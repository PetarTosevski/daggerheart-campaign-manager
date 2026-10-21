import { execFileSync } from "node:child_process";

import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Browser, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { cardsForDomains, getClass } from "../../src/lib/srd";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import { signInAsTestGm } from "./fixtures";

// Plan session-features F4: one browser flow through a whole session with all four features (K1-K4, U1-U9, Q1), at
// 1440x900 and 1024x768. A Hope & Fear Witherwild campaign; the GM plays Pip (Halfling Warrior), Bryn (Call of the
// Slayer Warrior) and Mira (Moon Witch); a player who joined by code plays Kai (Halfling, Seaborne Warrior).
//
// Real APIs throughout: the GM starts and ends the session in the live card, rolls come through rolls.manualRoll
// (fixed dice) or the dice box (server dice), the Slayer Die is stored and spent in the dice box, the Tide token is
// placed by rolls and spent in the player's dice box, the Tag Team is started by the GM and picked by the player (U9),
// the New Moon negates Minor damage in the damage calculator, the bump is the Lunar Phases button, and the End is
// undone from the dashboard feed. Seeding (internal sessionFeatures:seedForE2e, local e2e backend only) is used for
// two things no public call sets: Mira's mastery and level, and - only when the session start rolled anything else -
// a moon die of 1, because the server's d6 cannot be fixed from the browser and the New Moon step needs it.

const PLAYER = "e2e-player@example.test";
const action = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };
const common = { pronouns: "", description: "", potion: "Minor Health Potion", classItem: "", background: [], connections: [] };

const warriorDraft = (name: string, change: { subclassId?: string; communityId?: string; ancestry?: string } = {}) => ({
  ...common,
  classId: "warrior",
  subclassId: change.subclassId ?? "call-of-the-brave",
  ancestry: { kind: "single", id: change.ancestry ?? "elf" },
  communityId: change.communityId ?? "loreborne",
  traits: { agility: 2, strength: 1, finesse: 0, instinct: 1, presence: -1, knowledge: 0 },
  name,
  primaryWeaponId: "longsword",
  armorId: "chainmail-armor",
  experiences: ["Sellsword", "Brawler"],
  domainCards: ["get-back-up", "not-good-enough"],
});

const moonWitchDraft = (name: string) => ({
  ...common,
  classId: "witch",
  subclassId: "moon",
  ancestry: { kind: "single", id: "elf" },
  communityId: "loreborne",
  traits: { agility: 0, strength: -1, finesse: 1, instinct: 2, presence: 1, knowledge: 0 },
  name,
  primaryWeaponId: "dagger",
  armorId: "gambeson-armor",
  experiences: ["Night walker", "Herbalist"],
  domainCards: cardsForDomains(getClass("witch")!.domains, 1)
    .filter((c) => c.level === 1)
    .slice(0, 2)
    .map((c) => c.id),
});

/** A Convex client authenticated as the page's signed-in user. */
async function convexAs(page: Page): Promise<ConvexHttpClient> {
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("__convexAuthJWT"));
    return key ? localStorage.getItem(key) : null;
  });
  expect(token, "Convex Auth token in localStorage").toBeTruthy();
  const client = new ConvexHttpClient(process.env.E2E_CONVEX_URL!);
  client.setAuth(token!);
  return client;
}

type Seed = { characterId: string; subclassRank?: "mastery"; level?: number; moonDie?: number };
/** Internal sessionFeatures:seedForE2e on the local e2e backend (admin key through the Convex CLI). */
function seed(args: Seed): void {
  execFileSync(process.execPath, ["scripts/convex-e2e.mjs", "run", "sessionFeatures:seedForE2e", JSON.stringify(args)], { stdio: "pipe" });
}

/** The GM starts a Hope & Fear Witherwild campaign; a player joins it by code in their own browser context. */
async function campaignWithPlayer(page: Page, browser: Browser, viewport: { width: number; height: number }) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Tides ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
  const gm = await convexAs(page);
  await gm.mutation(api.campaigns.setOption, { campaignId, option: "hopeAndFear", enabled: true });

  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();

  const context = await browser.newContext({ viewport });
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  await player.getByRole("button", { name: /Join Campaign/ }).click();
  await player.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await player.getByRole("button", { name: "Join", exact: true }).click();
  await expect(player.getByRole("heading", { level: 1, name })).toBeVisible();
  return { campaignId, gm, player, playerClient: await convexAs(player), close: () => context.close() };
}

const diceBox = (page: Page) => page.getByRole("region", { name: "Dice", exact: true });
const liveCard = (page: Page) => page.getByRole("region", { name: "Live session" });
const chips = (page: Page, name: string) => page.getByRole("article", { name }).getByRole("list", { name: "Session features" });

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
]) {
  test.describe(`at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("a whole session: Luckbringer and the moon die at Start, Slayer, Tide, Tag Team, Lunar Phases, End and its undo", async ({ page, browser }) => {
      test.setTimeout(240_000);
      const { campaignId, gm, player, playerClient, close } = await campaignWithPlayer(page, browser, viewport);
      const create = async (client: ConvexHttpClient, draft: object) =>
        (await client.mutation(api.characters.create, { campaignId, draft: draft as never, idempotencyKey: crypto.randomUUID() })).characterId as Id<"characters">;
      const pip = await create(gm, warriorDraft("Pip", { ancestry: "halfling" }));
      const bryn = await create(gm, warriorDraft("Bryn", { subclassId: "call-of-the-slayer" }));
      const mira = await create(gm, moonWitchDraft("Mira"));
      const kai = await create(playerClient, warriorDraft("Kai", { ancestry: "halfling", communityId: "seaborne" }));
      seed({ characterId: mira, subclassRank: "mastery", level: 7 });
      // Pip at Hope 5: the stacked Luckbringer +2 stops at the maximum of 6 (K6).
      const pipHope = (await gm.query(api.characters.get, { characterId: pip }))!.sheet.hope;
      await gm.mutation(api.characters.adjustResource, { characterId: pip, resource: "hope", delta: 5 - pipHope });
      const sheetOf = async (id: Id<"characters">) => (await gm.query(api.characters.get, { characterId: id }))!.sheet as CharacterSheet;
      const hopes = async () => Promise.all([pip, bryn, mira, kai].map(async (id) => (await sheetOf(id)).hope));
      const before = await hopes();

      // ---- Start (K1, U1, K4, U6): two active Halflings give every active PC 2 Hope, capped; Mira's moon die is rolled.
      await page.goto(`/campaigns/${campaignId}/sessions`);
      await page.getByRole("button", { name: "+ New session" }).click();
      await expect(page).toHaveURL(/stage=prep$/);
      const playUrl = page.url().replace(/stage=prep$/, "stage=play");
      await liveCard(page).getByRole("button", { name: "Start session" }).click();
      await page.getByRole("dialog", { name: "Start the session?" }).getByRole("button", { name: "Start session" }).click();
      const report = liveCard(page).getByRole("status").locator("p");
      await expect(report.nth(0)).toHaveText("Session started.");
      await expect(report.nth(1)).toHaveText("Luckbringer (Pip, Kai): everyone gains 2 Hope.");
      await expect(report.nth(2)).toHaveText(/^Mira's moon die: [1-6] \((New|Waxing|Full|Waning): .+\)\.$/);
      expect(await hopes()).toEqual(before.map((h) => Math.min(6, h + 2)));
      const rolled = (await sheetOf(mira)).sessionFeatures?.moonDie;
      expect(rolled).toBeGreaterThanOrEqual(1);
      expect(rolled).toBeLessThanOrEqual(6);
      // The session log stamps the same notes after 'Session started.'.
      await page.goto(playUrl);
      const log = page.getByRole("region", { name: "Session log" }).getByRole("list", { name: "Log entries, newest first" }).getByRole("listitem");
      await expect(log.filter({ hasText: "Session started." }).filter({ hasText: "Luckbringer (Pip, Kai): everyone gains 2 Hope" }).filter({ hasText: `Mira's moon die: ${rolled} (` })).toHaveCount(1);

      // ---- Lunar Phases (U6, U7): the chip and the section show the rolled die.
      await page.goto(`/campaigns/${campaignId}/party/${mira}`);
      const miraSheet = page.getByRole("article", { name: "Mira" });
      const lunar = miraSheet.getByRole("region", { name: "Lunar Phases" });
      await expect(lunar.getByLabel(`Moon die ${rolled}`)).toBeVisible();
      await expect(chips(page, "Mira")).toContainText(`Moon die ${rolled}:`);
      if (rolled !== 1) {
        // The server's d6 cannot be fixed from the browser; the New Moon step needs a 1.
        seed({ characterId: mira, moonDie: 1 });
        await page.reload();
      }
      await expect(lunar.getByLabel("Moon die 1")).toBeVisible();
      await expect(lunar.locator("[aria-current='true']")).toContainText("New");

      // New Moon: Minor damage is negated for a Hope, no Hit Point marked (K4, U6).
      const miraBefore = await sheetOf(mira);
      const take = miraSheet.getByRole("group", { name: "Take damage" });
      await take.getByLabel("Damage roll").fill("1");
      await take.getByRole("button", { name: "Spend a Hope to negate this Minor damage" }).click();
      await expect(take).toContainText("The New Moon negates the Minor damage");
      await expect.poll(async () => (await sheetOf(mira)).hope).toBe(miraBefore.hope - 1);
      expect((await sheetOf(mira)).hp).toBe(miraBefore.hp);

      // The bump: a Hope, 1 -> 2 (Waxing), once per rest.
      const bump = lunar.getByRole("button", { name: /Spend a Hope: \+1 to the moon die/ });
      await bump.click();
      await expect(lunar.locator("[aria-current='true']")).toContainText("Waxing");
      await expect.poll(async () => (await sheetOf(mira)).sessionFeatures?.moonDie).toBe(2);
      expect((await sheetOf(mira)).hope).toBe(miraBefore.hope - 2);
      await page.reload();
      await expect(lunar.getByLabel("Moon die 2")).toBeVisible();
      await expect(bump).toBeDisabled();
      await expect(chips(page, "Mira")).toContainText("Moon die 2: Waxing");
      // Waxing: +2 to damage rolls, applied automatically (U6).
      const miraBox = diceBox(page);
      await miraBox.getByText("Damage", { exact: true }).click();
      await miraBox.getByRole("button", { name: "Roll", exact: true }).click();
      // Dagger d8+1: the flat part is 1 + 2. The box's result line does not name the bonus (G2, dcm-bxp.66); the feed does.
      await expect(miraBox.getByTestId("last-roll")).toContainText(/\(\d \+ 3\)/);
      const feed = await gm.query(api.feed.list, { campaignId, paginationOpts: { numItems: 3, cursor: null } });
      expect(feed.page[0]!.summary).toMatch(/^Mira: damage \d+ \(Dagger, Waxing Moon \+2\)$/);

      // ---- Tag Team (Q1, U9): the GM starts it from Bryn's box; the player picks Kai's roll in Kai's box.
      await page.goto(`/campaigns/${campaignId}/party/${bryn}`);
      const brynBox = diceBox(page);
      await brynBox.getByRole("button", { name: "Tag Team Roll…" }).click();
      const tag = brynBox.getByRole("region", { name: "Tag Team Roll" });
      await tag.getByRole("combobox", { name: "Partner", exact: true }).selectOption({ label: "Kai" });
      await tag.getByRole("button", { name: "Roll together (3 Hope)" }).click();
      await expect(tag.getByRole("button", { name: "Use Kai’s roll" })).toBeVisible();
      const pending = (await playerClient.query(api.rolls.pendingChoices, { characterId: kai })).tagTeam;
      expect(pending, "the Tag Team pick waits in Kai's box too").not.toBeNull();
      const kaiRoll = pending!.rolls.find((r) => r.characterId === kai)!.roll;
      const tagHope = await hopes();
      const tagTokens = (await sheetOf(kai)).sessionFeatures?.tideTokens ?? 0;
      await player.goto(`/campaigns/${campaignId}/party/${kai}`);
      const kaiBox = diceBox(player);
      await kaiBox.getByRole("button", { name: "Use Kai’s roll" }).click();
      // The pick closes in both boxes. (The partner, who never opened the panel, gets no "counts for both" line: see
      // TASK-SF-F4 G1, dcm-bxp.67.)
      await expect(kaiBox.getByRole("button", { name: "Use Kai’s roll" })).toHaveCount(0);
      const withFear = kaiRoll.outcome === "successFear" || kaiRoll.outcome === "failFear";
      const withHope = kaiRoll.outcome === "successHope" || kaiRoll.outcome === "failHope" || kaiRoll.outcome === "critical";
      // A roll with Fear places a Tide token for Kai (level 1: at most 1); with Hope both gain a Hope (capped).
      await expect.poll(async () => (await sheetOf(kai)).sessionFeatures?.tideTokens ?? 0).toBe(withFear ? Math.min(1, tagTokens + 1) : tagTokens);
      if (withHope) {
        const after = await hopes();
        expect(after[1]).toBe(Math.min(6, tagHope[1]! + 1));
        expect(after[3]).toBe(Math.min(6, tagHope[3]! + 1));
        // Q1: the chosen roll with Hope offers Bryn the Slayer choice (her pool of 1 is empty).
        expect((await gm.query(api.rolls.pendingChoices, { characterId: bryn })).slayer).not.toBeNull();
      }

      // ---- Slayer (K2, U2, U3): a roll with Hope -> store a Slayer Die instead of the Hope; spend it on damage.
      const brynHope = (await sheetOf(bryn)).hope;
      await gm.mutation(api.rolls.manualRoll, { characterId: bryn, roll: action, values: [8, 3], idempotencyKey: crypto.randomUUID() });
      await page.reload();
      await expect(brynBox.getByRole("group", { name: "Tide tokens to spend" })).toHaveCount(0);
      const choice = brynBox.getByRole("group", { name: "Take the Hope or store a Slayer Die?" });
      await choice.getByRole("button", { name: "Store a Slayer Die" }).click();
      await expect(choice).toHaveCount(0);
      await expect.poll(async () => (await sheetOf(bryn)).sessionFeatures?.slayerDice).toBe(1);
      expect((await sheetOf(bryn)).hope).toBe(brynHope);
      await expect(chips(page, "Bryn")).toContainText("Slayer Dice 1/1");
      await brynBox.getByText("Damage", { exact: true }).click();
      const slayerStepper = brynBox.getByRole("group", { name: "Slayer Dice to spend" });
      await slayerStepper.getByRole("button", { name: "Increase Slayer Dice to spend" }).click();
      await brynBox.getByRole("button", { name: "Roll", exact: true }).click();
      await expect(brynBox.getByRole("listitem", { name: /^Slayer d6: [1-6]$/ })).toHaveCount(1);
      await expect.poll(async () => (await sheetOf(bryn)).sessionFeatures?.slayerDice ?? 0).toBe(0);
      // A second roll with Hope stores another die, left for the End.
      await gm.mutation(api.rolls.manualRoll, { characterId: bryn, roll: action, values: [8, 3], idempotencyKey: crypto.randomUUID() });
      await page.reload();
      await choice.getByRole("button", { name: "Store a Slayer Die" }).click();
      await expect.poll(async () => (await sheetOf(bryn)).sessionFeatures?.slayerDice).toBe(1);

      // ---- Know the Tide (K3, U4, U5), in the player's browser: a roll with Fear places a token; spend it for +1.
      await playerClient.mutation(api.rolls.manualRoll, { characterId: kai, roll: action, values: [3, 8], idempotencyKey: crypto.randomUUID() });
      expect((await sheetOf(kai)).sessionFeatures?.tideTokens).toBe(1);
      await player.reload();
      const tideStepper = kaiBox.getByRole("group", { name: "Tide tokens to spend" });
      await expect(kaiBox.getByText("1 held (+1 each)")).toBeVisible();
      await expect(chips(player, "Kai")).toContainText("Tide tokens 1/1");
      await expect(kaiBox.getByRole("group", { name: "Slayer Dice to spend" })).toHaveCount(0);
      await tideStepper.getByRole("button", { name: "Increase Tide tokens to spend" }).click();
      await kaiBox.getByRole("button", { name: "Roll", exact: true }).click();
      await expect(kaiBox.getByTestId("last-roll")).toContainText("Know the Tide +1");
      // The spending roll's own dice are the server's; a fixed roll with Fear leaves exactly one token for the End.
      await playerClient.mutation(api.rolls.manualRoll, { characterId: kai, roll: action, values: [2, 9], idempotencyKey: crypto.randomUUID() });
      expect((await sheetOf(kai)).sessionFeatures?.tideTokens).toBe(1);

      // ---- The player sees only their own steppers; the other sheets show no Lunar Phases section (U5, U6).
      await expect(player.getByRole("article", { name: "Kai" }).getByRole("region", { name: "Lunar Phases" })).toHaveCount(0);
      for (const [id, name] of [[bryn, "Bryn"], [pip, "Pip"]] as const) {
        await player.goto(`/campaigns/${campaignId}/party/${id}`);
        await expect(player.getByRole("article", { name }).getByRole("heading", { level: 1, name })).toBeVisible();
        await expect(diceBox(player)).toHaveCount(0);
        await expect(player.getByRole("group", { name: "Slayer Dice to spend" })).toHaveCount(0);
        await expect(player.getByRole("group", { name: "Tide tokens to spend" })).toHaveCount(0);
        await expect(player.getByRole("article", { name }).getByRole("region", { name: "Lunar Phases" })).toHaveCount(0);
      }
      await page.goto(`/campaigns/${campaignId}/party/${pip}`);
      await expect(page.getByRole("article", { name: "Pip" }).getByRole("heading", { level: 1, name: "Pip" })).toBeVisible();
      await expect(diceBox(page).getByRole("group", { name: "Tide tokens to spend" })).toHaveCount(0);
      await expect(page.getByRole("article", { name: "Pip" }).getByRole("region", { name: "Lunar Phases" })).toHaveCount(0);

      // ---- End (K2, K3, U8): Slayer Dice -> Hope, Tide tokens cleared, the moon die ends; the report lists it.
      const preEnd = await hopes();
      await page.goto(playUrl);
      await liveCard(page).getByRole("button", { name: "End session" }).click();
      await page.getByRole("dialog", { name: "End the session?" }).getByRole("button", { name: "End session" }).click();
      const status = liveCard(page).getByRole("status");
      await expect(report.nth(0)).toHaveText("Session ended.");
      const brynGain = Math.min(6, preEnd[1]! + 1) - preEnd[1]!;
      await expect(status).toContainText(`Bryn cleared 1 Slayer Die: +${brynGain} Hope.`);
      await expect(status).toContainText("Kai cleared 1 Tide token.");
      await expect(status).toContainText("Mira's moon die ends.");
      expect(await hopes()).toEqual([preEnd[0], preEnd[1]! + brynGain, preEnd[2], preEnd[3]]);
      // The pools are gone (Bryn keeps only `slayerClaim`, the id of the roll she last answered).
      for (const id of [bryn, kai, mira]) {
        const left = (await sheetOf(id)).sessionFeatures ?? {};
        expect([left.slayerDice, left.tideTokens, left.moonDie]).toEqual([undefined, undefined, undefined]);
      }

      // ---- Undo the End from the dashboard feed: the dice, the token, the die and Bryn's Hope come back (E1, U8).
      await page.goto(`/campaigns/${campaignId}`);
      const endRow = page.getByRole("list", { name: "Rolls" }).getByRole("listitem").filter({ hasText: /^Session ended/ });
      await endRow.getByRole("button", { name: "Undo" }).click();
      await expect(endRow.getByText("undone")).toBeVisible();
      await expect.poll(async () => (await sheetOf(bryn)).sessionFeatures?.slayerDice).toBe(1);
      expect((await sheetOf(kai)).sessionFeatures?.tideTokens).toBe(1);
      expect((await sheetOf(mira)).sessionFeatures?.moonDie).toBe(2);
      expect(await hopes()).toEqual(preEnd);
      await page.goto(`/campaigns/${campaignId}/party/${mira}`);
      await expect(chips(page, "Mira")).toContainText("Moon die 2: Waxing");
      await expect(page.getByRole("article", { name: "Mira" }).getByRole("region", { name: "Lunar Phases" }).getByLabel("Moon die 2")).toBeVisible();
      await page.goto(`/campaigns/${campaignId}/party/${bryn}`);
      await expect(chips(page, "Bryn")).toContainText("Slayer Dice 1/1");
      await close();
    });
  });
}
