import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations, expectTouchTargets } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, openCombatMap } from "./visual/helpers";

// Plan combat-actions AA4, in three browsers: the player side of an adversary hit. The GM's Bandit hits Mira; Mira's
// player sees "N damage: <severity> (H HP). Mark an Armor Slot …?" on the Combat Map (never the roll, Q13, Q14);
// Tabby's player (390 px: a bottom sheet with 44 px buttons, Q11) sees "Bandit hit Mira" with I Am Your Shield,
// uses it, marks two Armor Slots, and the hit resolves on Tabby (CB p.341). On the sheet, Mira's player answers a
// hit with Mark (CB p.114). Axe on each prompt; shots in test-results/visual/CA-AA4/.

const PLAYER_A = "e2e-player@example.test";
const PLAYER_B = "e2e-player2@example.test";
const OUT = "test-results/visual/CA-AA4";

/** A Bandit that always hits (ATK +20) for 11-14 physical damage. */
const BRUTE_BANDIT = {
  name: "Bandit",
  tier: 1,
  type: "Standard" as const,
  description: "A road thug.",
  motives: "Rob",
  difficulty: 10,
  thresholds: { major: 5, severe: 10 },
  hp: 5,
  stress: 3,
  attack: { modifier: 20, name: "Club", range: "Melee", damage: "1d4+10 phy" },
  experiences: [],
  features: [],
};

/** A level-1 Guardian (Stalwart) in Chainmail holding I Am Your Shield (Valor 1, CB p.341). */
const guardianDraft = (name: string) => ({
  ...bardDraft(name),
  classId: "guardian",
  subclassId: "stalwart",
  ancestry: { kind: "single" as const, id: "dwarf" },
  communityId: "ridgeborne",
  traits: { agility: 1, strength: 2, finesse: 0, instinct: 1, presence: 0, knowledge: -1 },
  pronouns: "he/him",
  primaryWeaponId: "broadsword",
  armorId: "chainmail-armor",
  experiences: ["Shieldwall", "Stubborn"],
  domainCards: ["i-am-your-shield", "whirlwind"],
});

type Player = { page: Page; client: ConvexHttpClient; close: () => Promise<void> };

async function joinAs(browser: Browser, gm: ConvexHttpClient, campaignId: Id<"campaigns">, email: string, viewport = { width: 1440, height: 900 }): Promise<Player> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await signInAsTestGm(page, email);
  await expect(page).toHaveURL("/");
  const client = await convexAs(page);
  await client.mutation(api.members.joinByCode, { code });
  return { page, client, close: () => context.close() };
}

/** A running encounter with the Bandit; returns its instance id. */
async function banditEncounter(gm: ConvexHttpClient, campaignId: Id<"campaigns">) {
  const { customId } = await gm.mutation(api.customAdversaries.create, { campaignId, adversary: BRUTE_BANDIT, idempotencyKey: crypto.randomUUID() });
  const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
  const { instanceIds } = await gm.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
  await gm.mutation(api.encounters.start, { campaignId, encounterId });
  return instanceIds[0]!;
}

/** The GM's Bandit attacks `target` (paying the Fear the server asks for, Q19). Returns the hit's request id. */
async function banditAttacks(gm: ConvexHttpClient, campaignId: Id<"campaigns">, instanceId: Id<"encounterAdversaries">, target: Id<"characters">) {
  let res = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [target], idempotencyKey: crypto.randomUUID() });
  if (res.status === "confirmFear") {
    res = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [target], spendFear: res.fear, idempotencyKey: crypto.randomUUID() });
  }
  if (res.status !== "resolved") throw new Error("attack not resolved");
  const hit = res.targets[0]!;
  expect(hit.hit).toBe(true);
  expect(hit.resolved).toBe(false);
  return hit.requestId!;
}

async function sheetOf(gm: ConvexHttpClient, characterId: Id<"characters">) {
  return (await gm.query(api.characters.get, { characterId }))!.sheet;
}

const PROMPT_LINE = /^\d+ damage: (Minor|Major|Severe) \(\d HP\)\.$/;
const ENEMY_WORDS = /\b(roll|Evasion|Difficulty|threshold|ATK)\b/i;

test("the Bandit hits Mira; Tabby answers with I Am Your Shield, marks two Armor Slots, and the hit resolves on Tabby", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const { client: gm, campaignId, url } = await openCombatMap(page);
  const a = await joinAs(browser, gm, campaignId, PLAYER_A);
  const b = await joinAs(browser, gm, campaignId, PLAYER_B, { width: 390, height: 844 });
  try {
    const { characterId: mira } = await a.client.mutation(api.characters.create, { campaignId, draft: bardDraft("Mira"), idempotencyKey: crypto.randomUUID() });
    const { characterId: tabby } = await b.client.mutation(api.characters.create, { campaignId, draft: guardianDraft("Tabby"), idempotencyKey: crypto.randomUUID() });
    const instanceId = await banditEncounter(gm, campaignId);
    const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
    await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
    await gm.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: [instanceId], idempotencyKey: crypto.randomUUID() });
    const tokens = await gm.query(api.combatTokens.list, { campaignId, mapId });
    await gm.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.characterId === mira)!._id, x: 6, y: 10 });
    await gm.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.characterId === tabby)!._id, x: 6, y: 11 });
    await gm.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.instanceId === instanceId)!._id, x: 7, y: 10 });

    await a.page.goto(url);
    await b.page.goto(url);
    await expect(a.page.getByRole("region", { name: "Battle map" })).toBeVisible({ timeout: 30_000 });
    await expect(b.page.getByRole("region", { name: "Battle map" })).toBeVisible({ timeout: 30_000 });

    await banditAttacks(gm, campaignId, instanceId, mira);

    // Mira's player: her own damage and severity, Mark / Don't, never the roll (Q13, Q14).
    const miraPrompt = a.page.getByRole("region", { name: "Incoming hit: Bandit hit Mira" });
    await expect(miraPrompt).toBeVisible({ timeout: 30_000 });
    await expect(miraPrompt.locator(".ih-dmg")).toHaveText(PROMPT_LINE);
    await expect(miraPrompt.locator(".ih-q")).toHaveText(/^Mark an Armor Slot to (make it (Minor|Major)|take no damage)\?$/);
    await expect(miraPrompt.getByRole("button", { name: "Mark" })).toBeVisible();
    await expect(miraPrompt.getByRole("button", { name: "Don't" })).toBeVisible();
    await expect(miraPrompt).not.toContainText(ENEMY_WORDS);
    await expectNoSeriousA11yViolations(a.page, { include: "[data-testid=incoming-hit]" });
    await a.page.screenshot({ path: `${OUT}/map-target-1440.png`, animations: "disabled" });
    await miraPrompt.screenshot({ path: `${OUT}/prompt-target-1440.png`, animations: "disabled" });

    // Tabby's player at 390 px: a bottom sheet with "Bandit hit Mira" and I Am Your Shield; no damage number.
    const tabbyPrompt = b.page.getByRole("region", { name: "Incoming hit: Bandit hit Mira" });
    await expect(tabbyPrompt).toBeVisible({ timeout: 30_000 });
    await expect(tabbyPrompt).toContainText("Tabby can react");
    await expect(tabbyPrompt).not.toContainText(/\d+ damage/);
    await expect(tabbyPrompt.getByRole("heading", { name: "I Am Your Shield" })).toBeVisible();
    const dock = b.page.getByTestId("incoming-hit-dock");
    expect(await dock.evaluate((el) => getComputedStyle(el).position)).toBe("fixed");
    await expectTouchTargets(tabbyPrompt.getByRole("button"));
    await expectNoSeriousA11yViolations(b.page, { include: "[data-testid=incoming-hit]" });
    expect(await b.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await b.page.screenshot({ path: `${OUT}/map-ally-390.png`, animations: "disabled" });

    await tabbyPrompt.getByRole("button", { name: "Use I Am Your Shield" }).click();

    // Tabby is the target now: any number of Armor Slots (CB p.341). Mira's player owes nothing.
    const shield = b.page.getByRole("region", { name: "Incoming hit: Bandit hit Tabby" });
    await expect(shield).toBeVisible({ timeout: 30_000 });
    await expect(shield.locator(".ih-q")).toHaveText("Mark any number of Armor Slots to reduce it.");
    await expect(shield.getByRole("button", { name: "Use I Am Your Shield" })).toHaveCount(0);
    await expect(shield.locator(".ih-dmg")).toHaveText(PROMPT_LINE);
    await expectTouchTargets(shield.getByRole("button"));
    await expectNoSeriousA11yViolations(b.page, { include: "[data-testid=incoming-hit]" });
    await b.page.screenshot({ path: `${OUT}/map-shield-390.png`, animations: "disabled" });
    await expect(a.page.getByTestId("incoming-hit")).toHaveCount(0);
    await expect.poll(async () => (await sheetOf(gm, tabby)).stress).toBe(1);

    await shield.getByRole("button", { name: /^Mark 2/ }).click();
    await expect(b.page.getByTestId("incoming-hit")).toHaveCount(0);
    await expect(b.page.getByTestId("incoming-hit-line")).toHaveCount(0);
    await expect.poll(async () => (await sheetOf(gm, tabby)).armorMarked).toBe(2);
    expect((await sheetOf(gm, mira)).hp).toBe(0);
    expect(await gm.query(api.adversaryActions.pending, { campaignId, characterId: tabby })).toEqual([]);

    // The feed: "Bandit hit Mira" only, no numbers (Q14).
    await expect(a.page.getByRole("region", { name: "Roll feed" }).getByTestId("combat-mini-feed")).toContainText("Bandit hit Mira");
  } finally {
    await a.close();
    await b.close();
  }
});

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`on the sheet, Mira's player marks an Armor Slot against the Bandit's hit (${viewport.width}px)`, async ({ page, browser }) => {
    test.setTimeout(240_000);
    const { client: gm, campaignId } = await openCombatMap(page);
    const a = await joinAs(browser, gm, campaignId, PLAYER_A, viewport);
    try {
      const { characterId: mira } = await a.client.mutation(api.characters.create, { campaignId, draft: bardDraft("Mira"), idempotencyKey: crypto.randomUUID() });
      const instanceId = await banditEncounter(gm, campaignId);
      // No map: the GM targets from the party list (Q18).
      await banditAttacks(gm, campaignId, instanceId, mira);

      await a.page.goto(`/campaigns/${campaignId}/party/${mira}`);
      const prompt = a.page.getByRole("region", { name: "Incoming hit: Bandit hit Mira" });
      await expect(prompt).toBeVisible({ timeout: 30_000 });
      await expect(prompt.locator(".ih-dmg")).toHaveText(PROMPT_LINE);
      await expect(prompt).not.toContainText(ENEMY_WORDS);
      await expectTouchTargets(prompt.getByRole("button"));
      await expectNoSeriousA11yViolations(a.page, { include: "[data-testid=incoming-hit]" });
      await a.page.screenshot({ path: `${OUT}/sheet-target-${viewport.width}.png`, animations: "disabled" });

      const before = await sheetOf(gm, mira);
      await prompt.getByRole("button", { name: "Mark" }).click();
      await expect(a.page.getByTestId("incoming-hit")).toHaveCount(0);
      await expect.poll(async () => (await sheetOf(gm, mira)).armorMarked).toBe(before.armorMarked + 1);
      expect((await sheetOf(gm, mira)).hp).toBeGreaterThan(0);
    } finally {
      await a.close();
    }
  });
}
