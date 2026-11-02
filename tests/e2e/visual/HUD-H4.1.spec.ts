import { expect, test, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { hudScene, type HudScene } from "../hud/helpers";

// Shots for docs/tasks/TASK-HUD-H4.1.md (E2E_VISUAL=1): the result panel on the seed's real scene (Main 'Card result'):
// Moss casts Vicious Entangle at the Lieutenant (1440 × 900, 1024 × 768), the panel close up, the panel beside an open
// sheet (make-room), and a weapon attack's result (1440 × 900, 390 × 844 as a bottom sheet). Board render to compare:
// reference/designs/combat-hud/preview/Main.dc.html (Preview: Card result). 'Your roll waits' and 'After the roll' have no
// seedable trigger in the e2e scene (unit-tested in tests/unit/hud/result-panel.test.tsx).

const OUT = "test-results/visual/HUD-H4.1";

const hand = (page: Page) => page.getByTestId("hud-hand");
const fanCard = (page: Page, name: string) => hand(page).getByTestId("hud-hand-card").filter({ has: page.getByRole("heading", { name, exact: true }) });

async function cast(s: HudScene) {
  const { player, enemies } = s;
  await expect(hand(player)).toHaveAttribute("data-mode", "own", { timeout: 30_000 });
  await fanCard(player, "Vicious Entangle").hover();
  await fanCard(player, "Vicious Entangle").getByRole("button", { name: "Use Vicious Entangle" }).click();
  const panel = player.getByTestId("hud-pick");
  await expect(panel).toBeVisible();
  await panel.locator(`[data-testid="hud-pick-row"][data-token="${enemies.lieutenant.tokenId}"]`).click();
  await panel.getByTestId("hud-pick-go").click();
  await expect(player.getByTestId("hud-result")).toBeVisible({ timeout: 30_000 });
  await player.mouse.move(1, 1);
  await player.waitForTimeout(400);
}

test("HUD-H4.1 the result panel", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(400_000);
  const s = await hudScene(browser);
  const { player, client, campaignId, enemies } = s;
  try {
    for (const [w, h] of [
      [1440, 900],
      [1024, 768],
    ] as const) {
      // Hope back each round so the card stays playable.
      await client.mutation(api.characters.adjustResource, { characterId: s.characterId, resource: "hope", delta: 2 }).catch(() => undefined);
      await player.setViewportSize({ width: w, height: h });
      await player.goto(s.url);
      await expect(player.getByTestId("combat-hud")).toBeVisible();
      await cast(s);
      await player.screenshot({ path: `${OUT}/player-card-result-${w}.png`, animations: "disabled" });
      if (w === 1440) {
        await player.getByTestId("hud-result").screenshot({ path: `${OUT}/player-card-result-panel.png`, animations: "disabled" });
        // Beside an open sheet: the panel moves left with the make-room shift.
        await player.getByRole("button", { name: /^Open Moss’s sheet/ }).first().click();
        await player.waitForTimeout(600);
        await player.screenshot({ path: `${OUT}/player-card-result-sheet-1440.png`, animations: "disabled" });
      }
    }

    // A weapon attack's result (the Bandit steps next to Moss).
    // On a phone (390 × 844: a bottom sheet) too; the phone hand is H7.x's, so the phone shot is the attack's.
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: enemies.bandit.tokenId, x: 6, y: 10 });
    for (const [w, h] of [
      [1440, 900],
      [390, 844],
    ] as const) {
      await player.setViewportSize({ width: w, height: h });
      await player.goto(s.url);
      await expect(player.getByTestId("combat-hud")).toBeVisible();
      await player
        .getByRole("region", { name: "Battle map" })
        .getByRole("button", { name: /^Open Moss’s sheet \(your character\)/ })
        .click();
      const attack = player.getByRole("toolbar", { name: "Your actions (Moss)" }).getByRole("button", { name: "Attack" });
      await expect(attack).toBeEnabled({ timeout: 30_000 });
      await attack.click();
      const panel = player.getByTestId("hud-pick");
      await panel.locator(`[data-testid="hud-pick-row"][data-token="${enemies.bandit.tokenId}"]`).click();
      await panel.getByTestId("hud-pick-go").click();
      await expect(player.getByTestId("hud-result")).toBeVisible({ timeout: 30_000 });
      await player.waitForTimeout(400);
      await player.screenshot({ path: `${OUT}/player-attack-result-${w}.png`, animations: "disabled" });
      if (w === 1440) await player.getByTestId("hud-result").screenshot({ path: `${OUT}/player-attack-result-panel.png`, animations: "disabled" });
    }
  } finally {
    await s.close();
  }
});
