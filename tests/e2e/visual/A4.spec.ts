import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { openAdversaries, visual } from "./helpers";

// A4 (D8): the live encounter tracker at 1440 and 390: the top bar, instance cards (fresh, damaged, defeated), a
// Minion group and the whole tracker. The board has no tracker (analysis section 1); these are judged against the
// Adversaries board's tokens (pips, chips, parchment) in docs/tasks/TASK-D8-A4.md. TR1 (docs/tasks/TASK-TR1.md): the top
// bar's Fear is the dashboard's token art (5 of 12 lit), the cards show Thresholds beside Difficulty and the player
// sheet's HP hearts / Stress diamonds.

test("A4 encounter tracker: top bar, cards, Minion group and page at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { client, campaignId } = await openAdversaries(page);
  const key = () => crypto.randomUUID();
  await client.mutation(api.fear.set, { campaignId, value: 5, idempotencyKey: key() });
  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Den of the bear", pcs: 4, idempotencyKey: key() });
  const add = async (adversaryId: string, count: number) =>
    (await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "srd", adversaryId }, count, summoned: false, idempotencyKey: key() }))
      .instanceIds;
  const [fresh, damaged, defeated] = await add("bear", 3);
  const [group] = await add("jagged-knife-lackey", 6);
  await client.mutation(api.encounters.start, { campaignId, encounterId });
  await client.mutation(api.encounterTracking.applyDamage, { campaignId, instanceId: damaged!, amount: 9, resistant: false, idempotencyKey: key() });
  await client.mutation(api.encounterTracking.markStress, { campaignId, instanceId: damaged!, delta: 2, idempotencyKey: key() });
  await client.mutation(api.encounterTracking.toggleCondition, { campaignId, instanceId: damaged!, condition: "restrained", idempotencyKey: key() });
  await client.mutation(api.encounterTracking.setTags, { campaignId, instanceId: damaged!, tags: ["Cursed"], idempotencyKey: key() });
  await client.mutation(api.encounterTracking.spotlight, { campaignId, instanceId: damaged!, idempotencyKey: key() });
  await client.mutation(api.encounterTracking.markHp, { campaignId, instanceId: defeated!, delta: 7, idempotencyKey: key() });
  await client.mutation(api.encounterTracking.defeatMinions, { campaignId, instanceId: group!, count: 2, idempotencyKey: key() });
  expect(fresh).toBeDefined();

  await page.getByRole("tab", { name: "Encounters" }).click();
  const tracker = page.getByRole("tabpanel", { name: "Encounters" }).getByRole("region", { name: "Encounter tracker" });
  await expect(tracker.getByRole("heading", { name: "Den of the bear" })).toBeVisible();
  const { shoot } = visual(page, "A4");
  await expect(tracker.locator(".trk-token-on")).toHaveCount(5);
  await expect(tracker.getByRole("article", { name: "Bear 2", exact: true }).getByTestId("thresholds")).toHaveText("Thresholds 9 / 17");
  await expect(tracker.getByRole("article", { name: "Jagged Knife Lackey", exact: true }).getByTestId("thresholds")).toHaveText("Thresholds Minion");

  await shoot(tracker.locator(".trk-top"), "top-bar");
  await shoot(tracker.getByRole("article", { name: "Bear", exact: true }), "card-fresh");
  await shoot(tracker.getByRole("article", { name: "Bear 2", exact: true }), "card-damaged");
  await shoot(tracker.getByRole("article", { name: "Bear 3", exact: true }), "card-defeated");
  await shoot(tracker.getByRole("article", { name: "Jagged Knife Lackey", exact: true }), "minion-group");
  await shoot(tracker.getByRole("complementary", { name: "Selected adversary" }), "statblock");
  await shoot(tracker, "page");
});
