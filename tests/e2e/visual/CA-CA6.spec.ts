import { expect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";
import { VIEWPORTS, bardDraft, convexAs, openCombatMap } from "./helpers";

// Shots for the CA6 task doc (E2E_VISUAL=1), at 1440 and 390: the player's Hand (loadout with art, badges, Use; the
// vault with Recall), the Use dialog of a grimoire, a card result, an exhausted card greyed and turned with its reset
// label, the phone bottom sheet's Hand tab (a horizontal strip), and the GM's Hand of a selected PC, greyed and then
// with "Play for this character" on. The board (reference/designs/project/Combat.dc.html) has no Hand: the faces are
// compared with Party.dc.html's hand cards (`hc-face`) and SC1's CardDialog, the column with combat:player-day.

const PLAYER = "e2e-player@example.test";
const OUT = "test-results/visual/CA-CA6";

const SURE_BANDIT = {
  name: "Bandit",
  tier: 1,
  type: "Standard" as const,
  description: "A road thug.",
  motives: "Rob",
  difficulty: 1,
  thresholds: { major: 1, severe: 100 },
  hp: 5,
  stress: 3,
  attack: { modifier: 0, name: "Club", range: "Melee", damage: "1d6 phy" },
  experiences: [],
  features: [],
};

const wizardDraft = (name: string) => ({ ...bardDraft(name), classId: "wizard", subclassId: "school-of-war", domainCards: ["bolt-beacon", "book-of-illiat"] });
const warriorDraft = (name: string) => ({ ...bardDraft(name), classId: "warrior", subclassId: "call-of-the-brave", ancestry: { kind: "single" as const, id: "halfling" }, domainCards: ["deft-maneuvers", "whirlwind"] });

/** The scene of tests/e2e/combat-cards.spec.ts: the player's character at (5, 10) facing east, the Bandit at (8, 10). */
async function cardScene(page: Page, browser: Browser, draft: ReturnType<typeof bardDraft>) {
  const { client, campaignId, url } = await openCombatMap(page);
  const context = await browser.newContext({ viewport: VIEWPORTS[0] });
  const player = await context.newPage();
  const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  const playerClient = await convexAs(player);
  await playerClient.mutation(api.members.joinByCode, { code });
  const { characterId } = await playerClient.mutation(api.characters.create, { campaignId, draft, idempotencyKey: crypto.randomUUID() });
  const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: SURE_BANDIT, idempotencyKey: crypto.randomUUID() });
  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
  const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.encounters.start, { campaignId, encounterId });
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: crypto.randomUUID() });
  const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
  const mine = tokens.find((t) => t.characterId === characterId)!;
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: mine._id, x: 5, y: 10 });
  await client.mutation(api.combatTokens.turn, { campaignId, tokenId: mine._id, angle: 0 });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.instanceId === instanceIds[0])!._id, x: 8, y: 10 });
  return { client, playerClient, campaignId, characterId: characterId as Id<"characters">, url, player, closePlayer: () => context.close() };
}

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
}

test("CA6 the Hand: player, dialog, result, phone strip and the GM's view", { tag: "@visual" }, async ({ page, browser }) => {
  test.setTimeout(300_000);
  const s = await cardScene(page, browser, wizardDraft("Ash"));
  const { player } = s;
  try {
    // Book of Illiat waits in the vault, so the shots show Recall too.
    await s.playerClient.mutation(api.characters.moveCard, { characterId: s.characterId, cardId: "book-of-illiat", to: "vault" });
    await player.goto(s.url);
    const hand = player.getByRole("region", { name: "Your hand" });
    await expect(hand.getByRole("article", { name: "Bolt Beacon" })).toBeVisible({ timeout: 30_000 });
    await settle(player);
    await player.screenshot({ path: `${OUT}/player-page-1440.png`, animations: "disabled" });
    await hand.screenshot({ path: `${OUT}/hand-1440.png`, animations: "disabled" });

    await hand.getByRole("list", { name: "Vault" }).getByRole("button", { name: /^Recall: 2 Stress/ }).click();
    await expect(hand.getByRole("list", { name: "Loadout" }).getByRole("article", { name: "Book of Illiat" })).toBeVisible();
    await hand.getByRole("button", { name: "Use Book of Illiat" }).click();
    const dialog = player.getByRole("dialog", { name: "Book of Illiat" });
    await dialog.getByRole("button", { name: "Arcane Barrage" }).click();
    await settle(player);
    await player.screenshot({ path: `${OUT}/dialog-illiat-1440.png`, animations: "disabled" });
    await dialog.getByRole("button", { name: "Cancel" }).click();

    await player.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Bandit, Enemy/ }).click();
    await hand.getByRole("button", { name: "Use Bolt Beacon" }).click();
    await expect(hand.getByRole("region", { name: "Card result" })).toBeVisible();
    await settle(player);
    await hand.screenshot({ path: `${OUT}/hand-result-1440.png`, animations: "disabled" });

    // ---- Phone: the Hand tab of the bottom sheet (the result is kept across the layout switch).
    await player.setViewportSize(VIEWPORTS[1]);
    const sheet = player.getByTestId("combat-actions-sheet");
    await sheet.getByRole("tab", { name: "Hand" }).click();
    await expect(sheet.getByRole("tabpanel").getByRole("region", { name: "Card result" })).toBeVisible();
    expect(await player.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await settle(player);
    await player.screenshot({ path: `${OUT}/sheet-hand-390.png`, animations: "disabled" });
    await sheet.getByRole("tabpanel").getByRole("button", { name: "Use Book of Illiat" }).click();
    await settle(player);
    await player.screenshot({ path: `${OUT}/dialog-illiat-390.png`, animations: "disabled" });
    await player.getByRole("dialog", { name: "Book of Illiat" }).getByRole("button", { name: "Cancel" }).click();

    // ---- The GM's Hand of Ash: greyed, then playing for Ash.
    await page.goto(s.url);
    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport);
      await page.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Ash, / }).click();
      const gmHand = page.getByRole("region", { name: "Hand of Ash" });
      await expect(gmHand.getByRole("article", { name: "Bolt Beacon" })).toBeVisible({ timeout: 30_000 });
      const play = gmHand.getByRole("switch", { name: "Play for this character" });
      if (await play.isChecked()) await play.uncheck();
      await settle(page);
      await gmHand.screenshot({ path: `${OUT}/gm-hand-locked-${viewport.width}.png`, animations: "disabled" });
      await play.check();
      await settle(page);
      await gmHand.screenshot({ path: `${OUT}/gm-hand-playing-${viewport.width}.png`, animations: "disabled" });
    }
    await page.setViewportSize(VIEWPORTS[0]);
    await page.screenshot({ path: `${OUT}/gm-page-1440.png`, animations: "disabled" });
  } finally {
    await s.closePlayer();
  }
});

test("CA6 an exhausted card, greyed and turned with its reset label", { tag: "@visual" }, async ({ page, browser }) => {
  test.setTimeout(300_000);
  const s = await cardScene(page, browser, warriorDraft("Bryn"));
  const { player } = s;
  try {
    await player.goto(s.url);
    const hand = player.getByRole("region", { name: "Your hand" });
    await hand.getByRole("button", { name: "Use Deft Maneuvers" }).click({ timeout: 30_000 });
    await expect(hand.getByRole("article", { name: "Deft Maneuvers, used: Back after a rest" })).toBeVisible();
    for (const viewport of VIEWPORTS) {
      await player.setViewportSize(viewport);
      if (viewport.width <= 760) await player.getByTestId("combat-actions-sheet").getByRole("tab", { name: "Hand" }).click();
      await settle(player);
      await player.getByRole("region", { name: "Your hand" }).screenshot({ path: `${OUT}/hand-exhausted-${viewport.width}.png`, animations: "disabled" });
    }
  } finally {
    await s.closePlayer();
  }
});
