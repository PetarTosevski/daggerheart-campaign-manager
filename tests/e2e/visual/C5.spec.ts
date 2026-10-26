import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { squareIndex } from "../../../src/components/combat-map/editor/edit-model";
import { D9_VIEWPORTS, openCombatMap, visual } from "./helpers";

// Shots for the C5 task doc (E2E_VISUAL=1): the Edit tools card with the terrain palette over a hand-edited map,
// and the selected-object card with the sight outlines and painted blockers. Board counterpart:
// `node scripts/board-shots.mjs combat:gm-edit`.

test("C5 edit tools and the selected object at 1440, 1024 and 390", { tag: "@visual" }, async ({ page }) => {
  const { client, campaignId, url } = await openCombatMap(page);
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old mill", idempotencyKey: crypto.randomUUID() });
  const w = 30;
  const row = (y: number, x0: number, x1: number) => Array.from({ length: x1 - x0 + 1 }, (_, i) => squareIndex(x0 + i, y, w));
  const floor = [5, 6, 7, 8, 9, 10, 11].flatMap((y) => row(y, 8, 19));
  await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: floor, paint: "stone" });
  await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: [...row(4, 7, 20), ...row(12, 7, 20)], paint: "wall" });
  await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: [...row(15, 0, 29), ...row(16, 0, 29)], paint: "water" });
  await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: row(8, 22, 25), paint: "block" });
  for (const [kind, x, y] of [
    ["tree", 4, 4],
    ["tree", 25, 3],
    ["bush", 3, 10],
    ["rock", 24, 12],
    ["campfire", 13.5, 8.5],
    ["barrel", 9.5, 6],
    ["table", 17, 9],
  ] as const) {
    await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind, x, y });
  }
  const { objectId: crate } = await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "crate", x: 10, y: 10 });
  await client.mutation(api.combatMapEdit.setObjectSight, { campaignId, objectId: crate, sight: "block" });

  await page.goto(url);
  const tools = page.getByRole("complementary", { name: "Map tools" });
  await expect(page.getByTestId("combat-map-canvas")).toBeVisible();
  await tools.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Edit map/ }).click();
  const card = tools.getByRole("region", { name: "Edit by hand" });
  await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Terrain/ }).click();
  await card.getByRole("button", { name: "stone", exact: true }).click();
  const { shoot } = visual(page, "C5", D9_VIEWPORTS);
  await shoot(page.locator(".cm-root"), "gm-edit");

  // The crate selected with the Objects tool: its card, the outlines and the painted blockers.
  await page.setViewportSize(D9_VIEWPORTS[0]);
  await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Objects/ }).click();
  const box = (await page.getByTestId("combat-stage").boundingBox())!;
  const step = box.width / w;
  await page.mouse.click(box.x + 10 * step, box.y + 10 * step);
  await expect(card.getByRole("group", { name: "Selected object: Crate" })).toBeVisible();
  await shoot(page.locator(".cm-root"), "gm-edit-object");
});
