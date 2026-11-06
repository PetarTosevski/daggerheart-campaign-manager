import { mapGestures } from "./map-mocks";
import { beforeEach, expect, jest, test } from "@jest/globals";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { Profiler } from "react";

import { encodeExplored } from "../../../../../src/lib/domain/combat-map/vision";
import { resetMotionTest } from "../../theme/mock-reanimated";
import { CombatMapScreen } from "../../../src/features/combat-map";
import { paintStats, resetPaintStats } from "../../../src/features/combat-map/paint-stats";
import { CampaignProvider, CampaignScreen } from "../../../src/shell/campaign-provider";
import { OfflineFrame } from "../../../src/shell/offline";
import { api } from "../../../src/convex";
import { fn, renderAsPlayer } from "../../harness";
import { campaignId, campaignRecord, liveLayout, playerViewOk } from "./fixtures";

jest.mock("expo-crypto", () => ({
  randomUUID: () => "00000000-0000-4000-8000-000000000001",
}));

beforeEach(() => {
  resetMotionTest();
  resetPaintStats();
});

/**
 * Paint budget (dcm-gdzi.14). The old screen repainted the whole padded map (and re-decoded every sprite) on every
 * live update and re-rendered the board on every pan frame. These tests count the expensive steps and React commits
 * across many gesture frames and live updates.
 */

let commits = 0;

function screenFor() {
  return (
    <Profiler id="combat" onRender={() => (commits += 1)}>
      <OfflineFrame offline={false}>
        <CampaignProvider campaignId={campaignId}>
          <CampaignScreen>
            <CombatMapScreen />
          </CampaignScreen>
        </CampaignProvider>
      </OfflineFrame>
    </Profiler>
  );
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
}

const seenMask = new Uint8Array(64);
seenMask[18] = 1;

function viewWith(tokenX: number, seen: Uint8Array) {
  return playerViewOk({
    vision: { sw: 8, sh: 8, scale: 2, seen: encodeExplored(seen), clear: encodeExplored(new Uint8Array(64)) },
    pcs: [{ ...(playerViewOk() as { pcs: object[] }).pcs[0], x: tokenX }],
  } as never);
}

test("300 pan and pinch frames paint nothing and re-render nothing", async () => {
  const screen = await renderAsPlayer(screenFor(), {
    queries: {
      [fn(api.campaigns.get)]: campaignRecord("player"),
      [fn(api.combatMaps.live)]: liveLayout(),
      [fn(api.combatVision.playerView)]: viewWith(1, seenMask),
    },
  });
  await fireEvent(screen.getByTestId("combat-viewport"), "layout", { nativeEvent: { layout: { width: 360, height: 360, x: 0, y: 0 } } });
  await waitFor(() => expect([paintStats.base, paintStats.fog]).toEqual([1, 1]));

  const { pan, pinch } = mapGestures();
  commits = 0;
  const started = Date.now();
  pan.onBegin({ x: 100, y: 100 });
  for (let i = 1; i <= 200; i++) pan.onUpdate({ x: 100 + i, y: 100, translationX: i, translationY: i / 2 });
  pinch.onBegin({});
  for (let i = 1; i <= 100; i++) pinch.onUpdate({ scale: 1 + i / 100, focalX: 180, focalY: 180 });
  const frameMs = (Date.now() - started) / 300;

  expect(commits).toBe(0);
  expect(paintStats.base).toBe(1);
  expect(paintStats.fog).toBe(1);
  // The JS work per frame is a little arithmetic on shared values (generous bound for a loaded CI machine).
  expect(frameMs).toBeLessThan(2);

  // Ending the drag updates the zoom label: one commit, still no paint.
  await act(async () => {
    pan.onEnd({ x: 300, y: 100, translationX: 200, translationY: 100 });
  });
  expect(commits).toBeGreaterThan(0);
  expect(commits).toBeLessThanOrEqual(2);
  expect(paintStats.base).toBe(1);
  expect(screen.getByLabelText(/^Zoom \d+%$/).props.accessibilityLabel).not.toBe("Zoom 100%");
});

test("live updates repaint only what changed: a token move or a new layout object paints nothing", async () => {
  let layout = liveLayout();
  let view = viewWith(1, seenMask);
  const screen = await renderAsPlayer(screenFor(), {
    queries: {
      [fn(api.campaigns.get)]: campaignRecord("player"),
      [fn(api.combatMaps.live)]: () => layout,
      [fn(api.combatVision.playerView)]: () => view,
    },
  });
  await fireEvent(screen.getByTestId("combat-viewport"), "layout", { nativeEvent: { layout: { width: 360, height: 360, x: 0, y: 0 } } });
  await waitFor(() => expect([paintStats.base, paintStats.fog]).toEqual([1, 1]));

  // 20 live updates: a fresh layout object with the same paint inputs (new updatedAt), and the token moving.
  for (let i = 0; i < 20; i++) {
    layout = liveLayout({ updatedAt: 100 + i });
    view = viewWith(1 + (i % 3), seenMask);
    await screen.rerender(screenFor());
  }
  await flush();
  expect(paintStats.base).toBe(1);
  // The vision text did not change: no new fog either.
  expect(paintStats.fog).toBe(1);

  // What the character sees changes: the fog rebuilds once.
  const wider = new Uint8Array(64);
  wider[18] = 1;
  wider[19] = 1;
  view = viewWith(2, wider);
  await screen.rerender(screenFor());
  await waitFor(() => expect(paintStats.fog).toBe(2));

  // A door or object change repaints the base once.
  layout = liveLayout({ updatedAt: 200, objects: [{ _id: "obj-1", kind: "crate", x: 2, y: 2, r: 1, rot: 0 }] as never });
  await screen.rerender(screenFor());
  await flush();
  expect(paintStats.base).toBe(2);
});
