import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene, type HudScene } from "./hud/helpers";

// Plan combat-hud H5.1 (docs/tasks/TASK-HUD-H5.1.md; GMDesktop 'Requests', CmpPromptsGM): with the HUD on, everything
// that waits on the GM lands in one "Waiting on you" queue bottom-left, above the GM's spotlight panel and clear of the
// party banners; Resolutions with Undo sit under it. Live, two browsers: the player's out-of-range attack and card land
// in the queue; the player withdraws the card (it disappears), the GM allows the attack (it resolves, the player's wait
// ends, the hit shows in Resolutions and Undo undoes it). A Brute's hit opens 'Reactions' with Resolve now.

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

/** A plain attack roll: no modifier, Experience, advantage or option. */
const ROLL = { modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, options: [] };

function queueOf(gm: Page) {
  return gm.getByTestId("hud-queue");
}

/** Moss (the player's) attacks and uses Vicious Entangle (Far) on the Sniper (Very Far): both wait on the GM. */
async function outOfRangeUses(s: HudScene) {
  const { playerClient, campaignId, mapId, enemies } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  const attack = await playerClient.mutation(api.combatActions.attack, {
    campaignId,
    characterId: moss.characterId,
    mapId,
    targetTokenIds: [enemies.sniper.tokenId],
    slot: "primary",
    ...ROLL,
    idempotencyKey: crypto.randomUUID(),
  });
  expect(attack.status).toBe("pending");
  const card = await playerClient.mutation(api.combatCards.useCard, {
    campaignId,
    characterId: moss.characterId,
    mapId,
    cardId: s.farCardId,
    spell: "main",
    targetTokenIds: [enemies.sniper.tokenId],
    choices: [],
    idempotencyKey: crypto.randomUUID(),
  });
  expect(card.status).toBe("pending");
}

test("live: out-of-range uses land in the queue; a withdrawn one disappears, an allowed one resolves with Undo", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player, enemies } = s;
  try {
    for (const page of [gm, player]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(s.url);
      await expect(page.getByTestId("combat-hud")).toBeVisible();
    }
    const queue = queueOf(gm);
    await expect(queue).toBeVisible();
    await expect(queue.getByRole("heading", { name: /Waiting on you/ })).toBeVisible();
    await expect(gm.getByTestId("hud-queue-count")).toHaveText("0");
    await expect(queue).toContainText("Nothing is waiting on you.");
    await expect(player.getByTestId("hud-queue")).toHaveCount(0);

    await outOfRangeUses(s);
    const cards = queue.getByTestId("hud-queue-range");
    await expect(cards).toHaveCount(2, { timeout: 30_000 });
    await expect(gm.getByTestId("hud-queue-count")).toHaveText("2");
    await expect(cards.nth(0)).toContainText("Out of range: your call");
    await expect(cards.nth(0)).toContainText(`Moss · Attack on ${enemies.sniper.name} (Very Far)`);
    await expect(cards.nth(1)).toContainText("Moss · Vicious Entangle");
    await expect(cards.nth(0)).toContainText("Nothing is rolled or paid until you decide.");
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=hud-queue-column]" });

    // Placement: bottom-left, clear of the banners above; the GM's spotlight panel sits top middle (user 2026-11-03).
    const column = gm.getByTestId("hud-queue-column");
    const box = (await column.boundingBox())!;
    expect(box.x).toBeLessThan(40);
    const bannerBottoms = await gm.locator("[data-testid^=hud-banner-]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().bottom));
    expect(box.y).toBeGreaterThanOrEqual(Math.max(...bannerBottoms));
    const spot = gm.getByTestId("hud-spotlight-menu");
    if ((await spot.count()) > 0) {
      const sb = (await spot.boundingBox())!;
      expect(sb.x).toBeGreaterThan(box.x + box.width);
      expect(sb.y).toBeLessThan(450);
    }
    await gm.screenshot({ path: `${OUT}/requests-1440.png`, animations: "disabled" });

    // The player withdraws the card: it disappears from the GM's queue, live.
    const waits = player.getByTestId("hud-pick-wait");
    await expect(waits).toHaveCount(2, { timeout: 30_000 });
    await player.getByRole("button", { name: "Withdraw Vicious Entangle" }).click();
    await expect(cards).toHaveCount(1, { timeout: 30_000 });
    await expect(gm.getByTestId("hud-queue-count")).toHaveText("1");
    await expect(queue).not.toContainText("Vicious Entangle");

    // The GM allows the attack: it resolves; the player's wait ends; the hit is in Resolutions with Undo.
    await queue.getByRole("button", { name: "Allow: Moss · Attack" }).click();
    await expect(cards).toHaveCount(0);
    await expect(gm.getByTestId("hud-queue-result")).toHaveText("Allowed: Moss · Attack.", { timeout: 30_000 });
    await expect(waits).toHaveCount(0, { timeout: 30_000 });
    const resolutions = gm.getByTestId("hud-resolution");
    await expect(resolutions).toHaveCount(1, { timeout: 30_000 });
    await expect(resolutions.first()).toContainText("Moss");
    await gm.screenshot({ path: `${OUT}/resolutions-1440.png`, animations: "disabled" });
    await resolutions.first().getByRole("button", { name: /^Undo: / }).click();
    await expect(resolutions.first()).toHaveClass(/hud-res-undone/, { timeout: 30_000 });
    await expect(resolutions.first()).toContainText("undone");
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=hud-queue-column]" });
  } finally {
    await s.close();
  }
});

test("Reactions: an adversary's hit waits on the player; Resolve now settles it", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, client, campaignId } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  try {
    const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: BRUTE, idempotencyKey: crypto.randomUUID() });
    const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId: s.encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
    const instanceId = instanceIds[0]! as Id<"encounterAdversaries">;
    await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId: s.mapId, instanceIds: [instanceId], idempotencyKey: crypto.randomUUID() });
    const token = (await client.query(api.combatTokens.list, { campaignId, mapId: s.mapId })).find((t) => t.instanceId === instanceId)!;
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: token._id, x: 6, y: 10 });

    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible();

    let res = await client.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [moss.characterId], idempotencyKey: crypto.randomUUID() });
    if (res.status === "confirmFear") {
      res = await client.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [moss.characterId], spendFear: res.fear, idempotencyKey: crypto.randomUUID() });
    }
    expect(res.status).toBe("resolved");

    const card = queueOf(gm).getByTestId("hud-queue-reactions");
    await expect(card).toBeVisible({ timeout: 30_000 });
    await expect(card).toContainText("Reactions");
    await expect(card).toContainText("After Brute’s attack");
    await expect(card).toContainText("Waiting on Moss");
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=hud-queue-column]" });
    await card.screenshot({ path: `${OUT}/reactions-card.png`, animations: "disabled" });

    await card.getByRole("button", { name: /^Resolve now/ }).click();
    await expect(card).toHaveCount(0);
    await expect(gm.getByTestId("hud-queue-result")).toContainText("Resolved", { timeout: 30_000 });
    // The Brute's attack is in Resolutions with Undo.
    await expect(gm.getByTestId("hud-resolution").first()).toContainText("Brute", { timeout: 30_000 });
    await expect.poll(async () => (await client.query(api.adversaryActions.windows, { campaignId })).length).toBe(0);
  } finally {
    await s.close();
  }
});
