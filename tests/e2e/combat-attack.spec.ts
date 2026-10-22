import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, openCombatMap } from "./visual/helpers";

// Plan combat-actions CA5, in two browsers: a player taps a Bandit on the Combat Map, sees its band and hint, attacks
// with the Rapier and sees Hit (never the Bandit's HP, U1); the GM's Resolutions list shows 2 HP marked and Undo puts
// them back (U4, Q10). The Bandit is a custom block made certain: Difficulty 1 (any roll hits) and thresholds 1 / 100
// (any damage is Major: 2 HP). Also: an out-of-range attack waits for the GM, who allows it (Q1); the phone bottom
// sheet (Q11); axe on both views.

const PLAYER = "e2e-player@example.test";

/** A Bandit any attack hits and any damage marks 2 HP on (Major). */
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

type Scene = {
  client: ConvexHttpClient;
  campaignId: Id<"campaigns">;
  url: string;
  mapId: Id<"combatMaps">;
  encounterId: Id<"encounters">;
  ashToken: Id<"combatTokens">;
  banditToken: Id<"combatTokens">;
  archerToken: Id<"combatTokens">;
  player: Page;
  closePlayer: () => Promise<void>;
};

/**
 * The GM's campaign with a live map, the player's Ash (Bard, Rapier: Melee) at (5, 10) facing east, a running encounter
 * with the Bandit next to Ash and an Archer (same block) 10 squares east (Far: out of the Rapier's range).
 */
async function attackScene(page: Page, browser: Browser, viewport = { width: 1440, height: 900 }): Promise<Scene> {
  const { client, campaignId, url } = await openCombatMap(page);
  const context = await browser.newContext({ viewport });
  const player = await context.newPage();
  const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  const playerClient = await convexAs(player);
  await playerClient.mutation(api.members.joinByCode, { code });
  await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: crypto.randomUUID() });

  const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: SURE_BANDIT, idempotencyKey: crypto.randomUUID() });
  const { customId: archerId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: { ...SURE_BANDIT, name: "Archer" }, idempotencyKey: crypto.randomUUID() });
  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
  const { instanceIds: bandit } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
  const { instanceIds: archer } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId: archerId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.encounters.start, { campaignId, encounterId });

  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: [...bandit, ...archer], idempotencyKey: crypto.randomUUID() });
  const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
  const ash = tokens.find((t) => t.name === "Ash")!;
  const banditToken = tokens.find((t) => t.instanceId === bandit[0])!._id;
  const archerToken = tokens.find((t) => t.instanceId === archer[0])!._id;
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: ash._id, x: 5, y: 10 });
  await client.mutation(api.combatTokens.turn, { campaignId, tokenId: ash._id, angle: 0 });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: banditToken, x: 6, y: 10 });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: archerToken, x: 16, y: 10 });
  return { client, campaignId, url, mapId, encounterId, ashToken: ash._id, banditToken, archerToken, player, closePlayer: () => context.close() };
}

async function banditHp(s: Scene): Promise<number> {
  const got = await s.client.query(api.encounters.get, { campaignId: s.campaignId, encounterId: s.encounterId });
  return got!.instances.find((i) => i.label.startsWith("Bandit"))!.hp;
}

test("a player attacks a Bandit and sees Hit; the GM sees 2 HP marked and undoes it", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const s = await attackScene(page, browser);
  const { player } = s;
  try {
    await player.goto(s.url);
    const board = player.getByRole("region", { name: "Battle map" });
    const attackCard = player.getByRole("region", { name: "Attack", exact: true });
    await expect(attackCard.getByTestId("combat-attack-bar")).toBeVisible({ timeout: 30_000 });
    await expect(attackCard.getByRole("button", { name: /^Primary Rapier/ })).toContainText("1d8 phy");

    // Tap the Bandit on the map: it becomes the target, with its band and hint, and a ring on the map.
    await board.getByRole("button", { name: /^Bandit, Enemy/ }).click();
    const list = attackCard.getByRole("list", { name: "Enemies in sight" });
    await expect(list.getByRole("button", { name: "Bandit, Melee, In range" })).toHaveAttribute("aria-pressed", "true");
    await expect(list.getByRole("button", { name: "Archer, Far, Out of range: the GM decides" })).toHaveAttribute("aria-pressed", "false");
    await expect(board.getByTestId("combat-target-ring")).toHaveCount(1);

    // Single-select: tapping the Archer replaces the pick; tapping the Bandit picks it again.
    await list.getByRole("button", { name: /^Archer/ }).click();
    await expect(list.getByRole("button", { name: /^Bandit/ })).toHaveAttribute("aria-pressed", "false");
    await list.getByRole("button", { name: /^Bandit/ }).click();
    await expect(list.getByRole("button", { name: /^Archer/ })).toHaveAttribute("aria-pressed", "false");

    await expectNoSeriousA11yViolations(player, { include: ".cm-aside" });

    await attackCard.getByRole("button", { name: "⚔ Attack Bandit with Rapier" }).click();
    const result = attackCard.getByRole("region", { name: "Attack result" });
    await expect(result.getByTestId("combat-verdict")).toHaveText(/Bandit\s*Hit/);
    await expect(result.getByTestId("combat-attack-damage")).toBeVisible();
    await expect(result).not.toContainText(/\b(HP|Stress|Difficulty|threshold|Minor|Major|Severe)\b/);
    // The roll lands in the feed (U2): the mini feed shows the public row, without the Bandit's numbers.
    const feed = player.getByRole("region", { name: "Roll feed" });
    await expect(feed.getByTestId("combat-mini-feed")).toContainText("Bandit: Hit");
    await expect(feed).not.toContainText(/\(\d+\/\d+\)|Major/);

    // The GM: 2 HP marked in Resolutions, then Undo.
    expect(await banditHp(s)).toBe(2);
    await page.goto(s.url);
    const resolutions = page.getByRole("region", { name: "Resolutions" });
    const row = resolutions.getByTestId("combat-resolution").filter({ hasText: "Bandit" });
    await expect(row).toContainText("Major → 2 HP (2/5)");
    await expectNoSeriousA11yViolations(page, { include: ".cm-aside" });
    await row.getByRole("button", { name: /^Undo/ }).click();
    await expect(row).toContainText("Undone");
    await expect.poll(() => banditHp(s)).toBe(0);
    await expect(feed.getByTestId("combat-mini-feed")).toContainText("(undone)");

    // Out of range (Q1): the Archer's attack waits for the GM; nothing is rolled until they allow it.
    await list.getByRole("button", { name: /^Archer/ }).click();
    await attackCard.getByRole("button", { name: "⚔ Attack Archer with Rapier" }).click();
    await expect(attackCard.getByTestId("combat-attack-pending")).toContainText("Archer: Far");
    await expect(attackCard.getByTestId("combat-sanction-waiting")).toBeVisible();
    const sanction = resolutions.getByTestId("combat-sanction");
    await expect(sanction).toContainText("Ash attacks Archer (Far)");
    await sanction.getByRole("button", { name: /^Allow/ }).click();
    await expect(sanction).toHaveCount(0);
    await expect(attackCard.getByTestId("combat-sanction-waiting")).toHaveCount(0);
    await expect(resolutions.getByTestId("combat-resolution").filter({ hasText: "Archer" })).toContainText("Major → 2 HP (2/5)");
  } finally {
    await s.closePlayer();
  }
});

test("at phone width the actions live in a bottom sheet with Hand / Attack / Dice / Feed tabs", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const s = await attackScene(page, browser, { width: 390, height: 844 });
  const { player } = s;
  try {
    await player.goto(s.url);
    const sheet = player.getByTestId("combat-actions-sheet");
    const tabs = sheet.getByRole("tablist", { name: "Combat actions" });
    await expect(tabs.getByRole("tab")).toHaveText(["Hand", "Attack", "Dice", "Feed"], { timeout: 30_000 });
    for (const tab of await tabs.getByRole("tab").all()) {
      const box = (await tab.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    // Tap the Bandit on the map, then confirm in the sheet's Attack tab.
    await player.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Bandit, Enemy/ }).click();
    await tabs.getByRole("tab", { name: "Attack" }).click();
    const panel = sheet.getByRole("tabpanel");
    await expect(panel.getByRole("button", { name: "Bandit, Melee, In range" })).toHaveAttribute("aria-pressed", "true");
    await panel.getByRole("button", { name: "⚔ Attack Bandit with Rapier" }).click();
    await expect(panel.getByTestId("combat-verdict")).toHaveText(/Bandit\s*Hit/);
    await tabs.getByRole("tab", { name: "Feed" }).click();
    await expect(panel.getByTestId("combat-mini-feed")).toContainText("Bandit: Hit");
    await tabs.getByRole("tab", { name: "Dice" }).click();
    await expect(panel.getByTestId("combat-map-dice")).toBeVisible();
    // No sideways scroll.
    expect(await player.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=combat-actions-sheet]" });
    // The open tab closes the sheet again.
    await tabs.getByRole("tab", { name: "Dice" }).click();
    await expect(sheet.getByRole("tabpanel")).toHaveCount(0);
  } finally {
    await s.closePlayer();
  }
});
