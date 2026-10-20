import { expect, test } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";
import { D9_VIEWPORTS, bardDraft, convexAs, openCombatMap, visual } from "./helpers";

// Shots for the C8 task doc (E2E_VISUAL=1): the player at night with a torch (a hidden enemy in the dim band and one
// the GM revealed, the "Your view" card, the light pill), the player during a dim phase (badge), by day looking at
// the map's edge (hidden edges, Q1), the GM previewing the PC's view, and the GM's Vision & fog card with fog marks
// and "Reveal to…". Board counterparts: `node scripts/board-shots.mjs combat:player-night combat:player-day
// combat:gm-play`.

async function advance(client: ConvexHttpClient, campaignId: Id<"campaigns">, n: number) {
  for (let i = 0; i < n; i++) await client.mutation(api.campaignTime.advance, { campaignId, idempotencyKey: crypto.randomUUID() });
}

test("C8 fog of war, the player view, preview and fog brush at 1440, 1024 and 390", { tag: "@visual" }, async ({ page, browser }) => {
  test.setTimeout(300_000);
  const { client, campaignId, url } = await openCombatMap(page);
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Night road", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Liriel"), idempotencyKey: crypto.randomUUID() });

  const context = await browser.newContext();
  const player = await context.newPage();
  try {
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(player, "e2e-player@example.test");
    await expect(player).toHaveURL("/");
    const playerClient = await convexAs(player);
    await playerClient.mutation(api.members.joinByCode, { code });
    await playerClient.mutation(api.characters.create, {
      campaignId,
      draft: { ...bardDraft("Ash"), traits: { agility: 0, strength: -1, finesse: 1, instinct: 1, presence: 2, knowledge: 0 } },
      idempotencyKey: crypto.randomUUID(),
    });

    // The scene: a hedge of trees and a wall north of the road, a campfire, a wall torch; Ash and Liriel on the road
    // facing east, the Bandit in Ash's torch's dim band, the Archer behind the wall, the Wolf close in clear light.
    await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
    const add = (name: string) => client.mutation(api.combatTokens.addCustom, { campaignId, mapId, name, hp: 4, side: "enemy", idempotencyKey: crypto.randomUUID() });
    const { tokenId: banditId } = await add("Bandit");
    const { tokenId: archerId } = await add("Bandit Archer");
    const { tokenId: wolfId } = await add("Wolf");
    const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
    const ash = tokens.find((t) => t.name === "Ash")!;
    const liriel = tokens.find((t) => t.name === "Liriel")!;
    const place = async (tokenId: Id<"combatTokens">, x: number, y: number, face?: number) => {
      await client.mutation(api.combatTokens.move, { campaignId, tokenId, x, y });
      if (face !== undefined) await client.mutation(api.combatTokens.turn, { campaignId, tokenId, angle: face });
    };
    await place(ash._id, 6, 10, 0);
    await place(liriel._id, 4, 12, 0);
    await place(banditId, 16, 10);
    await place(archerId, 11, 6);
    await place(wolfId, 10, 11);
    await client.mutation(api.combatVision.setCarriedLight, { campaignId, tokenId: ash._id, light: "torch" });
    await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: [9, 10, 11, 12, 13].map((x) => 8 * 30 + x), paint: "stone" });
    await client.mutation(api.combatMapEdit.paintCells, { campaignId, mapId, squares: [5, 6, 7, 8].map((y) => y * 30 + 9), paint: "block" });
    for (const [x, y] of [[3.5, 6.5], [5, 5.5], [14.5, 14.5], [20.5, 6.5], [24, 15]] as const) {
      await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "tree", x, y });
    }
    await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "campfire", x: 28.5, y: 18.5 });
    await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "walltorch", x: 8.5, y: 4.5 });
    await client.mutation(api.combatMapEdit.addObject, { campaignId, mapId, kind: "rock", x: 13.5, y: 12.5 });
    // Night (Moonrise): the Bandit in the dim band stays hidden until the GM reveals it below.
    await advance(client, campaignId, 8);

    // ---- Player at night with a torch: only what Ash sees; the Bandit hidden.
    await player.goto(url);
    const playerBoard = player.getByRole("region", { name: "Battle map" });
    await expect(playerBoard.getByRole("button", { name: /^Wolf, Enemy/ })).toBeVisible();
    await expect(playerBoard.getByRole("button", { name: /^Bandit, Enemy/ })).toHaveCount(0);
    const shootPlayer = visual(player, "C8", D9_VIEWPORTS).shoot;
    await shootPlayer(player.locator(".cm-root"), "player-night-hidden");

    // The GM reveals the Bandit to Ash: dashed outline and eye badge for the player.
    await client.mutation(api.combatVision.revealTo, { campaignId, tokenId: banditId, characterId: ash.characterId! });
    await expect(playerBoard.getByRole("button", { name: "Bandit, Enemy, revealed to you" })).toBeVisible();
    await shootPlayer(player.locator(".cm-root"), "player-night");
    await shootPlayer(player.getByRole("region", { name: "Your view" }), "player-card-night");

    // ---- GM: the Bandit selected (Reveal to… and carried light), the Vision & fog card with Hide marks.
    await page.goto(url);
    const tools = page.getByRole("complementary", { name: "Map tools" });
    const board = page.getByRole("region", { name: "Battle map" });
    await board.getByRole("button", { name: /^Bandit, Enemy/ }).click();
    await expect(tools.getByRole("region", { name: "Light and reveal" })).toBeVisible();
    await client.mutation(api.combatVision.paintFog, { campaignId, mapId, squares: [20, 21, 22, 23, 24].flatMap((x) => [2, 3].map((y) => y * 30 + x)), mark: "hide" });
    await client.mutation(api.combatVision.paintFog, { campaignId, mapId, squares: [25, 26, 27].flatMap((x) => [16, 17].map((y) => y * 30 + x)), mark: "reveal" });
    const shootGm = visual(page, "C8", D9_VIEWPORTS).shoot;
    await shootGm(page.locator(".cm-root"), "gm-night");
    await shootGm(tools, "gm-cards");

    // ---- GM previewing Ash's view (R12).
    await tools.getByRole("group", { name: "See the map as" }).getByRole("button", { name: "Ash" }).click();
    await expect(page.getByTestId("combat-fog")).toBeVisible();
    await shootGm(page.locator(".cm-root"), "gm-preview");
    await tools.getByRole("group", { name: "See the map as" }).getByRole("button", { name: "GM (everything)" }).click();

    // ---- Day, then a dim phase: from NIGHT 2, five days to NIGHT 7 (Nautical Dawn, day), seven more to DAY 7
    // (Nautical Twilight, dim).
    await advance(client, campaignId, 5);
    await expect(player.getByTestId("combat-light-pill")).toContainText("Nautical Dawn");
    // By day: Ash looks east along the road to the map's edge; the padding stays fog (hidden edges, Q1).
    await place(ash._id, 22, 10, 0);
    await playerBoard.getByRole("button", { name: "Fit" }).click();
    await shootPlayer(player.locator(".cm-root"), "player-day-edge");
    await advance(client, campaignId, 7);
    await expect(player.getByTestId("combat-light-pill")).toContainText("Nautical Twilight");
    await shootPlayer(player.locator(".cm-root"), "player-dim");
  } finally {
    await context.close();
  }
});
