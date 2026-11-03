import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cardsForDomains, getClass } from "../../src/lib/srd";
import { signInAsTestGm } from "./fixtures";
import { convexAs, openCombatMap } from "./visual/helpers";

// Plan sheet-drawer SD5 (docs/tasks/TASK-SD-SD5.md), ported to the Combat HUD by plan combat-hud H8.1 (the classic
// Attack bar is gone): riders in the HUD's attack picker (`hud-pick`, "With this attack") and the after-roll hold.
// - A ranger's Hold Them Off (CB p.38): 3 Hope, the same roll against two more Bandits, Hit on all three.
// - A warlock's Patron's Boon after a miss (HF p.14, Q1): the roll waits with Miss only; Use rerolls with advantage.
// Dropped in the port (covered elsewhere):
// - A rogue's Sneak Attack from an ally's position: tests/convex/combat-riders.test.ts "Sneak Attack (Q9): added when
//   an ally's token is within Melee of the target, not otherwise; ...".
// - Rage Up riding on an attack: tests/convex/combat-riders.test.ts "Rage Up (CB p.330): a Stress per Rage Up, +twice
//   Strength to the damage each time; ..." and tests/unit/hud/attack-pick.test.tsx "weapon tiles, roll chips, riders
//   with cost pills, one primary; the send and the result line" / "builds combatActions.attack's arguments: ...".
// The Bandits are custom blocks any roll hits (Difficulty 1); the Ogre one only a critical hits (Difficulty 40, beyond any roll of these characters).

test.use({ actionTimeout: 30_000 });

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
  await client.mutation(api.combatMaps.setLive, { campaignId, mapId });
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

/** How many public feed rows are Ash's attacks with `rider` ("Ash attacks with Rapier: … (Patron’s Boon) → …"). */
async function attacksWith(s: Scene, rider: string) {
  const feed = await s.client.query(api.feed.list, { campaignId: s.campaignId, paginationOpts: { numItems: 20, cursor: null } });
  return feed.page.filter((r) => r.summary.startsWith("Ash attacks") && r.summary.includes(`(${rider})`)).length;
}

const panelOf = (page: Page) => page.getByTestId("hud-pick");
const rowOf = (page: Page, tokenId: string) => panelOf(page).locator(`[data-testid="hud-pick-row"][data-token="${tokenId}"]`);

/** Opens the player's attack picker from Ash's action ring (H3.4) and picks `tokenId`'s row; returns the panel. */
async function aim(s: Scene, tokenId: string) {
  const { player } = s;
  await player
    .getByRole("region", { name: "Battle map" })
    .getByRole("button", { name: /^Open Ash’s sheet \(your character\)/ })
    .click();
  const open = player.getByRole("toolbar", { name: "Your actions (Ash)" }).getByRole("button", { name: "Attack" });
  await expect(open).toBeEnabled({ timeout: 30_000 });
  await open.click();
  const panel = panelOf(player);
  await expect(panel).toBeVisible();
  await rowOf(player, tokenId).click();
  await expect(rowOf(player, tokenId)).toHaveAttribute("aria-pressed", "true");
  return panel;
}

async function openMap(s: Scene) {
  await s.player.goto(s.url);
  await expect(s.player.getByTestId("combat-hud")).toBeVisible({ timeout: 30_000 });
}

test("a ranger's Hold Them Off: 3 Hope, the same roll against two more Bandits", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const s = await riderScene(page, browser, "ranger", "wayfinder", [
    { name: "Bandit", difficulty: 1, x: 6, y: 10 },
    { name: "Wolf", difficulty: 1, x: 6, y: 9 },
    { name: "Boar", difficulty: 1, x: 6, y: 11 },
  ]);
  try {
    await s.playerClient.mutation(api.characters.adjustResource, { characterId: s.characterId, resource: "hope", delta: 4 });
    await openMap(s);
    const [bandit] = s.tokens;
    const panel = await aim(s, bandit!.tokenId);
    const riders = panel.getByTestId("hud-attack-riders");
    const hold = riders.getByRole("switch", { name: /^Hold Them Off/ });
    await hold.click();
    await expect(hold).toHaveAttribute("aria-checked", "true");
    const more = riders.getByRole("group", { name: "Hold Them Off: more targets" });
    await more.getByRole("button", { name: "Wolf" }).click();
    await more.getByRole("button", { name: "Boar" }).click();
    await expect(more.getByRole("button", { name: "Wolf" })).toHaveAttribute("aria-pressed", "true");
    await expect(more.getByRole("button", { name: "Boar" })).toHaveAttribute("aria-pressed", "true");
    await expect(panel.getByTestId("hud-pick-pay")).toContainText("3 Hope");
    await panel.getByTestId("hud-pick-go").click();
    await expect(panel).toHaveCount(0);

    const result = s.player.getByTestId("hud-result");
    await expect(result.getByTestId("hud-result-row")).toHaveCount(3, { timeout: 30_000 });
    for (const name of ["Bandit", "Wolf", "Boar"]) await expect(result.getByTestId("hud-result-row").filter({ hasText: name })).toContainText(/Hit|Defeated/);
    await expect(result).toContainText("With Hold Them Off");
    await expect(result).not.toContainText(/\b(HP|Difficulty|threshold|Minor|Major|Severe)\b/);
    for (const name of ["Bandit", "Wolf", "Boar"]) await expect.poll(() => hpOf(s, name)).toBeGreaterThan(0);
  } finally {
    await s.closePlayer();
  }
});

test("a warlock's Patron's Boon after a miss: the roll waits with Miss only, Use rerolls with advantage", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const s = await riderScene(page, browser, "warlock", "pact-of-the-endless", [{ name: "Ogre", difficulty: 40, x: 6, y: 10 }], true);
  const { player } = s;
  try {
    await openMap(s);
    const [ogre] = s.tokens;
    const held = player.getByTestId("hud-result-held");
    const result = player.getByTestId("hud-result");
    // A critical hits whatever the Difficulty (CB p.90) and holds nothing: attack again (a few tries at most).
    for (let i = 0; i < 6; i++) {
      const sheet = await sheetOf(s);
      if (sheet.hope < 6) await s.playerClient.mutation(api.characters.adjustResource, { characterId: s.characterId, resource: "hope", delta: 6 - sheet.hope });
      if (await result.isVisible()) await result.getByRole("button", { name: /^Close the result of/ }).click();
      const panel = await aim(s, ogre!.tokenId);
      await panel.getByTestId("hud-pick-go").click();
      await expect(panel).toHaveCount(0);
      await expect(held.or(result)).toBeVisible({ timeout: 30_000 });
      if (await held.isVisible()) break;
    }
    await expect(held).toContainText("Your roll waits");
    await expect(held.getByTestId("hud-result-row")).toHaveText(/Ogre\s*Miss/);
    await expect(held).not.toContainText(/\b(HP|Difficulty|40)\b/);
    await held.getByRole("radiogroup", { name: "Feature to use" }).getByRole("radio", { name: /Patron’s Boon/ }).click();
    await held.getByRole("button", { name: "Use", exact: true }).click();
    // The server rerolled with the Boon: the public feed row names it.
    await expect.poll(() => attacksWith(s, "Patron’s Boon"), { timeout: 30_000 }).toBe(1);
    await expect(result).toContainText("With Patron’s Boon", { timeout: 30_000 });
    await expect(result.getByTestId("hud-result-row").filter({ hasText: "Ogre" })).toContainText(/Hit|Miss|Defeated/);
    await expect(held).toHaveCount(0);
  } finally {
    await s.closePlayer();
  }
});
