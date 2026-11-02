import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { hudScene } from "../hud/helpers";

// Shots for docs/tasks/TASK-HUD-H5.2.md (E2E_VISUAL=1): GMDesktop 'Adversary acting' at 1440 × 900 on the seed's real
// scene, set to the board's marks (the Lieutenant 2 HP / 1 Stress marked, Vulnerable): the stat block, the purple
// picking panel with its rings, and the Fear question; a tablet look at 1024 × 768. Board render to compare:
// reference/designs/combat-hud/preview/GMDesktop.dc.html (state 'Adversary acting', click the Lieutenant).

const OUT = "test-results/visual/HUD-H5.2";

test("HUD-H5.2 the adversary stat block and the GM attack picker", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, client, campaignId } = s;
  try {
    const tokens = await client.query(api.combatTokens.list, { campaignId, mapId: s.mapId });
    const lt = tokens.find((t) => t._id === s.enemies.lieutenant.tokenId)!.instanceId!;
    const key = () => crypto.randomUUID();
    await client.mutation(api.encounterTracking.markHp, { campaignId, instanceId: lt, delta: 2, idempotencyKey: key() });
    await client.mutation(api.encounterTracking.markStress, { campaignId, instanceId: lt, delta: 1, idempotencyKey: key() });
    await client.mutation(api.encounterTracking.toggleCondition, { campaignId, instanceId: lt, condition: "vulnerable", idempotencyKey: key() });
    await client.mutation(api.fear.set, { campaignId, value: 5, idempotencyKey: key() });

    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    const name = s.enemies.lieutenant.name;
    await gm.getByRole("region", { name: "Battle map" }).getByRole("button", { name: new RegExp(`^Open the ${name}’s stat block`) }).click();
    const block = gm.getByRole("complementary", { name: `${name}’s stat block` });
    await expect(block.getByTestId("hud-statblock-body")).toBeVisible();
    await gm.waitForTimeout(700);
    await gm.screenshot({ path: `${OUT}/gm-statblock-1440.png`, animations: "disabled" });
    await block.screenshot({ path: `${OUT}/gm-statblock-panel.png`, animations: "disabled" });

    await block.getByTestId("hud-statblock-attack").click();
    const panel = gm.getByTestId("hud-pick");
    await panel.getByTestId("hud-pick-row").filter({ hasText: "Brannoc" }).click();
    await gm.waitForTimeout(300);
    await gm.screenshot({ path: `${OUT}/gm-adversary-acting-1440.png`, animations: "disabled" });
    await panel.screenshot({ path: `${OUT}/gm-picker-panel.png`, animations: "disabled" });

    await panel.getByRole("switch", { name: /Use Local Knowledge/ }).click();
    await panel.getByTestId("hud-pick-go").click();
    await expect(gm.getByTestId("hud-fear-confirm")).toBeVisible();
    await gm.screenshot({ path: `${OUT}/gm-spend-fear-1440.png`, animations: "disabled" });
    await gm.getByTestId("hud-fear-confirm").getByRole("button", { name: "Cancel" }).click();

    await gm.setViewportSize({ width: 1024, height: 768 });
    await gm.waitForTimeout(500);
    await gm.screenshot({ path: `${OUT}/gm-adversary-acting-1024.png`, animations: "disabled" });
  } finally {
    await s.close();
  }
});
