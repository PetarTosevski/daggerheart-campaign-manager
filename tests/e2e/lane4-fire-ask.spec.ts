import { expect, test, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "./a11y";
import { bardDraft, openCombatMap } from "./visual/helpers";

// Plan lanes-2, tracer E2.4 (dcm-sk4r; user answer 2026-10-31: "Fireproof on an untyped hit: the GM decides whether the
// hit is fire"). A custom Bandit (no data on its damage) hits Ember, an Emberkin (Fireproof, HF p.22: "You are immune to
// damage from magical or mundane flame"). The GM's HUD queue ("Waiting on you"; plan combat-hud H8.2 removed the classic
// "Hit questions" card) asks "Was this hit fire?" (Ember is Fireproof).
// Yes: the hit marks nothing once Ember answered; No: it marks HP as usual.

/** A Bandit that always hits (ATK +20) for 11-14 physical damage; a custom block, so its damage carries no known keyword. */
const BRUTE_BANDIT = {
  name: "Bandit",
  tier: 1,
  type: "Standard" as const,
  description: "A road thug.",
  motives: "Rob",
  difficulty: 10,
  thresholds: { major: 5, severe: 10 },
  hp: 5,
  stress: 3,
  attack: { modifier: 20, name: "Torch", range: "Melee", damage: "1d4+10 phy" },
  experiences: [],
  features: [],
};

async function setUp(page: Page) {
  const { client: gm, campaignId, url } = await openCombatMap(page);
  await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });
  const draft = { ...bardDraft("Ember"), ancestry: { kind: "single" as const, id: "emberkin" } };
  const { characterId } = await gm.mutation(api.characters.create, { campaignId, draft, idempotencyKey: crypto.randomUUID() });
  const { customId } = await gm.mutation(api.customAdversaries.create, { campaignId, adversary: BRUTE_BANDIT, idempotencyKey: crypto.randomUUID() });
  const { encounterId } = await gm.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
  const { instanceIds } = await gm.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
  await gm.mutation(api.encounters.start, { campaignId, encounterId });
  const { mapId } = await gm.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
  await gm.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
  await gm.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: crypto.randomUUID() });
  const tokens = await gm.query(api.combatTokensReads.list, { campaignId, mapId });
  await gm.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.characterId === characterId)!._id, x: 6, y: 10 });
  await gm.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.instanceId === instanceIds[0])!._id, x: 7, y: 10 });
  return { gm, campaignId, url, ember: characterId, bandit: instanceIds[0]! };
}

/** The Bandit attacks Ember (paying the Fear the server asks for). Returns the hit's request id. */
async function attack(gm: ConvexHttpClient, campaignId: Id<"campaigns">, instanceId: Id<"encounterAdversaries">, target: Id<"characters">) {
  let res = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [target], idempotencyKey: crypto.randomUUID() });
  if (res.status === "confirmFear") res = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [target], spendFear: res.fear, idempotencyKey: crypto.randomUUID() });
  if (res.status !== "resolved") throw new Error("attack not resolved");
  return res.targets[0]!.requestId!;
}

const sheetOf = async (gm: ConvexHttpClient, id: Id<"characters">) => (await gm.query(api.charactersReads.get, { characterId: id }))!.sheet;

for (const carries of [true, false]) {
  test(`the GM answers "Was this hit fire?" with ${carries ? "Yes" : "No"}`, async ({ page }) => {
    test.setTimeout(240_000);
    const s = await setUp(page);
    await page.goto(s.url);
    await expect(page.getByRole("region", { name: "Battle map" })).toBeVisible({ timeout: 30_000 });
    const requestId = await attack(s.gm, s.campaignId, s.bandit, s.ember);

    // The queue opens from "Waiting on you" (closed by default, plan combat-hud H9.2).
    const waiting = page.getByRole("button", { name: /^Waiting on you/ });
    if ((await waiting.getAttribute("aria-expanded")) !== "true") await waiting.click();
    const ask = page.getByTestId("hud-queue").getByTestId("hud-queue-keyword");
    await expect(ask).toBeVisible({ timeout: 30_000 });
    await expect(ask.getByRole("heading")).toHaveText(/Was this hit fire\?/);
    await expect(ask).toContainText(/Ember is Fireproof/);
    await expect(ask).toContainText(/Bandit hit Ember for \d+\./);
    await expectNoSeriousA11yViolations(page, { include: "[data-testid=hud-queue]" });

    // Ember (the GM's own PC here) answers the armor question; the ask still holds the hit.
    const answered = await s.gm.mutation(api.adversaryActions.respond, { campaignId: s.campaignId, requestId, characterId: s.ember, choice: { kind: "noArmor" }, idempotencyKey: crypto.randomUUID() });
    expect(answered.status).toBe("open");
    expect((await sheetOf(s.gm, s.ember)).hp).toBe(0);

    await ask.getByRole("button", { name: carries ? /^Yes, fire: / : /^Not fire: / }).click();
    await expect(page.getByTestId("hud-queue-result")).toHaveText(carries ? "Ember’s Fireproof applies." : "Not fire: the hit stands as it is.", { timeout: 30_000 });
    await expect(page.getByTestId("hud-queue-keyword")).toHaveCount(0);
    if (carries) {
      await expect.poll(async () => (await s.gm.query(api.adversaryActionsReads.windows, { campaignId: s.campaignId })).length).toBe(0);
      expect((await sheetOf(s.gm, s.ember)).hp).toBe(0);
    } else await expect.poll(async () => (await sheetOf(s.gm, s.ember)).hp).toBeGreaterThan(0);
    expect(await s.gm.query(api.hitKeywordsReads.asks, { campaignId: s.campaignId })).toEqual([]);
  });
}
