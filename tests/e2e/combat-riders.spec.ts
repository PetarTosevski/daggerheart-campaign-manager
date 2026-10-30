import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cardsForDomains, getClass } from "../../src/lib/srd";
import { signInAsTestGm } from "./fixtures";
import { convexAs, openCombatMap } from "./visual/helpers";

// Plan sheet-drawer SD5 (docs/tasks/TASK-SD-SD5.md), in two browsers: riders on the Attack bar and the after-roll step.
// - A rogue's Sneak Attack comes from positions (Q9, CB p.42): an ally token next to the Bandit adds it, no toggle.
// - A ranger's Hold Them Off (CB p.38): 3 Hope, the same roll against two more Bandits, Hit on all three.
// - A warlock's Patron's Boon after a miss (HF p.14, Q1): the roll waits with Miss only; Use rerolls with advantage.
// - Rage Up (CB p.330), the Blade card that rides on an attack, finally usable: a Stress, +twice Strength to the damage.
// The Bandits are custom blocks any roll hits (Difficulty 1); the Ogre one only a critical hits (Difficulty 40, beyond any roll of these characters).

const PLAYER = "e2e-player@example.test";

const unique = (label: string) => `${label} ${crypto.randomUUID().slice(0, 8)}`;

/** A sure-to-hit Bandit; `difficulty` 40 for an Ogre only a critical hits (CB p.90). */
const block = (name: string, difficulty: number) => ({
  name,
  tier: 1,
  type: "Standard" as const,
  description: "A road thug.",
  motives: "Rob",
  difficulty,
  thresholds: { major: 1, severe: 100 },
  hp: 8,
  stress: 3,
  attack: { modifier: 0, name: "Club", range: "Melee", damage: "1d6 phy" },
  experiences: [],
  features: [],
});

function draft(name: string, classId: string, subclassId: string) {
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
    primaryWeaponId: "rapier",
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

type Scene = {
  client: ConvexHttpClient;
  playerClient: ConvexHttpClient;
  campaignId: Id<"campaigns">;
  url: string;
  mapId: Id<"combatMaps">;
  characterId: Id<"characters">;
  tokens: { name: string; tokenId: Id<"combatTokens"> }[];
  player: Page;
  closePlayer: () => Promise<void>;
};

/**
 * The GM's campaign with a live map, the player's Ash of `classId` at (5, 10) facing east, a running encounter with the
 * named enemies placed at `spots`.
 */
async function riderScene(page: Page, browser: Browser, classId: string, subclassId: string, enemies: { name: string; difficulty: number; x: number; y: number }[], hopeAndFear = false): Promise<Scene> {
  const { client, campaignId, url } = await openCombatMap(page);
  if (hopeAndFear) await client.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const player = await context.newPage();
  const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  const playerClient = await convexAs(player);
  await playerClient.mutation(api.members.joinByCode, { code });
  const { characterId } = await playerClient.mutation(api.characters.create, { campaignId, draft: draft("Ash", classId, subclassId), idempotencyKey: crypto.randomUUID() });

  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: unique("Ambush"), idempotencyKey: crypto.randomUUID() });
  const instances: { name: string; instanceId: Id<"encounterAdversaries"> }[] = [];
  for (const e of enemies) {
    const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: block(e.name, e.difficulty), idempotencyKey: crypto.randomUUID() });
    const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
    instances.push({ name: e.name, instanceId: instanceIds[0]! });
  }
  await client.mutation(api.encounters.start, { campaignId, encounterId });
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: instances.map((i) => i.instanceId), idempotencyKey: crypto.randomUUID() });
  const list = await client.query(api.combatTokens.list, { campaignId, mapId });
  const ash = list.find((t) => t.name === "Ash")!;
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: ash._id, x: 5, y: 10 });
  await client.mutation(api.combatTokens.turn, { campaignId, tokenId: ash._id, angle: 0 });
  const tokens: Scene["tokens"] = [];
  for (const [i, e] of enemies.entries()) {
    const tokenId = list.find((t) => t.instanceId === instances[i]!.instanceId)!._id;
    await client.mutation(api.combatTokens.move, { campaignId, tokenId, x: e.x, y: e.y });
    tokens.push({ name: e.name, tokenId });
  }
  return { client, playerClient, campaignId, url, mapId, characterId, tokens, player, closePlayer: () => context.close() };
}

async function hpOf(s: Scene, name: string): Promise<number> {
  const encounters = await s.client.query(api.encounters.list, { campaignId: s.campaignId });
  const running = encounters.active.find((e) => e.status === "running")!;
  const got = await s.client.query(api.encounters.get, { campaignId: s.campaignId, encounterId: running._id });
  return got!.instances.find((i) => i.label.startsWith(name))!.hp;
}

async function sheetOf(s: Scene) {
  return (await s.client.query(api.characters.get, { characterId: s.characterId }))!.sheet;
}

/** Opens the player's Combat Map and picks `target` on the board; returns the Attack card. */
async function aim(s: Scene, target: string) {
  await s.player.goto(s.url);
  const attackCard = s.player.getByRole("region", { name: "Attack", exact: true });
  await expect(attackCard.getByTestId("combat-attack-bar")).toBeVisible({ timeout: 30_000 });
  await s.player.getByRole("region", { name: "Battle map" }).getByRole("button", { name: new RegExp(`^${target}, Enemy`) }).click();
  await expect(attackCard.getByRole("list", { name: "Enemies in sight" }).getByRole("button", { name: new RegExp(`^${target},`) })).toHaveAttribute("aria-pressed", "true");
  return attackCard;
}

test("a rogue's Sneak Attack comes from an ally's position next to the target, without a toggle", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const s = await riderScene(page, browser, "rogue", "nightwalker", [{ name: "Bandit", difficulty: 1, x: 6, y: 10 }]);
  try {
    // An ally token right next to the Bandit (CB p.42: "while an ally is within Melee range of your target").
    const { tokenId } = await s.client.mutation(api.combatTokens.addCustom, { campaignId: s.campaignId, mapId: s.mapId, name: "Hound", hp: 3, side: "ally", idempotencyKey: crypto.randomUUID() });
    await s.client.mutation(api.combatTokens.move, { campaignId: s.campaignId, tokenId, x: 7, y: 10 });
    const attackCard = await aim(s, "Bandit");
    await attackCard.getByRole("button", { name: "⚔ Attack Bandit with Rapier" }).click();
    const result = attackCard.getByRole("region", { name: "Attack result" });
    await expect(result.getByTestId("combat-verdict")).toHaveText(/Bandit\s*(Hit|Defeated)/);
    await expect(result.getByTestId("combat-attack-riders")).toContainText("Sneak Attack");
    await expect(result).not.toContainText(/\b(HP|Difficulty|threshold|Minor|Major|Severe)\b/);
  } finally {
    await s.closePlayer();
  }
});

test("a ranger's Hold Them Off: 3 Hope, the same roll against two more Bandits", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const s = await riderScene(page, browser, "ranger", "wayfinder", [
    { name: "Bandit", difficulty: 1, x: 6, y: 10 },
    { name: "Wolf", difficulty: 1, x: 6, y: 9 },
    { name: "Boar", difficulty: 1, x: 6, y: 11 },
  ]);
  try {
    await s.playerClient.mutation(api.characters.adjustResource, { characterId: s.characterId, resource: "hope", delta: 4 });
    const attackCard = await aim(s, "Bandit");
    const riders = attackCard.getByRole("group", { name: "With this attack" });
    await riders.getByRole("checkbox", { name: /Hold Them Off/ }).check();
    const more = riders.getByRole("group", { name: "Hold Them Off: more targets" });
    await more.getByRole("button", { name: "Wolf" }).click();
    await more.getByRole("button", { name: "Boar" }).click();
    await attackCard.getByRole("button", { name: "⚔ Attack Bandit with Rapier" }).click();
    const result = attackCard.getByRole("region", { name: "Attack result" });
    await expect(result.getByTestId("combat-verdict")).toHaveCount(3);
    await expect(result.getByTestId("combat-attack-riders")).toContainText("Hold Them Off");
    for (const name of ["Bandit", "Wolf", "Boar"]) expect(await hpOf(s, name)).toBeGreaterThan(0);
  } finally {
    await s.closePlayer();
  }
});

test("a warlock's Patron's Boon after a miss: the roll waits with Miss only, Use rerolls with advantage", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const s = await riderScene(page, browser, "warlock", "pact-of-the-endless", [{ name: "Ogre", difficulty: 40, x: 6, y: 10 }], true);
  try {
    const attackCard = await aim(s, "Ogre");
    const held = attackCard.getByRole("region", { name: "After the roll" });
    // A critical hits whatever the Difficulty (CB p.90) and holds nothing: attack again (a few tries at most).
    for (let i = 0; i < 6; i++) {
      const sheet = await sheetOf(s);
      if (sheet.hope < 6) await s.playerClient.mutation(api.characters.adjustResource, { characterId: s.characterId, resource: "hope", delta: 6 - sheet.hope });
      await attackCard.getByRole("button", { name: "⚔ Attack Ogre with Rapier" }).click();
      await expect(held.or(attackCard.getByRole("region", { name: "Attack result" }))).toBeVisible();
      if (await held.isVisible()) break;
    }
    await expect(held.getByTestId("combat-verdict")).toHaveText(/Ogre\s*Miss/);
    await expect(held).not.toContainText(/\b(HP|Difficulty|40)\b/);
    await held.getByRole("button", { name: /^Use Patron’s Boon/ }).click();
    const result = attackCard.getByRole("region", { name: "Attack result" });
    await expect(result.getByTestId("combat-attack-riders")).toContainText("Patron’s Boon");
    await expect(held).toHaveCount(0);
  } finally {
    await s.closePlayer();
  }
});

test("Rage Up rides on the attack: a Stress, +twice Strength to the damage", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const s = await riderScene(page, browser, "warrior", "call-of-the-brave", [{ name: "Bandit", difficulty: 1, x: 6, y: 10 }]);
  try {
    await s.client.mutation(api.levelUp.correctLevel, { characterId: s.characterId, level: 6, idempotencyKey: crypto.randomUUID() });
    await s.client.mutation(api.characters.takeCard, { characterId: s.characterId, cardId: "rage-up" });
    const attackCard = await aim(s, "Bandit");
    const riders = attackCard.getByRole("group", { name: "With this attack" });
    await riders.getByRole("checkbox", { name: /Rage Up/ }).check();
    await attackCard.getByRole("button", { name: "⚔ Attack Bandit with Rapier" }).click();
    const result = attackCard.getByRole("region", { name: "Attack result" });
    await expect(result.getByTestId("combat-attack-riders")).toContainText("Rage Up");
    // Strength 2: the damage total is at least 1 + 4.
    const total = Number(await result.getByTestId("combat-attack-damage").locator(".cma-total").textContent());
    expect(total).toBeGreaterThanOrEqual(5);
    await expect.poll(async () => (await sheetOf(s)).stress).toBeGreaterThanOrEqual(0);
  } finally {
    await s.closePlayer();
  }
});
