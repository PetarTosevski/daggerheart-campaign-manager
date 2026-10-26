import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { decodeCells } from "../../src/components/combat-map/map-view/cells";
import { openCombatMap } from "./visual/helpers";

// D9 C5: editing a map by hand (.omc/plans/d9-combat-map.yaml). The GM paints a stone floor, adds a tree and a
// crate, sets the crate to block sight; a reload keeps them. A stroke repaints only the squares it changed.

/** Page coordinates of the centre of square (x, y) on the stage (the GM's stage has no padding). */
async function squareCentre(stage: Locator, w: number, x: number, y: number) {
  // The tool column can be taller than the window (Scene card + Edit card), and picking a tool scrolls the page:
  // bring the map's top back into view so the square is on screen.
  await stage.evaluate((el) => el.scrollIntoView({ block: "start" }));
  const box = (await stage.boundingBox())!;
  const step = box.width / w;
  return { x: box.x + (x + 0.5) * step, y: box.y + (y + 0.5) * step };
}

/** Records the size of every terrain write the painter makes (putImageData), to tell a full paint from a dirty one. */
async function recordTerrainWrites(page: Page) {
  await page.addInitScript(() => {
    const writes: { w: number; h: number }[] = [];
    (window as unknown as { __terrainWrites: typeof writes }).__terrainWrites = writes;
    const put = CanvasRenderingContext2D.prototype.putImageData;
    CanvasRenderingContext2D.prototype.putImageData = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof put>) {
      writes.push({ w: args[0].width, h: args[0].height });
      return put.apply(this, args);
    } as typeof put;
  });
}

const terrainWrites = (page: Page) => page.evaluate(() => (window as unknown as { __terrainWrites: { w: number; h: number }[] }).__terrainWrites.slice());

test("the GM paints a stone floor, adds a tree and a crate, sets the crate to block sight; a reload keeps them", async ({ page }) => {
  await recordTerrainWrites(page);
  const { client, campaignId, url } = await openCombatMap(page);
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old mill", idempotencyKey: crypto.randomUUID() });
  await page.goto(url);
  const tools = page.getByRole("complementary", { name: "Map tools" });
  const stage = page.getByTestId("combat-stage");
  await expect(page.getByTestId("combat-map-canvas")).toBeVisible();
  await tools.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Edit map/ }).click();
  const card = tools.getByRole("region", { name: "Edit by hand" });
  await expect(card).toBeVisible();

  // ---- Terrain: stone, 3-square brush, one stroke from square (4, 6) to (9, 6).
  await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Terrain/ }).click();
  await card.getByRole("button", { name: "stone", exact: true }).click();
  await card.getByRole("button", { name: "Brush 3 × 3 squares" }).click();
  await expect(card.getByRole("button", { name: "stone", exact: true })).toHaveAttribute("aria-pressed", "true");
  const fullWrite = 30 * 48;
  await expect.poll(async () => (await terrainWrites(page)).some((wr) => wr.w === fullWrite)).toBe(true);
  const before = (await terrainWrites(page)).length;
  const from = await squareCentre(stage, 30, 4, 6);
  const to = await squareCentre(stage, 30, 9, 6);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
  await expect(card.getByRole("button", { name: "Undo all painting" })).toBeVisible();
  // The stroke repainted only around the painted squares (C3's dirty rectangle), never the whole map.
  await expect.poll(async () => (await terrainWrites(page)).length).toBeGreaterThan(before);
  const strokeWrites = (await terrainWrites(page)).slice(before);
  for (const wr of strokeWrites) expect(wr.w).toBeLessThan(fullWrite);

  // ---- Objects: a tree at (5, 12), a crate at (14, 12).
  await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Objects/ }).click();
  await card.getByRole("button", { name: "Tree", exact: true }).click();
  const treeAt = await squareCentre(stage, 30, 5, 12);
  await page.mouse.click(treeAt.x, treeAt.y);
  await expect(card.getByRole("group", { name: "Selected object: Tree" })).toBeVisible();
  await card.getByRole("button", { name: "Crate", exact: true }).click();
  const crateAt = await squareCentre(stage, 30, 14, 12);
  await page.mouse.click(crateAt.x, crateAt.y);
  const crate = card.getByRole("group", { name: "Selected object: Crate" });
  await expect(crate).toBeVisible();
  await expect(crate.getByRole("button", { name: "Cover only" })).toHaveAttribute("aria-pressed", "true");
  await crate.getByRole("button", { name: "Blocks sight" }).click();
  await expect(crate.getByRole("button", { name: "Blocks sight" })).toHaveAttribute("aria-pressed", "true");
  await expect(crate).toContainText("Set by hand (default: cover only).");

  // ---- Stored (the server's copy, not just the optimistic one).
  await expect
    .poll(async () => {
      const layout = await client.query(api.combatMaps.get, { campaignId, mapId });
      return layout?.objects.map((o) => `${o.kind}:${o.sight ?? "default"}`).sort();
    })
    .toEqual(["crate:block", "tree:default"]);
  const layout = (await client.query(api.combatMaps.get, { campaignId, mapId }))!;
  const paint = decodeCells(layout.cells, layout.w, layout.h).paint;
  for (let x = 3; x <= 10; x++) for (let y = 5; y <= 7; y++) expect([x, y, paint[`${x},${y}`]]).toEqual([x, y, "stone"]);
  expect(Object.keys(paint)).toHaveLength(8 * 3);

  // ---- Reload: the floor, both objects and the crate's sight setting are still there.
  await page.reload();
  await expect(page.getByTestId("combat-map-canvas")).toBeVisible();
  await tools.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Edit map/ }).click();
  await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Objects/ }).click();
  await expect(card.getByRole("button", { name: "Undo all painting" })).toHaveCount(0); // only on the Terrain tool
  const crateAgain = await squareCentre(stage, 30, 14, 12);
  await page.mouse.click(crateAgain.x, crateAgain.y);
  await expect(card.getByRole("group", { name: "Selected object: Crate" }).getByRole("button", { name: "Blocks sight" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  const treeAgain = await squareCentre(stage, 30, 5, 12);
  await page.mouse.click(treeAgain.x, treeAgain.y);
  await expect(card.getByRole("group", { name: "Selected object: Tree" }).getByRole("button", { name: "Blocks sight" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  // ---- Drag the tree to (8, 15) and delete the crate with the Delete key.
  const treeTo = await squareCentre(stage, 30, 8, 15);
  await page.mouse.move(treeAgain.x, treeAgain.y);
  await page.mouse.down();
  await page.mouse.move(treeTo.x, treeTo.y, { steps: 6 });
  await page.mouse.up();
  await page.mouse.click(crateAgain.x, crateAgain.y);
  await expect(card.getByRole("group", { name: "Selected object: Crate" })).toBeVisible();
  await page.keyboard.press("Delete");
  await expect(card.getByRole("group", { name: "Selected object: Crate" })).toHaveCount(0);
  await expect
    .poll(async () => (await client.query(api.combatMaps.get, { campaignId, mapId }))?.objects.map((o) => [o.kind, o.x, o.y]))
    .toEqual([["tree", 8.5, 15.5]]);

  // ---- Sight blockers: a stroke of Block sight, then Clear sight (Erase terrain leaves blockers alone).
  await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Block sight/ }).click();
  const wallAt = await squareCentre(stage, 30, 20, 3);
  await page.mouse.click(wallAt.x, wallAt.y);
  await expect.poll(async () => [...decodeCells((await client.query(api.combatMaps.get, { campaignId, mapId }))!.cells, 30, 20).block]).toEqual(["20,3"]);
  // Picking a tool can scroll the page, so the square's position is read again after each pick.
  await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Erase terrain/ }).click();
  let at = await squareCentre(stage, 30, 20, 3);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => [...decodeCells((await client.query(api.combatMaps.get, { campaignId, mapId }))!.cells, 30, 20).block]).toEqual(["20,3"]);
  await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Clear sight/ }).click();
  at = await squareCentre(stage, 30, 20, 3);
  await page.mouse.click(at.x, at.y);
  await expect.poll(async () => decodeCells((await client.query(api.combatMaps.get, { campaignId, mapId }))!.cells, 30, 20).block.size).toBe(0);
});

/** A 600 x 400 PNG with a 40 px grid printed on it, drawn in the browser. */
async function gridPng(page: Page): Promise<Blob> {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(600, 400);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#6f8f3a";
    ctx.fillRect(0, 0, 600, 400);
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    for (let x = 0; x <= 600; x += 40) ctx.strokeRect(x + 0.5, 0, 0, 400);
    for (let y = 0; y <= 400; y += 40) ctx.strokeRect(0, y + 0.5, 600, 0);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
    let text = "";
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text);
  });
  return new Blob([Buffer.from(base64, "base64")], { type: "image/png" });
}

test("an uploaded image offers the sight tools only; Move view lets the map pan", async ({ page }) => {
  const { client, campaignId, url } = await openCombatMap(page);
  await client.mutation(api.combatMaps.create, { campaignId, size: "small", name: "Glade", idempotencyKey: crypto.randomUUID() });
  const uploadUrl = await client.mutation(api.combatMaps.imageUploadUrl, { campaignId });
  const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "image/png" }, body: await gridPng(page) });
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
  const attached = await client.mutation(api.combatMaps.attachImage, { campaignId, storageId, width: 600, height: 400, name: "Crypt", size: "small" });
  expect(attached.ok).toBe(true);

  await page.goto(url);
  const tools = page.getByRole("complementary", { name: "Map tools" });
  const maps = tools.getByRole("list", { name: "Campaign maps" });
  await expect(maps.getByRole("listitem")).toHaveCount(2);
  await tools.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Edit map/ }).click();
  const toolGroup = tools.getByRole("region", { name: "Edit by hand" }).getByRole("group", { name: "Edit tool" });

  // A painted map: every tool. Move view is on and lets the pointer through to the map (it pans).
  await maps.getByRole("button", { name: "Glade", exact: true }).click();
  await expect(toolGroup.getByRole("button")).toHaveText(["✋ Move view", "🖌 Terrain", "🌲 Objects", "▦ Block sight", "⌫ Erase terrain", "⌫ Clear sight"]);
  await expect(toolGroup.getByRole("button", { name: /Move view/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("combat-editor-layer")).toHaveCSS("pointer-events", "none");
  await toolGroup.getByRole("button", { name: /Terrain/ }).click();
  await expect(page.getByTestId("combat-editor-layer")).toHaveCSS("pointer-events", "auto");

  // The image: no painted terrain or drawn objects, so only the sight tools (Terrain falls back to Move view).
  await maps.getByRole("button", { name: "Crypt", exact: true }).click();
  await expect(toolGroup.getByRole("button")).toHaveText(["✋ Move view", "▦ Block sight", "⌫ Clear sight"]);
  await expect(toolGroup.getByRole("button", { name: /Move view/ })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("group", { name: "Grid over the image" })).toBeVisible();
  await toolGroup.getByRole("button", { name: /Block sight/ }).click();
  const stage = page.getByTestId("combat-stage");
  const crypt = (await client.query(api.combatMaps.get, { campaignId, mapId: attached.ok ? attached.mapId : "" }))!;
  const at = await squareCentre(stage, crypt.w, 2, 2);
  await page.mouse.click(at.x, at.y);
  await expect
    .poll(async () => {
      const layout = await client.query(api.combatMaps.get, { campaignId, mapId: attached.ok ? attached.mapId : "" });
      return layout ? [...decodeCells(layout.cells, layout.w, layout.h).block] : [];
    })
    .toEqual(["2,2"]);
});
