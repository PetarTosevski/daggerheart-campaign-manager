import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, expectNoHorizontalScroll, openCombatMap } from "./visual/helpers";

// Plan combat-actions AA5: the GM's adversary actions on the Combat Map (Q12 "he can also use combat map if he wants",
// Q16) and the hit flashes, since plan combat-hud H8.2 through the HUD (the classic GM column's Adversaries card is
// gone). The GM opens the Bandit's stat block, Attack shows each PC's band in the purple picker, and attacks Mira; the
// open reaction window shows on the Encounter tab and in the GM's queue; Mira's player sees the flash on Mira's token,
// "Bandit hit Mira" in the HUD feed and the hit window, and marks an Armor Slot; the GM's HUD Resolutions list the
// adversary action with Undo (U4). A PC the GM owns gets the hit window on the GM's HUD (user answer 2026-10-22); a hit
// made from the Encounter tab flashes on the map too; a Fear feature asks first (Q19). The classic card's 390 px checks
// went with it: the GM at 390 is covered by tests/e2e/hud-phone.spec.ts and combat-actions-a11y.spec.ts.

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

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The GM's HUD token of an adversary ("Open the Bandit’s stat block, …"). */
const statBlockToken = (page: Page, name: string) =>
  page.getByRole("region", { name: "Battle map" }).getByRole("button", { name: new RegExp(`^Open the ${escape(name)}’s stat block`) });

async function openMapAsGm(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByTestId("combat-hud")).toBeVisible({ timeout: 30_000 });
  await expect(statBlockToken(page, "Bandit")).toBeVisible({ timeout: 30_000 });
  // The feed has loaded (the HUD's Resolutions read the same page as the flash layer): rows from now on flash.
  await expect(page.getByTestId("hud-resolutions")).toBeVisible({ timeout: 30_000 });
  await recordFlashes(page);
}

test("the GM attacks Mira from the HUD stat block: the window shows on the Encounter tab, Mira's player sees the flash and answers, Undo restores", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const s = await scene(page, browser, true);
  try {
    const player = s.player!;
    await player.setViewportSize({ width: 1440, height: 900 });
    await player.goto(s.mapUrl);
    await expect(player.getByRole("region", { name: "Battle map" }).getByRole("button", { name: /^Open Mira’s sheet/ })).toBeVisible({ timeout: 30_000 });
    await recordFlashes(player);

    await page.setViewportSize({ width: 1440, height: 900 });
    await openMapAsGm(page, s.mapUrl);
    await statBlockToken(page, "Bandit").click();
    const block = page.getByRole("complementary", { name: "Bandit’s stat block" });
    await expect(block.getByTestId("hud-statblock-body")).toBeVisible();
    await expectNoSeriousA11yViolations(page, { include: "[data-testid=hud-statblock-body]" });

    // Attack opens the purple picker with each PC's band from the Bandit (CB p.103-104, Q2).
    await block.getByTestId("hud-statblock-attack").click();
    const pick = page.getByTestId("hud-pick");
    await expect(pick.getByRole("heading", { level: 2 })).toHaveText("Acting for the Bandit");
    const rows = pick.getByTestId("hud-pick-row");
    await expect(rows.filter({ hasText: "Mira" })).toHaveAttribute("data-reach", "in");
    await expect(rows.filter({ hasText: "Rook" })).toHaveAttribute("data-reach", "out");
    await rows.filter({ hasText: "Mira" }).click();
    const before = await sheetOf(s.client, s.miraId);
    await pick.getByTestId("hud-pick-go").click();
    // The GM turn's first spotlight is free and nothing else costs: no Fear question.
    await expect(page.getByTestId("hud-fear-confirm")).toHaveCount(0);
    await expect(pick).toHaveCount(0, { timeout: 30_000 });
    await expect(block.getByTestId("tracker-action-result")).toContainText("Bandit attacks", { timeout: 30_000 });
    const reactions = page.getByTestId("hud-queue").getByTestId("hud-queue-reactions");
    await expect(reactions).toContainText("Waiting on Mira", { timeout: 30_000 });
    await expect.poll(() => flashes(page)).toContain("hit:Hit");

    // The Encounter tab shows the same open window (Q12, Q16).
    const tab = await page.context().newPage();
    await tab.goto(`/campaigns/${s.campaignId}/adversaries`);
    await tab.getByRole("tab", { name: "Encounters" }).click();
    const tracker = tab.getByRole("tabpanel", { name: "Encounters" }).getByRole("region", { name: "Encounter tracker" });
    await expect(tracker.getByRole("region", { name: "Reaction windows" }).getByTestId("tracker-window")).toContainText(/Bandit\s*hit\s*Mira/, { timeout: 30_000 });

    // Mira's player: the flash, the HUD feed's "Bandit hit Mira" (no numbers, Q14) and the hit window.
    await expect.poll(() => flashes(player), { timeout: 30_000 }).toContain("hit:Hit");
    await expect(player.getByTestId("hud-feed")).toContainText("Bandit hit Mira", { timeout: 30_000 });
    const win = player.getByRole("dialog", { name: "You were hit" });
    await expect(win).toContainText("Bandit hit Mira", { timeout: 30_000 });
    await win.getByRole("button", { name: /^Mark Armor · take / }).click();
    await expect.poll(async () => (await sheetOf(s.client, s.miraId)).armorMarked).toBe(before.armorMarked + 1);
    await expect(tracker.getByRole("region", { name: "Reaction windows" })).toHaveCount(0);
    await expect(reactions).toHaveCount(0);
    await tab.close();

    // The GM's HUD Resolutions list the adversary action; Undo restores Mira's sheet (U4).
    const resolution = page.getByTestId("hud-resolution").filter({ hasText: /Club/ }).first();
    await expect(resolution).toBeVisible({ timeout: 30_000 });
    await resolution.getByRole("button", { name: /^Undo: / }).click();
    await expect.poll(async () => (await sheetOf(s.client, s.miraId)).armorMarked).toBe(before.armorMarked);
    expect((await sheetOf(s.client, s.miraId)).hp).toBe(before.hp);
  } finally {
    await s.close();
  }
});

test("Rook, the GM's own PC, gets the hit window on the GM's HUD; a hit from the Encounter tab flashes on the map; Roar asks for Fear", async ({ page, browser }) => {
  test.setTimeout(300_000);
  const s = await scene(page, browser, false);
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMapAsGm(page, s.mapUrl);

    // An attack made off the map (the Encounter tab's server call) flashes Rook's token here.
    const attack = await s.client.mutation(api.adversaryActions.attack, { campaignId: s.campaignId, instanceId: s.instanceId, targets: [s.rookId], idempotencyKey: crypto.randomUUID() });
    expect(attack.status).toBe("resolved");
    await expect.poll(() => flashes(page), { timeout: 30_000 }).toContain("hit:Hit");

    // Rook is the GM's: the GM answers in the HUD's hit window (user answer 2026-10-22).
    const win = page.getByRole("dialog", { name: "Rook was hit" });
    await expect(win).toContainText("Bandit hit Rook", { timeout: 30_000 });
    await expectNoSeriousA11yViolations(page, { include: "[data-testid=hud-hit-window]" });
    const before = await sheetOf(s.client, s.rookId);
    await win.getByRole("button", { name: /^Take \d HP$/ }).click();
    await expect(win).toHaveCount(0, { timeout: 30_000 });
    await expect.poll(async () => (await sheetOf(s.client, s.rookId)).hp).toBeGreaterThan(0);
    expect((await sheetOf(s.client, s.rookId)).armorMarked).toBe(before.armorMarked);

    // Roar costs 1 Fear: asked first, spent on the tap (Q19).
    await statBlockToken(page, "Bandit").click();
    const block = page.getByRole("complementary", { name: "Bandit’s stat block" });
    await block.getByRole("button", { name: "Use Roar (1 Fear)" }).click();
    // Roar names its PCs: the purple picker "Roar" asks for them first (plan combat-hud H5.2).
    const roar = page.getByRole("dialog", { name: "Roar" });
    await roar.getByRole("button", { name: /^Rook, / }).click();
    await roar.getByRole("button", { name: /^Use on / }).click();
    const confirm = page.getByTestId("hud-fear-confirm");
    await expect(confirm).toContainText(/Spend \d Fear\?/);
    await expect(confirm).toContainText("Roar");
    expect(await s.client.query(api.campaigns.fear, { campaignId: s.campaignId })).toBe(3);
    await confirm.getByRole("button", { name: "Spend 1 Fear" }).click();
    await expect.poll(() => s.client.query(api.campaigns.fear, { campaignId: s.campaignId })).toBe(2);
    await expect(block.getByTestId("tracker-action-result")).toContainText("Bandit uses Roar", { timeout: 30_000 });
    await expectNoSeriousA11yViolations(page, { include: "[data-testid=hud-statblock-body]" });
    await expectNoHorizontalScroll(page);
  } finally {
    await s.close();
  }
});
