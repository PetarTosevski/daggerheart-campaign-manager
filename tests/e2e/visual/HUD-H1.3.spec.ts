import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { hudScene } from "../hud/helpers";

// Shots for docs/tasks/TASK-HUD-H1.3.md (E2E_VISUAL=1): the HUD token faces on the real seed, GM (adversaries with
// arcs) and player (adversaries without), at the boards' sizes. Board counterparts: CmpTokens "Token anatomy" /
// "Token kinds", Main and GMDesktop at 1440 × 900 (reference/designs/combat-hud/preview/*.dc.html).

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

test("HUD H1.3 token rings, Hope chips, badges and side colours at 1440, 1024 and 390", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { client, campaignId, gm, player } = s;
  try {
    const moss = s.pcs.find((p) => p.name === "Moss")!;
    const brannoc = s.pcs.find((p) => p.name === "Brannoc")!;
    await client.mutation(api.characters.adjustResource, { characterId: moss.characterId, resource: "hp", delta: 2 });
    await client.mutation(api.characters.adjustResource, { characterId: moss.characterId, resource: "stress", delta: 3 });
    await client.mutation(api.characters.adjustResource, { characterId: brannoc.characterId, resource: "stress", delta: 1 });
    await client.mutation(api.characters.toggleCondition, { characterId: brannoc.characterId, condition: "hidden" });
    const tokens = await client.query(api.combatTokens.list, { campaignId, mapId: s.mapId });
    const lt = tokens.find((t) => t._id === s.enemies.lieutenant.tokenId)!.instanceId!;
    const key = () => crypto.randomUUID();
    await client.mutation(api.encounterTracking.markHp, { campaignId, instanceId: lt, delta: 2, idempotencyKey: key() });
    await client.mutation(api.encounterTracking.markStress, { campaignId, instanceId: lt, delta: 1, idempotencyKey: key() });
    await client.mutation(api.encounterTracking.toggleCondition, { campaignId, instanceId: lt, condition: "vulnerable", idempotencyKey: key() });

    for (const [who, page] of [
      ["gm", gm],
      ["player", player],
    ] as const) {
      await page.setViewportSize(VIEWPORTS[0]);
      await page.goto(s.url);
      const board = page.getByRole("region", { name: "Battle map" });
      await expect(board.locator(".hud-tk").first()).toBeVisible();
      await expect(board.getByTestId("hud-token-hope").first()).toBeVisible();
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.getByTestId("combat-hud").scrollIntoViewIfNeeded();
        await page.screenshot({ path: `test-results/visual/HUD-H1.3/${who}-tokens-${viewport.width}.png`, animations: "disabled" });
      }
      // A close-up of the party and the Lieutenant (the board's "Token kinds" row).
      await page.setViewportSize(VIEWPORTS[0]);
      const mossToken = board.locator(`[data-token="${moss.tokenId}"]`);
      const box = await mossToken.boundingBox();
      if (box) {
        await page.screenshot({
          path: `test-results/visual/HUD-H1.3/${who}-closeup-1440.png`,
          clip: { x: Math.max(0, box.x - 120), y: Math.max(0, box.y - 260), width: 720, height: 420 },
          animations: "disabled",
        });
      }
    }
  } finally {
    await s.close();
  }
});
