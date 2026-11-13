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
//
// HD3: a Sprites map at 100 % (k = 2: 96 px per square, a 4-square texture tile 384 px, below its 512 px file) loads
// only the 1x sprite files; zoomed in past k = 2.67 (a tile above 512 px) it loads their @2x siblings.

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

/** Every /sprite-packs/ file the page requests from now on. */
function spriteRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (req) => {
    const path = new URL(req.url()).pathname;
    if (path.startsWith("/sprite-packs/")) urls.push(path);
  });
  return urls;
}

test("a Sprites map loads the 1x sprite files at 100 % and their @2x files once zoomed in on a 2x screen", async ({ page }) => {
  test.setTimeout(180_000);
  const { client, campaignId, url } = await openCombatMap(page);
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "small", name: "Glade", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "sprites" });
  const requested = spriteRequests(page);
  await page.goto(url);
  await expect(page.getByTestId("combat-hud")).toBeVisible();
  await expectMap(page, "sprites", 22, 15, 2);
  expect(await zoomOf(page)).toBeLessThanOrEqual(1);
  await expect.poll(() => requested.length, { timeout: 30_000 }).toBeGreaterThan(0);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  expect(requested.filter((u) => u.includes("@2x."))).toEqual([]);

  // Zoom in until the render scale passes 2.67 (a texture tile drawn above 512 px).
  const controls = page.getByRole("toolbar", { name: "Map controls" });
  for (let i = 0; i < 20 && renderScale(1.6, (await backing(page, "combat-map-canvas")).cssWidth / (22 * CELL), 22 * CELL, 15 * CELL) * CELL * 4 <= 512; i++) {
    const before = await zoomOf(page);
    await controls.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(() => zoomOf(page)).toBeGreaterThan(before);
  }
  const zk = renderScale(1.6, (await backing(page, "combat-map-canvas")).cssWidth / (22 * CELL), 22 * CELL, 15 * CELL);
  expect(zk * CELL * 4).toBeGreaterThan(512);
  await expect.poll(async () => (await backing(page, "combat-map-canvas")).scale, { timeout: 30_000 }).toBe(zk);
  await expect.poll(() => requested.filter((u) => /@2x\.[0-9a-f]{8}\.webp$/.test(u)).length, { timeout: 30_000 }).toBeGreaterThan(0);
});

// ---- HD5: the Classic full repaint runs in a Web Worker (paint-worker.ts), so zooming never blocks the page.

declare global {
  interface Window {
    __longTasks?: number[];
  }
}

/** Records the duration of every main-thread long task (over 50 ms) from the page's start on. */
async function watchLongTasks(page: Page) {
  await page.addInitScript(() => {
    window.__longTasks = [];
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) window.__longTasks!.push(entry.duration);
      }).observe({ type: "longtask", buffered: true });
    } catch {}
  });
}

/** Clears the long tasks seen so far and returns the longest of them (ms), 0 for none. */
const takeLongest = (page: Page) =>
  page.evaluate(() => {
    const longest = Math.max(0, ...(window.__longTasks ?? []));
    window.__longTasks = [];
    return longest;
  });

/** The squares of a `w` x `h` map whose column and row pass `keep`, as square indices. */
const squares = (w: number, h: number, keep: (x: number, y: number) => boolean) => {
  const out: number[] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (keep(x, y)) out.push(y * w + x);
  return out;
};

test("zooming a Large Classic map repaints off the main thread: no main-thread task over 100 ms", async ({ page }) => {
  test.setTimeout(240_000);
  await watchLongTasks(page);
  const { client, campaignId, url } = await openCombatMap(page);
  // Large is 40 x 27, the biggest map the app makes; on this screen its scale steps 2 -> 2.5 when zoomed in (15.6 M
  // pixels, more than a 64 x 64 map, which the canvas caps keep at 1 at every zoom). Water, stone and walls give the
  // terrain painter many edges (the slow path).
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "large", name: "Delta", idempotencyKey: crypto.randomUUID() });
  const W = 40;
  const H = 27;
  await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: squares(W, H, (x, y) => (x + 2 * y) % 7 < 2), paint: "water" });
  await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: squares(W, H, (x, y) => (3 * x + y) % 11 === 0), paint: "stone" });
  await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: squares(W, H, (x, y) => x % 9 === 4 && y % 5 !== 2), paint: "wall" });
  await page.goto(url);
  await expect(page.getByTestId("combat-hud")).toBeVisible();
  await expect(page.getByRole("region", { name: "Battle map" }).getByTestId("combat-map-canvas")).toBeVisible({ timeout: 30_000 });
  await expectMap(page, "classic", W, H, 2);
  await page.waitForTimeout(500);
  const atLoad = await takeLongest(page);

  // Zoom in until the scale steps up, then back with Fit: two full repaints.
  const controls = page.getByRole("toolbar", { name: "Map controls" });
  const scaleAt = async () => renderScale(1.6, (await backing(page, "combat-map-canvas")).cssWidth / (W * CELL), W * CELL, H * CELL);
  for (let i = 0; i < 20 && (await scaleAt()) <= 2; i++) {
    const before = await zoomOf(page);
    await controls.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(() => zoomOf(page)).toBeGreaterThan(before);
  }
  const zk = await scaleAt();
  expect(zk).toBe(2.5);
  await expectMap(page, "classic", W, H, zk);
  await controls.getByRole("button", { name: "Fit the map to the screen" }).click();
  const fitted = renderScale(1.6, await zoomOf(page), W * CELL, H * CELL);
  await expect.poll(async () => (await backing(page, "combat-map-canvas")).scale, { timeout: 30_000 }).toBe(fitted);
  await expectMap(page, "classic", W, H, fitted);
  await page.waitForTimeout(500);
  const longest = await takeLongest(page);
  test.info().annotations.push({ type: "longest main-thread task", description: `zoom ${longest.toFixed(0)} ms (load ${atLoad.toFixed(0)} ms)` });
  console.log(`HD5 longest main-thread task while zooming: ${longest.toFixed(0)} ms (after load: ${atLoad.toFixed(0)} ms)`);
  expect(longest).toBeLessThanOrEqual(100);
});

/** A digest of the map canvas's pixels. */
const pixelDigest = (page: Page) =>
  page
    .getByRole("region", { name: "Battle map" })
    .getByTestId("combat-map-canvas")
    .evaluate(async (el) => {
      const canvas = el as HTMLCanvasElement;
      const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
      return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
    });

test("the worker's Classic map has the same pixels as the main thread's (k = 2)", async ({ page }) => {
  test.setTimeout(180_000);
  // Counts the paint workers the page starts.
  await page.addInitScript(() => {
    const Original = window.Worker;
    (window as unknown as { __paintWorkers: number }).__paintWorkers = 0;
    window.Worker = class extends Original {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name === "combat-map-paint") (window as unknown as { __paintWorkers: number }).__paintWorkers++;
      }
    };
  });
  const { client, campaignId, url } = await openCombatMap(page);
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "small", name: "Mill", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: squares(22, 15, (x, y) => (x + y) % 6 < 2), paint: "water" });
  await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: squares(22, 15, (x, y) => x === 11 && y !== 7), paint: "wall" });
  await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "campfire", x: 5.5, y: 5.5 });
  await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "tree", x: 16.5, y: 4.5 });
  const map = page.getByRole("region", { name: "Battle map" }).getByTestId("combat-map-canvas");

  await page.goto(url);
  await expect(map).toBeVisible({ timeout: 30_000 });
  await expectMap(page, "classic", 22, 15, 2);
  expect(await page.evaluate(() => (window as unknown as { __paintWorkers: number }).__paintWorkers)).toBe(1);
  const fromWorker = await pixelDigest(page);

  // Without OffscreenCanvas the page paints on the main thread, as before HD5.
  await page.addInitScript(() => {
    delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
  });
  await page.goto(url);
  await expect(map).toBeVisible({ timeout: 30_000 });
  await expectMap(page, "classic", 22, 15, 2);
  expect(await page.evaluate(() => (window as unknown as { __paintWorkers: number }).__paintWorkers)).toBe(0);
  expect(await pixelDigest(page)).toBe(fromWorker);
});
