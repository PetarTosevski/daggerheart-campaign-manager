import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene, type HudScene } from "./hud/helpers";

// Plan combat-hud H3.0 (docs/tasks/TASK-HUD-H3.0.md): with the HUD on, picking targets is one panel beside the primary
// target (CmpPicking 'One target', Main 'Picking a target'): a row per creature (picked / in / out 'GM approves'),
// rows and map rings in step (CmpTokens 'Target rings'), one primary naming the action. Out of range never errors: the
// primary sends, the GM's classic list shows the request, the player sees 'Waiting for the GM' (CmpPromptsPlayer) and
// Withdraw (HD3) removes it on both screens. The pickers open from the action ring's Attack (H3.4 opens H3.2's).

const pickPanel = (page: Page) => page.getByTestId("hud-pick");
const pickRow = (page: Page, tokenId: string) => pickPanel(page).locator(`[data-testid="hud-pick-row"][data-token="${tokenId}"]`);
const ring = (page: Page, tokenId: string) => page.locator(`[data-testid="hud-pick-ring"][data-token="${tokenId}"]`);

/** The Bandit steps next to Moss (Melee), so the weapon reaches it; the Lieutenant (Far) and the Sniper (Very Far) don't. */
async function banditToMelee(s: HudScene) {
  await s.client.mutation(api.combatTokens.move, { campaignId: s.campaignId, tokenId: s.enemies.bandit.tokenId, x: 6, y: 10 });
  const tokens = await s.client.query(api.combatTokensReads.list, { campaignId: s.campaignId, mapId: s.mapId });
  const lt = tokens.find((t) => t._id === s.enemies.lieutenant.tokenId)!.instanceId!;
  await s.client.mutation(api.encounterTracking.toggleCondition, { campaignId: s.campaignId, instanceId: lt, condition: "vulnerable", idempotencyKey: crypto.randomUUID() });
}

/** The action ring's Attack (H3.4): a click on your own token opens the ring. */
const ringAttack = (page: Page) => page.getByRole("toolbar", { name: "Your actions (Moss)" }).getByRole("button", { name: "Attack" });

async function openAttack(page: Page): Promise<Locator> {
  await page
    .getByRole("region", { name: "Battle map" })
    .getByRole("button", { name: /^Open Moss’s sheet \(your character\)/ })
    .click();
  const attack = ringAttack(page);
  await expect(attack).toBeEnabled({ timeout: 30_000 });
  await attack.click();
  const panel = pickPanel(page);
  await expect(panel).toBeVisible();
  return panel;
}

test("a player picks: the panel beside the target, rows and rings in step, out of range tagged, Esc cancels", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { player, enemies } = s;
  try {
    await banditToMelee(s);
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();

    const panel = await openAttack(player);
    await expect(player.getByTestId("combat-hud")).toHaveClass(/hud-pk-open/);
    await expect(panel.getByRole("heading", { level: 2 })).toBeFocused();
    await expect(panel.getByTestId("hud-pick-rule")).toHaveText("Pick 1 target in your weapon’s range");

    // A row per creature Moss sees: the Bandit in reach, the Lieutenant (Vulnerable) and the Sniper out ('GM approves');
    // the Bandit behind the wall is not listed.
    await expect(pickRow(player, enemies.bandit.tokenId)).toHaveAttribute("data-state", "in");
    await expect(pickRow(player, enemies.lieutenant.tokenId)).toHaveAttribute("data-state", "out");
    await expect(pickRow(player, enemies.lieutenant.tokenId)).toContainText("Vulnerable");
    await expect(pickRow(player, enemies.sniper.tokenId)).toContainText("GM approves");
    await expect(pickRow(player, enemies.sniper.tokenId)).toContainText("Very Far");
    await expect(pickRow(player, enemies.hiddenBandit.tokenId)).toHaveCount(0);
    for (const r of await panel.getByTestId("hud-pick-row").all()) expect(await r.getAttribute("aria-label")).not.toMatch(/\d/);

    // Rings: in = dashed gold, out = amber with the GM badge, band labels above.
    await expect(ring(player, enemies.bandit.tokenId)).toHaveClass(/hud-tg-in/);
    await expect(ring(player, enemies.sniper.tokenId)).toHaveClass(/hud-tg-out/);
    await expect(ring(player, enemies.sniper.tokenId).locator(".hud-tg-b")).toHaveText("GM");
    await expect(ring(player, enemies.sniper.tokenId).locator(".hud-tg-l")).toHaveText("Very Far");

    // A row picks; the ring follows; the primary names the action; the panel stands right of the target.
    await pickRow(player, enemies.bandit.tokenId).click();
    await expect(pickRow(player, enemies.bandit.tokenId)).toHaveAttribute("aria-pressed", "true");
    await expect(ring(player, enemies.bandit.tokenId)).toHaveClass(/hud-tg-picked/);
    await expect(panel.getByTestId("hud-pick-go")).toHaveText(/^Attack /);
    await expect(panel.getByTestId("hud-pick-go")).toContainText(enemies.bandit.name);
    const token = await player.locator(`.hud-map [data-token="${enemies.bandit.tokenId}"]`).first().boundingBox();
    await expect.poll(async () => (await panel.boundingBox())!.x).toBeGreaterThan(token!.x + token!.width / 2 + 30);

    // A ring picks too (single: it replaces the Bandit); the row follows; the footer says the GM approves first.
    await ring(player, enemies.lieutenant.tokenId).getByTestId("hud-pick-ring-hit").click();
    await expect(pickRow(player, enemies.lieutenant.tokenId)).toHaveAttribute("aria-pressed", "true");
    await expect(pickRow(player, enemies.bandit.tokenId)).toHaveAttribute("aria-pressed", "false");
    await expect(ring(player, enemies.lieutenant.tokenId)).toHaveClass(/hud-tg-out/);
    await expect(panel.getByTestId("hud-pick-pay")).toContainText("the GM approves first");
    await expectNoSeriousA11yViolations(player, {
      exclude: 'button[aria-label="Zoom out"]',
      reason: "H3.2's taller panel beside the Lieutenant partly covers the map toolbar's Zoom out (target-size); dcm-bxp.99.32.22",
    });

    // Esc cancels: the panel and rings go, focus goes back to the ring's Attack button.
    await pickRow(player, enemies.lieutenant.tokenId).focus();
    await player.keyboard.press("Escape");
    await expect(panel).toHaveCount(0);
    await expect(player.getByTestId("hud-pick-ring")).toHaveCount(0);
    await expect(player.getByTestId("combat-hud")).not.toHaveClass(/hud-pk-open/);
    await expect(ringAttack(player)).toBeFocused();
  } finally {
    await s.close();
  }
});

test("live: an out-of-range pick waits for the GM (the GM's queue), Withdraw removes it on both screens", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player, enemies, client, campaignId } = s;
  try {
    const moss = s.pcs.find((p) => p.name === "Moss")!;
    const hopeBefore = (await client.query(api.combatHud.party, { campaignId, mapId: s.mapId })).find((m) => m.characterId === moss.characterId)!.hope.value;
    for (const page of [gm, player]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(s.url);
    }
    await expect(player.getByTestId("combat-hud")).toBeVisible();
    // The GM's HUD queue ("Waiting on you", plan combat-hud H5.1) lists the out-of-range use.
    const sanctions = gm.getByTestId("hud-queue").getByTestId("hud-queue-range");
    await expect(sanctions).toHaveCount(0);

    const panel = await openAttack(player);
    await pickRow(player, enemies.sniper.tokenId).click();
    const go = panel.getByTestId("hud-pick-go");
    await expect(go).toHaveText(/^Attack /);
    await expect(go).toContainText(enemies.sniper.name);
    await go.click();

    // Never an error: the session ends and 'Waiting for the GM' shows; nothing rolled or paid.
    await expect(panel).toHaveCount(0);
    const wait = player.getByTestId("hud-pick-wait");
    await expect(wait).toHaveCount(1);
    await expect(wait).toContainText("Waiting for the GM");
    await expect(wait).toContainText("Attack · out of range");
    await expect(wait).toContainText(`${enemies.sniper.name} is Very Far. Nothing is rolled or paid until the GM decides.`);
    await expectNoSeriousA11yViolations(player);

    // The GM's queue shows it, live.
    await expect(sanctions).toHaveCount(1);
    await expect(sanctions).toContainText(enemies.sniper.name);

    // Withdraw: gone on both screens; Hope untouched.
    await wait.getByRole("button", { name: "Withdraw Attack" }).click();
    await expect(wait).toHaveCount(0);
    await expect(sanctions).toHaveCount(0);
    const hopeAfter = (await client.query(api.combatHud.party, { campaignId, mapId: s.mapId })).find((m) => m.characterId === moss.characterId)!.hope.value;
    expect(hopeAfter).toBe(hopeBefore);
    await expect.poll(async () => (await client.query(api.combatRequestsReads.mine, { campaignId })).length).toBe(0);
  } finally {
    await s.close();
  }
});
