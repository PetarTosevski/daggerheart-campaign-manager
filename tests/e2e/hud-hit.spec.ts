import { expect, test, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "./a11y";
import { hudScene, type HudScene } from "./hud/helpers";

// Plan combat-hud H4.2 (docs/tasks/TASK-HUD-H4.2.md): with the HUD on, an adversary's hit opens "You were hit" beside
// the hit PC's token: the damage, the threshold tiles with the active one, "Mark an Armor Slot to drop it to …?", HP /
// Armor before → after as "n of 6 marked" (answer 2), Take n HP / Mark Armor. The GM holds the spotlight the whole
// time: the window stays usable (answer 1c). With every Armor Slot marked and nothing to answer no window opens. A PC the GM owns
// (Brannoc) gets the same window on the GM view. Never an adversary's numbers (hard rule 2). axe on each window.

const OUT = "test-results/visual/HUD-H4.2";

/** A Bandit that always hits (ATK +20) for 11-14 physical damage. */
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
  attack: { modifier: 20, name: "Club", range: "Melee", damage: "1d4+10 phy" },
  experiences: [],
  features: [],
};

const ENEMY_WORDS = /\b(roll|Evasion|Difficulty|ATK)\b/i;

/** Adds the Brute to the running encounter and stands it next to Moss and Brannoc; returns its instance id. */
async function addBrute(s: HudScene) {
  const { client, campaignId } = s;
  const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: BRUTE, idempotencyKey: crypto.randomUUID() });
  const { instanceIds } = await client.mutation(api.encounters.addAdversary, {
    campaignId,
    encounterId: s.encounterId,
    source: { kind: "custom", customId },
    count: 1,
    summoned: false,
    idempotencyKey: crypto.randomUUID(),
  });
  const instanceId = instanceIds[0]!;
  await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId: s.mapId, instanceIds: [instanceId], idempotencyKey: crypto.randomUUID() });
  const token = (await client.query(api.combatTokensReads.list, { campaignId, mapId: s.mapId })).find((t) => t.instanceId === instanceId)!;
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: token._id, x: 6, y: 10 });
  return { instanceId, tokenId: token._id };
}

/** The GM's Brute hits `target` (paying the Fear the server asks for). */
async function bruteHits(gm: ConvexHttpClient, campaignId: Id<"campaigns">, instanceId: Id<"encounterAdversaries">, target: Id<"characters">, open = true) {
  let res = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [target], idempotencyKey: crypto.randomUUID() });
  if (res.status === "confirmFear") {
    res = await gm.mutation(api.adversaryActions.attack, { campaignId, instanceId, targets: [target], spendFear: res.fear, idempotencyKey: crypto.randomUUID() });
  }
  if (res.status !== "resolved") throw new Error(`attack not resolved: ${res.status}`);
  expect(res.targets[0]!.hit).toBe(true);
  // Nothing to answer (no Armor Slot left, no reaction, no grant): the engine resolves the hit at once.
  expect(res.targets[0]!.resolved).toBe(!open);
}

async function partyRow(s: HudScene, characterId: Id<"characters">) {
  const party = await s.client.query(api.combatHud.party, { campaignId: s.campaignId, mapId: s.mapId });
  return party.find((m) => m.characterId === characterId)!;
}

/** The window stands beside the token (not over it). */
async function expectBesideToken(page: Page, tokenId: string) {
  const win = await page.getByTestId("hud-hit-window").boundingBox();
  const token = await page.locator(`.hud-map [data-token="${tokenId}"]`).first().boundingBox();
  expect(win && token).toBeTruthy();
  const overlaps = win!.x < token!.x + token!.width && token!.x < win!.x + win!.width && win!.y < token!.y + token!.height && token!.y < win!.y + win!.height;
  expect(overlaps).toBe(false);
}

test("You were hit: armor offer, n of 6 marked, no armor when none is left, the GM's own PC; usable while the GM holds the spotlight", async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player, client, campaignId } = s;
  const moss = s.pcs.find((p) => p.name === "Moss")!;
  const brannoc = s.pcs.find((p) => p.name === "Brannoc")!;
  try {
    const { instanceId, tokenId: bruteToken } = await addBrute(s);
    await gm.setViewportSize({ width: 1440, height: 900 });
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.url);
    await gm.goto(s.url);
    await expect(player.getByTestId("combat-hud")).toBeVisible();
    await expect(gm.getByTestId("combat-hud")).toBeVisible();

    // The GM holds the spotlight (answer 1c): reactions, the hit window included, stay usable.
    await client.mutation(api.combatSpotlight.gmTake, { campaignId, idempotencyKey: crypto.randomUUID() });
    await expect(player.getByTestId("hud-gm-turn")).toBeVisible();

    const before = await partyRow(s, moss.characterId);
    expect(before.armor.max).toBeGreaterThan(before.armor.marked);
    await bruteHits(client, campaignId, instanceId, moss.characterId);

    const win = player.getByRole("dialog", { name: "You were hit" });
    await expect(win).toBeVisible({ timeout: 30_000 });
    await expect(win).toContainText("Brute hit Moss");
    await expect(win.getByTestId("hud-hit-damage")).toHaveText(/^\d+$/);
    await expect(win.getByRole("list", { name: "Damage thresholds" }).locator("li[aria-current=true]")).toHaveCount(1);
    await expect(win.getByTestId("hud-hit-question")).toHaveText(/^Mark an Armor Slot to (drop it to (Minor|Major)|take no damage)\?$/);
    await expect(win.getByTestId("hud-hit-hp")).toHaveText(new RegExp(`^${before.hp.marked} → \\d of ${before.hp.max} marked$`));
    await expect(win.getByTestId("hud-hit-armor")).toHaveText(`${before.armor.marked} → ${before.armor.marked + 1} of ${before.armor.max} marked`);
    await expect(win.getByRole("button", { name: /^Take \d HP$/ })).toBeVisible();
    await expect(win).not.toContainText(ENEMY_WORDS);
    await expectBesideToken(player, moss.tokenId);
    await expectNoSeriousA11yViolations(player, { include: "[data-testid=hud-hit-window]" });
    await player.screenshot({ path: `${OUT}/youre-hit-1440.png`, animations: "disabled" });
    await win.screenshot({ path: `${OUT}/youre-hit-window.png`, animations: "disabled" });

    await win.getByRole("button", { name: /^Mark Armor · take / }).click();
    await expect(win).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(async () => (await partyRow(s, moss.characterId)).armor.marked, { timeout: 30_000 }).toBe(before.armor.marked + 1);

    // Every Armor Slot marked: with no armor option and nothing else to answer, the engine resolves the hit at once and
    // no window opens (the window's own "No Armor Slot left" state, with a reaction or grant still to answer, is covered
    // by tests/unit/hud/hit-window.test.tsx).
    const now = await partyRow(s, moss.characterId);
    await client.mutation(api.characters.adjustResource, { characterId: moss.characterId, resource: "armor", delta: now.armor.max - now.armor.marked });
    const hpBefore = (await partyRow(s, moss.characterId)).hp.marked;
    await bruteHits(client, campaignId, instanceId, moss.characterId, false);
    await expect(win).toHaveCount(0);
    await expect.poll(async () => (await partyRow(s, moss.characterId)).hp.marked, { timeout: 30_000 }).toBeGreaterThan(hpBefore);

    // Brannoc is the GM's: the same window on the GM view, and nothing on the player's.
    await client.mutation(api.combatTokens.move, { campaignId, tokenId: bruteToken, x: 8, y: 10 });
    await bruteHits(client, campaignId, instanceId, brannoc.characterId);
    const gmWin = gm.getByRole("dialog", { name: "Brannoc was hit" });
    await expect(gmWin).toBeVisible({ timeout: 30_000 });
    await expect(gmWin.getByTestId("hud-hit-hp")).toHaveText(/^\d → \d of \d marked$/);
    await expect(player.getByRole("dialog", { name: /was hit|You were hit/ })).toHaveCount(0);
    await expectBesideToken(gm, brannoc.tokenId);
    await expectNoSeriousA11yViolations(gm, { include: "[data-testid=hud-hit-window]" });
    await gm.screenshot({ path: `${OUT}/gm-own-pc-1440.png`, animations: "disabled" });
    await gmWin.getByRole("button", { name: /^Take \d HP$/ }).click();
    await expect(gmWin).toHaveCount(0, { timeout: 30_000 });
  } finally {
    await s.close();
  }
});
