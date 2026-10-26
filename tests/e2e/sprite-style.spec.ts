import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { signInAsTestGm } from "./fixtures";
import { convexAs, expectNoHorizontalScroll, openCombatMap } from "./visual/helpers";

// Sprite packs P6 (.omc/plans/sprite-packs.yaml): the GM flips a generated map between Classic and Sprites with one
// click in the Combat Map header (optimistic: the canvas changes before the server answers), a player sees the live
// map change style live and has no switch, and Classic -> Sprites -> Classic gives back the same Classic pixels (D1).

const PLAYER = "e2e-player@example.test";

async function generatedMap(page: Page, prompt: string) {
  const opened = await openCombatMap(page);
  const { client, campaignId } = opened;
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "small", name: "Glade", idempotencyKey: crypto.randomUUID() });
  await client.action(api.combatMapGenerate.generate, { campaignId, mapId, prompt, size: "small" });
  await client.mutation(api.combatMaps.setLive, { campaignId, mapId });
  return { ...opened, mapId };
}

/** The canvas's pixels as a data URL (to compare two paints of the same map). */
const pixels = (canvas: Locator) => canvas.evaluate((el) => (el as HTMLCanvasElement).toDataURL());

/** Waits until the sprite images the map asked for have arrived and been repainted. */
async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
}

test("the GM switches a generated map to Sprites and back; a player sees it change live", async ({ page, browser }) => {
  const { client, campaignId, mapId, url } = await generatedMap(page, "a forest clearing with a stream and a bandit camp");
  await page.goto(url);
  const canvas = page.getByRole("region", { name: "Battle map" }).getByTestId("combat-map-canvas");
  await expect(canvas).toHaveAttribute("data-style", "classic");
  const style = page.getByRole("group", { name: "Map style" });
  await expect(style.getByRole("button", { name: "Classic" })).toHaveAttribute("aria-pressed", "true");
  const classicBefore = await pixels(canvas);

  // A player on the live map: no switch, the map in its style.
  const context = await browser.newContext();
  try {
    const player = await context.newPage();
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(player, PLAYER);
    await expect(player).toHaveURL("/");
    await (await convexAs(player)).mutation(api.members.joinByCode, { code });
    await player.goto(url);
    const playerCanvas = player.getByRole("region", { name: "Battle map" }).getByTestId("combat-map-canvas");
    await expect(playerCanvas).toHaveAttribute("data-style", "classic");
    await expect(player.getByRole("group", { name: "Map style" })).toHaveCount(0);

    // One click: the GM's canvas changes at once (optimistic), the server follows, the player's map follows live.
    await style.getByRole("button", { name: "Sprites" }).click();
    await expect(style.getByRole("button", { name: "Sprites" })).toHaveAttribute("aria-pressed", "true");
    await expect(canvas).toHaveAttribute("data-style", "sprites");
    await expect.poll(async () => (await client.query(api.combatMaps.get, { campaignId, mapId }))?.style).toBe("sprites");
    // The first switch stored the keyword-picked setting (D7).
    expect((await client.query(api.combatMaps.get, { campaignId, mapId }))?.setting).toEqual({ builtin: "forest" });
    await expect(playerCanvas).toHaveAttribute("data-style", "sprites");
    await settle(page);
    expect(await pixels(canvas)).not.toBe(classicBefore);
    // The thumbnail in the maps list draws the Sprites look too.
    await expect(page.getByRole("complementary", { name: "Map tools" }).locator("canvas.cm-thumb").first()).toHaveAttribute("data-style", "sprites");

    // And back: Classic is exactly what it was (D1: nothing was rewritten).
    await style.getByRole("button", { name: "Classic" }).click();
    await expect(canvas).toHaveAttribute("data-style", "classic");
    await expect.poll(async () => (await client.query(api.combatMaps.get, { campaignId, mapId }))?.style).toBe("classic");
    await expect(playerCanvas).toHaveAttribute("data-style", "classic");
    expect(await pixels(canvas)).toBe(classicBefore);
  } finally {
    await context.close();
  }
});

test("the style switch fits a phone: 44 px targets, no horizontal scroll at 390 px", async ({ page }) => {
  const { client, campaignId, mapId, url } = await generatedMap(page, "a dark dungeon with a crypt");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(url);
  const style = page.getByRole("group", { name: "Map style" });
  const sprites = style.getByRole("button", { name: "Sprites" });
  await expect(sprites).toBeVisible();
  for (const button of [sprites, style.getByRole("button", { name: "Classic" })]) {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await sprites.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("combat-map-canvas")).toHaveAttribute("data-style", "sprites");
  await expect.poll(async () => (await client.query(api.combatMaps.get, { campaignId, mapId }))?.style).toBe("sprites");
  await expectNoHorizontalScroll(page);
});
