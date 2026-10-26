import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { VIEWPORTS, bardDraft, expectNoHorizontalScroll, openCombatMap } from "./helpers";

// Shots for the AA5 task doc (E2E_VISUAL=1), at 1440 and 390: the GM column's Adversaries card acting for the Bandit
// (range and sight, a target picked), the attack result with the open window and the hit flash on Mira's token, the
// incoming-hit prompt of Rook (the GM's own PC) and the adversary resolutions with Undo. The board
// (reference/designs/project/Combat.dc.html, region combat:gm-play) has no adversary controls; the shots are compared
// with its GM column cards and token rings (`node scripts/board-shots.mjs combat:gm-play`).

const OUT = "test-results/visual/CA-AA5";

/** The scene of tests/e2e/combat-adversary.spec.ts (a spec can't import another spec's tests). */
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
  const { client, campaignId, url } = await openCombatMap(page);
  const { characterId: miraId } = await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Mira"), idempotencyKey: crypto.randomUUID() });
  const { characterId: rookId } = await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Rook"), idempotencyKey: crypto.randomUUID() });
  const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: SURE_BANDIT, idempotencyKey: crypto.randomUUID() });
  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
  const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.encounters.start, { campaignId, encounterId });
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: crypto.randomUUID() });
  const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.characterId === miraId)!._id, x: 5, y: 10 });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.characterId === rookId)!._id, x: 6, y: 15 });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.instanceId === instanceIds[0])!._id, x: 6, y: 10 });
  await client.mutation(api.fear.set, { campaignId, value: 3, idempotencyKey: crypto.randomUUID() });
  return { client, campaignId, url, rookId, instanceId: instanceIds[0]! };
}

test("AA5 adversary controls, hit flash, the GM's own PC prompt and adversary resolutions", { tag: "@visual" }, async ({ page }) => {
  test.setTimeout(400_000);
  const s = await scene(page);
  for (const viewport of VIEWPORTS) {
    const w = viewport.width;
    await page.setViewportSize(viewport);
    await page.goto(s.url);
    // Hold each flash mid-animation so it can be shot (the real one plays once in under two seconds).
    await page.addStyleTag({ content: ".cmx-flash { animation-delay: -0.5s !important; animation-play-state: paused !important; }" });
    const board = page.getByRole("region", { name: "Battle map" });
    await expect(board.getByRole("button", { name: /^Bandit, / })).toBeVisible({ timeout: 30_000 });
    await board.getByRole("button", { name: /^Bandit, / }).click();
    const card = page.getByRole("region", { name: "Adversaries" });
    const panel = card.getByRole("region", { name: "Adversary actions" });
    await panel.getByRole("group", { name: "Targets" }).getByRole("button", { name: "Mira" }).click();
    await page.waitForLoadState("networkidle");
    await card.screenshot({ path: `${OUT}/panel-${w}.png`, animations: "disabled" });

    await panel.getByRole("button", { name: "⚔ Attack Mira with Club" }).click();
    await expect(panel.getByRole("region", { name: "Action result" })).toBeVisible();
    await expect(board.getByTestId("combat-hit-flash").first()).toBeVisible({ timeout: 30_000 });
    // The flash shots first: a shot with animations "disabled" ends the flash's animation, which removes it.
    await board.screenshot({ path: `${OUT}/flash-${w}.png` });
    // A close-up of the flash on Mira's token (the map is shot at its fitted zoom, so tokens are small).
    const flash = board.getByTestId("combat-hit-flash").first();
    await flash.scrollIntoViewIfNeeded();
    const box = (await flash.boundingBox())!;
    const pad = 90;
    await page.screenshot({ path: `${OUT}/flash-closeup-${w}.png`, clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.width + 2 * pad, height: box.height + 2 * pad } });
    await page.screenshot({ path: `${OUT}/page-${w}.png`, fullPage: true });
    await card.screenshot({ path: `${OUT}/result-${w}.png`, animations: "disabled" });

    // Rook (the GM's own PC) is hit from the Encounter tab's server call: the prompt in the GM column.
    await s.client.mutation(api.adversaryActions.attack, { campaignId: s.campaignId, instanceId: s.instanceId, targets: [s.rookId], idempotencyKey: crypto.randomUUID() });
    const prompt = page.getByTestId("incoming-hit").filter({ hasText: "Rook" });
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    await prompt.screenshot({ path: `${OUT}/gm-prompt-${w}.png`, animations: "disabled" });
    await prompt.getByRole("button", { name: "Don't" }).click();
    await expect(prompt).toHaveCount(0);

    // Settle Mira's window, then the resolutions with Undo.
    await card.getByRole("button", { name: /^Resolve now/ }).first().click();
    const resolutions = page.getByRole("region", { name: "Adversary resolutions" });
    await expect(resolutions.getByTestId("combat-resolution").first()).toBeVisible();
    await resolutions.screenshot({ path: `${OUT}/resolutions-${w}.png`, animations: "disabled" });
    if (w < 640) await expectNoHorizontalScroll(page);
  }
});
