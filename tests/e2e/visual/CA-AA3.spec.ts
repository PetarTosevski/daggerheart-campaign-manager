import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { VIEWPORTS, bardDraft, expectNoHorizontalScroll, openCombatMap } from "./helpers";

// Shots for the AA3 task doc (E2E_VISUAL=1), at 1440 and 390: the Encounter tab with the selected Bandit's actions
// panel (a target picked), the "Spend 1 Fear?" question, the attack result with the open reaction window, and the
// live map pane. The board (reference/designs/project/Adversaries.dc.html) has no actions panel; the shots are
// compared with its stat block and tracker regions for the parchment, chip and colour language. AA3b: the feature
// choices dialog (Deeproot Defender's Grab and Drag) and the stat block head without the old Roll attack / Roll damage.

const OUT = "test-results/visual/CA-AA3";

/** The scene of tests/e2e/encounter-actions.spec.ts (a spec can't import another spec's tests). */
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
  features: [
    { name: "Tough", kind: "passive" as const, text: "The Bandit shrugs off pain." },
    { name: "Roar", kind: "action" as const, text: "Spend a Fear: every PC within Close range marks a Stress.", fearCost: 1 },
  ],
};

async function scene(page: Page) {
  const { client, campaignId } = await openCombatMap(page);
  await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Mira"), idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Tabby"), idempotencyKey: crypto.randomUUID() });
  const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: SURE_BANDIT, idempotencyKey: crypto.randomUUID() });
  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
  const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "srd", adversaryId: "deeproot-defender" }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.encounters.start, { campaignId, encounterId });
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: crypto.randomUUID() });
  const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.name === "Mira")!._id, x: 5, y: 10 });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.name === "Tabby")!._id, x: 5, y: 12 });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.instanceId === instanceIds[0])!._id, x: 6, y: 10 });
  await client.mutation(api.fear.set, { campaignId, value: 3, idempotencyKey: crypto.randomUUID() });
  return { campaignId };
}

test("AA3 actions panel, Fear question, result with the reaction window, and the map pane", { tag: "@visual" }, async ({ page }) => {
  test.setTimeout(300_000);
  const { campaignId } = await scene(page);
  for (const viewport of VIEWPORTS) {
    const w = viewport.width;
    await page.setViewportSize(viewport);
    await page.goto(`/campaigns/${campaignId}/adversaries`);
    await page.getByRole("tab", { name: "Encounters" }).click();
    const tracker = page.getByRole("tabpanel", { name: "Encounters" }).getByRole("region", { name: "Encounter tracker" });
    const panel = tracker.getByRole("region", { name: "Adversary actions" });
    await expect(panel.getByRole("group", { name: "Targets" })).toBeVisible({ timeout: 30_000 });
    await panel.getByRole("group", { name: "Targets" }).getByRole("button", { name: "Mira" }).click();
    await page.waitForLoadState("networkidle");
    await tracker.getByRole("article", { name: "Bandit stat block" }).screenshot({ path: `${OUT}/panel-picked-${w}.png`, animations: "disabled" });
    await page.screenshot({ path: `${OUT}/page-${w}.png`, animations: "disabled", fullPage: true });

    await panel.getByRole("list", { name: "Features" }).getByRole("button", { name: "Use Roar (1 Fear)" }).click();
    const question = panel.getByRole("group", { name: "Spend Fear?" });
    await expect(question).toBeVisible();
    await panel.screenshot({ path: `${OUT}/fear-question-${w}.png`, animations: "disabled" });
    await question.getByRole("button", { name: "Cancel" }).click();

    await panel.getByRole("button", { name: "⚔ Attack Mira with Club" }).click();
    const windows = tracker.getByRole("region", { name: "Reaction windows" });
    await expect(windows).toBeVisible();
    await expect(panel.getByRole("region", { name: "Action result" })).toBeVisible();
    await panel.getByRole("region", { name: "Action result" }).screenshot({ path: `${OUT}/result-${w}.png`, animations: "disabled" });
    await windows.screenshot({ path: `${OUT}/windows-${w}.png`, animations: "disabled" });
    await tracker.getByRole("region", { name: "Live map" }).screenshot({ path: `${OUT}/map-pane-${w}.png`, animations: "disabled" });
    if (w < 640) await expectNoHorizontalScroll(page);
    await windows.getByRole("button", { name: "Resolve now: Bandit hit Mira" }).click();
    await expect(windows).toHaveCount(0);

    // AA3b: a feature with choices asks them in a dialog first.
    await tracker.getByRole("article", { name: "Deeproot Defender", exact: true }).getByRole("button", { name: "Deeproot Defender", exact: true }).click();
    const defender = tracker.getByRole("article", { name: "Deeproot Defender stat block" });
    await defender.getByRole("group", { name: "Targets" }).getByRole("button", { name: "Mira" }).click();
    const use = defender.getByRole("button", { name: "Use Grab and Drag (1 Fear)" });
    await expect(use).toHaveAttribute("aria-haspopup", "dialog");
    await use.click();
    const dialog = page.getByRole("dialog", { name: "Deeproot Defender: Grab and Drag" });
    await expect(dialog.getByRole("button", { name: "Use Grab and Drag" })).toBeVisible();
    await dialog.screenshot({ path: `${OUT}/choices-dialog-${w}.png`, animations: "disabled" });
    await page.screenshot({ path: `${OUT}/choices-page-${w}.png`, animations: "disabled" });
    if (w < 640) await expectNoHorizontalScroll(page);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  }
});
