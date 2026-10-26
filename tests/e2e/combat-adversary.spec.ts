import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations, expectTouchTargets } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, expectNoHorizontalScroll, openCombatMap } from "./visual/helpers";

// Plan combat-actions AA5: the GM's adversary controls on the Combat Map (Q12 "he can also use combat map if he wants",
// Q16) and the hit flashes. The GM selects the Bandit's token, sees each PC's range band and line of sight, and attacks
// Mira with the Encounter tab's own controls; the open reaction window shows on the Encounter tab; Mira's player sees
// the flash on Mira's token, "Bandit hit Mira" in the mini feed and the prompt, and marks an Armor Slot; the GM's
// Resolutions list the adversary action with Undo (U4). A PC the GM owns gets the incoming-hit prompt in the GM column
// (user answer 2026-10-22); a hit made from the Encounter tab flashes on the map too; a Fear feature asks first (Q19).

const PLAYER = "e2e-player@example.test";

/** A Bandit that always hits (ATK +15) for 2d6+12, with a 1-Fear action (no automation: a GM prompt). */
const SURE_BANDIT = {
  name: "Bandit",
  tier: 1,
  type: "Standard" as const,
  description: "A road thug.",
  motives: "Rob",
  difficulty: 10,
  thresholds: { major: 5, severe: 10 },
  hp: 5,
  stress: 3,
  attack: { modifier: 15, name: "Club", range: "Melee", damage: "2d6+12 phy" },
  experiences: [{ name: "Ambusher", value: 2 }],
  features: [
    { name: "Tough", kind: "passive" as const, text: "The Bandit shrugs off pain." },
    { name: "Roar", kind: "action" as const, text: "Spend a Fear: every PC within Close range marks a Stress.", fearCost: 1 },
  ],
};

type Scene = {
  client: ConvexHttpClient;
  campaignId: Id<"campaigns">;
  miraId: Id<"characters">;
  rookId: Id<"characters">;
  instanceId: Id<"encounterAdversaries">;
  mapUrl: string;
  player: Page | null;
  close: () => Promise<void>;
};

/**
 * The GM's campaign with a live map and a running encounter: the Bandit at (6, 10), Mira (the player's, when `withPlayer`)
 * beside it at (5, 10), and Rook (the GM's own PC) at (6, 15), Close to it.
 */
async function scene(page: Page, browser: Browser, withPlayer: boolean): Promise<Scene> {
  const { client, campaignId, url } = await openCombatMap(page);
  let player: Page | null = null;
  let miraId: Id<"characters">;
  const context = withPlayer ? await browser.newContext() : null;
  if (context) {
    player = await context.newPage();
    const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
    await signInAsTestGm(player, PLAYER);
    await expect(player).toHaveURL("/");
    const playerClient = await convexAs(player);
    await playerClient.mutation(api.members.joinByCode, { code });
    miraId = (await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Mira"), idempotencyKey: crypto.randomUUID() })).characterId;
  } else {
    miraId = (await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Mira"), idempotencyKey: crypto.randomUUID() })).characterId;
  }
  const { characterId: rookId } = await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Rook"), idempotencyKey: crypto.randomUUID() });
  const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: SURE_BANDIT, idempotencyKey: crypto.randomUUID() });
  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
  const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.encounters.start, { campaignId, encounterId });
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: crypto.randomUUID() });
  const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.characterId === miraId)!._id, x: 5, y: 10 });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.characterId === rookId)!._id, x: 6, y: 15 });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.instanceId === instanceIds[0])!._id, x: 6, y: 10 });
  await client.mutation(api.fear.set, { campaignId, value: 3, idempotencyKey: crypto.randomUUID() });
  return { client, campaignId, miraId, rookId, instanceId: instanceIds[0]!, mapUrl: url, player, close: async () => void (await context?.close()) };
}

/** Records every hit flash the page mounts (each plays for under two seconds), as "tone:label". */
async function recordFlashes(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __flashes: string[] };
    w.__flashes = [];
    new MutationObserver((records) => {
      for (const r of records) {
        for (const node of r.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const found = node.matches('[data-testid="combat-hit-flash"]') ? [node] : [...node.querySelectorAll<HTMLElement>('[data-testid="combat-hit-flash"]')];
          for (const f of found) w.__flashes.push(`${f.dataset.tone}:${f.textContent}`);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
}
const flashes = (page: Page) => page.evaluate(() => (window as unknown as { __flashes: string[] }).__flashes);

async function sheetOf(client: ConvexHttpClient, characterId: Id<"characters">) {
  return (await client.query(api.characters.get, { characterId }))!.sheet;
}

async function openMapAsGm(page: Page, url: string) {
  await page.goto(url);
  const board = page.getByRole("region", { name: "Battle map" });
  await expect(board.getByRole("button", { name: /^Bandit, / })).toBeVisible({ timeout: 30_000 });
  await recordFlashes(page);
  return board;
}

test("the GM attacks Mira from the map: the window shows on the Encounter tab, Mira's player sees the flash and answers, Undo restores", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const s = await scene(page, browser, true);
  try {
    const player = s.player!;
    await player.goto(s.mapUrl);
    await expect(player.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Mira, / })).toBeVisible({ timeout: 30_000 });
    await recordFlashes(player);

    const board = await openMapAsGm(page, s.mapUrl);
    const card = page.getByRole("region", { name: "Adversaries" });
    await expect(card.getByTestId("adversary-hint")).toBeVisible();
    await board.getByRole("button", { name: /^Bandit, / }).click();
    const selected = card.getByTestId("adversary-selected");
    await expect(selected.getByRole("heading", { name: "Bandit" })).toBeVisible();
    // Range bands and line of sight from the Bandit (CB p.103-104, Q2).
    const ranges = selected.getByRole("list", { name: "Range and sight" });
    await expect(ranges.getByRole("listitem").filter({ hasText: "Mira" })).toContainText(/Melee\s*In sight/);
    await expect(ranges.getByRole("listitem").filter({ hasText: "Rook" })).toContainText(/Close\s*In sight\s*beyond Club \(Melee\)/);
    await expectNoSeriousA11yViolations(page, { include: '[data-testid="adversary-panel"]' });

    // Selecting Mira's token keeps acting for the Bandit.
    await board.getByRole("button", { name: /^Mira, / }).click();
    const panel = selected.getByRole("region", { name: "Adversary actions" });
    await panel.getByRole("group", { name: "Targets" }).getByRole("button", { name: "Mira" }).click();
    const before = await sheetOf(s.client, s.miraId);
    await panel.getByRole("button", { name: "⚔ Attack Mira with Club" }).click();
    const result = panel.getByRole("region", { name: "Action result" });
    await expect(result.getByTestId("tracker-action-roll")).toHaveText(/^Roll \d+ \(d20 \d+, \+15\)/);
    await expect(result.getByRole("list", { name: "Targets" })).toContainText(/Mira\s*Hit\s*\d+ damage\s*waiting for answers/);
    await expect(card.getByTestId("tracker-window")).toContainText("Waiting for Mira (armor choice)");
    await expect.poll(() => flashes(page)).toContain("hit:Hit");

    // The Encounter tab shows the same open window (Q12, Q16).
    const tab = await page.context().newPage();
    await tab.goto(`/campaigns/${s.campaignId}/adversaries`);
    await tab.getByRole("tab", { name: "Encounters" }).click();
    const tracker = tab.getByRole("tabpanel", { name: "Encounters" }).getByRole("region", { name: "Encounter tracker" });
    await expect(tracker.getByRole("region", { name: "Reaction windows" }).getByTestId("tracker-window")).toContainText(/Bandit\s*hit\s*Mira/, { timeout: 30_000 });

    // Mira's player: the flash, the mini feed's "Bandit hit Mira" (no numbers, Q14) and the prompt.
    await expect.poll(() => flashes(player), { timeout: 30_000 }).toContain("hit:Hit");
    await expect(player.getByTestId("combat-mini-feed")).toContainText("Bandit hit Mira");
    const prompt = player.getByTestId("incoming-hit");
    await expect(prompt).toContainText("You were hit");
    await prompt.getByRole("button", { name: "Mark", exact: true }).click();
    await expect.poll(async () => (await sheetOf(s.client, s.miraId)).armorMarked).toBe(before.armorMarked + 1);
    await expect(tracker.getByRole("region", { name: "Reaction windows" })).toHaveCount(0);
    await expect(card.getByTestId("tracker-window")).toHaveCount(0);
    await tab.close();

    // The GM's Resolutions list the adversary action; Undo restores Mira's sheet (U4).
    const resolutions = page.getByRole("region", { name: "Adversary resolutions" });
    const rows = resolutions.getByTestId("combat-resolution");
    await expect(rows.first()).toBeVisible();
    await rows.filter({ hasText: /Club/ }).getByRole("button", { name: /^Undo/ }).first().click();
    await expect.poll(async () => (await sheetOf(s.client, s.miraId)).armorMarked).toBe(before.armorMarked);
    expect((await sheetOf(s.client, s.miraId)).hp).toBe(before.hp);
  } finally {
    await s.close();
  }
});

test("Rook, the GM's own PC, gets the prompt in the GM column; a hit from the Encounter tab flashes on the map; Roar asks for Fear (390 px)", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const s = await scene(page, browser, false);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const board = await openMapAsGm(page, s.mapUrl);

    // An attack made off the map (the Encounter tab's server call) flashes Rook's token here.
    const attack = await s.client.mutation(api.adversaryActions.attack, { campaignId: s.campaignId, instanceId: s.instanceId, targets: [s.rookId], idempotencyKey: crypto.randomUUID() });
    expect(attack.status).toBe("resolved");
    await expect.poll(() => flashes(page), { timeout: 30_000 }).toContain("hit:Hit");

    // Rook is the GM's: the GM answers the prompt in the GM column (user answer 2026-10-22).
    const prompt = page.getByTestId("incoming-hit");
    await expect(prompt).toContainText(/You were hit\s*Bandit hit Rook/);
    await expectTouchTargets(prompt.getByRole("button"));
    await expectNoSeriousA11yViolations(page, { include: '[data-testid="incoming-hit"]' });
    const before = await sheetOf(s.client, s.rookId);
    await prompt.getByRole("button", { name: "Don't" }).click();
    await expect(prompt).toHaveCount(0);
    await expect.poll(async () => (await sheetOf(s.client, s.rookId)).hp).toBeGreaterThan(0);
    expect((await sheetOf(s.client, s.rookId)).armorMarked).toBe(before.armorMarked);

    // Roar costs 1 Fear: asked first, spent on the tap (Q19).
    await board.getByRole("button", { name: /^Bandit, / }).click();
    const card = page.getByRole("region", { name: "Adversaries" });
    const panel = card.getByRole("region", { name: "Adversary actions" });
    await panel.getByRole("list", { name: "Features" }).getByRole("button", { name: "Use Roar (1 Fear)" }).click();
    const question = panel.getByRole("group", { name: "Spend Fear?" });
    await expect(question).toContainText("Spend 1 Fear? 1 for the feature.");
    await expect(page.getByTestId("combat-fear")).toHaveText("3");
    await question.getByRole("button", { name: "Spend 1 Fear" }).click();
    await expect(page.getByTestId("combat-fear")).toHaveText("2");
    await expect(panel.getByRole("region", { name: "Action result" })).toContainText("Bandit uses Roar");

    await expectTouchTargets(card.getByRole("button"));
    await expectNoSeriousA11yViolations(page, { include: '[data-testid="adversary-panel"]' });
    await expectNoHorizontalScroll(page);
  } finally {
    await s.close();
  }
});
