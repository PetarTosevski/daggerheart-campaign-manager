import "./mocks";
import { mapGestures } from "../combat-view/map-mocks";
import { beforeEach, expect, test } from "@jest/globals";
import { act, fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { CombatEditTools } from "../../../src/features/combat-map/edit/edit-tools";
import { api, type Id } from "../../../src/convex";
import { fn, renderAsGm } from "../../harness";
import { campaignId, editSlotQueries, liveLayout, playerViewOk } from "./fixtures";

beforeEach(() => {
  resetMotionTest();
});

const live = liveLayout({
  objects: [{ _id: "obj-1" as Id<"combatMapObjects">, kind: "tree", x: 1, y: 1, r: 1, rot: 0 }],
});
const id = campaignId as Id<"campaigns">;

async function render(calls: Record<string, unknown[]>) {
  const screen = await renderAsGm(<CombatEditTools campaignId={id} isGm layout={live} view={playerViewOk()} />, {
    queries: editSlotQueries(live),
    mutations: {
      [fn(api.combatMapEdit.moveObject)]: (args) => {
        (calls.move ??= []).push(args);
        return null;
      },
      [fn(api.combatMapEdit.addObject)]: (args) => {
        (calls.add ??= []).push(args);
        return "obj-new";
      },
    },
  });
  await fireEvent.press(screen.getByText("Objects"));
  return screen;
}

// The view starts at 1 point per square before the viewport has a size, so screen points are squares here (`moved`
// is the drag's translation in points).
test("dragging an object with the Objects tool moves it (dcm-gdzi.17: the drag is no longer dead code)", async () => {
  const calls: Record<string, unknown[]> = {};
  await render(calls);
  const { pan } = mapGestures();
  await act(async () => {
    pan.onBegin({ x: 1.2, y: 1.2 });
    pan.onUpdate({ x: 3.4, y: 2.4, translationX: 12, translationY: 4 });
    pan.onEnd({ x: 3.4, y: 2.4, translationX: 12, translationY: 4 });
  });
  expect(calls.move).toHaveLength(1);
  expect(calls.move?.[0]).toMatchObject({ campaignId: id, objectId: "obj-1" });
  expect(calls.add).toBeUndefined();
});

test("a drag that starts off every object pans instead, and moves nothing", async () => {
  const calls: Record<string, unknown[]> = {};
  await render(calls);
  const { pan } = mapGestures();
  await act(async () => {
    pan.onBegin({ x: 3.5, y: 3.5 });
    pan.onUpdate({ x: 3.6, y: 3.5, translationX: 12, translationY: 0 });
    pan.onEnd({ x: 3.6, y: 3.5, translationX: 12, translationY: 0 });
  });
  expect(calls.move).toBeUndefined();
  expect(calls.add).toBeUndefined();
});
