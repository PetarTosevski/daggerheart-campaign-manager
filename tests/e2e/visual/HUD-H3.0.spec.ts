import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { hudScene } from "../hud/helpers";

// Shots for docs/tasks/TASK-HUD-H3.0.md (E2E_VISUAL=1): the picking panel and the target rings on the seed's real scene
// (CmpPicking 'One target', Main 'Picking a target', CmpTokens 'Target rings'), "Waiting for the GM" with Withdraw
// (CmpPromptsPlayer), at the boards' sizes (1440 × 900, 1024 × 768, 390 × 844). The Bandit steps next to Moss so one
// row is in reach; the Lieutenant (Far, Vulnerable) and the Sniper (Very Far) are out. Board renders to compare:
// reference/designs/combat-hud/preview/{CmpPicking,Main,CmpTokens,CmpPromptsPlayer}.dc.html.

const OUT = "test-results/visual/HUD-H3.0";

test("HUD-H3.0 the picking panel, target rings and Waiting for the GM", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { player, client, campaignId, enemies } = s;
  try {
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: enemies.bandit.tokenId, x: 6, y: 10 });
    const tokens = await client.query(api.combatTokens.list, { campaignId, mapId: s.mapId });
    const lt = tokens.find((t) => t._id === enemies.lieutenant.tokenId)!.instanceId!;
    await client.mutation(api.encounterTracking.toggleCondition, { campaignId, instanceId: lt, condition: "vulnerable", idempotencyKey: crypto.randomUUID() });

    for (const [w, h] of [
      [1440, 900],
      [1024, 768],
      [390, 844],
    ] as const) {
      await player.setViewportSize({ width: w, height: h });
      await player.goto(s.url);
      await expect(player.getByTestId("combat-hud")).toBeVisible();
      // The action ring's Attack (H3.4): a click on Moss opens the ring.
      await player
        .getByRole("region", { name: "Battle map" })
        .getByRole("button", { name: /^Open Moss’s sheet \(your character\)/ })
        .click();
      const attack = player.getByRole("toolbar", { name: "Your actions (Moss)" }).getByRole("button", { name: "Attack" });
      await expect(attack).toBeEnabled({ timeout: 30_000 });
      await attack.click();
      const panel = player.getByTestId("hud-pick");
      await expect(panel).toBeVisible();
      await panel.locator(`[data-testid="hud-pick-row"][data-token="${enemies.lieutenant.tokenId}"]`).click();
      await player.waitForTimeout(300);
      await player.screenshot({ path: `${OUT}/player-picking-${w}.png`, animations: "disabled" });
      if (w === 1440) {
        await panel.screenshot({ path: `${OUT}/player-panel.png`, animations: "disabled" });
        // The rings close up: picked out of range (amber, GM), in (dashed gold), out (amber, GM).
        await player.locator(".hud-map").screenshot({ path: `${OUT}/player-rings-1440.png`, animations: "disabled" });
        await panel.getByTestId("hud-pick-go").click();
        const wait = player.getByTestId("hud-pick-wait");
        await expect(wait).toBeVisible();
        await player.screenshot({ path: `${OUT}/player-waiting-1440.png`, animations: "disabled" });
        await wait.screenshot({ path: `${OUT}/player-waiting-card.png`, animations: "disabled" });
        await wait.getByRole("button", { name: /^Withdraw/ }).click();
        await expect(wait).toHaveCount(0);
      } else {
        await player.keyboard.press("Escape");
      }
    }
  } finally {
    await s.close();
  }
});
