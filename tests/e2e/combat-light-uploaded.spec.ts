import path from "node:path";

import { expect, test, type Locator } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, openCombatMap } from "./visual/helpers";

// Follow-ups 3, tracer F2 (dcm-bxp.83, dcm-bxp.87): an uploaded light sprite gets the Play-mode light switch, and
// light switches read the sprite's name. The GM uploads a "Glow stone" labelled Faint glow (its suggested Classic
// look is a crystal, which gives no light of its own, so before F2 it got no switch), places it and a built-in
// "Iron brazier (lit)" on a live Sprites map, and switches both in Play; the player, whose character has seen the
// stone, switches it too. Players never get uploaded sprites' names (D10), so their switch reads the Classic look.

const PLAYER = "e2e-player@example.test";
const SHEET = path.join(__dirname, "../fixtures/sprite-uploads/props-4x4.png");
/** Medium map. */
const W = 30;

/** The centre of square (x, y) on the GM's stage; the stage scrolled into view first (the tool column is tall). */
async function squareCentre(stage: Locator, x: number, y: number) {
  await stage.evaluate((el) => el.scrollIntoView({ block: "start" }));
  const box = (await stage.boundingBox())!;
  const step = box.width / W;
  return { x: box.x + (x + 0.5) * step, y: box.y + (y + 0.5) * step };
}

test.use({ viewport: { width: 1440, height: 900 } });

test("an uploaded faint-glow sprite gets the Play light switch, named after the sprite; a player who has seen it switches it", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const { client, campaignId, url } = await openCombatMap(page);
  const tools = page.getByRole("complementary", { name: "Map tools" });

  // ---- P8 upload: a pack added to Dungeon, cut 1 of the fixture sheet labelled "Glow stone", Gives light: Faint glow.
  await tools.getByRole("link", { name: "Sprite packs" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Sprite packs" })).toBeVisible();
  const form = page.getByRole("region", { name: "New pack" });
  await form.getByLabel("Pack name").fill("Glow kit");
  await form.getByLabel("Setting").selectOption({ label: "Add to Dungeon" });
  await form.getByRole("button", { name: "Create pack" }).click();
  const pack = page.getByRole("region", { name: "Glow kit", exact: true });
  const upload = pack.getByRole("region", { name: "Add sprites to Glow kit" });
  await upload.getByTestId(/^sprite-file-/).setInputFiles(SHEET);
  const cuts = upload.getByRole("list", { name: "Cut sprites" });
  await expect(cuts.getByRole("listitem")).toHaveCount(16);
  await upload.getByRole("button", { name: "Select none" }).click();
  await cuts.getByRole("listitem", { name: "Cut 1: Sprite 1" }).getByLabel("Upload").check();
  await cuts.getByRole("listitem", { name: "Cut 1: Sprite 1" }).getByLabel("Name").fill("Glow stone");
  const glow = cuts.getByRole("listitem", { name: "Cut 1: Glow stone" });
  await glow.getByLabel("Gives light").selectOption({ label: "Faint glow" });
  await upload.getByRole("button", { name: "Upload selected (1)" }).click();
  await expect(glow.getByText("Uploaded")).toBeVisible();
  const sprite = (await client.query(api.spritePacks.packs, { campaignId }))[0]!.sprites[0]!;
  // The Classic look is a crystal (P8 suggestClassic), a kind that is no light switch on its own (the G1 bug).
  expect({ light: sprite.light, classicKind: sprite.classicKind }).toEqual({ light: "faintglow", classicKind: "crystal" });

  // ---- A blank Medium map (the campaign's first, so live, R2) in Dungeon Sprites.
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Glow hall", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatMapStyle.setStyle, { campaignId, mapId, style: "sprites" });
  await client.mutation(api.combatMapStyle.setSetting, { campaignId, mapId, setting: { builtin: "dungeon" } });
  const get = async () => (await client.query(api.combatMaps.get, { campaignId, mapId: mapId as Id<"combatMaps"> }))!;

  // ---- The GM places the Glow stone at (8, 7) and an iron brazier (Common) at (1, 18) with the Objects tool (P9).
  await page.goto(url);
  const mode = tools.getByRole("group", { name: "Map mode" });
  await mode.getByRole("button", { name: /Edit map/ }).click();
  const card = tools.getByRole("region", { name: "Edit by hand" });
  const stage = page.getByTestId("combat-stage");
  await card.getByRole("group", { name: "Edit tool" }).getByRole("button", { name: /Objects/ }).click();
  await card.getByRole("group", { name: "Sprites · Your sprites" }).getByRole("button", { name: "Glow stone" }).click();
  const glowAt = await squareCentre(stage, 8, 7);
  await page.mouse.click(glowAt.x, glowAt.y);
  await expect(card.getByRole("group", { name: "Selected object: Glow stone" })).toBeVisible();
  await card.getByLabel("Search sprites").fill("brazier");
  await card.getByRole("group", { name: "Sprites · Common" }).getByRole("button", { name: "Iron brazier (lit)" }).click();
  const fireAt = await squareCentre(stage, 1, 18);
  await page.mouse.click(fireAt.x, fireAt.y);
  await expect(card.getByRole("group", { name: "Selected object: Iron brazier (lit)" })).toBeVisible();
  await expect.poll(async () => (await get()).objects.length).toBe(2);
  const objects = (await get()).objects;
  const stone = objects.find((o) => o.sprite && "uploaded" in o.sprite)!;
  const brazier = objects.find((o) => o.sprite && "builtin" in o.sprite)!;
  expect({ kind: stone.kind, sprite: stone.sprite }).toEqual({ kind: "crystal", sprite: { uploaded: sprite._id } });

  // ---- Play: the GM's switches are named after the sprites (G5), and the Glow stone has one (G1).
  await mode.getByRole("button", { name: /Play/ }).click();
  const board = page.getByRole("region", { name: "Battle map" });
  await expect(board.getByTestId("combat-light")).toHaveCount(2);
  const stoneSwitch = board.getByRole("button", { name: "Put out the glow stone" });
  await expect(stoneSwitch).toHaveAttribute("aria-pressed", "true");
  await expect(board.getByRole("button", { name: "Put out the iron brazier (lit)" })).toBeVisible();
  await expect(board.getByRole("button", { name: /crystal|the torch/ })).toHaveCount(0);
  await stoneSwitch.click();
  await expect.poll(async () => (await get()).objects.find((o) => o._id === stone._id)!.lit).toBe(false);
  await expect(board.getByRole("button", { name: "Light the glow stone" })).toHaveAttribute("aria-pressed", "false");
  await board.getByRole("button", { name: "Light the glow stone" }).click();
  await expect.poll(async () => (await get()).objects.find((o) => o._id === stone._id)!.lit).toBe(true);
  await board.getByRole("button", { name: "Put out the iron brazier (lit)" }).click();
  await expect.poll(async () => (await get()).objects.find((o) => o._id === brazier._id)!.lit).toBe(false);
  await expect(board.getByRole("button", { name: "Light the iron brazier (lit)" })).toBeVisible();

  // ---- The player: Ash stands at (7, 7) facing east, next to the stone (players switch lights only from Melee, B4), so
  // the stone is in view by day; the brazier, behind Ash, is not.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const player = await context.newPage();
  try {
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(player, PLAYER);
    await expect(player).toHaveURL("/");
    const playerClient = await convexAs(player);
    await playerClient.mutation(api.members.joinByCode, { code });
    await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
    const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
    const ash = tokens.find((t) => t.name === "Ash")!;
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: ash._id, x: 7, y: 7 });
    await client.mutation(api.combatTokens.turn, { campaignId, tokenId: ash._id, angle: 0 });

    await player.goto(url);
    const playerBoard = player.getByRole("region", { name: "Battle map" });
    await expect(playerBoard.getByRole("button", { name: /^Ash, Party/ })).toHaveAttribute("data-square", "7,7");
    // D10: no names for players, so the switch reads the Classic look; only the light the character has seen.
    const playerSwitch = playerBoard.getByRole("button", { name: "Put out the crystal" });
    await expect(playerSwitch).toBeVisible();
    await expect(playerBoard.getByTestId("combat-light")).toHaveCount(1);
    await playerSwitch.click();
    await expect.poll(async () => (await get()).objects.find((o) => o._id === stone._id)!.lit).toBe(false);
    await expect(playerBoard.getByRole("button", { name: "Light the crystal" })).toHaveAttribute("aria-pressed", "false");
    // The GM's board follows live, still with the sprite's name.
    await expect(board.getByRole("button", { name: "Light the glow stone" })).toBeVisible();
    await playerBoard.getByRole("button", { name: "Light the crystal" }).click();
    await expect.poll(async () => (await get()).objects.find((o) => o._id === stone._id)!.lit).toBe(true);
    await expect(player.locator(".cm-root").getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".cm-root").getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
