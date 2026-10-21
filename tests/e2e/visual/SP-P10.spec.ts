import path from "node:path";

import { expect, test, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";
import { bardDraft, convexAs, D9_VIEWPORTS, openCombatMap, visual } from "./helpers";

// Shots for the SP-P10 task doc (E2E_VISUAL=1): the end-to-end flow's dungeon hall (flagstones and a cracked-stone
// patch, thick stone pillars, a lit brazier, candles, an urn, an iron cage and the GM's uploaded Rune stone) at night,
// for the GM and for the player carrying a torch, each in Sprites and in Classic, at 1440, 1024 and 390. The map is
// built through the API (no generation, so the shots do not depend on a seed or the generation rate limit). There is
// no design board for sprites: each Sprites shot's counterpart is the same view in Classic (D1: same layout, same
// vision).

const PLAYER = "e2e-player@example.test";
const SHEET = path.join(__dirname, "../../fixtures/sprite-uploads/props-4x4.png");
const W = 30;

function rect(x0: number, y0: number, x1: number, y1: number): number[] {
  const out: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(y * W + x);
  return out;
}

/** Creates "Deep halls" (added to Dungeon) on the packs screen and uploads cut 1 of the fixture sheet as "Rune stone"
 * (cut in the browser, P8), as the flow spec does. */
async function uploadRune(page: Page, client: ConvexHttpClient, campaignId: Id<"campaigns">) {
  await page.goto(`/campaigns/${campaignId}/combat-map/packs`);
  const form = page.getByRole("region", { name: "New pack" });
  await form.getByLabel("Pack name").fill("Deep halls");
  await form.getByLabel("Setting").selectOption({ label: "Add to Dungeon" });
  await form.getByRole("button", { name: "Create pack" }).click();
  const upload = page.getByRole("region", { name: "Add sprites to Deep halls" });
  await upload.getByTestId(/^sprite-file-/).setInputFiles(SHEET);
  const cuts = upload.getByRole("list", { name: "Cut sprites" });
  await expect(cuts.getByRole("listitem")).toHaveCount(16);
  await upload.getByRole("button", { name: "Select none" }).click();
  await cuts.getByRole("listitem", { name: "Cut 1: Sprite 1" }).getByLabel("Upload").check();
  await cuts.getByRole("listitem", { name: "Cut 1: Sprite 1" }).getByLabel("Name").fill("Rune stone");
  const rune = cuts.getByRole("listitem", { name: "Cut 1: Rune stone" });
  await rune.getByLabel("Sight").selectOption({ label: "Blocks sight" });
  await upload.getByRole("button", { name: "Upload selected (1)" }).click();
  await expect(rune.getByText("Uploaded")).toBeVisible();
  return (await client.query(api.spritePacks.packs, { campaignId }))[0]!.sprites[0]!._id;
}

async function settle(page: Page, style: "classic" | "sprites") {
  await expect(page.getByRole("region", { name: "Battle map" }).getByTestId("combat-map-canvas")).toHaveAttribute("data-style", style);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
}

test("SP-P10 the flow's dungeon hall at night for the GM and the player, Sprites and Classic, at 1440, 1024 and 390", { tag: "@visual" }, async ({ page, browser }) => {
  test.setTimeout(300_000);
  const { client, campaignId, url } = await openCombatMap(page);
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Cell block", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "sprites" });
  await client.mutation(api.combatMapStyle.setSetting, { campaignId, mapId, setting: { builtin: "dungeon" } });
  const paint = (squares: number[], texture: string) =>
    client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares, paint: { layer: "texture", texture: { builtin: texture } } });
  await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: rect(0, 0, W - 1, 19), paint: "wall" });
  await paint(rect(1, 5, W - 2, 15), "dungeon/dungeon-flagstones");
  await paint(rect(5, 6, 11, 8), "dungeon/cracked-stone");
  await paint(rect(22, 12, 27, 15), "dungeon/dirt-and-straw-floor");
  const runeId = await uploadRune(page, client, campaignId);
  const place = (sprite: { builtin: string } | { uploaded: Id<"spritePackSprites"> }, x: number, y: number) =>
    client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, sprite, x, y });
  for (const x of [8, 13, 26]) await place({ builtin: "dungeon/thick-stone-pillar" }, x, 6.5);
  await place({ builtin: "dungeon/thick-stone-pillar" }, 17.5, 10.5);
  await place({ builtin: "common/iron-brazier-lit" }, 22.5, 10.5);
  await place({ builtin: "dungeon/candle-cluster" }, 11.5, 14.5);
  await place({ builtin: "dungeon/urn" }, 24.5, 14.5);
  await place({ builtin: "dungeon/iron-cage" }, 26.5, 13.5);
  await place({ uploaded: runeId }, 2.5, 6.5);
  await client.mutation(api.combatMaps.setLive, { campaignId, mapId });

  const context = await browser.newContext({ viewport: D9_VIEWPORTS[0] });
  const player = await context.newPage();
  try {
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(player, PLAYER);
    await expect(player).toHaveURL("/");
    const playerClient = await convexAs(player);
    await playerClient.mutation(api.members.joinByCode, { code });
    await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
    const { tokenId: wolfId } = await client.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Dire Wolf", hp: 4, side: "enemy", idempotencyKey: crypto.randomUUID() });
    const { tokenId: ghoulId } = await client.mutation(api.combatTokens.addCustom, { campaignId, mapId, name: "Ghoul", hp: 3, side: "enemy", idempotencyKey: crypto.randomUUID() });
    const ash = (await client.query(api.combatTokens.list, { campaignId, mapId })).find((t) => t.name === "Ash")!;
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: ash._id, x: 4, y: 10 });
    await client.mutation(api.combatTokens.turn, { campaignId, tokenId: ash._id, angle: 0 });
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: wolfId, x: 20, y: 10 });
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: ghoulId, x: 9, y: 12 });
    for (let i = 0; i < 8; i++) await client.mutation(api.campaignTime.advance, { campaignId, idempotencyKey: crypto.randomUUID() });

    await player.goto(url);
    const torch = player.getByRole("region", { name: "Your view" }).getByRole("group", { name: "Light you carry" }).getByRole("button", { name: "Torch", exact: true });
    await torch.click();
    await expect(torch).toHaveAttribute("aria-pressed", "true");

    const gmShots = visual(page, "SP-P10", D9_VIEWPORTS);
    const playerShots = visual(player, "SP-P10", D9_VIEWPORTS);
    for (const style of ["sprites", "classic"] as const) {
      await client.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style });
      await page.goto(url);
      await settle(page, style);
      await gmShots.shoot(page.locator(".cm-root"), `gm-night-${style}`);
      await settle(player, style);
      await playerShots.shoot(player.locator(".cm-root"), `player-night-${style}`);
    }
  } finally {
    await context.close();
  }
});
