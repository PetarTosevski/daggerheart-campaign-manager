import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { hudScene } from "../hud/helpers";

// Shots for docs/tasks/TASK-HUD-H4.2.md (E2E_VISUAL=1): Main 'You're hit' on the seed's real party. A custom Brute
// (always hits) stands next to Moss and hits; the window beside Moss's token at 1440 × 900, 1024 × 768 and as the
// phone's bottom sheet at 390 × 844. Board render to compare: reference/designs/combat-hud/preview/Main.dc.html (state
// "You're hit").

const OUT = "test-results/visual/HUD-H4.2";

const BRUTE = {
  name: "Brute",
  tier: 1,
  type: "Standard" as const,
  description: "A road thug.",
  motives: "Rob",
  difficulty: 10,
  thresholds: { major: 5, severe: 10 },
  hp: 5,
  stress: 3,
  attack: { modifier: 20, name: "Club", range: "Melee", damage: "1d4+6 phy" },
  experiences: [],
  features: [],
};

test("HUD-H4.2 the hit window at desktop, tablet and phone", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { player, client, campaignId } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: BRUTE, idempotencyKey: crypto.randomUUID() });
    const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId: s.encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
    const instanceId = instanceIds[0]!;
    await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId: s.mapId, instanceIds: [instanceId], idempotencyKey: crypto.randomUUID() });
    const token = (await client.query(api.combatTokens.list, { campaignId, mapId: s.mapId })).find((t) => t.instanceId === instanceId)!;
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: token._id, x: 6, y: 10 });
    await client.mutation(api.characters.adjustResource, { characterId: moss.characterId, resource: "hp", delta: 2 });

    let res = await client.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [moss.characterId], idempotencyKey: crypto.randomUUID() });
    if (res.status === "confirmFear") {
      res = await client.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [moss.characterId], spendFear: res.fear, idempotencyKey: crypto.randomUUID() });
    }
    expect(res.status).toBe("resolved");

    for (const [w, h] of [
      [1440, 900],
      [1024, 768],
      [390, 844],
    ] as const) {
      await player.setViewportSize({ width: w, height: h });
      await player.goto(s.url);
      const win = player.getByRole("dialog", { name: "You were hit" });
      await expect(win).toBeVisible({ timeout: 30_000 });
      await player.waitForTimeout(500);
      await player.screenshot({ path: `${OUT}/youre-hit-${w}.png`, animations: "disabled" });
      await win.screenshot({ path: `${OUT}/youre-hit-window-${w}.png`, animations: "disabled" });
    }
  } finally {
    await s.close();
  }
});
