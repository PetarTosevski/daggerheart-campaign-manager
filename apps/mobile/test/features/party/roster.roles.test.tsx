import { beforeEach, expect, jest, test } from "@jest/globals";
import { useQuery } from "convex/react";
import { Text } from "react-native";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { api } from "../../../src/convex";
import type { Id } from "../../../src/convex";
import { PartyScreen } from "../../../src/features/party";
import { QueryBoundary } from "../../../src/ui/query-boundary";
import { renderAsGm, renderAsPlayer } from "../../harness";
import { characterRecord, inCampaign, queriesFor } from "./fixture";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: jest.fn(), replace: jest.fn() }),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));

beforeEach(() => {
  resetMotionTest();
  mockPush.mockClear();
});

test("a player sees the roster and no GM controls", async () => {
  const screen = await renderAsPlayer(inCampaign("player", <PartyScreen />), {
    queries: queriesFor("player", [characterRecord({ canEdit: true, mine: true })]),
  });
  expect(screen.getByRole("header", { name: "The Party" })).toBeTruthy();
  expect(screen.getByText("Mira")).toBeTruthy();
  expect(screen.getByText("Yours")).toBeTruthy();
  expect(screen.getByText("Human · Ridgeborne")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Open character sheet" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Kill Mira" })).toBeTruthy();
  expect(screen.getByRole("header", { name: "Create character" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "+ Create character" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Import from photo" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Party levels up" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Delete Mira" })).toBeNull();
  expect(screen.queryByText("Unassigned (GM)")).toBeNull();
  expect(screen.client.subscribed).toEqual(["campaigns:get", "charactersReads:listByCampaign", "members:roster"]);
  expect(screen.client.called).toEqual([]);
});

test("a player who cannot edit a card gets no kill or portrait control", async () => {
  const screen = await renderAsPlayer(inCampaign("player", <PartyScreen />), {
    queries: queriesFor("player", [characterRecord({ canEdit: false, mine: false })]),
  });
  expect(screen.getByText("Former player")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Kill Mira" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Upload a portrait for Mira" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Party levels up" })).toBeNull();
});

test("the GM can mark the party for level-up and delete stays behind a confirm", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(inCampaign("gm", <PartyScreen />), {
    queries: queriesFor("gm", [characterRecord({ canEdit: true })]),
    mutations: {
      "levelUp:partyLevelUp": (args) => {
        calls.push(args);
        return { flagged: 1 };
      },
      "characters:remove": (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  expect(screen.getByRole("button", { name: "Delete Mira" })).toBeTruthy();
  expect(screen.getByText("Unassigned (GM)")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Party levels up" }));
  expect(calls[0]).toEqual({
    campaignId: "campaign-1",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
  });
  expect(screen.getByText("1 character can level up.")).toBeTruthy();
  await fireEvent.press(screen.getByRole("button", { name: "Delete Mira" }));
  expect(calls).toHaveLength(1);
  await fireEvent.press(screen.getByRole("button", { name: "Delete character" }));
  expect(calls[1]).toEqual({ characterId: "char-1" });
});

test("loading, empty, and offline states", async () => {
  const loading = await renderAsPlayer(inCampaign("player", <PartyScreen />), {
    queries: { "campaigns:get": queriesFor("player", [])["campaigns:get"] },
  });
  expect(loading.getByRole("progressbar", { name: "Loading the party" })).toBeTruthy();

  const empty = await renderAsPlayer(inCampaign("player", <PartyScreen />), {
    queries: queriesFor("player", []),
  });
  expect(empty.getByText("No characters yet. Create the first hero of this party.")).toBeTruthy();

  const calls: unknown[] = [];
  const offline = await renderAsPlayer(inCampaign("player", <PartyScreen />, true), {
    queries: queriesFor("player", [characterRecord({ canEdit: true })]),
    mutations: {
      "characters:setStatus": (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  expect(offline.getByText("Showing the last update.")).toBeTruthy();
  const kill = offline.getByRole("button", { name: "Kill Mira" });
  expect(kill.props.accessibilityState).toEqual({ disabled: true });
  await fireEvent.press(kill);
  expect(calls).toEqual([]);
});

test("a failing party query shows the error", async () => {
  function BrokenRoster() {
    useQuery(api.charactersReads.listByCampaign, { campaignId: "campaign-1" as Id<"campaigns"> });
    return <Text>Ready</Text>;
  }
  const screen = await renderAsPlayer(
    <QueryBoundary>
      <BrokenRoster />
    </QueryBoundary>,
    {
      queries: {
        "charactersReads:listByCampaign": () => {
          throw new Error("roster down");
        },
      },
    },
  );
  expect(screen.queryByText("Ready")).toBeNull();
  expect(screen.getByRole("header", { name: "Something went wrong" })).toBeTruthy();
  expect(screen.getByText("Something went wrong. Check your connection and try again.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
});

test("opening a card goes to that character's sheet route, so Android back returns to the party", async () => {
  const screen = await renderAsPlayer(inCampaign("player", <PartyScreen />), {
    queries: queriesFor("player", [characterRecord({ canEdit: true })]),
  });
  await fireEvent.press(screen.getByRole("button", { name: "Open character sheet" }));
  expect(mockPush).toHaveBeenCalledWith("/campaign/campaign-1/party/char-1");
  expect(screen.client.subscribed).not.toContain("charactersReads:get");
});
