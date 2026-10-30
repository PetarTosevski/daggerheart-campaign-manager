import { expect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectFitsViewport, expectNoSeriousA11yViolations } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, openCombatMap } from "./visual/helpers";

// Plan combat-actions CA8 (bead dcm-bxp.99.4): axe on the combat-action panels of the Combat Map at desktop (1440) and
// phone (390) width. Bar (D12, docs/tasks/TASK-D12-H1.md): no serious or critical violation on the player's Hand, the
// Attack bar (with a target picked and after an attack), the dice box (after a roll) and the GM's Resolutions (with a
// hit and Undo). At 390 the player's parts are the bottom sheet's tabs (Q11) and the page does not scroll sideways.
// The Hand's own states (raised card, vault, roll options, aiming, hidden) are scanned in a11y-combat-hand.spec.ts.
// Locators are roles and labels, so the sheet-drawer wave's layout changes leave them working.

test.describe.configure({ timeout: 240_000 });
test.use({ actionTimeout: 30_000 });

const PLAYER = "e2e-player@example.test";

/** A Bandit any roll hits (Difficulty 1); any damage is Major. */
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

/** WebGL dice canvas: no DOM for axe to check (its rolls are announced by the dice box's result list). */
const DICE_CANVAS = { exclude: '[data-testid="dice-3d"]', reason: "WebGL dice canvas: no DOM to check (its rolls are announced in text)" };

/** The GM's live map: the player's Ash (a Wizard with Bolt Beacon and Book of Illiat) at (5, 10), the Bandit next to her. */
async function scene(page: Page, browser: Browser, viewport: { width: number; height: number }) {
  const { client, campaignId, url } = await openCombatMap(page);
  const context = await browser.newContext({ viewport });
  const player = await context.newPage();
  const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  const playerClient = await convexAs(player);
  await playerClient.mutation(api.members.joinByCode, { code });
  const draft = { ...bardDraft("Ash"), classId: "wizard", subclassId: "school-of-war", domainCards: ["bolt-beacon", "book-of-illiat"] };
  const { characterId } = await playerClient.mutation(api.characters.create, { campaignId, draft, idempotencyKey: crypto.randomUUID() });
  const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: SURE_BANDIT, idempotencyKey: crypto.randomUUID() });
  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
  const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.encounters.start, { campaignId, encounterId });
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: crypto.randomUUID() });
  const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
  const ash = tokens.find((t) => t.characterId === characterId)!._id;
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: ash, x: 5, y: 10 });
  await client.mutation(api.combatTokens.turn, { campaignId, tokenId: ash, angle: 0 });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.instanceId === instanceIds[0])!._id, x: 6, y: 10 });
  return { url, player, campaignId: campaignId as Id<"campaigns">, closePlayer: () => context.close() };
}

test("desktop (1440): the Hand, the Attack bar, the dice box and Resolutions pass axe", async ({ page, browser }) => {
  const s = await scene(page, browser, { width: 1440, height: 900 });
  const { player } = s;
  try {
    await player.goto(s.url);
    const hand = player.getByRole("region", { name: "Your hand" });
    await expect(hand.getByRole("article", { name: "Bolt Beacon" })).toBeVisible({ timeout: 30_000 });
    await expectNoSeriousA11yViolations(player, { include: ".cmh-hand" });

    // The Attack bar: idle, with the Bandit picked, and with the result of an attack.
    const attack = player.getByRole("region", { name: "Attack", exact: true });
    await expect(attack.getByRole("button", { name: /^Primary Rapier/ })).toBeVisible();
    await expectNoSeriousA11yViolations(player, { include: ".cm-aside" });
    await player.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Bandit, Enemy/ }).click();
    await expect(attack.getByRole("button", { name: "Bandit, Melee, In range" })).toHaveAttribute("aria-pressed", "true");
    await attack.getByRole("button", { name: "⚔ Attack Bandit with Rapier" }).click();
    await expect(attack.getByRole("region", { name: "Attack result" }).getByTestId("combat-verdict")).toHaveText(/Bandit\s*Hit/);
    await expectNoSeriousA11yViolations(player, { include: ".cm-aside" });

    // The dice box, after a roll.
    const dice = player.getByRole("region", { name: "Map dice" });
    await expect(dice.getByTestId("combat-map-dice")).toBeVisible();
    await dice.getByRole("button", { name: "Roll", exact: true }).click();
    await expect(player.getByRole("region", { name: "Roll feed" }).getByTestId("combat-mini-feed")).toContainText("Ash");
    await expectNoSeriousA11yViolations(player, { include: ".cm-aside", ...DICE_CANVAS });

    // The GM's Resolutions, with the hit and its Undo.
    await page.goto(s.url);
    const resolutions = page.getByRole("region", { name: "Resolutions" });
    await expect(resolutions.getByRole("button", { name: /^Undo: Ash → Bandit/ })).toBeVisible({ timeout: 30_000 });
    await expectNoSeriousA11yViolations(page, { include: ".cm-aside" });
  } finally {
    await s.closePlayer();
  }
});

test("phone (390): the bottom sheet's Hand, Attack and Dice tabs and the GM's Resolutions pass axe, with no sideways scroll", async ({ page, browser }) => {
  const s = await scene(page, browser, { width: 390, height: 844 });
  const { player } = s;
  try {
    await player.goto(s.url);
    const sheet = player.getByTestId("combat-actions-sheet");
    const tabs = sheet.getByRole("tablist", { name: "Combat actions" });
    await expect(tabs.getByRole("tab", { name: "Hand" })).toBeVisible({ timeout: 30_000 });
    const hand = player.getByRole("region", { name: "Your hand" });
    await expect(hand.getByRole("article", { name: "Bolt Beacon" })).toBeVisible({ timeout: 30_000 });
    await expectNoSeriousA11yViolations(player, { include: ".cmh-hand" });

    await tabs.getByRole("tab", { name: "Hand" }).click();
    const panel = sheet.getByRole("tabpanel");
    await expect(panel).toBeVisible();
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=combat-actions-sheet]" });

    // Attack: the Bandit picked on the map, then the result.
    await player.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Bandit, Enemy/ }).click();
    await tabs.getByRole("tab", { name: "Attack" }).click();
    await expect(panel.getByRole("button", { name: "Bandit, Melee, In range" })).toHaveAttribute("aria-pressed", "true");
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=combat-actions-sheet]" });
    await panel.getByRole("button", { name: "⚔ Attack Bandit with Rapier" }).click();
    await expect(panel.getByTestId("combat-verdict")).toHaveText(/Bandit\s*Hit/);
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=combat-actions-sheet]" });

    // Dice, after a roll.
    await tabs.getByRole("tab", { name: "Dice" }).click();
    await expect(panel.getByTestId("combat-map-dice")).toBeVisible();
    await panel.getByRole("button", { name: "Roll", exact: true }).click();
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=combat-actions-sheet]", ...DICE_CANVAS });
    await expectFitsViewport(player);

    // The GM at 390: Resolutions with the hit and Undo.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(s.url);
    const resolutions = page.getByRole("region", { name: "Resolutions" });
    const undo = resolutions.getByRole("button", { name: /^Undo: Ash → Bandit/ });
    await expect(undo).toBeAttached({ timeout: 30_000 });
    await undo.scrollIntoViewIfNeeded();
    await expectNoSeriousA11yViolations(page, { include: ".cm-aside" });
    await expectFitsViewport(page);
  } finally {
    await s.closePlayer();
  }
});
