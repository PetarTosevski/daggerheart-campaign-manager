import { expect, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { cardsForDomains, getClass } from "../../src/lib/srd";
import { expectNoSeriousA11yViolations, expectTouchTargets } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { convexAs, openCombatMap } from "./visual/helpers";

// Plan drawer-answers DA13 (beads dcm-bxp.99.19.21, .5), in two browsers. CB p.33 Cannonball: "Mark a Stress to allow an
// ally to throw or launch you at an adversary. To do so, the ally makes an attack roll using Agility or Strength (their
// choice) against a target within Close range. On a success, the adversary takes d12+2 physical damage using the
// thrower's Proficiency." User 2026-10-30: the druid marks the Stress and is thrown; the throwing ally gets the prompt in
// their drawer and rolls.
// The GM (desktop) plays for Moss, a druid in Armored Sentry, and asks Bryn to throw her; the player (390 px) sees the
// prompt on Bryn's sheet, rolls Strength at the Bandit and sees Hit only (U1); the Bandit takes 2 HP (a custom block any
// roll hits and any damage marks 2 HP on). Plan combat-hud H8.1: both use the HUD's sheet panel (the GM's from Moss's
// token, the player's full-screen sheet on a phone), which shows the same ally-roll prompts.

const PLAYER = "e2e-player@example.test";

const SURE_BANDIT = {
  name: "Bandit",
  tier: 1,
  type: "Standard" as const,
  description: "A road thug.",
  motives: "Rob",
  difficulty: 1,
  thresholds: { major: 1, severe: 100 },
  hp: 8,
  stress: 3,
  attack: { modifier: 0, name: "Club", range: "Melee", damage: "1d6 phy" },
  experiences: [],
  features: [],
};

function draft(name: string, classId: string, subclassId: string, primaryWeaponId: string) {
  const cls = getClass(classId)!;
  return {
    classId,
    subclassId,
    ancestry: { kind: "single", id: "elf" },
    communityId: "loreborne",
    traits: { agility: 1, strength: 2, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    name,
    pronouns: "",
    description: "",
    primaryWeaponId,
    armorId: "gambeson-armor",
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Sellsword", "Lockpick"],
    domainCards: cardsForDomains(cls.domains, 1)
      .filter((c) => c.level === 1)
      .slice(0, 2)
      .map((c) => c.id),
    connections: [],
  };
}

test("a druid is thrown: the GM asks Bryn from Moss's sheet, the player rolls from Bryn's sheet at 390 px, the Bandit takes damage", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const { client, campaignId, url } = await openCombatMap(page);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const player = await context.newPage();
  try {
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(player, PLAYER);
    await expect(player).toHaveURL("/");
    const playerClient = await convexAs(player);
    await playerClient.mutation(api.members.joinByCode, { code });
    await playerClient.mutation(api.characters.create, { campaignId, draft: draft("Bryn", "warrior", "call-of-the-brave", "rapier"), idempotencyKey: crypto.randomUUID() });
    const { characterId: moss } = await client.mutation(api.characters.create, { campaignId, draft: draft("Moss", "druid", "warden-of-the-elements", "rapier"), idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.levelUp.correctLevel, { characterId: moss, level: 3, idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.classFeatures.use, { characterId: moss, featureKey: "beastform", params: { choice: "armored-sentry" }, idempotencyKey: crypto.randomUUID() });

    const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: SURE_BANDIT, idempotencyKey: crypto.randomUUID() });
    const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
    const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.encounters.start, { campaignId, encounterId });
    const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
    await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: crypto.randomUUID() });
    const tokens = await client.query(api.combatTokensReads.list, { campaignId, mapId });
    const at = async (name: string, x: number) => {
      const token = tokens.find((t) => (name === "Bandit" ? t.instanceId === instanceIds[0] : t.name === name))!;
      await client.mutation(api.combatTokens.move, { campaignId, tokenId: token._id, x, y: 10 });
      await client.mutation(api.combatTokens.turn, { campaignId, tokenId: token._id, angle: name === "Bandit" ? Math.PI : 0 });
    };
    await at("Moss", 3);
    await at("Bryn", 5);
    await at("Bandit", 8);
    const banditHp = async () => (await client.query(api.encounters.get, { campaignId, encounterId }))!.instances[0]!.hp;
    const stressOf = async () => (await client.query(api.charactersReads.get, { characterId: moss }))!.sheet.stress;
    const stressBefore = await stressOf();

    // The GM plays for Moss and asks Bryn to throw her: the Stress is marked, the sheet waits for Bryn.
    await page.goto(url);
    await page.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Open Moss’s sheet/ }).click();
    const drawer = page.getByRole("complementary", { name: "Moss’s sheet" });
    await drawer.getByRole("switch", { name: "Play for this character" }).check();
    const start = drawer.getByTestId("ally-roll-start");
    await start.getByLabel("Ally who throws you").selectOption({ label: "Bryn" });
    await start.getByRole("button", { name: "Ask to throw · 1 Stress" }).click();
    await expect(drawer.getByTestId("ally-roll-waiting")).toHaveText("Cannonball: waiting for Bryn to make the roll.");
    await expect.poll(stressOf).toBe(stressBefore + 1);
    // The GM's pending list shows it, with Cancel.
    await expect(drawer.getByTestId("ally-roll-pending")).toContainText("Moss's Cannonball: Bryn rolls");
    await expectNoSeriousA11yViolations(page);

    // The player opens Bryn's sheet at 390 px (full screen): the prompt with Agility / Strength and the targets in Close
    // range.
    await player.goto(url);
    await player.getByTestId("hud-phone-sheet-button").click();
    const brynDrawer = player.getByRole("complementary", { name: "Bryn’s sheet" });
    const ask = brynDrawer.getByTestId("ally-roll-ask");
    await expect(ask).toContainText("Moss's Cannonball: throw them at an adversary");
    expect(await player.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectTouchTargets(ask.locator("button, select"));
    await ask.getByLabel("Strength").check();
    await ask.getByLabel("Target within Close range").selectOption({ label: "Bandit" });
    await ask.getByRole("button", { name: "Roll the throw" }).click();
    const result = brynDrawer.getByTestId("ally-roll-result");
    await expect(result).toContainText("Bandit: Hit");
    // U1: the player's result names Hit, never the Bandit's HP or thresholds.
    await expect(result).not.toContainText("HP");
    await expect(ask).toHaveCount(0);
    await expect.poll(banditHp).toBe(2);
    await expectNoSeriousA11yViolations(player);

    // The GM's sheet no longer waits.
    await expect(drawer.getByTestId("ally-roll-waiting")).toHaveCount(0);
    await expect(drawer.getByTestId("ally-roll-pending")).toHaveCount(0);
  } finally {
    await context.close();
  }
});
