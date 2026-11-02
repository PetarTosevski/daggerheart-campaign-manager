import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { hudScene } from "../hud/helpers";

// Shots for docs/tasks/TASK-HUD-H5.1.md (E2E_VISUAL=1): GMDesktop 'Requests' on the seed's real party at 1440 × 900 —
// "Waiting on you" with the player's out-of-range attack and card, a Brute's hit waiting on Brannoc ('Reactions'), and
// Moss's death move to confirm; then Resolutions with Undo after Resolve now. Board render to compare:
// reference/designs/combat-hud/preview/GMDesktop.dc.html (state "Requests") and CmpPromptsGM.dc.html.

const OUT = "test-results/visual/HUD-H5.1";

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
  attack: { modifier: 20, name: "Club", range: "Melee", damage: "1d4+2 phy" },
  experiences: [],
  features: [],
};

test("HUD-H5.1 the GM's request queue and Resolutions at desktop", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, client, playerClient, campaignId, mapId, enemies } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  const brannoc = s.pcs.find((p) => p.name === "Brannoc")!;
  try {
    const base = { campaignId, characterId: moss.characterId, mapId, targetTokenIds: [enemies.sniper.tokenId] };
    await playerClient.mutation(api.combatActions.attack, { ...base, slot: "primary", modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [], idempotencyKey: crypto.randomUUID() });
    await playerClient.mutation(api.combatCards.useCard, { ...base, cardId: s.farCardId, spell: "main", choices: [], idempotencyKey: crypto.randomUUID() });

    const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: BRUTE, idempotencyKey: crypto.randomUUID() });
    const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId: s.encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
    const instanceId = instanceIds[0]!;
    await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds: [instanceId], idempotencyKey: crypto.randomUUID() });
    const token = (await client.query(api.combatTokens.list, { campaignId, mapId })).find((t) => t.instanceId === instanceId)!;
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: token._id, x: 9, y: 9 });
    let res = await client.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [brannoc.characterId], idempotencyKey: crypto.randomUUID() });
    if (res.status === "confirmFear") {
      res = await client.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [brannoc.characterId], spendFear: res.fear, idempotencyKey: crypto.randomUUID() });
    }
    expect(res.status).toBe("resolved");

    const party = await client.query(api.combatHud.party, { campaignId, mapId });
    const me = party.find((m) => m.characterId === moss.characterId)!;
    await client.mutation(api.characters.adjustResource, { characterId: moss.characterId, resource: "hp", delta: me.hp.max - me.hp.marked });
    await playerClient.mutation(api.deathMoves.choose, { characterId: moss.characterId, move: "avoidDeath", idempotencyKey: crypto.randomUUID() });

    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    const queue = gm.getByTestId("hud-queue");
    await expect(gm.getByTestId("hud-queue-count")).toHaveText("4", { timeout: 30_000 });
    await gm.waitForTimeout(500);
    await gm.screenshot({ path: `${OUT}/requests-full-1440.png`, animations: "disabled" });
    await gm.getByTestId("hud-queue-column").screenshot({ path: `${OUT}/queue-column.png`, animations: "disabled" });

    await queue.getByTestId("hud-queue-reactions").getByRole("button", { name: /^Resolve now/ }).click();
    await expect(gm.getByTestId("hud-resolution").first()).toBeVisible({ timeout: 30_000 });
    await gm.waitForTimeout(300);
    await gm.getByTestId("hud-queue-column").screenshot({ path: `${OUT}/queue-and-resolutions.png`, animations: "disabled" });
  } finally {
    await s.close();
  }
});
