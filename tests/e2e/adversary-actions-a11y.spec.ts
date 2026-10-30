import { expect, test } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, expectNoHorizontalScroll, openCombatMap } from "./visual/helpers";

// Plan combat-actions AA6 (bead dcm-bxp.99.9): axe (no serious or critical violation) on the adversary panels at desktop
// (1440) and phone (390) width: the Encounter tab's action panel (AA3) with a result and an open reaction window, the
// Combat Map's adversary panel (AA5) with the Bandit selected and a result, and the player's incoming-hit prompt (AA4)
// on the Combat Map. No sideways scroll for either role.

test.describe.configure({ timeout: 300_000 });
test.use({ actionTimeout: 30_000 });

const PLAYER = "e2e-player@example.test";

/** A Bandit that always hits (ATK +15) for 2d6+12, with a 1-Fear action (a GM prompt). */
const SURE_BANDIT = {
  name: "Bandit",
  tier: 1,
  type: "Standard" as const,
  description: "A road thug.",
  motives: "Rob",
  difficulty: 10,
  thresholds: { major: 5, severe: 10 },
  hp: 5,
  stress: 3,
  attack: { modifier: 15, name: "Club", range: "Melee", damage: "2d6+12 phy" },
  experiences: [{ name: "Ambusher", value: 2 }],
  features: [{ name: "Roar", kind: "action" as const, text: "Spend a Fear: every PC within Close range marks a Stress.", fearCost: 1 }],
};

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`Encounter-tab action panel, Combat Map adversary panel and incoming-hit prompt pass axe (${viewport.width}px)`, async ({ page, browser }) => {
    await page.setViewportSize(viewport);
    const { client, campaignId, url } = await openCombatMap(page);
    const context = await browser.newContext({ viewport });
    const player = await context.newPage();
    try {
      const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
      await signInAsTestGm(player, PLAYER);
      await expect(player).toHaveURL("/");
      const playerClient = await convexAs(player);
      await playerClient.mutation(api.members.joinByCode, { code });
      const { characterId: mira } = await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Mira"), idempotencyKey: crypto.randomUUID() });
      const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: SURE_BANDIT, idempotencyKey: crypto.randomUUID() });
      const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
      const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
      await client.mutation(api.encounters.start, { campaignId, encounterId });
      const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
      await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
      await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: crypto.randomUUID() });
      const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
      await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.characterId === mira)!._id, x: 5, y: 10 });
      await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.instanceId === instanceIds[0])!._id, x: 6, y: 10 });
      await client.mutation(api.fear.set, { campaignId, value: 3, idempotencyKey: crypto.randomUUID() });

      await player.goto(url);
      await expect(player.getByRole("region", { name: "Battle map" })).toBeVisible({ timeout: 30_000 });

      // The Encounter tab: idle, then with a result and an open reaction window.
      await page.goto(`/campaigns/${campaignId}/adversaries`);
      await page.getByRole("tab", { name: "Encounters" }).click();
      const tracker = page.getByRole("tabpanel", { name: "Encounters" }).getByRole("region", { name: "Encounter tracker" });
      const panel = tracker.getByRole("region", { name: "Adversary actions" });
      await expect(panel).toBeVisible({ timeout: 30_000 });
      await expectNoSeriousA11yViolations(page, { include: ".trk" });
      await panel.getByRole("group", { name: "Targets" }).getByRole("button", { name: "Mira" }).click();
      await panel.getByRole("button", { name: "⚔ Attack Mira with Club" }).click();
      await expect(panel.getByRole("region", { name: "Action result" }).getByTestId("tracker-action-roll")).toBeVisible();
      await expect(tracker.getByRole("region", { name: "Reaction windows" })).toBeVisible();
      await expectNoSeriousA11yViolations(page, { include: ".trk" });
      await expectNoHorizontalScroll(page);

      // The player's incoming-hit prompt on the Combat Map.
      const prompt = player.getByRole("region", { name: "Incoming hit: Bandit hit Mira" });
      await expect(prompt).toBeVisible({ timeout: 30_000 });
      await expectNoSeriousA11yViolations(player, { include: '[data-testid="incoming-hit"]' });
      await expectNoHorizontalScroll(player);
      await prompt.getByRole("button", { name: "Mark", exact: true }).click();
      await expect(player.getByTestId("incoming-hit")).toHaveCount(0);

      // The Combat Map's adversary panel: the hint, then the Bandit selected, then a result (a Fear question first).
      await page.goto(url);
      const board = page.getByRole("region", { name: "Battle map" });
      await expect(board.getByRole("button", { name: /^Bandit, / })).toBeVisible({ timeout: 30_000 });
      const adversaries = '[data-testid="adversary-panel"]';
      await expect(page.locator(adversaries)).toBeVisible();
      await expectNoSeriousA11yViolations(page, { include: adversaries });
      await board.getByRole("button", { name: /^Bandit, / }).click();
      const mapPanel = page.getByRole("region", { name: "Adversaries" }).getByRole("region", { name: "Adversary actions" });
      await expect(mapPanel).toBeVisible();
      await expectNoSeriousA11yViolations(page, { include: adversaries });
      await mapPanel.getByRole("list", { name: "Features" }).getByRole("button", { name: "Use Roar (1 Fear)" }).click();
      const question = mapPanel.getByRole("group", { name: "Spend Fear?" });
      await expect(question).toBeVisible();
      await expectNoSeriousA11yViolations(page, { include: adversaries });
      await question.getByRole("button", { name: "Spend 1 Fear" }).click();
      await expect(mapPanel.getByRole("region", { name: "Action result" })).toContainText("Bandit uses Roar");
      await expectNoSeriousA11yViolations(page, { include: adversaries });
      await expectNoHorizontalScroll(page);
    } finally {
      await context.close();
    }
  });
}
