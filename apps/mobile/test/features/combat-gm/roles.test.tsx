import { beforeEach, expect, jest, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { CombatGmSlot } from "../../../src/features/combat-map/gm";
import { CombatGmTools } from "../../../src/features/combat-map/gm/tools";
import { OfflineFrame } from "../../../src/shell/offline";
import { renderAsGm, renderAsPlayer } from "../../harness";
import { campaignId, gmSlotQueries, liveLayout, playerViewOk } from "./fixtures";

jest.mock("expo-crypto", () => {
  let keys = 0;
  return {
    randomUUID: () => {
      keys += 1;
      return `00000000-0000-4000-8000-${String(keys).padStart(12, "0")}`;
    },
  };
});

beforeEach(() => {
  resetMotionTest();
});

const live = liveLayout();
const view = playerViewOk();

function gmSlot(isGm: boolean, tools = false) {
  return (
    <OfflineFrame offline={false}>
      {tools ? (
        <CombatGmTools campaignId={campaignId} isGm={isGm} layout={live} view={view} />
      ) : (
        <CombatGmSlot campaignId={campaignId} isGm={isGm} layout={live} view={view} />
      )}
    </OfflineFrame>
  );
}

async function openTools(screen: Awaited<ReturnType<typeof renderAsGm>>) {
  await fireEvent.press(screen.getByRole("button", { name: "Open GM combat tools" }));
}

test("a closed GM slot does not subscribe to GM-only combat reads", async () => {
  const forbidden = ["combatMaps:list", "combatTokensReads:list", "combatVision:previewAs"];
  const screen = await renderAsGm(gmSlot(true), { queries: gmSlotQueries(live) });
  expect(screen.getByRole("button", { name: "Open GM combat tools" })).toBeTruthy();
  for (const name of forbidden) {
    expect(screen.client.subscribed).not.toContain(name);
  }
});

test("CombatGmSlot renders nothing for a player and never subscribes to GM combat queries", async () => {
  const screen = await renderAsPlayer(gmSlot(false), {
    queries: {
      "campaigns:fear": 0,
    },
  });
  expect(screen.queryByTestId("combat-gm-slot")).toBeNull();
  expect(screen.client.subscribed).toEqual([]);
});

test("the GM combat tools subscribe to map, token, vision and encounter reads", async () => {
  const screen = await renderAsGm(gmSlot(true), { queries: gmSlotQueries(live) });
  await openTools(screen);
  expect(screen.getByTestId("combat-gm-slot")).toBeTruthy();
  expect(screen.getByTestId("combat-fear")).toBeTruthy();
  expect(screen.getByTestId("combat-hand-sharing")).toBeTruthy();
  expect(screen.client.subscribed).toContain("combatMaps:list");
  expect(screen.client.subscribed).toContain("combatTokensReads:list");
  expect(screen.client.subscribed).toContain("combatTokensReads:combatants");
  expect(screen.client.subscribed).toContain("combatCardsReads:handSharing");
  expect(screen.client.subscribed).toContain("encounters:list");
  expect(screen.client.subscribed).toContain("combatRequestsReads:mine");
});

test("Make live sends combatMaps:setLive", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(gmSlot(true, true), {
    queries: gmSlotQueries(live),
    mutations: {
      "combatMaps:setLive": (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Make live" }));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ campaignId, mapId: "map-2" });
});

test("Fear increase sends fear:adjust", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(gmSlot(true, true), {
    queries: gmSlotQueries(live),
    mutations: {
      "fear:adjust": (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Increase Fear" }));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ campaignId, direction: "increase" });
});

test("hand sharing toggles campaigns:setPlayersSeeHands", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(gmSlot(true, true), {
    queries: gmSlotQueries(live),
    mutations: {
      "campaigns:setPlayersSeeHands": (args) => {
        calls.push(args);
        return null;
      },
    },
  });
  await fireEvent.press(screen.getByRole("switch", { name: "Players can see each other's cards" }));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ campaignId, enabled: false });
});

test("preview as a PC subscribes to combatVision:previewAs", async () => {
  const screen = await renderAsGm(gmSlot(true, true), {
    queries: {
      ...gmSlotQueries(live),
      "combatVision:previewAs": playerViewOk(),
    },
  });
  await fireEvent.press(screen.getByRole("button", { name: "Briar" }));
  expect(screen.client.subscribed).toContain("combatVision:previewAs");
});
