import { mapGestures } from "../combat-view/map-mocks";
import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, waitFor } from "@testing-library/react-native";

import { encodeExplored } from "../../../../../src/lib/domain/combat-map/vision";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { CombatMapScreen } from "../../../src/features/combat-map";
import { CombatGmTools } from "../../../src/features/combat-map/gm/tools";
import { paintStats, resetPaintStats } from "../../../src/features/combat-map/paint-stats";
import { CampaignProvider, CampaignScreen } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";
import { api } from "../../../src/convex";
import { fn, renderAsGm } from "../../harness";
import { campaignId, gmSlotQueries, liveLayout, playerViewOk, tokenList } from "./fixtures";

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
  resetPaintStats();
});

const live = liveLayout();
const view = playerViewOk();

const moss = { ...tokenList()[0], _id: "tok-pc2", name: "Moss", characterId: "char-2", x: 3, y: 3 };

function tools() {
  return (
    <OfflineFrame offline={false}>
      <CombatGmTools campaignId={campaignId} isGm layout={live} view={view} />
    </OfflineFrame>
  );
}

function board() {
  return (
    <OfflineFrame offline={false}>
      <CampaignProvider campaignId={campaignId}>
        <CampaignScreen>
          <CombatMapScreen />
        </CampaignScreen>
      </CampaignProvider>
    </OfflineFrame>
  );
}

test("an adversary attack targets the PC the GM picks, not the first one (dcm-gdzi.17)", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(tools(), {
    queries: { ...gmSlotQueries(live), [fn(api.combatTokensReads.list)]: [...tokenList(), moss] },
    mutations: {
      [fn(api.adversaryActions.attack)]: (args) => {
        calls.push(args);
        return {
          status: "resolved",
          groupId: "g",
          entryId: "log-1",
          roll: { kind: "action", dice: [{ role: "d20", sides: 20, value: 17 }], modifier: 2, total: 19, outcome: "none", manual: false },
          success: true,
          targets: [{ characterId: "char-2", hit: true, damage: 8, resolved: false, requestId: "req-h" }],
          fearDelta: 0,
          prompts: [],
          offers: [],
        };
      },
    },
  });
  await fireEvent.press(screen.getByTestId("combat-adversary-tok-adv"));
  await fireEvent.press(screen.getByTestId("combat-adversary-target-char-2"));
  await fireEvent.press(screen.getByText("Bear attacks Moss"));
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ campaignId, instanceId: "inst-1", targets: ["char-2"] });
  expect(screen.getByText("Moss: Hit · 8 damage · waiting for their answer")).toBeTruthy();
});

test("every door on the map is listed and switches to the wanted state", async () => {
  const calls: unknown[] = [];
  const doors = Array.from({ length: 5 }, (_, i) => ({ _id: `door-${i}`, x: i, y: 0, r: 0.5, rot: 0, open: i === 4, solid: i !== 3, reach: true }));
  const screen = await renderAsGm(tools(), {
    queries: { ...gmSlotQueries(live), [fn(api.combatVision.doors)]: { mapId: live._id, doors } },
    mutations: {
      [fn(api.combatVision.toggleDoor)]: (args) => {
        calls.push(args);
        return { open: true };
      },
    },
  });
  for (const name of ["Door 1: open", "Door 2: open", "Door 3: open", "Gate 1: open", "Door 4: close"]) expect(screen.getByLabelText(name)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("Gate 1: open"));
  expect(calls).toEqual([{ campaignId, objectId: "door-3", open: true }]);
});

test("a refused door switch shows an alert instead of an unhandled rejection", async () => {
  const doors = [{ _id: "door-0", x: 0, y: 0, r: 0.5, rot: 0, open: false, solid: true, reach: true }];
  const screen = await renderAsGm(tools(), {
    queries: { ...gmSlotQueries(live), [fn(api.combatVision.doors)]: { mapId: live._id, doors } },
    mutations: {
      [fn(api.combatVision.toggleDoor)]: () => Promise.reject(new Error("boom")),
    },
  });
  await fireEvent.press(screen.getByLabelText("Door 1: open"));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
});

test("a token is revealed to the PC the GM picks, and hidden again from one it was revealed to", async () => {
  const calls: { name: string; args: unknown }[] = [];
  const bear = { ...tokenList()[1], revealedTo: ["char-1"] };
  const screen = await renderAsGm(tools(), {
    queries: { ...gmSlotQueries(live), [fn(api.combatTokensReads.list)]: [tokenList()[0], moss, bear] },
    mutations: {
      [fn(api.combatVision.revealTo)]: (args) => {
        calls.push({ name: "reveal", args });
        return null;
      },
      [fn(api.combatVision.unrevealTo)]: (args) => {
        calls.push({ name: "unreveal", args });
        return null;
      },
    },
  });
  await fireEvent.press(screen.getAllByLabelText("Bear")[0]);
  await fireEvent.press(screen.getByLabelText("Reveal Bear to Moss"));
  await fireEvent.press(screen.getByLabelText("Hide Bear from Briar"));
  expect(calls).toEqual([
    { name: "reveal", args: { campaignId, tokenId: "tok-adv", characterId: "char-2" } },
    { name: "unreveal", args: { campaignId, tokenId: "tok-adv", characterId: "char-1" } },
  ]);
});

test("a GM Minion pick (rule switch D6 'GM picks') is answered from the GM tools", async () => {
  const calls: unknown[] = [];
  const offer = { kind: "minionOffer", requestId: "req-m", characterId: "char-1", characterName: "Briar", createdAt: 1, entryId: "log-9", extra: 1, candidates: [{ instanceId: "inst-m", tokenId: "tok-m", name: "Rotlings", available: 4 }] };
  const screen = await renderAsGm(tools(), {
    queries: { ...gmSlotQueries(live), [fn(api.combatRequestsReads.mine)]: [offer] },
    mutations: {
      [fn(api.combatActions.pickMinions)]: (args) => {
        calls.push(args);
        return { status: "resolved", defeated: 1, targets: [] };
      },
    },
  });
  expect(screen.getByText("Briar's attack: defeat 1 more Minion")).toBeTruthy();
  await fireEvent.press(screen.getByLabelText("One more from Rotlings"));
  await fireEvent.press(screen.getByLabelText("Defeat the picked Minions"));
  expect(calls[0]).toMatchObject({ entryId: "log-9", instanceIds: ["inst-m"] });
});

const boardQueries = {
  ...gmSlotQueries(live),
  [fn(api.campaigns.timeOfDay)]: { phase: null, light: "night", canSet: true },
};

async function openBoard(queries: Record<string, unknown>, mutations: Record<string, (args: unknown) => unknown> = {}) {
  const screen = await renderAsGm(board(), { queries, mutations });
  await fireEvent(screen.getByTestId("combat-viewport"), "layout", { nativeEvent: { layout: { width: 360, height: 360, x: 0, y: 0 } } });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  await fireEvent.press(screen.getByRole("button", { name: "Open GM combat tools" }));
  return screen;
}

test("the fog brush paints one stroke on the GM's map: one combatVision:paintFog with the brushed squares", async () => {
  const calls: unknown[] = [];
  const screen = await openBoard(boardQueries, {
    [fn(api.combatVision.paintFog)]: (args) => {
      calls.push(args);
      return null;
    },
  });
  await fireEvent.press(screen.getByLabelText("Fog brush Hide"));
  expect(screen.getByText("Fog brush: hide · drag to paint")).toBeTruthy();
  const { pan } = mapGestures();
  await act(async () => {
    pan.onBegin({ x: 180, y: 180 });
    pan.onUpdate({ x: 250, y: 180, translationX: 70, translationY: 0 });
    pan.onEnd({ x: 250, y: 180, translationX: 70, translationY: 0 });
  });
  expect(calls).toHaveLength(1);
  const sent = calls[0] as { mapId: string; mark: string; squares: number[] };
  expect(sent).toMatchObject({ campaignId, mapId: live._id, mark: "hide" });
  expect(sent.squares.length).toBeGreaterThan(0);
  expect(sent.squares.every((s) => s >= 0 && s < live.w * live.h)).toBe(true);
});

test("the GM's own view gets the night tint and the fog marks; with the brush off a drag pans and paints nothing", async () => {
  const calls: unknown[] = [];
  // Square (0, 0) marked hide and (1, 0) reveal on a 4-wide map.
  const marked = liveLayout({ cells: [{ layer: "fog", tile: 0, cells: `hr${".".repeat(14)}` }] as never });
  const screen = await openBoard({ ...boardQueries, [fn(api.combatMaps.live)]: marked }, {
    [fn(api.combatVision.paintFog)]: (args) => {
      calls.push(args);
      return null;
    },
  });
  // The base rect, the night tint and one rect per mark run.
  expect(screen.getAllByTestId("skia-rect", { includeHiddenElements: true }).length).toBe(4);
  const { pan } = mapGestures();
  await act(async () => {
    pan.onBegin({ x: 180, y: 180 });
    pan.onUpdate({ x: 250, y: 180, translationX: 70, translationY: 0 });
    pan.onEnd({ x: 250, y: 180, translationX: 70, translationY: 0 });
  });
  expect(calls).toEqual([]);
});

test("previewing a PC draws that PC's fog and only the tokens they see on the GM's map", async () => {
  const seen = new Uint8Array(64);
  seen[18] = 1;
  const preview = playerViewOk({ vision: { sw: 8, sh: 8, scale: 2, seen: encodeExplored(seen), clear: encodeExplored(new Uint8Array(64)) } });
  const screen = await openBoard({ ...boardQueries, [fn(api.combatVision.previewAs)]: preview });
  expect(paintStats.fog).toBe(0);
  expect(screen.getByLabelText("Bear, enemy")).toBeTruthy();
  await fireEvent.press(screen.getAllByLabelText("Briar").find((n) => n.props.accessibilityRole === "button")!);
  await waitFor(() => expect(paintStats.fog).toBe(1));
  expect(screen.getByText("Previewing Briar")).toBeTruthy();
  expect(screen.queryByLabelText("Bear, enemy")).toBeNull();
});
