import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { expectNoSeriousA11yViolations } from "./a11y";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs, expectNoHorizontalScroll, openCombatMap } from "./visual/helpers";

// Plan combat-actions AA3: the GM's adversary actions on the Encounter tab (Q12, Q16-Q19). The GM picks Mira on the
// live map and attacks with the Bandit through the server; the result shows the roll, the hit and the damage; the
// reaction window lists who still has to answer; Mira's player marks an Armor Slot (AA4 builds that prompt; here the
// player's own client answers through adversaryActions.respond) and the hit resolves: the sheet and Mira's token on the
// Combat Map show the marks. A Fear-cost feature asks "Spend 1 Fear?" first (Q19); "Resolve now" settles an open window
// (Q17); a token moved in the map pane moves on the Combat Map (Q16). Axe at desktop and 390 px.

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
  playerClient: ConvexHttpClient;
  campaignId: Id<"campaigns">;
  miraId: Id<"characters">;
  miraToken: Id<"combatTokens">;
  mapUrl: string;
  closePlayer: () => Promise<void>;
};

/** The GM's campaign with a live map: the player's Mira at (5, 10) and the Bandit beside her, in a running encounter. */
async function scene(page: Page, browser: Browser): Promise<Scene> {
  const { client, campaignId, url } = await openCombatMap(page);
  const context = await browser.newContext();
  const player = await context.newPage();
  const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  const playerClient = await convexAs(player);
  await playerClient.mutation(api.members.joinByCode, { code });
  const { characterId: miraId } = await playerClient.mutation(api.characters.create, { campaignId, draft: bardDraft("Mira"), idempotencyKey: crypto.randomUUID() });
  const { customId } = await client.mutation(api.customAdversaries.create, { campaignId, adversary: SURE_BANDIT, idempotencyKey: crypto.randomUUID() });
  const { encounterId } = await client.mutation(api.encounters.create, { campaignId, name: "Road ambush", idempotencyKey: crypto.randomUUID() });
  const { instanceIds } = await client.mutation(api.encounters.addAdversary, { campaignId, encounterId, source: { kind: "custom", customId }, count: 1, summoned: false, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.encounters.start, { campaignId, encounterId });
  const { mapId } = await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Old road", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.addParty, { campaignId, mapId, idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.combatTokens.placeAdversaries, { campaignId, mapId, instanceIds, idempotencyKey: crypto.randomUUID() });
  const tokens = await client.query(api.combatTokens.list, { campaignId, mapId });
  const mira = tokens.find((t) => t.characterId === miraId)!;
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: mira._id, x: 5, y: 10 });
  await client.mutation(api.combatTokens.move, { campaignId, tokenId: tokens.find((t) => t.instanceId === instanceIds[0])!._id, x: 6, y: 10 });
  await client.mutation(api.fear.set, { campaignId, value: 3, idempotencyKey: crypto.randomUUID() });
  return { client, playerClient, campaignId, miraId, miraToken: mira._id, mapUrl: url, closePlayer: () => context.close() };
}

async function openTracker(page: Page, campaignId: Id<"campaigns">) {
  await page.goto(`/campaigns/${campaignId}/adversaries`);
  await page.getByRole("tab", { name: "Encounters" }).click();
  const tracker = page.getByRole("tabpanel", { name: "Encounters" }).getByRole("region", { name: "Encounter tracker" });
  await expect(tracker.getByRole("heading", { name: "Road ambush" })).toBeVisible();
  return tracker;
}

async function sheetOf(s: Scene) {
  const view = await s.client.query(api.characters.get, { characterId: s.miraId });
  return view!.sheet;
}

test("the GM attacks Mira from the Encounter tab, Mira's player marks an Armor Slot, the hit resolves on the sheet and the Combat Map", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const s = await scene(page, browser);
  try {
    const tracker = await openTracker(page, s.campaignId);
    const panel = tracker.getByRole("region", { name: "Adversary actions" });
    // With the Bandit on the live map, the targets are the PCs on it (Q18).
    await expect(panel).toContainText("PCs on the live map");
    const targets = panel.getByRole("group", { name: "Targets" });
    await targets.getByRole("button", { name: "Mira" }).click();
    await expect(targets.getByRole("button", { name: "Mira" })).toHaveAttribute("aria-pressed", "true");
    // Passive features are modifiers; actions have Use.
    const features = panel.getByRole("list", { name: "Features" });
    await expect(features.getByRole("listitem").filter({ hasText: "Tough" })).toContainText("Modifier: applies on its own");
    await expect(features.getByRole("button", { name: "Use Roar (1 Fear)" })).toBeVisible();
    await expectNoSeriousA11yViolations(page, { include: ".trk" });

    const before = await sheetOf(s);
    await panel.getByRole("button", { name: "⚔ Attack Mira with Club" }).click();
    const result = panel.getByRole("region", { name: "Action result" });
    await expect(result.getByTestId("tracker-action-roll")).toHaveText(/^Roll \d+ \(d20 \d+, \+15\)/);
    await expect(result.getByRole("list", { name: "Targets" })).toContainText(/Mira\s*Hit\s*\d+ damage\s*waiting for answers/);

    // The open window: Mira still has to choose armor (Q13, Q17).
    const windows = tracker.getByRole("region", { name: "Reaction windows" });
    await expect(windows.getByTestId("tracker-window")).toContainText("Waiting for Mira (armor choice)");

    // Mira's player marks an Armor Slot (their own client; AA4 puts the prompt on the map and the sheet).
    const hits = await s.playerClient.query(api.adversaryActions.pending, { campaignId: s.campaignId, characterId: s.miraId });
    expect(hits).toHaveLength(1);
    expect(hits[0]).not.toHaveProperty("roll");
    await s.playerClient.mutation(api.adversaryActions.respond, {
      campaignId: s.campaignId,
      requestId: hits[0]!.requestId,
      characterId: s.miraId,
      choice: { kind: "armor" },
      idempotencyKey: crypto.randomUUID(),
    });
    await expect(windows).toHaveCount(0);
    await expect.poll(async () => (await sheetOf(s)).armorMarked).toBe(before.armorMarked + 1);
    const hp = (await sheetOf(s)).hp;
    expect(hp).toBeGreaterThan(before.hp);

    // The Combat Map shows it on Mira's token.
    const map = await page.context().newPage();
    await map.goto(s.mapUrl);
    await expect(map.getByRole("region", { name: "Battle map" }).getByRole("button", { name: new RegExp(`^Mira, .*${hp} of \\d+ HP marked`) })).toBeVisible({ timeout: 30_000 });
    await map.close();
  } finally {
    await s.closePlayer();
  }
});

test("a Fear-cost feature asks first (Q19), Resolve now settles a window (Q17), and a token moved in the map pane moves on the map (Q16)", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const s = await scene(page, browser);
  try {
    const tracker = await openTracker(page, s.campaignId);
    const panel = tracker.getByRole("region", { name: "Adversary actions" });
    await expect(tracker.getByTestId("tracker-fear")).toHaveAttribute("aria-label", "GM Fear 3 of 12");

    // Roar costs 1 Fear: nothing happens until the GM taps Spend.
    await panel.getByRole("list", { name: "Features" }).getByRole("button", { name: "Use Roar (1 Fear)" }).click();
    const question = panel.getByRole("group", { name: "Spend Fear?" });
    await expect(question).toContainText("Spend 1 Fear? 1 for the feature.");
    await expect(tracker.getByTestId("tracker-fear")).toHaveAttribute("aria-label", "GM Fear 3 of 12");
    await question.getByRole("button", { name: "Spend 1 Fear" }).click();
    await expect(question).toHaveCount(0);
    await expect(tracker.getByTestId("tracker-fear")).toHaveAttribute("aria-label", "GM Fear 2 of 12");
    const result = panel.getByRole("region", { name: "Action result" });
    await expect(result).toContainText("Bandit uses Roar");
    await expect(result.getByRole("list", { name: "For you to do" })).toContainText("Roar");

    // An attack (the Bandit holds the spotlight now: free), then Resolve now without waiting for Mira.
    await panel.getByRole("group", { name: "Targets" }).getByRole("button", { name: "Mira" }).click();
    await panel.getByRole("button", { name: "⚔ Attack Mira with Club" }).click();
    await expect(result).toContainText("Bandit attacks");
    const windows = tracker.getByRole("region", { name: "Reaction windows" });
    await windows.getByRole("button", { name: "Resolve now: Bandit hit Mira" }).click();
    await expect(windows).toHaveCount(0);
    await expect.poll(async () => (await sheetOf(s)).hp).toBeGreaterThan(0);

    // The map pane: Mira's token moves one square down with the keyboard; the Combat Map's tokens follow.
    const pane = tracker.getByRole("region", { name: "Live map" });
    const token = pane.getByRole("button", { name: /^Mira, / });
    await token.focus();
    await token.press("ArrowDown");
    await expect
      .poll(async () => {
        const maps = await s.client.query(api.combatMaps.list, { campaignId: s.campaignId });
        const tokens = await s.client.query(api.combatTokens.list, { campaignId: s.campaignId, mapId: maps[0]!._id });
        return tokens.find((t) => t._id === s.miraToken)?.y;
      })
      .toBe(11);
  } finally {
    await s.closePlayer();
  }
});

test("at 390 px the actions panel, windows and map pane stack without horizontal scroll, 44 px controls, no serious axe violations", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const s = await scene(page, browser);
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    const tracker = await openTracker(page, s.campaignId);
    const panel = tracker.getByRole("region", { name: "Adversary actions" });
    await panel.getByRole("group", { name: "Targets" }).getByRole("button", { name: "Mira" }).click();
    await panel.getByRole("button", { name: "⚔ Attack Mira with Club" }).click();
    await expect(tracker.getByRole("region", { name: "Reaction windows" })).toBeVisible();
    await expect(tracker.getByRole("region", { name: "Live map" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    for (const control of await panel.getByRole("button").all()) {
      const box = await control.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await expectNoSeriousA11yViolations(page, { include: ".trk" });
  } finally {
    await s.closePlayer();
  }
});
