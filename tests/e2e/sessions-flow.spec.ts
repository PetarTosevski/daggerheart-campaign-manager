import { expect, test, type Browser, type Page } from "@playwright/test";
import type { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cardsForDomains, getClass } from "../../src/lib/srd/index";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, openSessions } from "./visual/helpers";

// D10 S9: one GM-and-player session from prep to the dashboard's Last Session card, at 1440x900 and 1024x768
// (.omc/plans/d10-sessions.yaml S9). The GM preps Session 1 (two scenes, hooks, the session encounter), starts it
// from the dashboard (with its confirm), plays it (spotlight, a log line, the live tally after a Fear change),
// places the session encounter with the Combat Map's '＋ Session encounter', ends it keeping the Wither tokens on the
// sheets (house-rule checkbox unticked), restarts it (B7) and ends it from the dashboard's Wither panel converting the
// tokens to Fear, then wraps up (recap, loot, threads, the milestone with its confirm, the party's level-up flags).
// The player sees 'Session 1 in progress' while it runs, then the recap on the dashboard and in the read-only
// Sessions view, and never the prep, the log, the loot, the threads or the stage tabs.

const PLAYER = "e2e-player@example.test";
const RECAP = "The party held the ford against the Jagged Knife Bandits and Seren's prayers turned the tide.";
const LOOT = "Forty gold and a bandit's silver horn";
const THREADS = "The bandit chief escaped upriver.";
const HOOKS = "The ferryman owes the bandits a toll.";
const LOG_LINE = "Seren called on the gods at the ford.";

/** A level-1 Seraph (Divine Wielder, Strength 2): Prayer Dice at session start (Spellcast trait, K3). */
function seraphDraft(name: string) {
  const seraph = getClass("seraph")!;
  return {
    ...bardDraft(name),
    classId: "seraph",
    subclassId: "divine-wielder",
    traits: { agility: 0, strength: 2, finesse: 1, instinct: 1, presence: 0, knowledge: -1 },
    domainCards: cardsForDomains(seraph.domains, 1)
      .filter((c) => c.level === 1)
      .slice(0, 2)
      .map((c) => c.id),
  };
}

async function playerJoins(page: Page, browser: Browser, campaignId: string, campaignName: string) {
  await page.goto(`/campaigns/${campaignId}`);
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();
  const context = await browser.newContext({ viewport: page.viewportSize() });
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  await player.getByRole("button", { name: /Join Campaign/ }).click();
  await player.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await player.getByRole("button", { name: "Join", exact: true }).click();
  await expect(player.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  return { player, close: () => context.close() };
}

async function addBandits(page: Page, count: string) {
  await page.getByRole("button", { name: "+ Add adversary" }).click();
  const dialog = page.getByRole("dialog", { name: "Add to encounter" });
  await dialog.getByPlaceholder("Search by name or type").fill("bandit");
  await dialog.getByRole("list", { name: "Matching adversaries" }).getByRole("button", { name: "Jagged Knife Bandit, Tier 1 Standard" }).click();
  await dialog.getByLabel("How many").fill(count);
  await dialog.getByRole("button", { name: "Add to encounter", exact: true }).click();
  await expect(dialog).toBeHidden();
}

/** Severe Withered damage until a Wither token stays on the sheet (the Fear Die can scar and clear it, CB 261). */
async function witherToken(client: ConvexHttpClient, characterId: Id<"characters">): Promise<number> {
  let tokens = 0;
  for (let attempt = 0; attempt < 5 && tokens === 0; attempt++) {
    const hit = await client.mutation(api.characters.applyDamage, { characterId, damage: 13, useArmorSlot: false, withered: true, idempotencyKey: crypto.randomUUID() });
    tokens = hit.wither && !hit.wither.scarred ? hit.wither.tokens : 0;
  }
  expect(tokens).toBeGreaterThan(0);
  return tokens;
}

async function expectFear(page: Page, campaignId: string, fear: number) {
  await page.goto(`/campaigns/${campaignId}`);
  if (fear > 0) await expect(page.getByRole("button", { name: `Fear ${fear} of 12` })).toHaveAttribute("aria-pressed", "true");
  if (fear < 12) await expect(page.getByRole("button", { name: `Fear ${fear + 1} of 12` })).toHaveAttribute("aria-pressed", "false");
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
]) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("a session from prep to the Last Session card, for the GM and a player", async ({ page, browser }) => {
      test.setTimeout(300_000);
      const { client, campaignId, campaignName, url } = await openSessions(page);
      const uuid = () => crypto.randomUUID();
      await client.mutation(api.characters.create, { campaignId, draft: seraphDraft("Seren"), idempotencyKey: uuid() });
      const ash = (await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: uuid() })).characterId;
      await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Ford", idempotencyKey: uuid() });
      const { player, close } = await playerJoins(page, browser, campaignId, campaignName);
      try {
        // ---- Prep (B1, B3, Q1): a titled session, a Combat and a Social scene, hooks, the session encounter.
        await page.goto(url);
        await page.getByRole("button", { name: "+ New session" }).click();
        await expect(page).toHaveURL(/\?s=[^&]+&stage=prep$/);
        const sessionId = new URL(page.url()).searchParams.get("s")!;
        const card = page.getByRole("region", { name: "Session detail" }).getByRole("region", { name: "Session", exact: true });
        await card.getByLabel("Session 1 title").fill("The Ford at Dawn");
        await card.getByLabel("Session 1 title").press("Enter");
        const prep = page.getByRole("tabpanel");
        await prep.getByRole("button", { name: "+ Scene" }).click();
        await expect(prep.getByLabel("Scene 1 description")).toBeEnabled();
        await prep.getByLabel("Scene 1 description").fill("Ambush at the ford");
        await prep.getByLabel("Scene 1 description").press("Enter");
        await prep.getByRole("button", { name: "+ Scene" }).click();
        await expect(prep.getByLabel("Scene 2 type")).toBeEnabled();
        await prep.getByLabel("Scene 2 type").selectOption("social");
        await prep.getByLabel("Scene 2 description").fill("Bargain with the ferryman");
        await prep.getByLabel("Scene 2 description").blur();
        const hooks = prep.getByRole("textbox", { name: "Hooks & loose threads" });
        await hooks.fill(HOOKS);
        await hooks.blur();
        await prep.getByRole("button", { name: "Create the session encounter" }).click();
        await expect(prep.getByRole("heading", { name: "Session 1 encounter" })).toBeVisible();
        await addBandits(page, "2");
        await expect(prep.getByRole("list", { name: "Adversaries in this encounter" }).getByRole("listitem")).toHaveCount(2);
        await expect.poll(async () => (await client.query(api.sessionPrep.get, { campaignId, sessionId }))?.scenes.length).toBe(2);
        await expect.poll(async () => (await client.query(api.sessionPrep.get, { campaignId, sessionId }))?.hooks).toBe(HOOKS);
        await page.reload();
        await expect(prep.getByLabel("Scene 2 description")).toHaveValue("Bargain with the ferryman");
        await expect(card.getByLabel("Session 1 title")).toHaveValue("The Ford at Dawn");

        // The player never sees a planned session (Q4).
        await player.goto(url);
        await expect(player.getByRole("heading", { level: 1, name: "Sessions" })).toBeVisible();
        await expect(player.getByRole("complementary", { name: "Session list" }).getByRole("button")).toHaveCount(0);
        await expect(player.getByText("The Ford at Dawn")).toHaveCount(0);

        // ---- Start from the dashboard (B8): a confirm, then Session 1 opens on Play; the Seraph rolled Prayer Dice (B10, K3).
        await page.goto(`/campaigns/${campaignId}`);
        const hero = page.getByRole("region", { name: "Campaign header" });
        await hero.getByRole("button", { name: "Start Session", exact: true }).click();
        const startDialog = page.getByRole("dialog", { name: "Start the session?" });
        await startDialog.getByRole("button", { name: "Cancel" }).click();
        await expect(startDialog).toBeHidden();
        await expect(page).toHaveURL(`/campaigns/${campaignId}`);
        await hero.getByRole("button", { name: "Start Session", exact: true }).click();
        await startDialog.getByRole("button", { name: "Start session" }).click();
        await expect(page).toHaveURL(new RegExp(`/sessions\\?s=${sessionId}&stage=play$`));
        await expect(page.getByRole("tab", { name: "Play" })).toHaveAttribute("aria-selected", "true");
        await expect(page.getByRole("region", { name: "Live session" })).toContainText("Session in progress");
        const log = page.getByRole("region", { name: "Session log" });
        const entries = log.getByRole("list", { name: "Log entries, newest first" }).getByRole("listitem");
        await expect(entries.filter({ hasText: /Session started\. Seren rolled Prayer Dice: [1-4], [1-4]\./ })).toHaveCount(1);
        const playUrl = page.url();

        // The player's dashboard: 'Session 1 in progress', no button.
        await player.goto(`/campaigns/${campaignId}`);
        const playerHero = player.getByRole("region", { name: "Campaign header" });
        await expect(playerHero.getByText("Session 1 in progress")).toBeVisible();
        await expect(playerHero.getByRole("button", { name: "Start Session", exact: true })).toHaveCount(0);

        // ---- Play (B4, Q3, Q12): spotlight, a log line, the tally after a Fear change.
        const spot = page.getByRole("region", { name: "Spotlight" });
        const serenPill = spot.getByRole("button", { name: /^Seren, / });
        const ashPill = spot.getByRole("button", { name: /^Ash, / });
        await serenPill.click();
        await expect(serenPill).toHaveAccessibleName("Seren, 1 spotlight moment");
        await expect(ashPill).toHaveAccessibleName("Ash, 0 spotlight moments, due");
        await log.getByLabel("New log entry").fill(LOG_LINE);
        await log.getByLabel("New log entry").press("Enter");
        await expect(entries.nth(0)).toContainText(LOG_LINE);
        await expect.poll(async () => (await client.query(api.sessionPlay.log, { campaignId, sessionId })).map((l) => l.text)).toContain(LOG_LINE);
        await expect.poll(async () => (await client.query(api.sessionPlay.spotlight, { campaignId, sessionId })).map((e) => e.count).sort()).toEqual([0, 1]);
        const tally = page.getByRole("region", { name: "Session tally" });
        await expect(tally.getByRole("definition")).toHaveText(["0", "0", "0", "0"]);
        await page.goto(`/campaigns/${campaignId}`);
        await page.getByRole("button", { name: "Fear 2 of 12" }).click();
        await expect(page.getByTestId("fear-value")).toHaveText("II");
        await page.goto(playUrl);
        await expect(tally.getByRole("definition")).toHaveText(["2", "0", "0", "0"]);

        // ---- Combat Map (B11, Q2): '＋ Session encounter' starts the encounter and places both Bandits.
        await page.goto(`/campaigns/${campaignId}/combat-map`);
        const combatants = page.getByRole("complementary", { name: "Map tools" }).getByRole("region", { name: "Combatants" });
        const place = combatants.getByRole("button", { name: "＋ Session encounter" });
        await expect(place).toBeEnabled();
        await expect(place).toHaveAttribute("title", "Session 1: 2× Standard");
        await place.click();
        await expect(combatants.getByRole("status")).toHaveText("Added Session 1's encounter.");
        await expect(page.getByRole("region", { name: "Battle map" }).getByTestId("combat-token")).toHaveCount(2);
        await expect(combatants.getByTestId("combat-token-count")).toHaveText("0 party · 2 enemies");

        // ---- End, keeping Wither (house rule, checkbox unticked): the tokens stay on the sheet and Fear stays 2.
        const tokens = await witherToken(client, ash as Id<"characters">);
        await page.goto(playUrl);
        const liveCard = page.getByRole("region", { name: "Live session" });
        await liveCard.getByRole("button", { name: "End session" }).click();
        const endDialog = page.getByRole("dialog", { name: "End the session?" });
        const convert = endDialog.getByRole("checkbox", { name: /Turn Wither tokens into Fear \(CB p\.261\)/ });
        await expect(convert).toBeChecked();
        await convert.uncheck();
        await expect(endDialog).toContainText("Wither tokens stay on the PCs' sheets.");
        await endDialog.getByRole("button", { name: "End session" }).click();
        await expect(page).toHaveURL(/stage=wrap/);
        await expect(liveCard.getByRole("status")).toContainText("stay on the sheets.");
        await expect.poll(async () => (await client.query(api.characters.get, { characterId: ash }))?.sheet.wither ?? 0).toBe(tokens);
        await page.getByRole("tab", { name: "Play" }).click();
        await expect(tally.getByRole("definition")).toHaveText(["2", "0", "0", "0"]);
        await expectFear(page, campaignId, 2);
        const witherPanel = page.getByRole("region", { name: "Wither Tokens" });
        await expect(witherPanel.getByTestId("wither-panel-count")).toHaveText(`${tokens} on sheets · ${20 - tokens} in pool`);

        // ---- Start Session 1 again (B7), then End from the dashboard's Wither panel converting the tokens (B12, K4).
        await page.goto(`${url}?s=${sessionId}&stage=wrap`);
        await expect(liveCard).toContainText("This session has been played. Starting it again re-rolls Prayer Dice and refreshes Rally.");
        await liveCard.getByRole("button", { name: "Start session" }).click();
        await startDialog.getByRole("button", { name: "Start session" }).click();
        await expect(page).toHaveURL(/stage=play/);
        await expect(liveCard).toContainText("Session in progress");
        await page.goto(`/campaigns/${campaignId}`);
        await witherPanel.getByRole("button", { name: `End Session · convert ${tokens} to Fear` }).click();
        await expect(endDialog.getByRole("checkbox", { name: /Turn Wither tokens into Fear/ })).toBeChecked();
        await endDialog.getByRole("button", { name: "End session" }).click();
        await expect(witherPanel.getByRole("status")).toContainText(`${tokens} Wither token${tokens === 1 ? "" : "s"} → +${tokens} Fear.`);
        await expect(witherPanel.getByTestId("wither-panel-count")).toHaveText("0 on sheets · 20 in pool");
        await expectFear(page, campaignId, Math.min(12, 2 + tokens));

        // ---- Wrap-up (B5, Q5): recap, loot, threads, the milestone with its confirm.
        await page.goto(`${url}?s=${sessionId}&stage=wrap`);
        const stage = page.getByRole("region", { name: "Wrap-up stage" });
        const recap = stage.getByRole("textbox", { name: "Recap" });
        await recap.fill(RECAP);
        await expect.poll(async () => (await client.query(api.sessionWrap.get, { campaignId, sessionId }))?.recap).toBe(RECAP);
        await stage.getByRole("textbox", { name: "Loot & gold" }).fill(LOOT);
        const threads = stage.getByRole("textbox", { name: "Countdowns & threads" });
        await threads.click();
        await threads.fill(THREADS);
        await threads.blur();
        await expect.poll(async () => (await client.query(api.sessionWrap.get, { campaignId, sessionId }))?.threads).toBe(THREADS);
        expect((await client.query(api.sessionWrap.get, { campaignId, sessionId }))?.loot).toBe(LOOT);
        const milestone = stage.getByRole("button", { name: "Milestone reached: the party levels up" });
        await milestone.click();
        await stage.getByRole("button", { name: "Level up the party" }).click();
        await expect(stage.getByRole("status").filter({ hasText: "can level up" })).toHaveText("2 characters can level up.");
        await expect(milestone).toHaveAttribute("aria-pressed", "true");
        await stage.getByRole("link", { name: "Open Party to level up →" }).click();
        await expect(page).toHaveURL(`/campaigns/${campaignId}/party`);
        for (const name of ["Seren", "Ash"]) await expect(page.getByRole("article", { name }).getByTestId("level-up-pending")).toBeVisible();

        // ---- The dashboard's Last Session card (B9) for the GM.
        await page.goto(`/campaigns/${campaignId}`);
        await expect(hero.getByTestId("hero-session")).toHaveText("Session 1");
        await expect(page.getByRole("region", { name: "Last Session" }).getByTestId("last-session-text")).toHaveText(RECAP);
        await expect(hero.getByRole("button", { name: "Start Session", exact: true })).toBeVisible();

        // ---- The player: the recap on the dashboard and in the read-only Sessions view; nothing else (K10, Q4).
        await player.goto(`/campaigns/${campaignId}`);
        await expect(playerHero.getByTestId("hero-session")).toHaveText("Session 1");
        await expect(playerHero.getByText("Session 1 in progress")).toHaveCount(0);
        await expect(player.getByRole("region", { name: "Last Session" }).getByTestId("last-session-text")).toHaveText(RECAP);
        for (const stageName of ["", "&stage=prep", "&stage=play", "&stage=wrap"]) {
          await player.goto(`${url}?s=${sessionId}${stageName}`);
          const items = player.getByRole("complementary", { name: "Session list" }).getByRole("button");
          await expect(items).toHaveCount(1);
          await expect(items.first().locator(".ss-chip")).toHaveText("Played");
          const view = player.getByRole("region", { name: "Session detail" }).getByRole("region", { name: "Session", exact: true });
          await expect(view.getByRole("heading", { name: "The Ford at Dawn" })).toBeVisible();
          await expect(view.getByText(RECAP)).toBeVisible();
          await expect(player.getByRole("tablist", { name: "Session stage" })).toHaveCount(0);
          await expect(player.getByRole("tab")).toHaveCount(0);
          for (const hidden of [HOOKS, "Ambush at the ford", "Session 1 encounter", LOG_LINE, LOOT, THREADS]) await expect(player.getByText(hidden)).toHaveCount(0);
          for (const region of ["Spotlight", "Session tally", "Session log", "Wrap-up stage", "Live session"]) await expect(player.getByRole("region", { name: region })).toHaveCount(0);
          await expect(player.getByRole("textbox")).toHaveCount(0);
        }
      } finally {
        await close();
      }
    });
  });
}
