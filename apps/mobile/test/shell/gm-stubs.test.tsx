import { expect, test } from "@jest/globals";

import EncounterRoute from "../../app/campaign/[campaignId]/(gm)/adversaries/[encounterId]";
import PacksRoute from "../../app/campaign/[campaignId]/(gm)/packs";
import { CampaignProvider } from "../../src/shell/campaign-provider";
import { renderAsGm, renderAsPlayer } from "../harness";

const base = {
  _id: "campaign-1",
  name: "The Table",
};

test("a player who opens packs lands on the dashboard and does not subscribe to a GM function", async () => {
  const screen = await renderAsPlayer(
    <CampaignProvider campaignId="campaign-1">
      <PacksRoute />
    </CampaignProvider>,
    { queries: { "campaigns:get": { ...base, role: "player" } } },
  );
  expect(screen.getByRole("header", { name: "Dashboard" })).toBeTruthy();
  expect(screen.queryByRole("header", { name: "Packs" })).toBeNull();
  expect(screen.client.subscribed).toEqual(["campaigns:get"]);
});

test("a player who opens an encounter lands on the dashboard and does not subscribe to a GM function", async () => {
  const screen = await renderAsPlayer(
    <CampaignProvider campaignId="campaign-1">
      <EncounterRoute />
    </CampaignProvider>,
    { queries: { "campaigns:get": { ...base, role: "player" } } },
  );
  expect(screen.getByRole("header", { name: "Dashboard" })).toBeTruthy();
  expect(screen.queryByRole("header", { name: "Encounter" })).toBeNull();
  expect(screen.client.subscribed).toEqual(["campaigns:get"]);
});

test("a GM query role opens the packs stub without a GM subscription", async () => {
  const screen = await renderAsGm(
    <CampaignProvider campaignId="campaign-1">
      <PacksRoute />
    </CampaignProvider>,
    { queries: { "campaigns:get": { ...base, role: "gm" } } },
  );
  expect(screen.getByRole("header", { name: "Packs" })).toBeTruthy();
  expect(screen.getByText("Not built yet.")).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["campaigns:get"]);
});

test("a GM query role opens the encounter stub without a GM subscription", async () => {
  const screen = await renderAsGm(
    <CampaignProvider campaignId="campaign-1">
      <EncounterRoute />
    </CampaignProvider>,
    { queries: { "campaigns:get": { ...base, role: "gm" } } },
  );
  expect(screen.getByRole("header", { name: "Encounter" })).toBeTruthy();
  expect(screen.getByText("Not built yet.")).toBeTruthy();
  expect(screen.client.subscribed).toEqual(["campaigns:get"]);
});
