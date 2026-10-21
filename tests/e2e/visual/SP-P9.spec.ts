import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { D9_VIEWPORTS, openCombatMap, visual } from "./helpers";

// Shots for the SP-P9 task doc (E2E_VISUAL=1): hand editing a Sprites forest map (the sprite picker with a search,
// the texture picker, a selected sprite's panel) at 1440, 1024 and 390, and the same edited map in Classic as the
// counterpart. No design board exists for sprites (plan rule "Visual acceptance").

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

test("SP-P9 sprite and texture pickers on an edited forest map, and its Classic counterpart", { tag: "@visual" }, async ({ page }) => {
  test.setTimeout(240_000);
  const { client, campaignId, url } = await openCombatMap(page);
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Glade", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "sprites" });
  await client.mutation(api.combatMapStyle.setSetting, { campaignId, mapId, setting: { builtin: "forest" } });
  // A moss clearing with a muddy path, oaks, pines, a bush, a stump and a campfire, placed through P9's intents.
  const w = 30;
  const rect = (x0: number, y0: number, x1: number, y1: number) => {
    const out: number[] = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(y * w + x);
    return out;
  };
  await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: rect(8, 5, 20, 14), paint: { layer: "texture", texture: { builtin: "forest/moss" } } });
  await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: rect(0, 9, 29, 10), paint: { layer: "texture", texture: { builtin: "forest/muddy-path" } } });
  for (const [key, x, y] of [
    ["forest/oak-tree", 6, 4],
    ["forest/oak-tree", 23, 15],
    ["forest/pine-tree", 4, 15],
    ["forest/pine-tree", 25, 5],
    ["forest/bush", 12, 7],
    ["forest/tree-stump", 17, 13],
    ["forest/hollow-log", 10, 13],
  ] as const) {
    await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, sprite: { builtin: key }, x, y });
  }
  await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "campfire", x: 15, y: 7 });

  await page.goto(url);
  await expect(page.getByTestId("combat-map-canvas")).toHaveAttribute("data-style", "sprites");
  const tools = page.getByRole("complementary", { name: "Map tools" });
  await tools.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Edit map/ }).click();
  const card = tools.getByRole("region", { name: "Edit by hand" });
  await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Objects/ }).click();
  await settle(page);
  const { shoot } = visual(page, "SP-P9", D9_VIEWPORTS);
  await shoot(card, "sprite-picker");
  await card.getByLabel("Search sprites").fill("tree");
  await settle(page);
  await shoot(card, "sprite-search");
  await card.getByLabel("Search sprites").fill("");

  // A selected oak: its name, the manifest sight as the default.
  const stage = page.getByTestId("combat-stage");
  await stage.evaluate((el) => el.scrollIntoView({ block: "start" }));
  const box = (await stage.boundingBox())!;
  await page.mouse.click(box.x + (6 / w) * box.width, box.y + (4 / w) * box.width);
  await expect(card.getByRole("group", { name: "Selected object: Oak tree" })).toBeVisible();
  await shoot(card.getByTestId("combat-object-panel"), "sprite-panel");

  await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Terrain/ }).click();
  await settle(page);
  await shoot(card, "texture-picker");
  await shoot(page.getByRole("region", { name: "Battle map" }), "map-sprites");

  // Counterpart: the same edited map in Classic.
  await client.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "classic" });
  await expect(page.getByTestId("combat-map-canvas")).toHaveAttribute("data-style", "classic");
  await settle(page);
  await shoot(page.getByRole("region", { name: "Battle map" }), "map-classic");
});
