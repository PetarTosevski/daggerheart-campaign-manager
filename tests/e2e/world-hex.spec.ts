import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { PUBLISHED_FRAME_IDS } from "../../src/lib/frames/index";
import { hexBox, hexToPixel, type Hex } from "../../src/lib/world/hex";
import { WORLD_MAPS } from "../../src/lib/world/map-state";
import { PRINTED_HEX_GRIDS } from "../../src/lib/world/printed-grids";
import { signInAsTestGm } from "./fixtures";
import { convexAs } from "./visual/helpers";

// dcm-kggd (WH1): the overlay hexes and the hex markers match the hexes printed on the map art.
// Screenshots go to the test's output folder (and to $WH1_SHOTS when set) for a look by eye.

const GRID = PRINTED_HEX_GRIDS["journey-to-horizon"]!;
const IMAGE = WORLD_MAPS["journey-to-horizon"];
const pct = (h: Hex) => {
  const c = hexToPixel(h, GRID);
  return { x: (c.x / IMAGE.width) * 100, y: (c.y / IMAGE.height) * 100 };
};

async function shoot(page: Page, info: TestInfo, name: string) {
  const viewport = page.getByRole("application", { name: /^Map of/ });
  const path = info.outputPath(`${name}.png`);
  await viewport.screenshot({ path });
  if (process.env.WH1_SHOTS) await viewport.screenshot({ path: `${process.env.WH1_SHOTS}/${name}.png` });
}

/** Where hex `h` is on screen now, from the map canvas's box (the art's 0–100 % box). */
async function expectedBox(page: Page, h: Hex, scale = 1) {
  const canvas = (await page.locator("[data-map]").first().boundingBox())!;
  const c = hexToPixel(h, GRID);
  const box = hexBox(GRID);
  const k = canvas.width / IMAGE.width;
  return { cx: canvas.x + c.x * k, cy: canvas.y + (c.y / IMAGE.height) * canvas.height, w: box.width * k * scale, h: box.height * (canvas.height / IMAGE.height) * scale };
}

async function expectOnHex(page: Page, token: Locator, h: Hex, scale = 1) {
  const got = (await token.boundingBox())!;
  const want = await expectedBox(page, h, scale);
  // Sub-pixel: the marker's box is the hex's box, centred on the printed hex.
  expect(Math.abs(got.x + got.width / 2 - want.cx)).toBeLessThan(1);
  expect(Math.abs(got.y + got.height / 2 - want.cy)).toBeLessThan(1);
  expect(Math.abs(got.width - want.w)).toBeLessThan(1);
  expect(Math.abs(got.height - want.h)).toBeLessThan(1);
}

test("Journey to Horizon: the party hex, its neighbour ring and hex markers sit on the printed hexes at every zoom", async ({ page }, info) => {
  test.slow();
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const client = await convexAs(page);
  const { campaignId } = await client.mutation(api.campaigns.create, { frameId: "journey-to-horizon", name: `Hexes ${Date.now().toString(36)}`, idempotencyKey: crypto.randomUUID() });
  const id = campaignId as Id<"campaigns">;
  // The party in the middle of the map, a village next door, and a temple and a cave sharing the hex below it.
  await client.mutation(api.maps.placePartyHex, { campaignId: id, q: 40, r: 5 });
  await client.mutation(api.maps.updateHex, { campaignId: id, q: 41, r: 4, patch: { explored: true } });
  const village = await client.mutation(api.maps.addToken, { campaignId: id, type: "village", ...pct({ q: 41, r: 5 }), idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.maps.addToken, { campaignId: id, type: "temple", ...pct({ q: 40, r: 6 }), idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.maps.addToken, { campaignId: id, type: "cave", ...pct({ q: 40, r: 6 }), idempotencyKey: crypto.randomUUID() });

  // Centred on the village at a close zoom.
  await page.goto(`/campaigns/${id}/world?focus=${village.id}`);
  const map = page.getByRole("application", { name: /^Map of/ });
  await expect(map).toBeVisible();
  const party = map.getByRole("button", { name: /^Party token/ });
  const villageTok = map.getByRole("button", { name: /^Village, Village/ });
  await expect(villageTok).toBeVisible();
  await page.waitForTimeout(600);
  // Checked as is (fitted to the village), then zoomed in until a hex is ~50 and ~100 px across.
  await expectOnHex(page, party, { q: 40, r: 5 });
  await shoot(page, info, "horizon-focus-zoom");
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom in" }).click();
  await page.waitForTimeout(400);

  for (const zoom of ["close", "closer"]) {
    await expectOnHex(page, party, { q: 40, r: 5 });
    await expectOnHex(page, villageTok, { q: 41, r: 5 });
    // Two markers in one hex share it as third-size hexes inside it.
    const temple = (await map.getByRole("button", { name: /^Temple, Temple/ }).boundingBox())!;
    const want = await expectedBox(page, { q: 40, r: 6 }, 1 / 3);
    expect(Math.abs(temple.width - want.w)).toBeLessThan(1);
    expect(Math.hypot(temple.x + temple.width / 2 - want.cx, temple.y + temple.height / 2 - want.cy)).toBeLessThan(0.5);
    await shoot(page, info, `horizon-${zoom}`);
    for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(400);
  }

  // The whole grid drawn over the art, for a look at the fit away from the party.
  await page.getByRole("region", { name: "Hex Crawl" }).getByText("The grid", { exact: true }).click();
  await expect(page.getByRole("checkbox", { name: "Show the whole grid" })).toBeChecked();
  await shoot(page, info, "horizon-grid");
  // Keyboard focus draws a hex ring on the marker.
  await page.keyboard.press("Shift");
  await party.focus();
  await expect(party.locator(".tok-focus")).toBeVisible();
  await shoot(page, info, "horizon-focus");
  // Markers sharing a hex show no name tag over their neighbours (their names stay in the marker list and labels).
  await expect(map.getByRole("button", { name: /^Temple, Temple/ }).locator(".tok-lbl")).toBeHidden();

  // Fitted out: the markers shrink with the hexes.
  await page.getByRole("button", { name: "Fit map" }).click().catch(() => undefined);
  await page.waitForTimeout(400);
  await expectOnHex(page, party, { q: 40, r: 5 });
  await shoot(page, info, "horizon-fit");
});

test("the other built-in maps print no hex grid: their markers keep today's round tokens", async ({ page }, info) => {
  test.slow();
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const client = await convexAs(page);
  for (const frameId of PUBLISHED_FRAME_IDS.filter((f) => !PRINTED_HEX_GRIDS[f])) {
    const { campaignId } = await client.mutation(api.campaigns.create, { frameId, name: `Map ${frameId} ${Date.now().toString(36)}`, idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.maps.addToken, { campaignId: campaignId as Id<"campaigns">, type: "village", x: 52, y: 50, idempotencyKey: crypto.randomUUID() });
    await page.goto(`/campaigns/${campaignId}/world`);
    const map = page.getByRole("application", { name: /^Map of/ });
    await expect(map.getByRole("button", { name: /^Party token/ })).toBeVisible();
    await expect(map.locator(".tok-hex")).toHaveCount(0);
    await shoot(page, info, `map-${frameId}`);
  }
});

// dcm-kggd (WH2): a hex marker covers its hex, so clicking it must still give the hex panel's Travel here.
test("Journey to Horizon: clicking a hex that holds a marker selects the hex (Travel here) and the marker, and the party can move there", async ({ page }, info) => {
  test.slow();
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const client = await convexAs(page);
  const { campaignId } = await client.mutation(api.campaigns.create, { frameId: "journey-to-horizon", name: `Hex click ${Date.now().toString(36)}`, idempotencyKey: crypto.randomUUID() });
  const id = campaignId as Id<"campaigns">;
  await client.mutation(api.maps.placePartyHex, { campaignId: id, q: 40, r: 5 });
  // A dungeon on the hex next to the party, a cave two hexes off.
  const dungeon = await client.mutation(api.maps.addToken, { campaignId: id, type: "dungeon", ...pct({ q: 41, r: 5 }), idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.maps.updateToken, { campaignId: id, id: dungeon.id, patch: { name: "Sunken Vault" } });
  await client.mutation(api.maps.addToken, { campaignId: id, type: "cave", ...pct({ q: 42, r: 6 }), idempotencyKey: crypto.randomUUID() });

  await page.goto(`/campaigns/${id}/world?focus=${dungeon.id}`);
  const map = page.getByRole("application", { name: /^Map of/ });
  const vault = map.getByRole("button", { name: /^Sunken Vault, Dungeon/ });
  const party = map.getByRole("button", { name: /^Party token/ });
  const editor = page.getByRole("region", { name: "Edit Sunken Vault" });
  await expect(vault).toBeVisible();
  await page.waitForTimeout(600);
  const crawlPanel = page.getByRole("region", { name: "Hex Crawl" });
  const travel = crawlPanel.getByText("Travel here", { exact: true });

  // Keyboard: Enter on the marker selects its hex and opens the marker's editor.
  await vault.focus();
  await page.keyboard.press("Enter");
  await expect(travel).toBeVisible();
  await expect(editor).toBeVisible();

  // The party's own hex: a click selects it (no travel: the party is there) and closes the editor.
  await party.click();
  await expect(crawlPanel.getByText("0 from the party")).toBeVisible();
  await expect(travel).toBeHidden();
  await expect(editor).toBeHidden();

  // A pointer click on the marker: the hex panel with Travel here, and the marker's editor with it.
  await vault.click();
  await expect(travel).toBeVisible();
  await expect(editor).toBeVisible();
  await shoot(page, info, "horizon-marker-hex-selected");
  await page.screenshot({ path: info.outputPath("horizon-marker-hex-page.png") });
  if (process.env.WH1_SHOTS) await page.screenshot({ path: `${process.env.WH1_SHOTS}/horizon-marker-hex-page.png` });

  // Move the party onto the marker's hex: it shares the hex and takes its centre slot.
  await crawlPanel.getByRole("combobox", { name: "Terrain rating" }).selectOption("1");
  await crawlPanel.getByRole("button", { name: "Move the party here" }).click();
  await expect
    .poll(async () => {
      const got = (await party.boundingBox())!;
      const want = await expectedBox(page, { q: 41, r: 5 });
      return Math.hypot(got.x + got.width / 2 - want.cx, got.y + got.height / 2 - want.cy);
    })
    .toBeLessThan(1);

  // Dragging a marker (GM) still moves it, onto the hex it is dropped on.
  const cave = map.getByRole("button", { name: /^Cave, Cave/ });
  const from = (await cave.boundingBox())!;
  const to = await expectedBox(page, { q: 43, r: 6 });
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2, { steps: 3 });
  await page.mouse.move(to.cx, to.cy, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(async () => {
      const got = (await cave.boundingBox())!;
      return Math.hypot(got.x + got.width / 2 - to.cx, got.y + got.height / 2 - to.cy);
    })
    .toBeLessThan(1);
  await shoot(page, info, "horizon-marker-hex-moved");
});
