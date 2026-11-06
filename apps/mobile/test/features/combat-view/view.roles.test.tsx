import "./map-mocks";
import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, waitFor } from "@testing-library/react-native";

import { encodeExplored } from "../../../../../src/lib/domain/combat-map/vision";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { CombatMapScreen } from "../../../src/features/combat-map";
import { paintStats, resetPaintStats } from "../../../src/features/combat-map/paint-stats";
import { CampaignProvider, CampaignScreen } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";
import { api } from "../../../src/convex";
import { fn, renderAsGm, renderAsPlayer } from "../../harness";
import { campaignId, campaignRecord, liveLayout, playerViewOk } from "./fixtures";
import { ruleSettingsRecord } from "../../harness/records";

jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
}));

beforeEach(() => {
  resetMotionTest();
  resetPaintStats();
});

function screenFor() {
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

const live = liveLayout();
const view = playerViewOk();

const playerQueries = {
  [fn(api.campaigns.get)]: campaignRecord("player"),
  [fn(api.combatMaps.live)]: live,
  [fn(api.combatVision.playerView)]: view,
};

const gmTokens = [
  { _id: "tok-1", kind: "pc", name: "Briar", side: "pc", x: 1, y: 1, size: 1, face: 0, light: "none", sub: "", portrait: null, canMove: true, mine: false, stats: null },
  { _id: "tok-9", kind: "adversary", name: "Bramble Brute", side: "enemy", x: 3, y: 2, size: 2, face: 0, light: "none", sub: "Bruiser", portrait: null, canMove: true, mine: false, stats: null },
];

const gmQueries = {
  [fn(api.campaigns.get)]: campaignRecord("gm"),
  [fn(api.combatMaps.live)]: live,
  [fn(api.combatTokensReads.list)]: gmTokens,
};

async function layoutViewport(screen: Awaited<ReturnType<typeof renderAsPlayer>>) {
  await fireEvent(screen.getByTestId("combat-viewport"), "layout", {
    nativeEvent: { layout: { width: 360, height: 360, x: 0, y: 0 } },
  });
}

/** Renders and lets the async paints (Skia load, base map, fog) land inside act. */
async function settle<T>(rendering: Promise<T>): Promise<T> {
  const screen = await rendering;
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  return screen;
}

const gmOnly = [fn(api.combatMaps.list), fn(api.combatMaps.get), fn(api.combatTokensReads.list), fn(api.combatVision.previewAs)];

test("a player sees their character's view: playerView, explored and the rules, never a GM combat read", async () => {
  const screen = await settle(renderAsPlayer(screenFor(), { queries: playerQueries }));
  await layoutViewport(screen);
  expect(screen.client.subscribed).toEqual(
    expect.arrayContaining([
      fn(api.combatMaps.live),
      fn(api.combatVision.playerView),
      fn(api.combatVision.explored),
      fn(api.ruleSettings.get),
      fn(api.combatHud.party),
      fn(api.combatHud.scene),
    ]),
  );
  for (const name of gmOnly) expect(screen.client.subscribed).not.toContain(name);
  expect(screen.getByTestId("combat-map-stage")).toBeTruthy();
  expect(screen.getByLabelText("Briar, yours, pc")).toBeTruthy();
  expect(screen.getByTestId("combat-play-slot", { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByTestId("combat-gm-slot", { includeHiddenElements: true })).toBeNull();
  // The player's fog is built (dcm-gdzi.11).
  await waitFor(() => expect(paintStats.fog).toBe(1));
});

test("the GM sees every token on the map from combatTokensReads.list, and no character view (dcm-gdzi.10)", async () => {
  const screen = await settle(renderAsGm(screenFor(), { queries: gmQueries }));
  await layoutViewport(screen);
  expect(screen.client.subscribed).toContain(fn(api.combatTokensReads.list));
  expect(screen.client.subscribed).not.toContain(fn(api.combatVision.playerView));
  expect(screen.client.subscribed).not.toContain(fn(api.combatVision.explored));
  expect(screen.getByLabelText("Briar, pc")).toBeTruthy();
  expect(screen.getByLabelText("Bramble Brute, enemy")).toBeTruthy();
  expect(screen.getByTestId("combat-gm-slot", { includeHiddenElements: true })).toBeTruthy();
  expect(screen.queryByTestId("combat-play-slot", { includeHiddenElements: true })).toBeNull();
  await waitFor(() => expect(paintStats.base).toBe(1));
  expect(paintStats.fog).toBe(0);
});

test("a player on an uploaded image map still gets fog, and nothing is painted for the base (dcm-gdzi.11)", async () => {
  const image = liveLayout({ source: "image", image: { url: "https://example.test/map.png", grid: { cell: 50, offsetX: 0, offsetY: 0 } } });
  const screen = await settle(renderAsPlayer(screenFor(), { queries: { ...playerQueries, [fn(api.combatMaps.live)]: image } }));
  await layoutViewport(screen);
  await waitFor(() => expect(paintStats.fog).toBe(1));
  expect(paintStats.base).toBe(0);
});

test("a player's view writes markSeen and markExplored once, like the website (dcm-gdzi.12)", async () => {
  const seen = new Uint8Array(64);
  seen[0] = 1;
  seen[9] = 1;
  const watching = playerViewOk({
    unseenAdversaries: ["tok-9"],
    vision: { sw: 8, sh: 8, scale: 2, seen: encodeExplored(seen), clear: encodeExplored(new Uint8Array(64)) },
  } as never);
  const calls: { name: string; args: unknown }[] = [];
  const record = (name: string) => (args: unknown) => {
    calls.push({ name, args });
    return Promise.resolve(name === fn(api.combatVision.markSeen) ? { added: 1 } : { grew: true });
  };
  const handlers = {
    queries: {
      ...playerQueries,
      [fn(api.combatVision.playerView)]: watching,
      [fn(api.combatVision.explored)]: { mapId: "map-1", characterId: "char-1", length: 64, bits: "" },
    },
    mutations: {
      [fn(api.combatVision.markSeen)]: record(fn(api.combatVision.markSeen)),
      [fn(api.combatVision.markExplored)]: record(fn(api.combatVision.markExplored)),
    },
  };
  const screen = await settle(renderAsPlayer(screenFor(), handlers));
  await waitFor(() => expect(calls.map((c) => c.name).sort()).toEqual([fn(api.combatVision.markExplored), fn(api.combatVision.markSeen)]));
  expect(calls.find((c) => c.name === fn(api.combatVision.markSeen))?.args).toEqual({ campaignId, characterId: "char-1", tokenIds: ["tok-9"] });
  expect(calls.find((c) => c.name === fn(api.combatVision.markExplored))?.args).toEqual({
    campaignId,
    mapId: "map-1",
    characterId: "char-1",
    bits: encodeExplored(seen),
  });
  // The same view rendered again sends nothing more.
  await screen.rerender(screenFor());
  await act(async () => {
    await Promise.resolve();
  });
  expect(calls).toHaveLength(2);
});

test("the dim-light badge follows M3 Darkness: shown in Book, hidden in Manual", async () => {
  const dim = playerViewOk({ light: "dim" } as never);
  const book = await settle(renderAsPlayer(screenFor(), {
    queries: { ...playerQueries, [fn(api.combatVision.playerView)]: dim, [fn(api.ruleSettings.get)]: ruleSettingsRecord({ darkness: "book" }, { locked: false, canEdit: false }) },
  }));
  expect(book.getByText("Dim light: ranged attacks at disadvantage")).toBeTruthy();
  await book.unmount();
  const manual = await settle(renderAsPlayer(screenFor(), {
    queries: { ...playerQueries, [fn(api.combatVision.playerView)]: dim, [fn(api.ruleSettings.get)]: ruleSettingsRecord({ darkness: "manual" }, { locked: false, canEdit: false }) },
  }));
  expect(manual.queryByTestId("combat-light-badge")).toBeNull();
});

test("shows an empty state when no map is live", async () => {
  const screen = await settle(renderAsPlayer(screenFor(), {
    queries: {
      ...playerQueries,
      [fn(api.combatMaps.live)]: null,
      [fn(api.combatVision.playerView)]: { state: "noMap" },
    },
  }));
  expect(screen.getByText("The GM has not shown a map yet.")).toBeTruthy();
  expect(screen.queryByTestId("combat-empty-gm")).toBeNull();
  expect(screen.client.subscribed).not.toContain(fn(api.combatMaps.list));
});

test("a GM with no live map can start one without opening the other GM tools", async () => {
  const screen = await settle(renderAsGm(screenFor(), {
    queries: {
      ...gmQueries,
      [fn(api.combatMaps.live)]: null,
      [fn(api.combatMaps.list)]: [],
    },
  }));
  expect(screen.getByTestId("combat-empty-gm")).toBeTruthy();
  expect(screen.getByText("New Small map")).toBeTruthy();
  expect(screen.client.subscribed).toContain(fn(api.combatMaps.list));
  expect(screen.client.subscribed).not.toContain(fn(api.combatTokensReads.list));
});
