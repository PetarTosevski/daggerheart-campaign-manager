import { beforeEach, expect, jest, test } from "@jest/globals";
import { useQuery } from "convex/react";
import { Text } from "react-native";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { api } from "../../../src/convex";
import type { Id } from "../../../src/convex";
import { CodexEntryRoute, CodexScreen } from "../../../src/features/codex";
import { QueryBoundary } from "../../../src/features/sheet/query-boundary";
import { renderAsGm, renderAsPlayer } from "../../harness";
import {
  campaignId,
  entryQueries,
  gmCharacter,
  gmList,
  inCampaign,
  listQueries,
  playerCharacter,
  playerList,
} from "./fixture";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: mockReplace }),
  useLocalSearchParams: () => ({ entryId: "entry-1" }),
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => "11111111-1111-4111-8111-111111111111",
}));

beforeEach(() => {
  resetMotionTest();
  mockPush.mockReset();
  mockBack.mockReset();
  mockReplace.mockReset();
});

test("a player sees the list and no create control", async () => {
  const screen = await renderAsPlayer(inCampaign("player", <CodexScreen />), {
    queries: listQueries("player", playerList([playerCharacter()])),
  });
  expect(screen.getByRole("header", { name: "Characters & Locations" })).toBeTruthy();
  expect(screen.getByText("Kreil Dirn")).toBeTruthy();
  expect(screen.getByText("What your party knows")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "New character" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Player view" })).toBeNull();
  expect(screen.client.subscribed).toEqual(["campaigns:get", "codex:list"]);
  expect(screen.client.called).toEqual([]);
});

test("a player opening an entry sees public notes but not GM notes", async () => {
  const screen = await renderAsPlayer(inCampaign("player", <CodexEntryRoute />), {
    queries: entryQueries("player", playerList([playerCharacter()]), {
      role: "player",
      pdesc: "A careful ally.",
    }),
  });
  expect(screen.getByRole("header", { name: "Kreil Dirn" })).toBeTruthy();
  expect(screen.getByText("A careful ally.")).toBeTruthy();
  expect(screen.queryByText("GM notes")).toBeNull();
  expect(screen.queryByText("Never shown to players.")).toBeNull();
  expect(screen.client.subscribed).toEqual(["campaigns:get", "codex:list", "codex:entryText"]);
});

test("the GM sees create controls and GM notes on an entry", async () => {
  const screen = await renderAsGm(inCampaign("gm", <CodexScreen />), {
    queries: listQueries("gm", gmList([gmCharacter()])),
  });
  expect(screen.getByRole("button", { name: "New character" })).toBeTruthy();
  expect(screen.queryByText("Secret")).toBeNull();
  expect(screen.getByText("Known")).toBeTruthy();
});

test("the GM entry editor loads GM notes and can create a character", async () => {
  const calls: unknown[] = [];
  const list = await renderAsGm(inCampaign("gm", <CodexScreen />), {
    queries: listQueries("gm", gmList([gmCharacter()], [{ id: 1, name: "Haven gate", x: 50, y: 40, hidden: false, type: "city" }])),
    mutations: {
      "codex:create": (args) => {
        calls.push(args);
        return { entryId: "entry-new" };
      },
    },
  });
  await fireEvent.press(list.getByRole("button", { name: "New character" }));
  expect(calls[0]).toEqual({
    campaignId,
    kind: "character",
    idempotencyKey: "11111111-1111-4111-8111-111111111111",
  });
  expect(mockPush).toHaveBeenCalledWith(`/campaign/${campaignId}/codex/entry-new`);

  const detail = await renderAsGm(inCampaign("gm", <CodexEntryRoute />), {
    queries: entryQueries(
      "gm",
      gmList([gmCharacter()]),
      { role: "gm", pdesc: "Public line.", gmn: "Hidden motive." },
    ),
  });
  expect(detail.getByDisplayValue("Hidden motive.")).toBeTruthy();
  expect(detail.getByText("Never shown to players.")).toBeTruthy();
  expect(detail.queryByRole("button", { name: "Show on map" })).toBeNull();
});

test("a location with a pin offers show on map", async () => {
  const screen = await renderAsPlayer(inCampaign("player", <CodexEntryRoute />), {
    queries: entryQueries(
      "player",
      playerList([playerCharacter({ kind: "location", name: "The Abbey", role: "Ruins", tokenId: 3, region: "Haven" })]),
      { role: "player", pdesc: "" },
    ),
  });
  await fireEvent.press(screen.getByRole("button", { name: "Show on map" }));
  expect(mockPush).toHaveBeenCalledWith(`/campaign/${campaignId}/world?token=3`);
});

test("loading and failing codex queries", async () => {
  const loading = await renderAsPlayer(inCampaign("player", <CodexScreen />), {
    queries: { "campaigns:get": listQueries("player", playerList([]))["campaigns:get"] },
  });
  expect(loading.getByRole("progressbar", { name: "Loading characters and locations" })).toBeTruthy();

  function BrokenList() {
    useQuery(api.codex.list, { campaignId: campaignId as Id<"campaigns"> });
    return <Text>Ready</Text>;
  }
  const broken = await renderAsPlayer(
    <QueryBoundary>
      <BrokenList />
    </QueryBoundary>,
    {
      queries: {
        "campaigns:get": listQueries("player", playerList([]))["campaigns:get"],
        "codex:list": () => {
          throw new Error("Codex offline");
        },
      },
    },
  );
  expect(broken.queryByText("Ready")).toBeNull();
  expect(broken.getByRole("header", { name: "Something went wrong" })).toBeTruthy();
});
