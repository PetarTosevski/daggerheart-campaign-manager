import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene } from "./hud/helpers";

// Plan combat-hud H4.1 (docs/tasks/TASK-HUD-H4.1.md): with the HUD on, a card's or an attack's result opens as the result
// panel (Main 'Card result'): the card's art and name, "<actor> · <roll>", the outcome tag, the Hope and Fear dice with
// the total, and per target Hit / Miss / Defeated with the player's own damage on a hit; never an adversary's number
// (U1). It replaces the result above the fan (H3.1) and the attack's interim line (H3.2). ✕ closes it; a new Use clears
// it. On a phone it is a bottom sheet. "Your roll waits" (a held attack, CB p.107) comes from the internal e2e seed
// `combatRequests:seedHeldAttackForE2e` (dcm-bxp.99.32.25: fixed Hope and Fear dice); "After the roll" stays covered by
// tests/unit/hud/result-panel.test.tsx.

test.use({ actionTimeout: 30_000 });

const hand = (page: Page) => page.getByTestId("hud-hand");
const fanCard = (page: Page, name: string) => hand(page).getByTestId("hud-hand-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
const pickPanel = (page: Page) => page.getByTestId("hud-pick");
const pickRow = (page: Page, tokenId: string) => pickPanel(page).locator(`[data-testid="hud-pick-row"][data-token="${tokenId}"]`);

const NUMBERS = /Difficulty|threshold|Major|Severe|\bHP\b|Hit Points? left/;

test("a cast card's result: art, name, roll, tag, Hope / Fear dice, the target’s verdict; a new Use clears it", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { player, gm, enemies } = s;
  try {
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();
    await expect(hand(player)).toHaveAttribute("data-mode", "own", { timeout: 30_000 });

    await fanCard(player, "Vicious Entangle").hover();
    await fanCard(player, "Vicious Entangle").getByRole("button", { name: "Use Vicious Entangle" }).click();
    await expect(pickPanel(player)).toBeVisible();
    await pickRow(player, enemies.lieutenant.tokenId).click();
    await pickPanel(player).getByTestId("hud-pick-go").click();
    await expect(pickPanel(player)).toHaveCount(0);

    const result = player.getByTestId("hud-result");
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result.getByRole("heading", { name: "Vicious Entangle", level: 2 })).toBeVisible();
    await expect(result).toContainText("Moss · Spellcast Roll");
    await expect(result.locator(".hud-res-art img")).toBeVisible();
    await expect(result.getByTestId("hud-result-tag")).toHaveText(/^(Success|Failure) with (Hope|Fear)$|^Critical success$/);
    await expect(result.getByRole("img", { name: /^Hope die \d+$/ })).toBeVisible();
    await expect(result.getByRole("img", { name: /^Fear die \d+$/ })).toBeVisible();
    await expect(result.getByTestId("hud-result-total")).toHaveText(/^\d+$/);
    const row = result.getByTestId("hud-result-row").filter({ hasText: enemies.lieutenant.name });
    await expect(row).toContainText(/Hit|Miss|Defeated/);
    // A hit shows the player's own damage ("1d8+1 → 7 physical"); a miss shows none.
    if (/Hit|Defeated/.test((await row.textContent()) ?? "")) await expect(row.getByTestId("hud-result-row-damage")).toHaveText(/^1d8\+1( \+8 critical)? → \d+ physical$/);
    await expect(result).not.toContainText(NUMBERS);
    // Beside the hand, at the board's spot (Main `.res`: left 820, 440 wide).
    const box = (await result.boundingBox())!;
    expect(Math.round(box.x)).toBe(820);
    expect(Math.round(box.width)).toBe(440);
    await expectNoSeriousA11yViolations(player);

    // The GM's screen does not show the player's result (it is the player's own panel).
    await gm.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();
    await expect(gm.getByTestId("hud-result")).toHaveCount(0);

    // A new Use clears the last result: Esc on the new pick does not bring it back.
    await fanCard(player, "Unleash Chaos").hover();
    await fanCard(player, "Unleash Chaos").getByRole("button", { name: "Use Unleash Chaos" }).click();
    await expect(pickPanel(player)).toBeVisible();
    await player.keyboard.press("Escape");
    await expect(pickPanel(player)).toHaveCount(0);
    await expect(player.getByTestId("hud-result")).toHaveCount(0);
  } finally {
    await s.close();
  }
});

test("an attack's result through the action ring; on a phone the result is a bottom sheet", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { player, client, campaignId, enemies } = s;
  try {
    // The Bandit steps next to Moss, within any weapon's reach.
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: enemies.bandit.tokenId, x: 6, y: 10 });
    await player.setViewportSize({ width: 390, height: 844 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();

    await player
      .getByRole("region", { name: "Battle map" })
      .getByRole("button", { name: /^Moss \(your character\): actions/ })
      .click();
    const open = player.getByRole("toolbar", { name: "Your actions (Moss)" }).getByRole("button", { name: "Attack" });
    await expect(open).toBeEnabled({ timeout: 30_000 });
    await open.click();
    const panel = pickPanel(player);
    await expect(panel).toBeVisible();
    const weaponName = (await panel.getByTestId("hud-attack-weapon").first().locator("b").textContent())!;
    await pickRow(player, enemies.bandit.tokenId).click();
    await panel.getByTestId("hud-pick-go").click();
    await expect(panel).toHaveCount(0);

    const result = player.getByTestId("hud-result");
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toHaveAttribute("data-kind", "attack");
    await expect(result.getByRole("heading", { name: weaponName, level: 2 })).toBeVisible();
    await expect(result).toContainText("Moss · Attack Roll");
    await expect(result.getByTestId("hud-result-row").filter({ hasText: enemies.bandit.name })).toContainText(/Hit|Miss|Defeated/);
    await expect(result).not.toContainText(NUMBERS);
    // A bottom sheet: full width, on the bottom edge.
    const box = (await result.boundingBox())!;
    expect(Math.round(box.x)).toBe(0);
    expect(Math.round(box.width)).toBe(390);
    expect(Math.round(box.y + box.height)).toBeLessThanOrEqual(844);
    await expectNoSeriousA11yViolations(player);

    await result.getByRole("button", { name: `Close the result of ${weaponName}` }).click();
    await expect(result).toHaveCount(0);
  } finally {
    await s.close();
  }
});

/**
 * dcm-bxp.99.32.25: opens a held attack for Moss on `targetTokenId` with fixed dice (Hope 7, Fear 3: "with Hope") and one
 * after-roll option (Favor instead of Hope, HF p.14: Moss doesn't hold it, so only Pass is answered here). The seed runs
 * on the worktree's local e2e backend (`E2E_CONVEX_PORT`), as the forced-attack seed in hud-attack-pick.spec.ts does.
 */
function seedHeldAttack(characterId: string, targetTokenId: string) {
  execFileSync(
    process.execPath,
    ["scripts/convex-e2e.mjs", "run", "combatRequests:seedHeldAttackForE2e", JSON.stringify({ characterId, targetTokenId, hope: 7, fear: 3, options: [{ featureId: "class:warlock:favor", useId: "main" }] })],
    { stdio: "pipe" },
  );
}

test("your roll waits: a held attack shows its fixed dice and the after-roll option; Pass rolls the damage and shows the result", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { player, client, campaignId, enemies } = s;
  try {
    const moss = s.pcs.find((p) => p.name === "Moss")!;
    seedHeldAttack(moss.characterId, enemies.bandit.tokenId);
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();

    const held = player.getByTestId("hud-result-held");
    await expect(held).toContainText("Your roll waits", { timeout: 30_000 });
    await expect(held).toContainText(/Moss · \d+ with Hope · before damage/);
    await expect(held.getByRole("img", { name: "Hope die 7" })).toBeVisible();
    await expect(held.getByRole("img", { name: "Fear die 3" })).toBeVisible();
    await expect(held.getByTestId("hud-result-row").filter({ hasText: enemies.bandit.name })).toContainText(/Hit|Miss/);
    await expect(held.getByRole("radiogroup", { name: "Feature to use" })).toContainText("Favor instead of Hope");
    await expect(held).not.toContainText(NUMBERS);
    await expectNoSeriousA11yViolations(player);

    await held.getByRole("button", { name: "Pass" }).click();
    await expect(held).toHaveCount(0);
    const result = player.getByTestId("hud-result");
    await expect(result).toBeVisible({ timeout: 30_000 });
    await expect(result).toHaveAttribute("data-kind", "attack");
    await expect(result.getByTestId("hud-result-row").filter({ hasText: enemies.bandit.name })).toContainText(/Hit|Miss|Defeated/);
    await expect(result).not.toContainText(NUMBERS);
    // The request is answered: nothing waits any more.
    expect((await client.query(api.combatRequestsReads.mine, { campaignId })).filter((r) => r.kind === "afterRoll")).toEqual([]);
  } finally {
    await s.close();
  }
});
