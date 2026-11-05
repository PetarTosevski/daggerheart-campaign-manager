import "./mocks";
import { beforeEach, expect, test } from "@jest/globals";
import { fireEvent } from "@testing-library/react-native";

import { resetMotionTest } from "../../theme/mock-reanimated";
import { CombatEditTools } from "../../../src/features/combat-map/edit/edit-tools";
import type { Id } from "../../../src/convex";
import { renderAsGm } from "../../harness";
import { campaignId, editSlotQueries, liveLayout, playerViewOk } from "./fixtures";

beforeEach(() => {
  resetMotionTest();
});

const live = liveLayout({
  objects: [{ _id: "obj-1" as Id<"combatMapObjects">, kind: "tree", x: 1, y: 1, r: 1, rot: 0 }],
});
const view = playerViewOk();
const id = campaignId as Id<"campaigns">;

test("undo all painting calls combatMapEdit:clearPaint", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(
    <CombatEditTools campaignId={id} isGm layout={live} view={view} />,
    {
      queries: editSlotQueries(live),
      mutations: {
        "combatMapEdit:clearPaint": (args) => {
          calls.push(args);
          return null;
        },
      },
    },
  );
  await fireEvent.press(screen.getByText("Terrain"));
  await fireEvent.press(screen.getByRole("button", { name: "Undo all painting" }));
  expect(calls).toEqual([{ campaignId: id, mapId: live._id, layer: "terrain" }]);
});

test("Classic style switch calls combatMapStyle:setStyle", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(
    <CombatEditTools campaignId={id} isGm layout={live} view={view} />,
    {
      queries: editSlotQueries(live),
      mutations: {
        "combatMapStyle:setStyle": (args) => {
          calls.push(args);
          return null;
        },
      },
    },
  );
  await fireEvent.press(screen.getByText("Sprites"));
  expect(calls).toEqual([{ campaignId: id, mapId: live._id, style: "sprites" }]);
});

test("picking a setting calls combatMapStyle:setSetting", async () => {
  const calls: unknown[] = [];
  const screen = await renderAsGm(
    <CombatEditTools campaignId={id} isGm layout={live} view={view} />,
    {
      queries: editSlotQueries(live),
      mutations: {
        "combatMapStyle:setSetting": (args) => {
          calls.push(args);
          return null;
        },
      },
    },
  );
  await fireEvent.press(screen.getByText("Forest"));
  expect(calls).toEqual([{ campaignId: id, mapId: live._id, setting: { builtin: "forest" } }]);
});
