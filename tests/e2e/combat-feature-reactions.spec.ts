import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cardsForDomains, getClass } from "../../src/lib/srd";
import { expectNoSeriousA11yViolations, expectTouchTargets } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, openCombatMap } from "./visual/helpers";

// Plan sheet-drawer SD4, in three browsers: feature reactions in an adversary hit's reaction window. A Stalwart
// Guardian answers the Bandit's hit with Iron Will and marks two Armor Slots (CB p.36, p.114); a dwarf halves the next
// hit with Increased Fortitude (CB p.55; rounded up, CB p.107); a Pact of the Endless warlock answers before the roll
// with Harrowing Invocation (HF p.14, Q2): a Favor, and the attack rolls with disadvantage. Players never see the roll
// (Q14). The GM's undo of each action group puts every sheet back (U4). The server's dice are fair here, so whether the
// disadvantaged roll misses is checked against what happened (the forced miss is tests/convex/feature-reactions.test.ts).

const PLAYER_A = "e2e-player@example.test";
const PLAYER_B = "e2e-player2@example.test";
const OUT = "test-results/visual/SD-SD4";

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

/** A Bandit that hits on 11+ (ATK 0 against Evasion 11) for the warlock's before-roll answer. */
const PLAIN_BANDIT = { ...BRUTE_BANDIT, name: "Cutpurse", attack: { ...BRUTE_BANDIT.attack, modifier: 0 } };

/** A level-1 human Stalwart Guardian in Chainmail: Iron Will (CB p.36). */
const guardianDraft = (name: string) => ({
  ...bardDraft(name),
  classId: "guardian",
  subclassId: "stalwart",
  ancestry: { kind: "single" as const, id: "human" },
  communityId: "ridgeborne",
  traits: { agility: 1, strength: 2, finesse: 0, instinct: 1, presence: 0, knowledge: -1 },
  pronouns: "he/him",
  primaryWeaponId: "broadsword",
  armorId: "chainmail-armor",
  experiences: ["Shieldwall", "Stubborn"],
  domainCards: ["i-am-your-shield", "whirlwind"],
});

/** A dwarf Bard: Thick Skin and Increased Fortitude (CB p.55). */
const dwarfDraft = (name: string) => ({ ...bardDraft(name), ancestry: { kind: "single" as const, id: "dwarf" } });

/** A level-1 Pact of the Endless Warlock (HF p.14); the spec levels it to 2 with the specialization. */
const warlockDraft = (name: string) => ({
  ...bardDraft(name),
  classId: "warlock",
  subclassId: "pact-of-the-endless",
  traits: { agility: 0, strength: -1, finesse: 1, instinct: 0, presence: 2, knowledge: 1 },
  primaryWeaponId: "dagger",
  domainCards: cardsForDomains(getClass("warlock")!.domains, 1)
    .filter((c) => c.level === 1)
    .slice(0, 2)
    .map((c) => c.id),
});

type Player = { page: Page; client: ConvexHttpClient; close: () => Promise<void> };

async function joinAs(browser: Browser, gm: ConvexHttpClient, campaignId: Id<"campaigns">, email: string, viewport = { width: 1280, height: 900 }): Promise<Player> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const code = await gm.mutation(api.members.rotateJoinCode, { campaignId });
  await signInAsTestGm(page, email);
  await expect(page).toHaveURL("/");
  const client = await convexAs(page);
  await client.mutation(api.members.joinByCode, { code });
  return { page, client, close: () => context.close() };
}

/** A running encounter with `adversary`; returns its instance id. */
async function encounterWith(gm: ConvexHttpClient, campaignId: Id<"campaigns">, adversary: typeof BRUTE_BANDIT) {
  const { customId } = await gm.mutation(api.customAdversaries.create, { campaignId, adversary, idempotencyKey: crypto.randomUUID() });
  const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
  const { instanceIds } = await gm.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
  await gm.mutation(api.encounters.start, { campaignId, encounterId });
  return instanceIds[0]!;
}

/** The GM's adversary attacks `target` (paying the Fear the server asks for, Q19). */
async function attacks(gm: ConvexHttpClient, campaignId: Id<"campaigns">, instanceId: Id<"encounterAdversaries">, target: Id<"characters">) {
  let res = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [target], idempotencyKey: crypto.randomUUID() });
  if (res.status === "confirmFear") res = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [target], spendFear: res.fear, idempotencyKey: crypto.randomUUID() });
  if (res.status !== "resolved") throw new Error("attack not resolved");
  return res;
}

async function sheetOf(gm: ConvexHttpClient, characterId: Id<"characters">) {
  return (await gm.query(api.charactersReads.get, { characterId }))!.sheet;
}

const ENEMY_WORDS = /\b(roll|Evasion|Difficulty|threshold|ATK)\b/i;
const DAMAGE = /^(\d+) damage: /;

test("a Guardian answers with Iron Will, a dwarf with Increased Fortitude, and the GM's undo puts each sheet back", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const { client: gm, campaignId } = await openCombatMap(page);
  const a = await joinAs(browser, gm, campaignId, PLAYER_A);
  const b = await joinAs(browser, gm, campaignId, PLAYER_B, { width: 390, height: 844 });
  try {
    const { characterId: tabby } = await a.client.mutation(api.characters.create, { campaignId, draft: guardianDraft("Tabby"), idempotencyKey: crypto.randomUUID() });
    const { characterId: mira } = await b.client.mutation(api.characters.create, { campaignId, draft: dwarfDraft("Mira"), idempotencyKey: crypto.randomUUID() });
    // Increased Fortitude costs 3 Hope (CB p.55); a new character starts with 2 (CB p.19).
    while ((await sheetOf(gm, mira)).hope < 3) await gm.mutation(api.characters.adjustResource, { characterId: mira, resource: "hope", delta: 1 });
    const instanceId = await encounterWith(gm, campaignId, BRUTE_BANDIT);

    // Tabby: the Bandit's hit (11-14 physical, Major or Severe against Chainmail) with Iron Will on offer.
    const first = await attacks(gm, campaignId, instanceId, tabby);
    await a.page.goto(`/campaigns/${campaignId}/party/${tabby}`);
    const tabbyPrompt = a.page.getByRole("region", { name: "Incoming hit: Bandit hit Tabby" });
    await expect(tabbyPrompt).toBeVisible({ timeout: 30_000 });
    const ironWill = tabbyPrompt.getByTestId("incoming-hit-feature").filter({ has: a.page.getByRole("heading", { name: "Iron Will" }) });
    await expect(ironWill).toBeVisible();
    await expect(tabbyPrompt).not.toContainText(ENEMY_WORDS);
    await expectNoSeriousA11yViolations(a.page, { include: "[data-testid=incoming-hit]" });
    await expectTouchTargets(tabbyPrompt.getByRole("button"));
    await tabbyPrompt.screenshot({ path: `${OUT}/iron-will-1280.png`, animations: "disabled" });
    await ironWill.getByRole("button", { name: "Use Iron Will" }).click();
    // One more slot than the usual one (CB p.114): "Mark 2" is there now.
    await expect(tabbyPrompt.locator(".ih-q")).toHaveText("Mark any number of Armor Slots to reduce it.");
    await tabbyPrompt.getByRole("button", { name: /^Mark 2/ }).click();
    await expect(a.page.getByTestId("incoming-hit")).toHaveCount(0);
    await expect.poll(async () => (await sheetOf(gm, tabby)).armorMarked, { timeout: 30_000 }).toBe(2);
    const tabbyHp = (await sheetOf(gm, tabby)).hp;
    expect(tabbyHp).toBeLessThanOrEqual(1);
    // The GM undoes the action: the Armor Slots (and any Hit Point) come back.
    await gm.mutation(api.actionLog.undo, { entryId: first.entryId, idempotencyKey: crypto.randomUUID() });
    await expect.poll(async () => (await sheetOf(gm, tabby)).armorMarked).toBe(0);
    expect(await sheetOf(gm, tabby)).toMatchObject({ hp: 0 });

    // Mira at 390 px: Increased Fortitude halves the damage she sees, rounded up.
    const second = await attacks(gm, campaignId, instanceId, mira);
    await b.page.goto(`/campaigns/${campaignId}/party/${mira}`);
    const miraPrompt = b.page.getByRole("region", { name: "Incoming hit: Bandit hit Mira" });
    await expect(miraPrompt).toBeVisible({ timeout: 30_000 });
    const before = Number(DAMAGE.exec((await miraPrompt.locator(".ih-dmg").textContent()) ?? "")?.[1]);
    expect(before).toBeGreaterThanOrEqual(11);
    const fortitude = miraPrompt.getByTestId("incoming-hit-feature").filter({ has: b.page.getByRole("heading", { name: "Increased Fortitude" }) });
    await expectTouchTargets(miraPrompt.getByRole("button"));
    await expectNoSeriousA11yViolations(b.page, { include: "[data-testid=incoming-hit]" });
    expect(await b.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await b.page.screenshot({ path: `${OUT}/fortitude-390.png`, animations: "disabled" });
    await fortitude.getByRole("button", { name: "Use Increased Fortitude" }).click();
    await expect(miraPrompt.locator(".ih-dmg")).toHaveText(new RegExp(`^${Math.ceil(before / 2)} damage: `));
    await expect.poll(async () => (await sheetOf(gm, mira)).hope).toBe(0);
    await miraPrompt.getByRole("button", { name: "Don't" }).click();
    await expect(b.page.getByTestId("incoming-hit")).toHaveCount(0);
    // Tabby holds I Am Your Shield (an ally's answer, CB p.341): the window waits for Tabby's Pass (Q17).
    const tabbyAlly = a.page.getByRole("region", { name: "Incoming hit: Bandit hit Mira" });
    await expect(tabbyAlly).toBeVisible({ timeout: 30_000 });
    await expect(tabbyAlly).not.toContainText(/\d+ damage/);
    await tabbyAlly.getByRole("button", { name: "Pass" }).click();
    await expect.poll(async () => (await sheetOf(gm, mira)).hp, { timeout: 30_000 }).toBeGreaterThan(0);

    // The GM undoes it: Hit Points and Hope come back.
    await gm.mutation(api.actionLog.undo, { entryId: second.entryId, idempotencyKey: crypto.randomUUID() });
    await expect.poll(async () => (await sheetOf(gm, mira)).hope).toBe(3);
    expect(await sheetOf(gm, mira)).toMatchObject({ hp: 0 });
  } finally {
    await a.close();
    await b.close();
  }
});

type LevelChoice = { picks: { option: "traits" | "hp" | "stress" | "evasion" | "subclass"; tier: number; targets?: string[] }[]; experienceName?: string };

/** Levels a Warlock from 1 with `levels` (one entry per level from 2), a new class domain card each level. */
async function levelWarlock(gm: ConvexHttpClient, characterId: Id<"characters">, levels: readonly LevelChoice[]) {
  const cards = cardsForDomains(getClass("warlock")!.domains, levels.length + 1);
  const owned = new Set((await sheetOf(gm, characterId)).domainCards.owned);
  for (const [i, level] of levels.entries()) {
    const card = cards.find((c) => c.level <= i + 2 && !owned.has(c.id))!;
    owned.add(card.id);
    await gm.mutation(api.levelUp.apply, { characterId, choice: { ...level, cardId: card.id }, idempotencyKey: crypto.randomUUID() });
  }
}

/** Levels 2-5: the tier 3 upgraded subclass (specialization) at level 5 (HF p.14). */
const TO_SPECIALIZATION: LevelChoice[] = [
  { picks: [{ option: "traits", tier: 2, targets: ["agility", "instinct"] }, { option: "hp", tier: 2 }], experienceName: "Bargains Kept" },
  { picks: [{ option: "stress", tier: 2 }, { option: "evasion", tier: 2 }] },
  { picks: [{ option: "traits", tier: 2, targets: ["strength", "finesse"] }, { option: "hp", tier: 2 }] },
  { picks: [{ option: "subclass", tier: 3 }, { option: "hp", tier: 3 }], experienceName: "Old Debts" },
];

/** Levels 6-8 on top: the tier 4 upgraded subclass (mastery: Dark Aegis, HF p.14) at level 8. */
const TO_MASTERY: LevelChoice[] = [
  ...TO_SPECIALIZATION,
  { picks: [{ option: "stress", tier: 3 }, { option: "evasion", tier: 3 }] },
  { picks: [{ option: "hp", tier: 3 }, { option: "stress", tier: 3 }] },
  { picks: [{ option: "subclass", tier: 4 }, { option: "hp", tier: 4 }], experienceName: "Endless Pact" },
];

// Plan drawer-answers DA8 (user answers 2026-10-29 / 2026-10-30): CB p.107 "the player controlling the effects ... can
// apply the effects in any order": after the Armor Slot every ready reaction that still fits stays offered; Dark Aegis
// (HF p.14) cancels the damage to zero. Stable (HF p.12) has no e2e: no public function teaches a stance yet (the
// convex test seeds it; docs/tasks/TASK-DA-DA8.md).
test("after an Armor Slot a dwarf still gets Increased Fortitude; a warlock's Dark Aegis leaves no Hit Point marked; the GM's undo restores all", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const { client: gm, campaignId } = await openCombatMap(page);
  await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
  const a = await joinAs(browser, gm, campaignId, PLAYER_A);
  const b = await joinAs(browser, gm, campaignId, PLAYER_B);
  try {
    const { characterId: mira } = await a.client.mutation(api.characters.create, { campaignId, draft: dwarfDraft("Mira"), idempotencyKey: crypto.randomUUID() });
    while ((await sheetOf(gm, mira)).hope < 3) await gm.mutation(api.characters.adjustResource, { characterId: mira, resource: "hope", delta: 1 });
    const instanceId = await encounterWith(gm, campaignId, BRUTE_BANDIT);

    // Mira: Mark the Armor Slot first; Increased Fortitude is still offered after it.
    const first = await attacks(gm, campaignId, instanceId, mira);
    await a.page.goto(`/campaigns/${campaignId}/party/${mira}`);
    const miraPrompt = a.page.getByRole("region", { name: "Incoming hit: Bandit hit Mira" });
    await expect(miraPrompt).toBeVisible({ timeout: 30_000 });
    const before = Number(DAMAGE.exec((await miraPrompt.locator(".ih-dmg").textContent()) ?? "")?.[1]);
    await miraPrompt.getByRole("button", { name: "Mark", exact: true }).click();
    await expect(miraPrompt).toHaveAttribute("data-mode", "afterArmor");
    const fortitude = miraPrompt.getByTestId("incoming-hit-feature").filter({ has: a.page.getByRole("heading", { name: "Increased Fortitude" }) });
    await expect(fortitude).toBeVisible();
    await expect(miraPrompt).not.toContainText(ENEMY_WORDS);
    await expectNoSeriousA11yViolations(a.page, { include: "[data-testid=incoming-hit]" });
    await expectTouchTargets(miraPrompt.getByRole("button"));
    await miraPrompt.screenshot({ path: "test-results/visual/DA-DA8/after-armor-1280.png", animations: "disabled" });
    await fortitude.getByRole("button", { name: "Use Increased Fortitude" }).click();
    await expect.poll(async () => (await sheetOf(gm, mira)).hope).toBe(0);
    // Thick Skin may fit the hit as the slot and the halving left it (Minor): then Done ends Mira's turn.
    const [owed] = await a.client.query(api.adversaryActions.pending, { campaignId, characterId: mira });
    if (owed?.awaiting) {
      await expect(miraPrompt.locator(".ih-dmg")).toHaveText(new RegExp(`^${Math.ceil(before / 2)} damage: `), { timeout: 30_000 });
      await miraPrompt.getByRole("button", { name: "Done" }).click();
    }
    await expect.poll(async () => (await sheetOf(gm, mira)).armorMarked, { timeout: 30_000 }).toBe(1);
    expect((await sheetOf(gm, mira)).hp).toBeLessThanOrEqual(2);
    await gm.mutation(api.actionLog.undo, { entryId: first.entryId, idempotencyKey: crypto.randomUUID() });
    await expect.poll(async () => (await sheetOf(gm, mira)).armorMarked).toBe(0);
    expect(await sheetOf(gm, mira)).toMatchObject({ hp: 0, hope: 3 });

    // Wren joins only now: a warlock's before-roll answers (Harrowing Invocation, Draining Bane: "you or an ally") would
    // hold the attack on Mira too.
    const { characterId: wren } = await b.client.mutation(api.characters.create, { campaignId, draft: warlockDraft("Wren"), idempotencyKey: crypto.randomUUID() });
    await levelWarlock(gm, wren, TO_MASTERY);
    expect(await sheetOf(gm, wren)).toMatchObject({ level: 8, subclassRank: "mastery" });
    await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: crypto.randomUUID() });
    const favor = (await sheetOf(gm, wren)).classState?.favor ?? 0;
    expect(favor).toBeGreaterThan(0);

    // Wren: Harrowing Invocation and Draining Bane wait before the roll (Q2): Pass; then the hit: an Armor Slot, then
    // Dark Aegis: the damage is zero, so the slot isn't marked and no Hit Point is.
    const second = await attacks(gm, campaignId, instanceId, wren);
    await b.page.goto(`/campaigns/${campaignId}/party/${wren}`);
    const beforeRoll = b.page.getByRole("region", { name: "Before the roll: Bandit attacks Wren" });
    await expect(beforeRoll).toBeVisible({ timeout: 30_000 });
    // Draining Bane's "Clear a Stress" is ticked by default (dcm-bxp.99.19.15).
    await expect(beforeRoll.getByRole("checkbox", { name: "Clear a Stress" })).toBeChecked();
    await beforeRoll.getByRole("button", { name: "Pass" }).click();
    const wrenPrompt = b.page.getByRole("region", { name: "Incoming hit: Bandit hit Wren" });
    await expect(wrenPrompt).toBeVisible({ timeout: 30_000 });
    await wrenPrompt.getByRole("button", { name: "Mark", exact: true }).click();
    const aegis = wrenPrompt.getByTestId("incoming-hit-feature").filter({ has: b.page.getByRole("heading", { name: "Dark Aegis" }) });
    await expect(aegis).toBeVisible({ timeout: 30_000 });
    await aegis.getByRole("button", { name: "Use Dark Aegis" }).click();
    await expect.poll(async () => (await sheetOf(gm, wren)).classState?.favor, { timeout: 30_000 }).toBe(favor - 1);
    // A reaction that still fits a zero-damage hit (a loadout card such as Umbral Veil: "After an attack roll is made
    // against you") stays offered with Done (CB p.107); the hit PC sees their own "0 damage: No damage." (Q14).
    const [left] = await b.client.query(api.adversaryActions.pending, { campaignId, characterId: wren });
    if (left?.awaiting) {
      await expect(wrenPrompt.locator(".ih-dmg")).toHaveText("0 damage: No damage.", { timeout: 30_000 });
      await wrenPrompt.getByRole("button", { name: "Done" }).click();
    }
    await expect(b.page.getByTestId("incoming-hit")).toHaveCount(0, { timeout: 30_000 });
    expect(await sheetOf(gm, wren)).toMatchObject({ hp: 0, armorMarked: 0 });
    await gm.mutation(api.actionLog.undo, { entryId: second.entryId, idempotencyKey: crypto.randomUUID() });
    await expect.poll(async () => (await sheetOf(gm, wren)).classState?.favor).toBe(favor);
    expect(await sheetOf(gm, wren)).toMatchObject({ hp: 0, armorMarked: 0 });
  } finally {
    await a.close();
    await b.close();
  }
});

test("a warlock's Harrowing Invocation answers before the roll: a Favor, disadvantage, and the GM's undo gives the Favor back", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const { client: gm, campaignId } = await openCombatMap(page);
  await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
  const a = await joinAs(browser, gm, campaignId, PLAYER_A);
  try {
    const { characterId: wren } = await a.client.mutation(api.characters.create, { campaignId, draft: warlockDraft("Wren"), idempotencyKey: crypto.randomUUID() });
    // Level 5 with the upgraded subclass (a tier 3 option): Harrowing Invocation is a specialization (HF p.14).
    await levelWarlock(gm, wren, TO_SPECIALIZATION);
    expect(await sheetOf(gm, wren)).toMatchObject({ level: 5, subclassRank: "specialization" });
    // The session start gives the Warlock their Favor (HF p.14).
    await gm.mutation(api.sessions.start, { campaignId, idempotencyKey: crypto.randomUUID() });
    const favor = (await sheetOf(gm, wren)).classState?.favor ?? 0;
    expect(favor).toBeGreaterThan(0);
    const instanceId = await encounterWith(gm, campaignId, PLAIN_BANDIT);

    await a.page.goto(`/campaigns/${campaignId}/party/${wren}`);
    const held = await attacks(gm, campaignId, instanceId, wren);
    expect(held.held).toBeDefined();
    expect(held.roll).toBeNull();
    const windows = await gm.query(api.adversaryActions.windows, { campaignId });
    expect(windows).toEqual([expect.objectContaining({ preRoll: true, attackerLabel: "Cutpurse" })]);

    const prompt = a.page.getByRole("region", { name: "Before the roll: Cutpurse attacks Wren" });
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    // Nothing is rolled yet; no number of the Cutpurse's (Q14). (The feature's own text says "roll".)
    await expect(prompt).not.toContainText(/\d/);
    await expect(prompt.getByRole("button", { name: "Pass" })).toBeVisible();
    await expectNoSeriousA11yViolations(a.page, { include: "[data-testid=incoming-hit]" });
    await expectTouchTargets(prompt.getByRole("button"));
    await prompt.screenshot({ path: `${OUT}/before-roll-1280.png`, animations: "disabled" });
    await prompt.getByRole("button", { name: "Use Harrowing Invocation" }).click();
    await expect(prompt).toHaveCount(0);
    await expect.poll(async () => (await sheetOf(gm, wren)).classState?.favor).toBe(favor - 1);

    // The attack rolled with disadvantage: a miss leaves Wren untouched (and the Cutpurse marks a Stress); a hit opens
    // the usual prompt.
    const gmFeed = await gm.query(api.feed.list, { campaignId, paginationOpts: { numItems: 30, cursor: null } });
    expect(JSON.stringify(gmFeed.page)).toContain("Harrowing Invocation");
    const hitPrompt = a.page.getByRole("region", { name: "Incoming hit: Cutpurse hit Wren" });
    await expect.poll(async () => (await gm.query(api.adversaryActions.windows, { campaignId })).every((w) => !("preRoll" in w) || w.preRoll !== true)).toBe(true);
    const open = await gm.query(api.adversaryActions.windows, { campaignId });
    if (open.length > 0) await expect(hitPrompt).toBeVisible({ timeout: 30_000 });
    else await expect(hitPrompt).toHaveCount(0);

    // The GM's undo of the action group gives the Favor back.
    await gm.mutation(api.actionLog.undo, { entryId: held.entryId, idempotencyKey: crypto.randomUUID() });
    await expect.poll(async () => (await sheetOf(gm, wren)).classState?.favor).toBe(favor);
  } finally {
    await a.close();
  }
});
