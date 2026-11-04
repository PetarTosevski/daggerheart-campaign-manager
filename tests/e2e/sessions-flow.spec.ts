import type { ConvexHttpClient } from "convex/browser";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cardsForDomains, getClass } from "../../src/lib/srd/index";
import { signInAsTestGm } from "./fixtures";
import { openMapTools } from "./hud/helpers";
import { bardDraft, endFromJournal, journalLiveChip, journalReport, openSessions } from "./visual/helpers";

// D10 S9 in the Journal (Journal JX2; the old Sessions page is gone): one GM-and-player session from the plan to the
// dashboard's Last Session card, at 1440x900 and 1024x768. The GM plans Session 1 in the Journal (title, a Combat and
// a Social scene, the GM prep note, the Combat scene's encounter), starts it from the dashboard (with its confirm) and
// lands on its Log & recap, adds a log line, raises Fear (the tally follows), places the session encounter with the
// Combat Map's '＋ Session encounter' (its scene turns 'Playing now', Q7), ends it from the Journal's live chip keeping
// the Wither tokens on the sheets, and writes the recap and the loot. The player sees 'Session 1 in progress' while it
// runs, then the recap and the log on the dashboard and in the Journal, and never the plan, the prep, the loot or the
// GM controls (Q5). The pieces are covered in depth by the journal-* specs; this one checks they join up.

const PLAYER = "e2e-player@example.test";
const RECAP = "The party held the ford against the Jagged Knife Bandits and Seren's prayers turned the tide.";
const LOOT = "Forty gold and a bandit's silver horn";
const PREP = "The ferryman owes the bandits a toll.";
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

const list = (page: Page) => page.getByRole("complementary", { name: "All sessions" }).getByRole("list", { name: "Sessions" });
const head = (page: Page) => page.locator(".jr-heading-slot");
const plan = (page: Page) => page.getByRole("region", { name: "Planned scenes" });
const scene = (page: Page, n: number) => plan(page).getByRole("listitem", { name: `Scene ${n}`, exact: true });
const logOf = (page: Page) => page.getByRole("region", { name: "Session log" });

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
]) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("a session from the plan to the Last Session card, for the GM and a player", async ({ page, browser }) => {
      test.setTimeout(300_000);
      const { client, campaignId, campaignName, url } = await openSessions(page);
      const uuid = () => crypto.randomUUID();
      await client.mutation(api.characters.create, { campaignId, draft: seraphDraft("Seren"), idempotencyKey: uuid() });
      const ash = (await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Ash"), idempotencyKey: uuid() })).characterId;
      await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Ford", idempotencyKey: uuid() });
      const { player, close } = await playerJoins(page, browser, campaignId, campaignName);
      try {
        // ---- Plan (B1, B3, Q6): a titled session, a Combat and a Social scene, the GM prep, the Combat scene's encounter.
        await page.goto(url);
        await page.getByRole("button", { name: "Plan session 1" }).click();
        await expect(page).toHaveURL(/sv=plan/);
        const sessionId = new URL(page.url()).searchParams.get("s")! as Id<"sessions">;
        await head(page).getByRole("button", { name: "Untitled session" }).click();
        await head(page).getByRole("textbox", { name: "Session 1 title" }).fill("The Ford at Dawn");
        await head(page).getByRole("textbox", { name: "Session 1 title" }).press("Enter");
        await expect(head(page).getByRole("heading", { level: 2, name: "The Ford at Dawn" })).toBeVisible();

        await plan(page).getByRole("button", { name: "Add scene" }).click();
        await expect(scene(page, 1).getByText("Combat", { exact: true })).toBeVisible();
        await scene(page, 1).getByRole("textbox", { name: "Scene 1 title" }).fill("Ambush at the ford");
        await scene(page, 1).getByRole("textbox", { name: "Scene 1 title" }).press("Enter");
        await plan(page).getByRole("button", { name: "Add scene" }).click();
        await scene(page, 2).getByRole("button", { name: "Scene 2 options" }).click();
        await scene(page, 2).getByRole("button", { name: "Social", exact: true }).click();
        await expect(scene(page, 2).getByText("Social", { exact: true })).toBeVisible();
        await scene(page, 2).getByRole("textbox", { name: "Scene 2 title" }).fill("Bargain with the ferryman");
        await scene(page, 2).getByRole("textbox", { name: "Scene 2 title" }).press("Enter");

        const prep = plan(page).locator(".jp-prep");
        await prep.getByRole("button", { name: "Edit GM prep" }).click();
        await prep.getByRole("textbox", { name: "GM prep" }).fill(PREP);
        await prep.getByRole("textbox", { name: "GM prep" }).blur();
        await expect(prep.getByText(PREP)).toBeVisible();

        const encounterCard = scene(page, 1).getByTestId("scene-encounter");
        await encounterCard.getByRole("button", { name: "Create encounter" }).click();
        await expect(encounterCard.getByRole("heading", { name: /^Encounter · / })).toBeVisible();
        await expect.poll(async () => (await client.query(api.sessionPrep.get, { campaignId, sessionId }))?.scenes[0]?.encounterId).toBeTruthy();
        const encounterId = (await client.query(api.sessionPrep.get, { campaignId, sessionId }))!.scenes[0]!.encounterId!;
        await client.mutation(api.encounters.addAdversary, {
          campaignId,
          encounterId,
          source: { kind: "srd", adversaryId: "jagged-knife-bandit" },
          count: 2,
          summoned: false,
          idempotencyKey: uuid(),
        });
        await expect(encounterCard.getByRole("list", { name: "Adversaries in this encounter" }).getByRole("listitem")).toHaveText([/Bandit ×2/]);
        await expect.poll(async () => (await client.query(api.sessionPrep.get, { campaignId, sessionId }))?.hooks).toBe(PREP);
        await page.reload();
        await expect(scene(page, 2).getByRole("textbox", { name: "Scene 2 title" })).toHaveValue("Bargain with the ferryman");
        await expect(head(page).getByRole("heading", { level: 2, name: "The Ford at Dawn" })).toBeVisible();

        // The player never sees a planned session (Q5).
        await player.goto(url);
        await expect(player.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
        await expect(list(player).getByRole("button")).toHaveCount(0);
        await expect(player.getByText("The Ford at Dawn")).toHaveCount(0);

        // ---- Start from the dashboard (B8): a confirm, then Session 1 opens on its Log & recap (B10, K3: Prayer Dice).
        await page.goto(`/campaigns/${campaignId}`);
        const hero = page.getByRole("region", { name: "Campaign header" });
        await hero.getByRole("button", { name: "Start Session", exact: true }).click();
        const startDialog = page.getByRole("dialog", { name: "Start the session?" });
        await startDialog.getByRole("button", { name: "Cancel" }).click();
        await expect(startDialog).toBeHidden();
        await expect(page).toHaveURL(`/campaigns/${campaignId}`);
        await hero.getByRole("button", { name: "Start Session", exact: true }).click();
        await startDialog.getByRole("button", { name: "Start session" }).click();
        await expect(page).toHaveURL(new RegExp(`/journal\\?s=${sessionId}&sv=log$`));
        await expect(journalLiveChip(page)).toContainText("Session 1 · live");
        const lines = logOf(page).getByRole("listitem");
        await expect(lines.filter({ hasText: /Session started\. Seren rolled Prayer Dice: [1-4], [1-4]\./ })).toHaveCount(1);
        const logUrl = page.url();

        // The player's dashboard: 'Session 1 in progress', no button.
        await player.goto(`/campaigns/${campaignId}`);
        const playerHero = player.getByRole("region", { name: "Campaign header" });
        await expect(playerHero.getByText("Session 1 in progress")).toBeVisible();
        await expect(playerHero.getByRole("button", { name: "Start Session", exact: true })).toHaveCount(0);

        // ---- Play: a GM log line; the tally after a Fear change.
        const add = logOf(page).getByRole("textbox", { name: "New log entry" });
        await add.fill(LOG_LINE);
        await logOf(page).getByRole("button", { name: "Add" }).click();
        await expect(lines.filter({ hasText: LOG_LINE })).toHaveCount(1);
        const fearTile = page.getByRole("region", { name: "Session tally" }).getByRole("listitem").filter({ hasText: "Fear gained" });
        await expect(fearTile).toHaveText("0 Fear gained");
        await page.goto(`/campaigns/${campaignId}`);
        await page.getByRole("button", { name: "Fear 2 of 12" }).click();
        await expect(page.getByTestId("fear-value")).toHaveText("II");
        await page.goto(logUrl);
        await expect(fearTile).toHaveText("2 Fear gained");

        // ---- Combat Map (B11, Q7): '＋ Session encounter' starts the encounter, places both Bandits and plays scene 1.
        await page.goto(`/campaigns/${campaignId}/combat-map`);
        await openMapTools(page);
        const combatants = page.getByRole("complementary", { name: "Map tools" }).getByRole("region", { name: "Combatants" });
        const place = combatants.getByRole("button", { name: "＋ Session encounter" });
        await expect(place).toBeEnabled();
        await place.click();
        await expect(combatants.getByRole("status")).toHaveText("Added Session 1's encounter.");
        await expect(page.getByRole("region", { name: "Battle map" }).getByTestId("combat-token")).toHaveCount(2);
        await page.goto(`${url}?s=${sessionId}&sv=plan`);
        await expect(scene(page, 1).getByText("Playing now")).toBeVisible();

        // ---- End from the Journal's live chip, keeping Wither: the tokens stay on the sheet and Fear stays 2.
        const tokens = await witherToken(client, ash as Id<"characters">);
        await page.goto(logUrl);
        await endFromJournal(page, { convertWither: false });
        await expect(journalReport(page)).toContainText("stay on the sheets.");
        await expect.poll(async () => (await client.query(api.charactersReads.get, { characterId: ash }))?.sheet.wither ?? 0).toBe(tokens);
        await expect(page.getByRole("region", { name: "Session tally" }).getByRole("listitem").filter({ hasText: "Fear gained" })).toHaveText("2 Fear gained");
        await expectFear(page, campaignId, 2);
        await expect(page.getByTestId("wither-panel-count")).toHaveText(`${tokens} on sheets · ${20 - tokens} in pool`);

        // ---- Log & recap (Q4): the recap and the loot.
        await page.goto(logUrl);
        const recapCard = page.getByRole("region", { name: "Recap" });
        await recapCard.getByRole("button", { name: "Write the recap" }).click();
        await recapCard.getByRole("textbox", { name: "Recap" }).fill(RECAP);
        await recapCard.getByRole("button", { name: "Save recap" }).click();
        await expect(recapCard.getByText(RECAP)).toBeVisible();
        const after = page.getByRole("region", { name: "After the session" });
        await after.getByRole("button", { name: /^Edit loot/ }).click();
        await after.getByRole("textbox", { name: "Loot" }).fill(LOOT);
        await after.getByRole("textbox", { name: "Loot" }).press("Enter");
        await expect(after.getByRole("button", { name: `Edit loot: ${LOOT}` })).toBeVisible();
        await expect.poll(async () => (await client.query(api.sessionWrap.get, { campaignId, sessionId }))?.recap).toBe(RECAP);
        await expect.poll(async () => (await client.query(api.sessionWrap.get, { campaignId, sessionId }))?.loot).toBe(LOOT);

        // ---- The dashboard's Last Session card (B9) for the GM.
        await page.goto(`/campaigns/${campaignId}`);
        await expect(hero.getByTestId("hero-session")).toHaveText("Session 1");
        await expect(page.getByRole("region", { name: "Last Session" }).getByTestId("last-session-text")).toHaveText(RECAP);
        await expect(hero.getByRole("button", { name: "Start Session", exact: true })).toBeVisible();

        // ---- The player: the recap on the dashboard; in the Journal the session, its recap and log, nothing else (Q5).
        await player.goto(`/campaigns/${campaignId}`);
        await expect(playerHero.getByTestId("hero-session")).toHaveText("Session 1");
        await expect(playerHero.getByText("Session 1 in progress")).toHaveCount(0);
        await expect(player.getByRole("region", { name: "Last Session" }).getByTestId("last-session-text")).toHaveText(RECAP);
        for (const view of ["", "&sv=plan", "&sv=log"]) {
          await player.goto(`${url}?s=${sessionId}${view}`);
          await expect(list(player).getByRole("button")).toHaveCount(1);
          await expect(head(player).getByRole("heading", { level: 2, name: "The Ford at Dawn" })).toBeVisible();
          await expect(player.getByRole("region", { name: "Recap" }).getByText(RECAP)).toBeVisible();
          await expect(logOf(player).getByRole("listitem").filter({ hasText: LOG_LINE })).toHaveCount(1);
          await expect(player.getByRole("tablist", { name: "Session view" })).toHaveCount(0);
          // The played scene shows in the log (its encounter and "Scene 1 began", Q7); the unplayed one nowhere.
          for (const hidden of [PREP, "Bargain with the ferryman", LOOT]) await expect(player.getByText(hidden)).toHaveCount(0);
          for (const region of ["Planned scenes", "Session tally", "Spotlight", "After the session"]) await expect(player.getByRole("region", { name: region })).toHaveCount(0);
          await expect(player.getByRole("button", { name: /^Start session/ })).toHaveCount(0);
          await expect(logOf(player).getByRole("textbox")).toHaveCount(0);
        }
      } finally {
        await close();
      }
    });
  });
}
