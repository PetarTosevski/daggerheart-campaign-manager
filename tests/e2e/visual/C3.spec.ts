import { expect, test, type Page } from "@playwright/test";

import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { signInAsTestGm } from "../fixtures";
import { D9_VIEWPORTS, convexAs, openCombatMap, visual } from "./helpers";

// Shots for the C3 task doc (E2E_VISUAL=1): the maps list with the map area, an uploaded image with its grid bar,
// and a player looking at the live map. Board counterparts: `node scripts/board-shots.mjs combat:map-list
// combat:gm-edit combat:player-day`.

/** A 1200 x 800 PNG battle map with a 40 px grid printed on it, drawn in the browser. */
async function battleMapPng(page: Page): Promise<Blob> {
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
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
    let text = "";
    for (const b of bytes) text += String.fromCharCode(b);
    return btoa(text);
  });
  return new Blob([Buffer.from(base64, "base64")], { type: "image/png" });
}

test("C3 maps list, image grid and the player's live map at 1440, 1024 and 390", { tag: "@visual" }, async ({ page, browser }) => {
  const { client, campaignId, url } = await openCombatMap(page);
  await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Forest clearing", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatMaps.create, { campaignId, size: "small", name: "Cellar", idempotencyKey: crypto.randomUUID() });
  const uploadUrl = await client.mutation(api.combatMaps.imageUploadUrl, { campaignId });
  const res = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": "image/png" }, body: await battleMapPng(page) });
  const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
  const attached = await client.mutation(api.combatMaps.attachImage, { campaignId, storageId, width: 1200, height: 800, name: "Old bridge", size: "medium" });
  expect(attached.ok).toBe(true);

  await page.goto(url);
  const tools = page.getByRole("complementary", { name: "Map tools" });
  await expect(tools.getByRole("list", { name: "Campaign maps" }).getByRole("listitem")).toHaveCount(3);
  const { shoot } = visual(page, "C3", D9_VIEWPORTS);
  await expect(page.getByTestId("combat-map-canvas")).toBeVisible();
  await shoot(page.locator(".cm-root"), "map-list");

  // The uploaded image in Edit, with the grid bar.
  await tools.getByRole("listitem").filter({ hasText: "Old bridge" }).getByRole("button", { name: "Old bridge" }).click();
  await tools.getByRole("group", { name: "Map mode" }).getByRole("button", { name: /Edit map/ }).click();
  await expect(page.getByRole("group", { name: "Grid over the image" })).toBeVisible();
  await shoot(page.locator(".cm-root"), "gm-grid");

  // A player looking at the live map (Forest clearing, the first map).
  const context = await browser.newContext();
  try {
    const player = await context.newPage();
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(player, "e2e-player@example.test");
    await expect(player).toHaveURL("/");
    const playerClient = await convexAs(player);
    await playerClient.mutation(api.members.joinByCode, { code });
    await player.goto(url);
    await expect(player.getByRole("region", { name: "Battle map" }).getByTestId("combat-map-canvas")).toBeVisible();
    const { shoot: shootPlayer } = visual(player, "C3", D9_VIEWPORTS);
    await shootPlayer(player.locator(".cm-root"), "player-live");
  } finally {
    await context.close();
  }
});
