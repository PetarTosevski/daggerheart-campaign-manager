import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { D9_VIEWPORTS, openCombatMap, visual } from "./helpers";

// Shots for the SP-P6 task doc (E2E_VISUAL=1): one forest, one tavern and one dungeon map, each in Classic and in
// Sprites, at 1440, 1024 and 390 (the Combat Map page), plus the canvas itself at 1x and a 2x crop to check tile
// seams, repetition and shadow direction. There is no design board for sprites: the counterpart of each Sprites
// shot is the same map in Classic (and P4's contact sheets).

const MAPS = [
  { name: "forest", title: "Forest clearing", prompt: "a forest clearing with a stream and a bandit camp" },
  { name: "tavern", title: "The Gilded Tankard", prompt: "a tavern common room with a hearth and tables" },
  { name: "dungeon", title: "Sunken crypt", prompt: "a dark dungeon crypt with pillars and a statue" },
] as const;

const OUT = "test-results/visual/SP-P6";

/** Writes the canvas at 1x and a 2x crop of its middle (smoothing on, as the zoomed board shows it). */
async function canvasShots(page: Page, name: string) {
  const shots = await page.getByRole("region", { name: "Battle map" }).getByTestId("combat-map-canvas").evaluate((el) => {
    const canvas = el as HTMLCanvasElement;
    const crop = document.createElement("canvas");
    const w = Math.min(canvas.width, 576), h = Math.min(canvas.height, 384);
    crop.width = w * 2;
    crop.height = h * 2;
    const ctx = crop.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h, 0, 0, w * 2, h * 2);
    return [canvas.toDataURL("image/png"), crop.toDataURL("image/png")];
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/${name}-canvas-1x.png`, Buffer.from(shots[0]!.split(",")[1]!, "base64"));
  writeFileSync(`${OUT}/${name}-canvas-2x.png`, Buffer.from(shots[1]!.split(",")[1]!, "base64"));
}

test("SP-P6 forest, tavern and dungeon maps in Classic and Sprites at 1440, 1024 and 390", { tag: "@visual" }, async ({ page }) => {
  test.setTimeout(300_000);
  const { client, campaignId, url } = await openCombatMap(page);
  const { shoot } = visual(page, "SP-P6", D9_VIEWPORTS);
  for (const map of MAPS) {
    const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: map.title, idempotencyKey: crypto.randomUUID() });
    await client.action(api.combatMapGenerate.generate, { campaignId, mapId, prompt: map.prompt, size: "medium" });
    for (const style of ["classic", "sprites"] as const) {
      await client.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style });
      await page.goto(url);
      const tools = page.getByRole("complementary", { name: "Map tools" });
      await tools.getByRole("listitem").filter({ hasText: map.title }).getByRole("button", { name: map.title }).click();
      const canvas = page.getByRole("region", { name: "Battle map" }).getByTestId("combat-map-canvas");
      await expect(canvas).toHaveAttribute("data-style", style);
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(500);
      await canvasShots(page, `${map.name}-${style}`);
      await shoot(page.locator(".cm-root"), `${map.name}-${style}`);
    }
  }
});
