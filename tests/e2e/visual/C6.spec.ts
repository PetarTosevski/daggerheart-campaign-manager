import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { signInAsTestGm } from "../fixtures";
import { openMapTools } from "../hud/helpers";
import { D9_VIEWPORTS, bardDraft, convexAs, openCombatMap, visual } from "./helpers";

// Shots for the C6 task doc (E2E_VISUAL=1): the GM in play (Combatants card, a selected adversary's card, tokens with
// range circles on) and a player with their own token selected. Board counterparts: `node scripts/board-shots.mjs
// combat:gm-play combat:player-day`.

test("C6 tokens, range circles and the token card at 1440, 1024 and 390", { tag: "@visual" }, async ({ page, browser }) => {
  const { client, campaignId, url } = await openCombatMap(page);
  await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Forest clearing", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Liriel"), idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Brannoc"), idempotencyKey: crypto.randomUUID() });
  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Bandit camp", idempotencyKey: crypto.randomUUID() });
  for (const adversaryId of ["bear", "jagged-knife-lackey", "acid-burrower"]) {
    await client.mutation(api.encounters.addAdversary, {
      campaignId,
      encounterId,
      source: { kind: "srd", adversaryId },
      count: adversaryId === "bear" ? 2 : 1,
      summoned: false,
      idempotencyKey: crypto.randomUUID(),
    });
  }
  await client.mutation(api.encounters.start, { campaignId, encounterId });

  const context = await browser.newContext();
  const player = await context.newPage();
  try {
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(player, "e2e-player@example.test");
    await expect(player).toHaveURL("/");
    const playerClient = await convexAs(player);
    await playerClient.mutation(api.members.joinByCode, { code });
    await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });

    await page.goto(url);
    await openMapTools(page); // Play is the HUD (plan combat-hud H8.1): the classic column is in its "Map tools" drawer.
    const tools = page.getByRole("complementary", { name: "Map tools" });
    const combatants = tools.getByRole("region", { name: "Combatants" });
    await combatants.getByRole("button", { name: /＋ Party/ }).click();
    const queue = combatants.getByRole("group", { name: "From the Adversaries tab" });
    // One chip placed by hand, then the rest; leave the queue empty.
    await queue.getByRole("button", { name: /^⚔ Bear$/ }).click();
    await queue.getByRole("button", { name: "Place all" }).click();
    await expect(queue).toHaveCount(0);
    await combatants.getByText("Add a custom token").click();
    await combatants.getByRole("textbox", { name: "Token name" }).fill("Bandit Archer");
    await combatants.getByRole("textbox", { name: "Hit Points" }).fill("4");
    await combatants.getByRole("button", { name: "＋ Add token" }).click();

    const board = page.getByRole("region", { name: "Battle map" });
    await expect(board.getByTestId("combat-token")).toHaveCount(8);
    // Rings on Liriel and on the selected bear; 2 HP and Vulnerable on the bear.
    // HUD tokens are named for the sheet or stat block a click opens; select by keyboard (focus + Enter), as the open
    // drawer may cover a token on screen.
    await board.getByRole("button", { name: /^Open Liriel’s sheet/ }).focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("r");
    const bear = board.getByRole("button", { name: /^Open the Bear’s stat block/ }).first();
    await bear.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("r");
    // Selecting also opened the Bear's stat block on the right: close it so the shot shows the board and the drawer.
    await page.getByRole("button", { name: /^Close .*stat block$/ }).click();
    const panel = tools.getByRole("region", { name: "Selected token" });
    await panel.getByRole("button", { name: "Hit Point 2", exact: true }).click();
    await panel.getByRole("group", { name: "Conditions" }).getByRole("button", { name: "Vulnerable" }).click();
    await expect(panel.getByText("Hit Points · 2 / 7 marked")).toBeVisible();
    await expect(board.getByTestId("combat-rings")).toHaveCount(2);

    const { shoot } = visual(page, "C6", D9_VIEWPORTS);
    await shoot(page.locator(".cm-root"), "gm-play");
    await shoot(tools, "gm-cards");

    // The player: their own token selected, with its card.
    await player.goto(url);
    const playerBoard = player.getByRole("region", { name: "Battle map" });
    // A click on the player's own HUD token selects it (and opens its action ring); its card is in the "Your
    // character" drawer (plan combat-hud H8.1).
    await playerBoard.getByRole("button", { name: /^Open Ash’s sheet \(your character\)/ }).click();
    await player.getByRole("button", { name: "Your character", exact: true }).click();
    await expect(player.getByRole("complementary", { name: "Your character" }).getByRole("region", { name: "Selected token" })).toBeVisible();
    const { shoot: shootPlayer } = visual(player, "C6", D9_VIEWPORTS);
    await shootPlayer(player.locator(".cm-root"), "player-tokens");
  } finally {
    await context.close();
  }
});
