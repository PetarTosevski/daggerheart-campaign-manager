import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectFitsViewport, expectNoSeriousA11yViolations } from "./a11y";
import { hudScene } from "./hud/helpers";

// Plan combat-actions CA8 (bead dcm-bxp.99.4), on the Combat HUD since the cut-over (plan combat-hud H8.1): axe on the
// combat-action parts the other HUD specs leave unscanned. Bar (D12, docs/tasks/TASK-D12-H1.md): no serious or critical
// violation on the player's phone tabs Attack (idle and after an attack) and Dice (after a roll), the desktop Dice
// dialog after a roll, and the GM's phone request queue with a player's roll with Fear and its Undo; at 390 the page
// does not scroll sideways. The hand's states are scanned in a11y-combat-hand.spec.ts, the picking panel and the result
// sheet in hud-phone-sheets.spec.ts, the desktop Resolutions in hud-answers.spec.ts.

test.describe.configure({ timeout: 300_000 });
test.use({ actionTimeout: 30_000 });

const PHONE = { width: 390, height: 844 };

/** WebGL dice canvas: no DOM for axe to check (its rolls are announced by the dice box's result list). */
const DICE_CANVAS = { exclude: "canvas", reason: "WebGL dice canvas: no DOM to check (its rolls are announced in text)" };

/** Success with Fear on an Agility action roll (Hope Die 3, Fear Die 8; CB p.95: the GM gains a Fear). */
const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

async function openPhone(page: Page, url: string) {
  await page.setViewportSize(PHONE);
  await page.goto(url);
  await expect(page.getByTestId("combat-hud")).toBeVisible({ timeout: 30_000 });
  // The HUD is viewport-tall under the campaign header: scroll so it fills the window.
  await page.getByTestId("combat-hud").evaluate((el) => el.scrollIntoView({ block: "end" }));
}

test("phone (390): the player's Attack and Dice tabs pass axe, with no sideways scroll", async ({ browser }) => {
  const s = await hudScene(browser);
  const { player, client, campaignId, enemies } = s;
  try {
    // The Bandit steps next to Moss, within any weapon's reach.
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: enemies.bandit.tokenId, x: 6, y: 10 });
    await openPhone(player, s.url);
    const tabs = player.getByTestId("hud-phone-sheet").getByRole("tablist", { name: "Combat actions" });

    // Attack: idle.
    await tabs.getByRole("tab", { name: "Attack" }).click();
    const attackTab = player.getByTestId("hud-phone-tab-attack");
    const weapon = attackTab.getByTestId("hud-phone-attack");
    await expect(weapon).toBeEnabled({ timeout: 30_000 });
    await expectNoSeriousA11yViolations(player, { include: '[data-testid="hud-phone-tab-attack"]' });
    await expectFitsViewport(player);

    // An attack on the Bandit; the result sheet closes and the Attack tab is scanned again.
    await weapon.click();
    const pick = player.getByTestId("hud-pick");
    await expect(pick).toBeVisible();
    const row = pick.locator(`[data-testid="hud-pick-row"][data-token="${enemies.bandit.tokenId}"]`);
    await row.click();
    await expect(row).toHaveAttribute("data-state", "picked");
    await pick.getByTestId("hud-pick-go").click();
    await expect(pick).toHaveCount(0);
    const result = player.getByTestId("hud-result");
    await expect(result).toBeVisible({ timeout: 30_000 });
    await result.getByRole("button", { name: /^Close the result of / }).click();
    await expect(result).toHaveCount(0);
    await expect(player.getByTestId("hud-phone-sheet")).toBeVisible();
    if (!(await attackTab.isVisible())) await tabs.getByRole("tab", { name: "Attack" }).click();
    await expect(attackTab.getByTestId("hud-phone-attack")).toBeVisible();
    await expectNoSeriousA11yViolations(player, { include: '[data-testid="hud-phone-tab-attack"]' });
    await expectFitsViewport(player);

    // Dice, after a roll.
    await tabs.getByRole("tab", { name: "Dice" }).click();
    const box = player.getByTestId("hud-phone-tab-dice").getByTestId("hud-dice-box");
    await expect(box).toBeVisible({ timeout: 30_000 });
    await box.getByRole("button", { name: "Roll", exact: true }).click();
    await expect(box.getByTestId("last-roll")).toBeVisible({ timeout: 30_000 });
    await expectNoSeriousA11yViolations(player, { include: '[data-testid="hud-phone-tab-dice"]', ...DICE_CANVAS });
    await expectFitsViewport(player);
  } finally {
    await s.close();
  }
});

test("desktop (1440): the player's Dice dialog passes axe after a roll", async ({ browser }) => {
  const s = await hudScene(browser);
  const { player } = s;
  try {
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible({ timeout: 30_000 });
    await player.getByRole("group", { name: "Your tools" }).getByRole("button", { name: "Dice" }).click();
    const dialog = player.getByRole("dialog", { name: "Dice" });
    const box = dialog.getByTestId("hud-dice-box");
    await expect(box).toBeVisible({ timeout: 30_000 });
    await box.getByRole("button", { name: "Roll", exact: true }).click();
    await expect(box.getByTestId("last-roll")).toBeVisible({ timeout: 30_000 });
    await expectNoSeriousA11yViolations(player, { include: '[data-testid="hud-dice-box"]', ...DICE_CANVAS });
  } finally {
    await s.close();
  }
});

test("phone (390): the GM's request queue with a player's roll with Fear and its Undo passes axe, with no sideways scroll", async ({ browser }) => {
  const s = await hudScene(browser);
  const { gm, playerClient } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    await openPhone(gm, s.url);
    await playerClient.mutation(api.rolls.manualRoll, { characterId: moss.characterId, roll: agility, values: [3, 8], idempotencyKey: crypto.randomUUID() });

    const queue = gm.getByTestId("hud-phone-queue");
    await expect(queue).toBeVisible();
    await queue.getByRole("button", { name: "Show the requests" }).click();
    await expect(queue.getByRole("button", { name: "Fold the requests down" })).toHaveAttribute("aria-expanded", "true");
    const undo = queue.getByRole("button", { name: "Undo: Moss rolled with Fear" });
    await expect(undo).toBeAttached({ timeout: 30_000 });
    await undo.scrollIntoViewIfNeeded();
    await expect(undo).toBeVisible();
    await expectNoSeriousA11yViolations(gm, { include: '[data-testid="hud-phone-queue"]' });
    await expectFitsViewport(gm);
  } finally {
    await s.close();
  }
});
