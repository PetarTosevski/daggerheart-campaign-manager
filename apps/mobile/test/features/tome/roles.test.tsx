import { afterEach, beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { TomeScreen } from "../../../src/features/tome";
import { renderAsGm, renderAsPlayer } from "../../harness";
import { customCampaign, inCampaign, publishedCampaign } from "./fixture";

beforeEach(() => {
  resetMotionTest();
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test("a player reads a published frame tome from campaigns.get only", async () => {
  const screen = await renderAsPlayer(inCampaign(publishedCampaign("player"), <TomeScreen />), {
    queries: { "campaigns:get": publishedCampaign("player") },
  });
  expect(screen.getByRole("header", { name: "Tome" })).toBeTruthy();
  expect(screen.getByText("The Witherwild")).toBeTruthy();
  expect(screen.getByText(/Fanewick is a wild and untamed land/)).toBeTruthy();
  expect(screen.queryByLabelText("Edit Overview")).toBeNull();
  expect(screen.client.subscribed).toEqual(["campaigns:get"]);
  expect(screen.client.called).toEqual([]);
});

test("a player reads custom tome text and cannot edit", async () => {
  const screen = await renderAsPlayer(inCampaign(customCampaign("player"), <TomeScreen />), {
    queries: { "campaigns:get": customCampaign("player") },
  });
  expect(screen.getByText("The city remembers.")).toBeTruthy();
  expect(screen.queryByLabelText("Edit Overview")).toBeNull();
});

test("the GM edits a custom tome chapter with campaigns.updateTome", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(inCampaign(customCampaign("gm"), <TomeScreen />), {
    queries: { "campaigns:get": customCampaign("gm") },
    mutations: {
      "campaigns:updateTome": (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  expect(screen.getByLabelText("Edit Overview")).toBeTruthy();
  expect(screen.getByText(/A haunted city/)).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText("Edit Overview"), "The city remembers everything.");
  jest.advanceTimersByTime(650);
  expect(calls[0]).toEqual({
    campaignId: "campaign-1",
    chapter: "overview",
    text: "The city remembers everything.",
  });
});

test("the GM on a published frame sees book text without updateTome", async () => {
  const screen = await renderAsGm(inCampaign(publishedCampaign("gm"), <TomeScreen />), {
    queries: { "campaigns:get": publishedCampaign("gm") },
    mutations: {
      "campaigns:updateTome": (args) => args,
    },
  });
  expect(screen.getByText(/Fanewick is a wild and untamed land/)).toBeTruthy();
  expect(screen.queryByLabelText("Edit Overview")).toBeNull();
  expect(screen.client.called).toEqual([]);
});

test("switching chapters shows inciting incident content", async () => {
  const screen = await renderAsPlayer(inCampaign(publishedCampaign("player"), <TomeScreen />), {
    queries: { "campaigns:get": publishedCampaign("player") },
  });
  await fireEvent.press(screen.getByRole("tab", { name: "The Inciting Incident" }));
  expect(screen.getByText("Kreil Dirn")).toBeTruthy();
});

test("an empty custom chapter tells the player the GM has not written yet", async () => {
  const empty = customCampaign("player");
  empty.tome = { overview: "", incident: "", mechanics: "" };
  const screen = await renderAsPlayer(inCampaign(empty, <TomeScreen />), {
    queries: { "campaigns:get": empty },
  });
  expect(screen.getByText("Your GM hasn’t written this chapter yet.")).toBeTruthy();
});

test("switching chapters while a save is pending never writes one chapter's text into another", async () => {
  const calls: { chapter: string; text: string }[] = [];
  const screen = await renderAsGm(inCampaign(customCampaign("gm"), <TomeScreen />), {
    queries: { "campaigns:get": customCampaign("gm") },
    mutations: {
      "campaigns:updateTome": (args) => {
        calls.push(args as { chapter: string; text: string });
        return null;
      },
    },
  });
  await fireEvent.changeText(screen.getByLabelText("Edit Overview"), "Draft overview");
  await fireEvent.press(screen.getByRole("tab", { name: "The Inciting Incident" }));
  const incident = screen.getByLabelText("Edit The Inciting Incident");
  expect(incident.props.value).toBe("");
  await fireEvent.changeText(incident, "It begins");
  jest.advanceTimersByTime(650);
  expect(calls).toEqual([
    { campaignId: "campaign-1", chapter: "overview", text: "Draft overview" },
    { campaignId: "campaign-1", chapter: "incident", text: "It begins" },
  ]);
});
