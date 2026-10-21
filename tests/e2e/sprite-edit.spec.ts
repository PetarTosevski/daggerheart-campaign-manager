import { readFileSync } from "node:fs";

import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, expectNoHorizontalScroll, openCombatMap } from "./visual/helpers";

// Sprite packs P9 (.omc/plans/sprite-packs.yaml): hand editing in the Sprites style. On a Sprites forest map the GM
// paints moss (a partial repaint), adds an oak tree and an uploaded sprite, sets a bush sprite to block sight; after
// a reload all are there; a player's view hides a token behind the oak. At 390 px the pickers fit a phone.

const PLAYER = "e2e-player@example.test";
const SHEET = "tests/fixtures/sprite-uploads/props-4x4.png";
const MAP_W = 30;

type ConvexClient = Awaited<ReturnType<typeof convexAs>>;

/** A blank medium map drawn with Sprites in the Forest setting. */
async function forestMap(client: ConvexClient, campaignId: Id<"campaigns">) {
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Glade", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "sprites" });
  await client.mutation(api.combatMapStyle.setSetting, { campaignId, mapId, setting: { builtin: "forest" } });
  return mapId;
}

/** Uploads the fixture sheet as one sprite, "Standing stone", into a pack added to Forest (P8's functions). */
async function uploadStone(client: ConvexClient, campaignId: Id<"campaigns">) {
  const { packId } = await client.mutation(api.spritePacks.createPack, { campaignId, name: "Moorland", extends: "forest", idempotencyKey: crypto.randomUUID() });
  const url = await client.mutation(api.spritePacks.spriteUploadUrl, { campaignId });
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "image/png" }, body: readFileSync(SHEET) });
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
  const result = await client.mutation(api.spritePacks.attachSprite, {
    campaignId,
    packId,
    storageId,
    name: "Standing stone",
    category: "object",
    w: 1,
    h: 1,
    sight: "block",
    light: "none",
    height: "tall",
    footprint: "circle",
    classicKind: "pillar",
    px: { w: 256, h: 256 },
  });
  if (!result.ok) throw new Error(result.message);
  return result.spriteId;
}

/** Page coordinates of the centre of square (x, y); the stage scrolled into view first (the tool column is tall). */
async function squareCentre(stage: Locator, x: number, y: number) {
  await stage.evaluate((el) => el.scrollIntoView({ block: "start" }));
  const box = (await stage.boundingBox())!;
  const step = box.width / MAP_W;
  return { x: box.x + (x + 0.5) * step, y: box.y + (y + 0.5) * step };
}

/** Records the size of every terrain write (putImageData), to tell a full paint from a partial one. */
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

async function openEditor(page: Page) {
  const tools = page.getByRole("complementary", { name: "Map tools" });
  await tools.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Edit map/ }).click();
  const card = tools.getByRole("region", { name: "Edit by hand" });
  await expect(card).toBeVisible();
  return card;
}

test("on a Sprites forest map the GM paints moss, adds an oak and an uploaded sprite, makes a bush block sight; a player is hidden behind the oak", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await recordTerrainWrites(page);
  const { client, campaignId, url } = await openCombatMap(page);
  const mapId = await forestMap(client, campaignId);
  const stoneId = await uploadStone(client, campaignId);
  const get = async () => (await client.query(api.combatMaps.get, { campaignId, mapId }))!;
  await page.goto(url);
  const canvas = page.getByTestId("combat-map-canvas");
  await expect(canvas).toHaveAttribute("data-style", "sprites");
  const stage = page.getByTestId("combat-stage");
  const card = await openEditor(page);

  // ---- Moss: the Terrain tool lists the textures; one stroke repaints only around it.
  await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Terrain/ }).click();
  const forestTextures = card.getByRole("group", { name: "Textures · This setting" });
  await expect(forestTextures.getByRole("button", { name: "Muddy path" })).toBeVisible();
  await forestTextures.getByRole("button", { name: "Moss", exact: true }).click();
  await expect(forestTextures.getByRole("button", { name: "Moss", exact: true })).toHaveAttribute("aria-pressed", "true");
  await card.getByRole("button", { name: "Brush 3 × 3 squares" }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  const fullWrite = MAP_W * 48;
  const before = (await terrainWrites(page)).length;
  const from = await squareCentre(stage, 3, 3);
  const to = await squareCentre(stage, 7, 3);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await get()).texturePalette).toEqual([{ builtin: "forest/moss" }]);
  await expect.poll(async () => (await terrainWrites(page)).length).toBeGreaterThan(before);
  for (const wr of (await terrainWrites(page)).slice(before)) expect(wr.w).toBeLessThan(fullWrite);
  const painted = await get();
  expect(painted.textureCells?.[0]?.cells.slice(2 * MAP_W + 2, 2 * MAP_W + 9)).toBe("AAAAAAA");

  // ---- Objects: an oak tree (searched), the uploaded stone, a bush set to block sight.
  await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Objects/ }).click();
  await card.getByLabel("Search sprites").fill("oak");
  await card.getByRole("button", { name: "Oak tree" }).click();
  const oakAt = await squareCentre(stage, 10, 10);
  await page.mouse.click(oakAt.x, oakAt.y);
  await expect(card.getByRole("group", { name: "Selected object: Oak tree" })).toBeVisible();
  await expect(card.getByRole("group", { name: "Selected object: Oak tree" }).getByRole("button", { name: "Blocks sight" })).toHaveAttribute("aria-pressed", "true");

  await card.getByLabel("Search sprites").fill("");
  await card.getByRole("group", { name: "Sprites · Your sprites" }).getByRole("button", { name: "Standing stone" }).click();
  const stoneAt = await squareCentre(stage, 20, 10);
  await page.mouse.click(stoneAt.x, stoneAt.y);
  await expect(card.getByRole("group", { name: "Selected object: Standing stone" })).toBeVisible();

  await card.getByLabel("Search sprites").fill("bush");
  await card.getByRole("group", { name: "Sprites · This setting" }).getByRole("button", { name: "Bush", exact: true }).click();
  const bushAt = await squareCentre(stage, 5, 15);
  await page.mouse.click(bushAt.x, bushAt.y);
  const bush = card.getByRole("group", { name: "Selected object: Bush" });
  await expect(bush).toBeVisible();
  await expect(bush.getByRole("button", { name: "Cover only" })).toHaveAttribute("aria-pressed", "true");
  await expect(bush).toContainText("Default for a bush: cover only.");
  await bush.getByRole("button", { name: "Blocks sight" }).click();
  await expect(bush.getByRole("button", { name: "Blocks sight" })).toHaveAttribute("aria-pressed", "true");

  // The server has all of it before the page goes away.
  await expect
    .poll(async () => (await get()).objects.map((o) => ({ kind: o.kind, sprite: o.sprite, sight: o.sight, x: o.x, y: o.y })))
    .toEqual([
      { kind: "tree", sprite: { builtin: "forest/oak-tree" }, sight: undefined, x: 10.5, y: 10.5 },
      { kind: "pillar", sprite: { uploaded: stoneId }, sight: undefined, x: 20.5, y: 10.5 },
      { kind: "bush", sprite: { builtin: "forest/bush" }, sight: "block", x: 5.5, y: 15.5 },
    ]);

  // ---- After a reload all are there.
  await page.reload();
  await expect(page.getByTestId("combat-map-canvas")).toHaveAttribute("data-style", "sprites");
  const again = await openEditor(page);
  await again.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Objects/ }).click();
  const bushAgain = await squareCentre(stage, 5, 15);
  await page.mouse.click(bushAgain.x, bushAgain.y);
  await expect(again.getByRole("group", { name: "Selected object: Bush" }).getByRole("button", { name: "Blocks sight" })).toHaveAttribute("aria-pressed", "true");
  const stoneAgain = await squareCentre(stage, 20, 10);
  await page.mouse.click(stoneAgain.x, stoneAgain.y);
  await expect(again.getByRole("group", { name: "Selected object: Standing stone" })).toBeVisible();
  expect((await get()).textureCells?.length).toBeGreaterThan(0);

  // ---- A player north of the oak, facing south: the Wolf behind the oak is hidden, the Bandit beside it is not.
  await client.mutation(api.combatMaps.setLive, { campaignId, mapId });
  const context = await browser.newContext();
  try {
    const player = await context.newPage();
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(player, PLAYER);
    await expect(player).toHaveURL("/");
    const playerClient = await convexAs(player);
    await playerClient.mutation(api.members.joinByCode, { code });
    await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
    const { tokenId: wolfId } = await client.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Wolf", hp: 4, side: "enemy", idempotencyKey: crypto.randomUUID() });
    const { tokenId: banditId } = await client.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Bandit", hp: 3, side: "enemy", idempotencyKey: crypto.randomUUID() });
    // Token x / y are the top-left corner of their square (the oak's centre is 10.5, 10.5).
    const ash = (await client.query(api.combatTokens.list, { campaignId, mapId })).find((t) => t.name === "Ash")!;
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: ash._id, x: 10, y: 7 });
    await client.mutation(api.combatTokens.turn, { campaignId, tokenId: ash._id, angle: Math.PI / 2 });
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: wolfId, x: 10, y: 13 });
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: banditId, x: 13, y: 12 });

    await player.goto(url);
    const board = player.getByRole("region", { name: "Battle map" });
    await expect(board.getByRole("button", { name: /^Ash, Party/ })).toBeVisible();
    await expect(board.getByRole("button", { name: /^Bandit, Enemy/ })).toBeVisible();
    await expect(board.getByRole("button", { name: /^Wolf/ })).toHaveCount(0);
    await expect(player.getByTestId("combat-map-canvas")).toHaveAttribute("data-style", "sprites");
    // It is the oak that hides it: moved aside, the Wolf shows live.
    const oak = (await get()).objects.find((o) => o.kind === "tree")!;
    await client.mutation(api.combatMapEdit.moveObject, { campaignId, objectId: oak._id, x: 25, y: 18 });
    await expect(board.getByRole("button", { name: /^Wolf, Enemy/ })).toBeVisible();
  } finally {
    await context.close();
  }
});

test("the sprite pickers fit a phone: search, 44 px targets, placing by tap, no horizontal scroll at 390 px", async ({ page }) => {
  const { client, campaignId, url } = await openCombatMap(page);
  const mapId = await forestMap(client, campaignId);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  const card = await openEditor(page);
  await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Objects/ }).click();
  const search = card.getByLabel("Search sprites");
  await expect(search).toBeVisible();
  await search.fill("pine");
  const pine = card.getByRole("button", { name: "Pine tree" });
  expect((await pine.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await pine.focus();
  await page.keyboard.press("Enter");
  await expect(pine).toHaveAttribute("aria-pressed", "true");
  await expectNoHorizontalScroll(page);

  const stage = page.getByTestId("combat-stage");
  await stage.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const box = (await stage.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(card.getByRole("group", { name: "Selected object: Pine tree" })).toBeVisible();
  await expect.poll(async () => (await client.query(api.combatMaps.get, { campaignId, mapId }))?.objects.map((o) => o.sprite)).toEqual([{ builtin: "forest/pine-tree" }]);

  await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Terrain/ }).click();
  const moss = card.getByRole("group", { name: "Textures · This setting" }).getByRole("button", { name: "Moss", exact: true });
  expect((await moss.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await expectNoHorizontalScroll(page);
});
