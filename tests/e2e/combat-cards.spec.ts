import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, openCombatMap } from "./visual/helpers";

// Plan combat-actions CA6, in two browsers: the Hand on the Combat Map. A player uses Bolt Beacon on a Bandit (Hope
// spent, Hit, the card stays ready; never the Bandit's numbers, U1); a once-per-rest card (Deft Maneuvers) greys out
// and comes back after the GM's rest, and a vault card is recalled for free while the rest is open (CB p.101, p.105);
// the GM selecting a PC token sees the Hand greyed until "Play for this character" is on, then plays Bolt Beacon for Ash
// (desktop and 390 px). Axe on each view.
// F7-H4 (dcm-bxp.99.24): a rolling card opens the dialog with the Attack bar's roll options; a player selecting another
// PC's token sees that Hand read only (no Use / Recall), and nothing once the GM turns "Players can see each other's
// cards" off; the player's "Hide my hand" switch; a creature the GM picks in a card dialog gets a target ring on the map.

const PLAYER = "e2e-player@example.test";

/** A Bandit any roll hits (Difficulty 1). */
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

/** A level-1 Wizard holding Bolt Beacon (Splendor) and Book of Illiat (Codex). */
const wizardDraft = (name: string) => ({ ...bardDraft(name), classId: "wizard", subclassId: "school-of-war", domainCards: ["bolt-beacon", "book-of-illiat"] });
/** A level-1 Warrior holding Deft Maneuvers (Bone, once per rest) and Whirlwind (Blade). */
const warriorDraft = (name: string) => ({ ...bardDraft(name), classId: "warrior", subclassId: "call-of-the-brave", ancestry: { kind: "single" as const, id: "halfling" }, domainCards: ["deft-maneuvers", "whirlwind"] });

type Scene = {
  client: ConvexHttpClient;
  playerClient: ConvexHttpClient;
  campaignId: Id<"campaigns">;
  url: string;
  characterId: Id<"characters">;
  player: Page;
  closePlayer: () => Promise<void>;
};

/**
 * The GM's campaign with a live map: the player's character (`draft`) at (5, 10) facing east, the GM's Mira (a Bard
 * with Book of Ava) at (5, 13), and a running encounter with the Bandit three squares east of the player's character.
 */
async function cardScene(page: Page, browser: Browser, draft: ReturnType<typeof bardDraft>, viewport = { width: 1440, height: 900 }): Promise<Scene> {
  const { client, campaignId, url } = await openCombatMap(page);
  const context = await browser.newContext({ viewport });
  const player = await context.newPage();
  const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  const playerClient = await convexAs(player);
  await playerClient.mutation(api.members.joinByCode, { code });
  const { characterId } = await playerClient.mutation(api.characters.create, { campaignId, draft, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Mira"), idempotencyKey: crypto.randomUUID() });

  const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: SURE_BANDIT, idempotencyKey: crypto.randomUUID() });
  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
  const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.encounters.start, { campaignId, encounterId });

  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: crypto.randomUUID() });
  const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
  const mine = tokens.find((t) => t.characterId === characterId)!;
  const mira = tokens.find((t) => t.name === "Mira")!;
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: mine._id, x: 5, y: 10 });
  await client.mutation(api.combatTokens.turn, { campaignId, tokenId: mine._id, angle: 0 });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: mira._id, x: 5, y: 13 });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.instanceId === instanceIds[0])!._id, x: 8, y: 10 });
  return { client, playerClient, campaignId, url, characterId, player, closePlayer: () => context.close() };
}

async function sheetOf(s: Scene) {
  const view = await s.client.query(api.characters.get, { characterId: s.characterId });
  return view!.sheet;
}

/** The Hope a roll with Bolt Beacon leaves: +1 with Hope or a critical, then the 1 Hope it costs on a success. */
function hopeAfter(before: number, outcome: string): number {
  return Math.min(6, before + (outcome === "With Fear" ? 0 : 1)) - 1;
}

test("a player uses Bolt Beacon on the Bandit with roll options: Hope spent, Hit, the card stays ready; another PC's Hand read only", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const s = await cardScene(page, browser, wizardDraft("Ash"));
  const { player } = s;
  try {
    await player.goto(s.url);
    const hand = player.getByRole("region", { name: "Your hand" });
    const bolt = hand.getByRole("article", { name: "Bolt Beacon" });
    await expect(bolt).toBeVisible({ timeout: 30_000 });
    await expect(bolt.getByRole("list", { name: "Cost and limit" })).toHaveText("On a success: 1 Hope");
    await expect(hand.getByRole("article", { name: "Book of Illiat" }).getByRole("list", { name: "Cost and limit" })).toHaveText("3 spells");
    await expectNoSeriousA11yViolations(player, { include: ".cm-aside" });

    // Pick the Bandit on the map; Bolt Beacon rolls, so Use opens the dialog with the Bandit picked and the roll options.
    await player.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Bandit, Enemy/ }).click();
    const hopeBefore = (await sheetOf(s)).hope;
    await bolt.getByRole("button", { name: "Use Bolt Beacon" }).click();
    const dialog = player.getByRole("dialog", { name: "Bolt Beacon" });
    await expect(dialog.getByRole("button", { name: "Bandit" })).toHaveAttribute("aria-pressed", "true");
    const options = dialog.getByTestId("combat-card-roll-options");
    await options.getByText("Roll options").click();
    await options.getByRole("button", { name: "More advantage" }).click();
    await expect(options.getByRole("group", { name: "Advantage" })).toContainText("Advantage ×1");
    await expectNoSeriousA11yViolations(player, { include: "dialog[open]" });
    await dialog.getByRole("button", { name: "Use Bolt Beacon" }).click();
    await expect(player.getByRole("dialog")).toHaveCount(0);
    const result = hand.getByRole("region", { name: "Card result" });
    await expect(result.getByTestId("combat-card-verdict")).toHaveText(/Bandit\s*Hit/);
    await expect(result.getByTestId("combat-card-damage")).toBeVisible();
    await expect(result).not.toContainText(/\b(HP|Stress|Difficulty|threshold|Minor|Major|Severe)\b/);
    const outcome = (await result.locator(".cma-outcome").first().textContent())!.trim();
    await expect.poll(async () => (await sheetOf(s)).hope).toBe(hopeAfter(hopeBefore, outcome));
    // Bolt Beacon has no usage limit: it stays ready.
    await expect(hand.getByRole("article", { name: "Bolt Beacon" })).not.toHaveAttribute("data-exhausted", "true");
    await expect(bolt.getByRole("button", { name: "Use Bolt Beacon" })).toBeEnabled();
    // The feed has the public row (U2), without the Bandit's numbers.
    await expect(player.getByRole("region", { name: "Roll feed" }).getByTestId("combat-mini-feed")).toContainText("Ash uses Bolt Beacon");

    // A player selecting another PC's token sees that Hand read only (F7-H4): no Use, no Recall.
    await player.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Mira, / }).click();
    const miraHand = player.getByRole("region", { name: "Hand of Mira" });
    await expect(miraHand.getByRole("article", { name: "Book of Ava" })).toBeVisible();
    await expect(miraHand.getByRole("article", { name: "Deft Deceiver" })).toHaveAttribute("data-locked", "true");
    await expect(miraHand.getByRole("button", { name: /^(Use|Recall)/ })).toHaveCount(0);
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=combat-other-hand]" });
    // The GM turns "Players can see each other's cards" off: no cards, and why.
    await s.client.mutation(api.campaigns.setPlayersSeeHands, { campaignId: s.campaignId, enabled: false });
    await expect(miraHand.getByTestId("combat-hand-hidden")).toHaveText("The GM keeps every player’s cards private.");
    await expect(miraHand.getByRole("article")).toHaveCount(0);
    await s.client.mutation(api.campaigns.setPlayersSeeHands, { campaignId: s.campaignId, enabled: true });
    await expect(miraHand.getByRole("article", { name: "Book of Ava" })).toBeVisible();
    await miraHand.getByRole("button", { name: "Your hand" }).click();
    await expect(hand.getByRole("article", { name: "Bolt Beacon" })).toBeVisible();
    // The player hides their own hand; the GM still reads it.
    await hand.getByRole("switch", { name: "Hide my hand from the other players" }).check();
    await expect.poll(async () => (await s.client.query(api.combatCards.handSharing, { campaignId: s.campaignId })).hidden).toEqual([s.characterId]);
    expect((await s.client.query(api.combatCards.hand, { campaignId: s.campaignId, characterId: s.characterId })).loadout.length).toBe(2);

    // The vault: Book of Illiat (moved there on the sheet) costs 2 Stress to recall (R7, CB p.101).
    await s.playerClient.mutation(api.characters.moveCard, { characterId: s.characterId, cardId: "book-of-illiat", to: "vault" });
    const stressBefore = (await sheetOf(s)).stress;
    const vault = hand.getByRole("list", { name: "Vault" });
    await vault.getByRole("button", { name: "Recall: 2 Stress, Book of Illiat" }).click();
    await expect(hand.getByRole("list", { name: "Loadout" }).getByRole("article", { name: "Book of Illiat" })).toBeVisible();
    await expect.poll(async () => (await sheetOf(s)).stress).toBe(stressBefore + 2);
  } finally {
    await s.closePlayer();
  }
});

test("a once-per-rest card greys out and comes back after the GM's rest; Recall is free while the rest is open", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const s = await cardScene(page, browser, warriorDraft("Bryn"));
  const { player } = s;
  try {
    // Whirlwind goes to the vault first (on the sheet), so the Hand shows it there.
    await s.playerClient.mutation(api.characters.moveCard, { characterId: s.characterId, cardId: "whirlwind", to: "vault" });
    await player.goto(s.url);
    const hand = player.getByRole("region", { name: "Your hand" });
    const deft = hand.getByRole("article", { name: "Deft Maneuvers" });
    await expect(deft).toBeVisible({ timeout: 30_000 });
    await expect(deft.getByRole("list", { name: "Cost and limit" })).toHaveText(/1 Stress\s*Once per rest/);
    const vault = hand.getByRole("list", { name: "Vault" });
    await expect(vault.getByRole("article", { name: "Whirlwind" })).toBeVisible();
    // A level-1 card's recall cost is 0: free.
    await expect(vault.getByRole("button", { name: "Recall: free, Whirlwind" })).toBeVisible();

    await deft.getByRole("button", { name: "Use Deft Maneuvers" }).click();
    await expect(hand.getByRole("region", { name: "Card result" }).getByTestId("combat-card-prompt").first()).toContainText("Sprint anywhere within Far range");
    const used = hand.getByRole("article", { name: "Deft Maneuvers, used: Back after a rest" });
    await expect(used).toHaveAttribute("data-exhausted", "true");
    await expect(used).toContainText("Used · Back after a rest");
    await expect(used.getByRole("button", { name: /^Use/ })).toHaveCount(0);
    expect((await sheetOf(s)).stress).toBe(1);

    // The GM rests the party; Whirlwind is recalled while the rest is open (a paid recall being free then: unit test).
    const { restId } = await s.client.mutation(api.rests.start, { campaignId: s.campaignId, kind: "short", idempotencyKey: crypto.randomUUID() });
    const recall = vault.getByRole("button", { name: "Recall: free, Whirlwind" });
    await expect(recall).toBeVisible();
    await recall.click();
    await expect(hand.getByRole("list", { name: "Loadout" }).getByRole("article", { name: "Whirlwind" })).toBeVisible();
    await expect.poll(async () => (await sheetOf(s)).domainCards.loadout).toContain("whirlwind");
    expect((await sheetOf(s)).stress).toBe(1);

    await s.client.mutation(api.rests.finish, { campaignId: s.campaignId, restId, idempotencyKey: crypto.randomUUID() });
    await expect(hand.getByRole("article", { name: "Deft Maneuvers" })).toBeVisible();
    await expect(hand.getByRole("article", { name: "Deft Maneuvers" }).getByRole("button", { name: "Use Deft Maneuvers" })).toBeEnabled();
  } finally {
    await s.closePlayer();
  }
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`the GM selects Ash's token: the Hand is greyed until 'Play for this character', then Bolt Beacon works (${viewport.width}px)`, async ({ page, browser }) => {
    test.setTimeout(240_000);
    const s = await cardScene(page, browser, wizardDraft("Ash"));
    try {
      await page.setViewportSize(viewport);
      await page.goto(s.url);
      await page.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Ash, / }).click();
      const hand = page.getByRole("region", { name: "Hand of Ash" });
      const bolt = hand.getByRole("article", { name: "Bolt Beacon" });
      await expect(bolt).toBeVisible({ timeout: 30_000 });
      await expect(bolt).toHaveAttribute("data-locked", "true");
      await expect(hand.getByRole("button", { name: /^Use/ })).toHaveCount(0);
      await expectNoSeriousA11yViolations(page, { include: "[data-testid=combat-gm-hand]" });
      if (viewport.width <= 760) expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      const play = hand.getByRole("switch", { name: "Play for this character" });
      await play.check();
      await expect(bolt).not.toHaveAttribute("data-locked", "true");
      const hopeBefore = (await sheetOf(s)).hope;
      await bolt.getByRole("button", { name: "Use Bolt Beacon" }).click();
      // The GM has picked no enemy on the map: the dialog asks for the target; the pick rings the Bandit on the map (F7-H4).
      const dialog = page.getByRole("dialog", { name: "Bolt Beacon" });
      await expect(page.getByTestId("combat-target-ring")).toHaveCount(0);
      await dialog.getByRole("button", { name: "Bandit" }).click();
      await expect(page.getByTestId("combat-target-ring")).toHaveCount(1);
      await expectNoSeriousA11yViolations(page, { include: "dialog[open]" });
      await dialog.getByRole("button", { name: "Use Bolt Beacon" }).click();
      await expect(dialog).toHaveCount(0);
      const result = hand.getByRole("region", { name: "Card result" });
      await expect(result.getByTestId("combat-card-verdict")).toHaveText(/Bandit\s*Hit/);
      const outcome = (await result.locator(".cma-outcome").first().textContent())!.trim();
      await expect.poll(async () => (await sheetOf(s)).hope).toBe(hopeAfter(hopeBefore, outcome));
      // Logged with the GM acting for Ash: the public row names Ash's card.
      const feed = await s.client.query(api.feed.list, { campaignId: s.campaignId, paginationOpts: { numItems: 10, cursor: null } });
      expect(feed.page.some((r) => r.summary.startsWith("Ash uses Bolt Beacon"))).toBe(true);

      // Turning the switch off greys the Hand again.
      await play.uncheck();
      await expect(hand.getByRole("button", { name: /^Use/ })).toHaveCount(0);
    } finally {
      await s.closePlayer();
    }
  });
}
