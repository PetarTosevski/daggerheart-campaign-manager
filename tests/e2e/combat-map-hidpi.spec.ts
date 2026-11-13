import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { renderScale } from "../../src/lib/combat-map/render-scale";
import { bardDraft, openCombatMap } from "./visual/helpers";

// Plan sharp-4k HD1: on a HiDPI screen the Combat Map's canvases draw at render scale k = devicePixelRatio x the root
// CSS zoom (0.8 on a mouse screen) x the settled board zoom, rounded up to 0.5. Here devicePixelRatio is 2, so
// k = 2 x 0.8 = 1.6 -> 2: the backing store is twice the canvas's size at zoom 1, for a Classic, a Sprites and an
// uploaded-image map, and the fog likewise (twice its own 12 px per square; it does not follow the board zoom).
// Zooming in repaints at the bigger scale once the zoom is still. The canvas's CSS size never changes.

test.use({ deviceScaleFactor: 2 });

const CELL = 48;
const FOG_PX = 12;

type Backing = { width: number; height: number; cssWidth: number; cssHeight: number; scale: number; alpha: number };

/** The canvas's backing store, its CSS size and the alpha of its middle pixel. */
async function backing(page: Page, testId: string): Promise<Backing> {
  return page
    .getByRole("region", { name: "Battle map" })
    .getByTestId(testId)
    .evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      // An uploaded image comes from the storage origin, so its canvas cannot be read back (alpha -1).
      let alpha = -1;
      try {
        alpha = canvas.getContext("2d")!.getImageData(canvas.width >> 1, canvas.height >> 1, 1, 1).data[3]!;
      } catch {}
      return { width: canvas.width, height: canvas.height, cssWidth: Number.parseFloat(canvas.style.width), cssHeight: Number.parseFloat(canvas.style.height), scale: Number(canvas.dataset.scale), alpha };
    });
}

const zoomOf = async (page: Page) => Number.parseInt((await page.getByTestId("combat-zoom").first().textContent()) ?? "0", 10) / 100;

/** The map canvas once it shows `style` at `w` x `h` squares and render scale `k`. */
async function expectMap(page: Page, style: "classic" | "sprites" | "image", w: number, h: number, k: number) {
  const canvas = page.getByRole("region", { name: "Battle map" }).getByTestId("combat-map-canvas");
  // An image map's canvas reports the Classic style (it has no painted style of its own).
  await expect(canvas).toHaveAttribute("data-style", style === "image" ? "classic" : style);
  await expect.poll(async () => (await backing(page, "combat-map-canvas")).width, { timeout: 30_000 }).toBe(w * CELL * k);
  const b = await backing(page, "combat-map-canvas");
  expect(b.scale).toBe(k);
  expect(b.height).toBe(h * CELL * k);
  // The CSS size is the board's: squares x 48 x the zoom (the label rounds it to a percent), whatever the backing store.
  expect(Math.abs(b.cssWidth / (w * CELL) - (await zoomOf(page)))).toBeLessThanOrEqual(0.006);
  if (style !== "image") expect(b.alpha).toBe(255);
  return b;
}

/** A 1200 x 800 PNG battle map, drawn in the browser. */
async function battleMapPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(1200, 800);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#6f8f3a";
    ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = "#3a6fa0";
    ctx.beginPath();
    ctx.ellipse(900, 200, 180, 110, 0, 0, Math.PI * 2);
    ctx.fill();
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
    let text = "";
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text);
  });
  return Buffer.from(base64, "base64");
}

test("on a 2x screen the map (Classic, Sprites, image) and the fog draw at render scale 2; zooming in repaints sharper", async ({ page }) => {
  test.setTimeout(240_000);
  const { client, campaignId, url } = await openCombatMap(page);
  // A mouse screen: the root zoom is 0.8 and devicePixelRatio 2, so k = 1.6 -> 2.
  expect(await page.evaluate(() => [window.devicePixelRatio, getComputedStyle(document.documentElement).zoom])).toEqual([2, "0.8"]);
  const k = renderScale(2 * 0.8, 1, 22 * CELL, 15 * CELL);
  expect(k).toBe(2);

  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "small", name: "Ford", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
  await page.goto(url);
  await expect(page.getByTestId("combat-hud")).toBeVisible();

  // ---- Classic.
  const classic = await expectMap(page, "classic", 22, 15, 2);
  expect(classic.width / classic.cssWidth).toBeCloseTo(2 / (await zoomOf(page)), 1);

  // ---- The fog (the GM previews Ash's view): 12 px per square x 2, the GM's preview has no padding.
  const controls = page.getByRole("toolbar", { name: "Map controls" });
  await controls.getByRole("button", { name: /Player view/ }).click();
  await page.getByRole("menu", { name: "Open the player view as" }).getByRole("menuitemradio", { name: "Ash" }).press("Enter");
  await expect(controls.getByRole("button", { name: /Viewing as Ash/ })).toBeVisible();
  await expect(page.getByTestId("combat-fog")).toBeVisible();
  await expect.poll(async () => (await backing(page, "combat-fog")).width).toBe(22 * FOG_PX * 2);
  const fog = await backing(page, "combat-fog");
  expect([fog.height, fog.scale]).toEqual([15 * FOG_PX * 2, 2]);
  expect(Math.abs(fog.cssWidth / (22 * CELL) - (await zoomOf(page)))).toBeLessThanOrEqual(0.006);

  // ---- Zoom in: once the zoom is still, the map repaints at the bigger scale; the fog keeps its scale.
  // Past 125 % (1.6 x 1.25 = 2), so the scale must grow.
  for (let i = 0; i < 10 && (await zoomOf(page)) <= 1.3; i++) {
    const before = await zoomOf(page);
    await controls.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(() => zoomOf(page)).toBeGreaterThan(before);
  }
  // The exact zoom from the canvas's CSS width (the label is rounded).
  const zoomed = (await backing(page, "combat-map-canvas")).cssWidth / (22 * CELL);
  expect(zoomed).toBeGreaterThan(1.25);
  const zk = renderScale(2 * 0.8, zoomed, 22 * CELL, 15 * CELL);
  expect(zk).toBeGreaterThan(2);
  await expect.poll(async () => (await backing(page, "combat-map-canvas")).scale, { timeout: 30_000 }).toBe(zk);
  await expectMap(page, "classic", 22, 15, zk);
  expect((await backing(page, "combat-fog")).scale).toBe(2);
  await controls.getByRole("button", { name: "Fit the map to the screen" }).click();
  await expect.poll(async () => (await backing(page, "combat-map-canvas")).scale, { timeout: 30_000 }).toBe(renderScale(1.6, await zoomOf(page), 22 * CELL, 15 * CELL));

  // ---- Sprites.
  await client.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "sprites" });
  await page.goto(url);
  await expectMap(page, "sprites", 22, 15, 2);

  // ---- An uploaded image (1200 px over a medium map's 30 squares: 40 px squares, 30 x 20).
  const uploadUrl = await client.mutation(api.combatMaps.imageUploadUrl, { campaignId });
  const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "image/png" }, body: new Uint8Array(await battleMapPng(page)) });
  const { storageId } = (await res.json()) as { storageId: string };
  const attached = await client.mutation(api.combatMaps.attachImage, { campaignId, mapId, storageId: storageId as Id<"_storage">, width: 1200, height: 800, size: "medium" });
  expect(attached.ok).toBe(true);
  await page.goto(url);
  await expectMap(page, "image", 30, 20, renderScale(1.6, 1, 30 * CELL, 20 * CELL));
  await expect(page.getByRole("region", { name: "Battle map" }).getByTestId("combat-map-canvas")).toHaveAttribute("data-scale", "2");
});
