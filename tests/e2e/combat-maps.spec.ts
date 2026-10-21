import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";
import { api } from "../../convex/_generated/api";
import { openCombatMap } from "./visual/helpers";

// D9 C3: combat maps (.omc/plans/d9-combat-map.yaml). The GM keeps several maps, uploads an image to one, lines
// its grid up and sets it live; a player then sees that map (and no GM tools: no Scene card, no maps list).

const PLAYER = "e2e-player@example.test";

/** A 1200 x 800 PNG battle map with a 40 px grid printed on it, drawn in the browser. */
async function battleMapPng(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = new OffscreenCanvas(1200, 800);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#6f8f3a";
    ctx.fillRect(0, 0, 1200, 800);
    ctx.fillStyle = "#8a7a5a";
    ctx.fillRect(0, 340, 1200, 120);
    ctx.fillStyle = "#3a6fa0";
    ctx.beginPath();
    ctx.ellipse(900, 200, 180, 110, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    for (let x = 0; x <= 1200; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, 800);
      ctx.stroke();
    }
    for (let y = 0; y <= 800; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(1200, y + 0.5);
      ctx.stroke();
    }
    const blob = await canvas.convertToBlob({ type: "image/png" });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = "";
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text);
  });
  return Buffer.from(base64, "base64");
}

async function playerJoins(page: Page, browser: Browser, campaignName: string) {
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();

  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  await player.getByRole("button", { name: /Join Campaign/ }).click();
  await player.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await player.getByRole("button", { name: "Join", exact: true }).click();
  await expect(player.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  return { player, close: () => context.close() };
}

test("the GM keeps two maps, uploads an image to one and sets it live; a player sees that map and no Scene card", async ({ page, browser }) => {
  const { client, campaignId, campaignName, url } = await openCombatMap(page);
  const tools = page.getByRole("complementary", { name: "Map tools" });
  const maps = tools.getByRole("list", { name: "Campaign maps" });

  // Two blank maps; the first one is live at once.
  await tools.getByRole("button", { name: "＋ New map" }).click();
  await tools.getByRole("group", { name: "New map" }).getByRole("button", { name: "Small 22×15" }).click();
  await expect(maps.getByRole("listitem")).toHaveCount(1);
  await tools.getByRole("button", { name: "＋ New map" }).click();
  await tools.getByRole("group", { name: "New map" }).getByRole("button", { name: "Medium 30×20" }).click();
  await expect(maps.getByRole("listitem")).toHaveCount(2);
  const first = maps.getByRole("listitem").filter({ hasText: "Map 1" });
  const second = maps.getByRole("listitem").filter({ hasText: "Map 2" });
  await expect(first.getByText("LIVE", { exact: true })).toBeVisible();
  await expect(second).toContainText("30 × 20 · Blank");
  // The new map is the one on screen, with its header line.
  await expect(page.getByText("Map 2 · 30 × 20 squares · 0 tokens")).toBeVisible();
  await expect(page.getByTestId("combat-map-canvas")).toBeVisible();

  // Rename the second map, then give it an uploaded image.
  await second.getByRole("button", { name: "Rename" }).click();
  // While renaming, the row shows a field instead of its name, so the field is found in the list.
  await maps.getByRole("textbox", { name: "Map name" }).fill("Old bridge");
  await maps.getByRole("textbox", { name: "Map name" }).press("Enter");
  const bridge = maps.getByRole("listitem").filter({ hasText: "Old bridge" });
  await expect(bridge).toBeVisible();
  await bridge.locator('input[type="file"]').setInputFiles({ name: "bridge.png", mimeType: "image/png", buffer: await battleMapPng(page) });
  // 1200 px across a Medium map: 40 px squares, so 30 x 20 squares.
  await expect(bridge).toContainText("30 × 20 · Image");
  await expect(bridge.getByRole("img", { name: "Map thumbnail" })).toBeVisible();

  // Line the grid up in Edit: bigger squares make the map smaller.
  const mode = tools.getByRole("group", { name: "Map mode" });
  await mode.getByRole("button", { name: /Edit map/ }).click();
  const grid = page.getByRole("group", { name: "Grid over the image" });
  await expect(grid.getByRole("textbox", { name: "Square size in image pixels" })).toHaveValue("40");
  await grid.getByRole("textbox", { name: "Square size in image pixels" }).fill("50");
  await grid.getByRole("textbox", { name: "Square size in image pixels" }).press("Enter");
  await expect(page.getByText("Old bridge · 24 × 16 squares · 0 tokens")).toBeVisible();
  await grid.getByRole("button", { name: "Shift grid right" }).click();
  await grid.getByRole("button", { name: "Shift grid right" }).click();
  await expect(grid.getByTestId("grid-offset")).toHaveText("2, 0");

  // Zoom controls.
  const board = page.getByRole("region", { name: "Battle map" });
  const zoom = board.getByTestId("combat-zoom");
  const before = await zoom.textContent();
  await board.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom).not.toHaveText(before!);
  await board.getByRole("button", { name: "Fit" }).click();
  await expect(zoom).toHaveText(before!);

  // Set it live; reload keeps everything.
  await bridge.getByRole("button", { name: "Set live" }).click();
  await expect(bridge.getByText("LIVE", { exact: true })).toBeVisible();
  await expect(first.getByText("LIVE", { exact: true })).toHaveCount(0);
  // The badge moves optimistically: wait for the server before leaving the page (a pending write could be dropped).
  await expect.poll(async () => (await client.query(api.combatMaps.list, { campaignId })).find((m) => m.name === "Old bridge")?.live).toBe(true);
  await page.goto(url);
  await expect(maps.getByRole("listitem").filter({ hasText: "Old bridge" }).getByText("LIVE", { exact: true })).toBeVisible();

  // The player sees the live map: its name, the drawn map, and none of the GM's tools.
  await page.goto(`/campaigns/${campaignId}`);
  const { player, close } = await playerJoins(page, browser, campaignName);
  try {
    await player.goto(url);
    await expect(player.getByRole("heading", { level: 1, name: "Combat Map" })).toBeVisible();
    const playerBoard = player.getByRole("region", { name: "Battle map" });
    await expect(playerBoard.getByText("Old bridge")).toBeVisible();
    await expect(playerBoard.getByTestId("combat-map-canvas")).toBeVisible();
    await expect(player.getByRole("heading", { name: "Scene" })).toHaveCount(0);
    await expect(player.getByRole("heading", { name: "Maps" })).toHaveCount(0);
    await expect(player.getByRole("group", { name: "Grid over the image" })).toHaveCount(0);
    await expect(playerBoard.getByRole("button", { name: "Make live" })).toHaveCount(0);
    // Players never see the map's size (Q1).
    await expect(player.getByText(/squares/)).toHaveCount(0);

    // The GM shows the other map: the player's view follows.
    await page.goto(url);
    await first.getByRole("button", { name: "Set live" }).click();
    await expect(playerBoard.getByText("Map 1")).toBeVisible();
  } finally {
    await close();
  }
});

test("a player sees the empty state until the GM shows a map", async ({ page, browser }) => {
  const { campaignName, url } = await openCombatMap(page);
  await page.goto(url.replace(/\/combat-map$/, ""));
  const { player, close } = await playerJoins(page, browser, campaignName);
  try {
    await player.goto(url);
    await expect(player.getByRole("region", { name: "Battle map" }).getByText("The GM has not shown a map yet.")).toBeVisible();
  } finally {
    await close();
  }
});

test("the GM duplicates and deletes a map (two clicks)", async ({ page }) => {
  await openCombatMap(page);
  const tools = page.getByRole("complementary", { name: "Map tools" });
  const maps = tools.getByRole("list", { name: "Campaign maps" });
  await tools.getByRole("button", { name: "＋ New map" }).click();
  await tools.getByRole("group", { name: "New map" }).getByRole("button", { name: "Large 40×27" }).click();
  await maps.getByRole("listitem").filter({ hasText: "Map 1" }).getByRole("button", { name: "Duplicate" }).click();
  const copy = maps.getByRole("listitem").filter({ hasText: "Map 1 (copy)" });
  await expect(copy).toContainText("40 × 27 · Blank");
  await expect(copy.getByText("LIVE", { exact: true })).toHaveCount(0);

  const original = maps.getByRole("listitem").filter({ hasText: /^Map 1(?! \(copy\))/ });
  await original.getByRole("button", { name: "Delete" }).click();
  await original.getByRole("button", { name: "Confirm delete" }).click();
  await expect(maps.getByRole("listitem")).toHaveCount(1);
  // The live map went, so the remaining one is live now.
  await expect(copy.getByText("LIVE", { exact: true })).toBeVisible();
});
