import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "../a11y";
import { gmAndPlayer } from "../live";
import { TOUCH_FLOOR_ON_SCREEN } from "../zoom";

// Shots for docs/tasks/TASK-GLASS-G9.md (E2E_VISUAL=1): the live encounter tracker on the Adversaries page's Encounters
// tab as glass buttons in the GM's colours (top bar, instance cards, the actions panel inside the stat block, the
// Fear question, the action result, the reaction windows, the Spend Fear, End scene and feature choices dialogs) at
// 1440 x 900, 1024 x 768 and 390 x 844; a player gets the page's GM-only note (no tracker). A hovered confirm and a
// keyboard-focused button, each with axe; 44 px for every glass button at 1024 and 390. The HP / Stress pips stay
// sheet pips (sh-pip). The party has no live map, so the targets are the party list (Q18).

const OUT = "test-results/visual/GLASS-G9";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

/** A Bandit that always hits (ATK +15), with a 1-Fear action (encounter-actions.spec.ts' scene). */
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

async function settle(page: Page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
}

async function shoot(target: Locator, name: string) {
  await settle(target.page());
  await target.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
}

/** Keyboard focus on `locator` (Tab into it, so :focus-visible applies). */
async function keyboardFocus(page: Page, locator: Locator) {
  await locator.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(locator).toBeFocused();
  await page.waitForTimeout(400);
}

async function expectAtLeast44(buttons: Locator) {
  for (const button of await buttons.all()) {
    if (!(await button.isVisible())) continue;
    const box = await button.boundingBox();
    const name = (await button.getAttribute("aria-label")) ?? (await button.textContent()) ?? "";
    expect(box!.height, name).toBeGreaterThanOrEqual(TOUCH_FLOOR_ON_SCREEN);
  }
}

async function openTracker(page: Page, campaignId: string) {
  await page.goto(`/campaigns/${campaignId}/adversaries`);
  await page.getByRole("tab", { name: "Encounters" }).click();
  const tracker = page.getByRole("tabpanel", { name: "Encounters" }).getByRole("region", { name: "Encounter tracker" });
  await expect(tracker.getByRole("heading", { name: "Road ambush" })).toBeVisible({ timeout: 30_000 });
  return tracker;
}

test("GLASS-G9 the encounter tracker, its actions panel and dialogs as the GM; the player's GM-only note", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(600_000);
  const table = await gmAndPlayer(browser);
  const { gm, player, campaignId, client } = table;
  const key = () => crypto.randomUUID();
  try {
    const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: SURE_BANDIT, idempotencyKey: key() });
    const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Road ambush", pcs: 4, idempotencyKey: key() });
    const add = async (source: { kind: "custom"; customId: typeof customId } | { kind: "srd"; adversaryId: string }, count: number) =>
      (await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source, count, summoned: false, idempotencyKey: key() })).instanceIds;
    const [bandit] = await add({ kind: "custom", customId }, 1);
    await add({ kind: "srd", adversaryId: "jagged-knife-lackey" }, 4);
    await add({ kind: "srd", adversaryId: "deeproot-defender" }, 1);
    await client.mutation(api.encounters.start, { campaignId, encounterId });
    await client.mutation(api.encounterTracking.toggleCondition, { campaignId, instanceId: bandit!, condition: "restrained", idempotencyKey: key() });
    await client.mutation(api.encounterTracking.setTags, { campaignId, instanceId: bandit!, tags: ["Cursed"], idempotencyKey: key() });
    await client.mutation(api.encounterTracking.spotlight, { campaignId, instanceId: bandit!, idempotencyKey: key() });
    await client.mutation(api.fear.set, { campaignId, value: 4, idempotencyKey: key() });

    // ── The tracker as the GM, every width; the player's GM-only note ──
    for (const viewport of VIEWPORTS) {
      await gm.setViewportSize(viewport);
      const tracker = await openTracker(gm, campaignId);
      await tracker.getByRole("article", { name: "Bandit", exact: true }).getByRole("button", { name: "Bandit", exact: true }).click();
      await expect(tracker.getByRole("region", { name: "Adversary actions" })).toBeVisible({ timeout: 30_000 });
      await shoot(tracker, `tracker-gm-${viewport.width}`);
      if (viewport.width < 1440) await expectAtLeast44(tracker.locator("button.gb"));

      await player.setViewportSize(viewport);
      await player.goto(`/campaigns/${campaignId}/adversaries`);
      await expect(player.getByRole("heading", { level: 1 }).first()).toBeVisible();
      await expect(player.getByRole("region", { name: "Encounter tracker" })).toHaveCount(0);
      await settle(player);
      await player.screenshot({ path: `${OUT}/adversaries-player-${viewport.width}.png`, animations: "disabled" });
    }

    const page = gm;
    await page.setViewportSize(VIEWPORTS[0]);
    const tracker = await openTracker(page, campaignId);
    const top = tracker.locator(".trk-top");

    // Top bar roles.
    await expect(top.getByRole("button", { name: "End GM turn" })).toHaveClass(/\bgb-neutral\b/);
    await expect(top.getByRole("button", { name: "End scene" })).toHaveClass(/\bgb-danger\b/);
    await expect(top.getByRole("button", { name: "Gain 1 Fear" })).toHaveClass(/\bgb-neutral\b/);
    const spendFear = top.getByRole("button", { name: "Spend Fear" });
    await expect(spendFear).toHaveClass(/\bgb-confirm\b/);
    // The GM's confirm wears Fear (purple): its rim is not the player's Hope gold.
    const gmRim = await spendFear.evaluate((el) => getComputedStyle(el).getPropertyValue("--rim").trim());
    const hopeRim = await spendFear.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--gb-hope").trim());
    expect(gmRim).not.toBe(hopeRim);

    await spendFear.hover();
    await shoot(top, "top-gm-hover-spend-fear");
    await expectNoSeriousA11yViolations(page, { include: ".trk-top" });
    await page.mouse.move(0, 0);
    await keyboardFocus(page, top.getByRole("button", { name: "End GM turn" }));
    await shoot(top, "top-gm-focus-end-turn");
    await expectNoSeriousA11yViolations(page, { include: ".trk-top" });

    // The Bandit's card.
    const card = tracker.getByRole("article", { name: "Bandit", exact: true });
    await expect(card.getByRole("button", { name: "Mark Hit Point 1 of 5" })).toHaveClass(/\bsh-pip\b.*\bheart\b/);
    await expect(card.getByRole("button", { name: "Mark 1 Hit Point on Bandit" })).toHaveClass(/\bgb-neutral\b.*\bgb-sm\b.*\bgb-icon\b/);
    await expect(card.getByRole("button", { name: "Resistant" })).toHaveClass(/\bgb-neutral\b/);
    await expect(card.getByRole("button", { name: "Apply" })).toHaveClass(/\bgb-confirm\b/);
    const restrained = card.getByRole("button", { name: /^Restrained/ });
    await expect(restrained).toHaveClass(/\bgb-neutral\b/);
    await expect(restrained).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByRole("button", { name: "Remove tag Cursed" })).toHaveClass(/\bgb-neutral\b.*\bgb-icon\b/);
    const spot = card.getByRole("button", { name: /^Spotlight Bandit/ });
    await expect(spot).toHaveAttribute("data-maxed", "true");
    await expect(spot).toHaveClass(/\bgb-danger\b/);
    await card.getByLabel("Damage to Bandit").fill("3");
    await card.getByRole("button", { name: "Apply" }).hover();
    await shoot(card, "card-gm-hover-apply");
    await expectNoSeriousA11yViolations(page, { include: ".trk-cards" });
    await card.getByLabel("Damage to Bandit").fill("");

    // A Minion group: Apply suggests defeats; Defeat N is danger between neutral steppers.
    const lackeys = tracker.getByRole("article", { name: "Jagged Knife Lackey", exact: true });
    await expect(lackeys.getByRole("button", { name: /^Spotlight Jagged/ })).toHaveClass(/\bgb-neutral\b/);
    await lackeys.getByLabel("Damage to Jagged Knife Lackey").fill("12");
    await lackeys.getByRole("button", { name: "Apply" }).click();
    const defeat = lackeys.getByRole("button", { name: /^Defeat \d/ });
    await expect(defeat).toHaveClass(/\bgb-danger\b/);
    await expect(lackeys.getByRole("button", { name: "One more Minion" })).toHaveClass(/\bgb-neutral\b.*\bgb-icon\b/);
    await shoot(lackeys, "minion-gm-defeat");

    // The actions panel on the parchment.
    await card.getByRole("button", { name: "Bandit", exact: true }).click();
    const block = tracker.getByRole("article", { name: "Bandit stat block" });
    const panel = tracker.getByRole("region", { name: "Adversary actions" });
    const liriel = panel.getByRole("group", { name: "Targets" }).getByRole("button", { name: "Liriel" });
    await expect(liriel).toHaveClass(/\bgb-neutral\b/);
    await liriel.click();
    await expect(liriel).toHaveAttribute("aria-pressed", "true");
    const edges = panel.getByRole("group", { name: "Advantage" });
    await expect(edges.getByRole("button", { name: "Normal" })).toHaveClass(/\bgb-normal\b/);
    await expect(edges.getByRole("button", { name: "Advantage", exact: true })).toHaveClass(/\bgb-advantage\b/);
    await expect(edges.getByRole("button", { name: "Disadvantage" })).toHaveClass(/\bgb-disadvantage\b/);
    const attack = panel.getByRole("button", { name: "⚔ Attack Liriel with Club" });
    await expect(attack).toHaveClass(/\bgb-confirm\b/);
    const roar = panel.getByRole("list", { name: "Features" }).getByRole("button", { name: "Use Roar (1 Fear)" });
    await expect(roar).toHaveClass(/\bgb-confirm\b.*\bgb-sm\b/);
    await attack.scrollIntoViewIfNeeded();
    await attack.hover();
    await shoot(block, "panel-gm-hover-attack");
    await expectNoSeriousA11yViolations(page, { include: ".trk-act" });
    await page.mouse.move(0, 0);
    await keyboardFocus(page, edges.getByRole("button", { name: "Advantage", exact: true }));
    await shoot(panel, "panel-gm-focus-advantage");
    await expectNoSeriousA11yViolations(page, { include: ".trk-act" });

    // The Fear question.
    await roar.click();
    const question = panel.getByRole("group", { name: "Spend Fear?" });
    await expect(question.getByRole("button", { name: "Spend 1 Fear" })).toHaveClass(/\bgb-confirm\b/);
    await expect(question.getByRole("button", { name: "Cancel" })).toHaveClass(/\bgb-cancel\b/);
    await question.getByRole("button", { name: "Spend 1 Fear" }).hover();
    await shoot(question, "fear-question-gm-hover-spend");
    await expectNoSeriousA11yViolations(page, { include: ".trk-act" });
    await question.getByRole("button", { name: "Cancel" }).click();

    // The attack's result and the reaction window (Liriel's player has to choose armor).
    await attack.click();
    const result = panel.getByRole("region", { name: "Action result" });
    await expect(result.getByRole("button", { name: "Clear" })).toHaveClass(/\bgb-cancel\b.*\bgb-sm\b/);
    await shoot(result, "result-gm");
    const windows = tracker.getByRole("region", { name: "Reaction windows" });
    const resolve = windows.getByRole("button", { name: "Resolve now: Bandit hit Liriel" });
    await expect(resolve).toHaveClass(/\bgb-confirm\b/);
    await shoot(windows, "windows-gm");
    await resolve.click();
    await expect(windows).toHaveCount(0);
    await result.getByRole("button", { name: "Clear" }).click();

    // The Spend Fear dialog: steppers neutral, the four reasons confirm.
    await spendFear.click();
    const spend = page.getByRole("dialog", { name: "Spend Fear" });
    await expect(spend.getByRole("button", { name: "Spend more Fear" })).toHaveClass(/\bgb-neutral\b.*\bgb-icon\b/);
    await expect(spend.getByRole("button", { name: "Additional GM move" })).toHaveClass(/\bgb-confirm\b/);
    await spend.getByRole("button", { name: "Interrupt" }).hover();
    await shoot(spend, "spend-fear-dialog-gm-hover-reason");
    await expectNoSeriousA11yViolations(page, { include: "dialog[open]" });
    await spend.getByRole("button", { name: "Close spend fear" }).click();

    // End scene's dialog (EndSceneButton is G11's: it applies the passed class to its dialog's buttons too).
    await top.getByRole("button", { name: "End scene" }).click();
    const endScene = page.getByRole("dialog", { name: "End the scene?" });
    await shoot(endScene, "end-scene-dialog-gm");
    await endScene.getByRole("button", { name: "Cancel" }).click();

    // A feature with choices (Deeproot Defender's Grab and Drag): Use = confirm, Cancel = cancel.
    await tracker.getByRole("article", { name: "Deeproot Defender", exact: true }).getByRole("button", { name: "Deeproot Defender", exact: true }).click();
    const defender = tracker.getByRole("article", { name: "Deeproot Defender stat block" });
    await defender.getByRole("group", { name: "Targets" }).getByRole("button", { name: "Liriel" }).click();
    await defender.getByRole("button", { name: "Use Grab and Drag (1 Fear)" }).click();
    const choices = page.getByRole("dialog", { name: "Deeproot Defender: Grab and Drag" });
    await expect(choices.getByRole("button", { name: "Use Grab and Drag" })).toHaveClass(/\bgb-confirm\b/);
    const cancel = choices.getByRole("button", { name: "Cancel" });
    await expect(cancel).toHaveClass(/\bgb-cancel\b/);
    await keyboardFocus(page, cancel);
    await shoot(choices, "choices-gm-focus-cancel");
    await expectNoSeriousA11yViolations(page, { include: "dialog[open]" });
    await cancel.click();
    await expect(choices).toHaveCount(0);
  } finally {
    await table.close();
  }
});
