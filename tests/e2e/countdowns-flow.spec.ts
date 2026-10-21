import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs } from "./visual/helpers";

// countdowns-advanced K5: one scene with every countdown type, at 1440 and 1024 px. The GM arms a standard
// 'Countdown (Loop 3)', a progress 6 and a consequence 6 and starts a chase (d10, decent lead, the PCs pursuing), plus
// an unarmed 'Countdown 4' and an armed long-term 4. The player's manual action rolls move each countdown as the book
// says (R2 standard, R4 table, R8 chase); a reaction roll moves nothing (R11); a Tag Team counts once (R10); the loop
// triggers, the GM's feed shows the notice and it is back at 3 (R6, D7); the GM applies an older roll to the unarmed
// countdown from the feed (Q1 (c)); the player undoes a roll and its ticks come back (D11); a long rest ticks the armed
// long-term countdown once (R9, Q3). The player sees badges, never the Armed switch, steps, notices or the feed button
// (D12).

const PLAYER = "e2e-player@example.test";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

/** CB p.163 Dynamic Countdown Advancement, written out here so the spec does not reuse the app's copy. */
const R4 = {
  critical: { progress: 3, consequence: 0 },
  successHope: { progress: 2, consequence: 0 },
  successFear: { progress: 1, consequence: 1 },
  failHope: { progress: 0, consequence: 2 },
  failFear: { progress: 0, consequence: 3 },
} as const;

const agility = { kind: "action" as const, trait: "agility" as const, modifier: 0, experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };

async function newCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Countdown flow ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
}

/** A standard / progress / consequence countdown through the New countdown dialog (public, threat). */
async function newCountdown(
  page: Page,
  { name, consequence, type, start, loop, armed }: { name: string; consequence: string; type: "Standard" | "Progress" | "Consequence"; start: number; loop?: boolean; armed: boolean },
) {
  await page.getByRole("button", { name: "+ New countdown" }).click();
  const dialog = page.getByRole("dialog", { name: "New countdown" });
  await dialog.getByLabel("Countdown name").fill(name);
  await dialog.getByLabel("What happens at zero").fill(consequence);
  await dialog.getByRole("radio", { name: type, exact: true }).check();
  if (loop) await dialog.getByRole("radio", { name: "Loop", exact: true }).check();
  const box = dialog.getByRole("checkbox", { name: /Advance automatically on action rolls/ });
  await expect(box).toBeChecked();
  if (!armed) await box.uncheck();
  await dialog.getByRole("radio", { name: String(start), exact: true }).click();
  await dialog.getByRole("button", { name: `Start at ${start}` }).click();
  await expect(dialog).toBeHidden();
}

for (const viewport of VIEWPORTS) {
  test.describe(`at ${viewport.width} px`, () => {
    test.use({ viewport });

    test("a scene with every countdown type: rolls, reaction, Tag Team, loop trigger, feed apply, undo and a long rest", async ({ page, browser }) => {
      test.setTimeout(240_000);
      const campaignId = await newCampaign(page);
      const campaignUrl = page.url();
      const gm = await convexAs(page);
      const grid = page.getByRole("region", { name: "Countdowns" });
      const card = (name: string) => grid.getByRole("article", { name, exact: true });
      const value = (name: string) => card(name).getByTestId("countdown-value");

      // The server's values by countdown name (chase rows: "The party" and the rivals' name).
      const values = async () => Object.fromEntries((await gm.query(api.countdowns.listByCampaign, { campaignId })).map((c) => [c.name, c.currentValue]));
      const serverIs = (expected: Record<string, number>) => expect.poll(values, { timeout: 15_000 }).toEqual(expected);

      // ---- The player joins with a Bard; the GM keeps a second PC for the Tag Team.
      const { joinCode } = await gm.query(api.members.access, { campaignId });
      const context = await browser.newContext({ viewport });
      const player = await context.newPage();
      await signInAsTestGm(player, PLAYER);
      await expect(player).toHaveURL("/");
      const asPlayer = await convexAs(player);
      await asPlayer.mutation(api.members.joinByCode, { code: joinCode! });
      const hero = `Liriel ${crypto.randomUUID().slice(0, 6)}`;
      const { characterId: liriel } = await asPlayer.mutation(api.characters.create, { campaignId, draft: bardDraft(hero), idempotencyKey: crypto.randomUUID() });
      const { characterId: bryn } = await gm.mutation(api.characters.create, { campaignId, draft: bardDraft("Bryn"), idempotencyKey: crypto.randomUUID() });
      const roll = (values: [number, number], extra: { difficulty?: number; kind?: "action" | "reaction" } = {}) =>
        asPlayer.mutation(api.rolls.manualRoll, { characterId: liriel, roll: { ...agility, ...extra }, values, idempotencyKey: crypto.randomUUID() });

      // ---- The GM sets the scene.
      await newCountdown(page, { name: "Rockfall", consequence: "Stones rain down.", type: "Standard", start: 3, loop: true, armed: true });
      await newCountdown(page, { name: "Climb the cliff", consequence: "The party reaches the top.", type: "Progress", start: 6, armed: true });
      await newCountdown(page, { name: "Alarm", consequence: "The guards come running.", type: "Consequence", start: 6, armed: true });
      await newCountdown(page, { name: "The dam breaks", consequence: "The valley floods.", type: "Standard", start: 4, armed: false });

      // Long-term 4, armed (Automatic), with a step at 3 and the final event.
      await page.getByRole("button", { name: "+ New countdown" }).click();
      const dialog = page.getByRole("dialog", { name: "New countdown" });
      await dialog.getByLabel("Countdown name").fill("Invasion");
      await dialog.getByLabel("What happens at zero").fill("The city falls.");
      await dialog.getByRole("radio", { name: "Long-term", exact: true }).check();
      await expect(dialog.getByRole("checkbox", { name: /Tick on every long rest/ })).toBeChecked();
      await dialog.getByRole("radio", { name: "4", exact: true }).click();
      const editor = dialog.getByRole("list", { name: "Steps" });
      await editor.getByLabel("Step at 3", { exact: true }).fill("Scouts are seen on the ridge");
      await editor.getByLabel("Final event").fill("The city falls");
      await dialog.getByRole("button", { name: "Start at 4" }).click();
      await expect(dialog).toBeHidden();

      // The chase: d10, decent lead (3 lower), the PCs pursuing, armed by default.
      await page.getByRole("button", { name: "+ New chase" }).click();
      const chaseDialog = page.getByRole("dialog", { name: "New chase" });
      await chaseDialog.getByLabel("Rivals").fill("The thief");
      await chaseDialog.getByRole("radio", { name: "d10", exact: true }).click();
      await expect(chaseDialog.getByRole("radio", { name: "Decent lead" })).toBeChecked();
      await expect(chaseDialog.getByRole("checkbox", { name: /Advance automatically on action rolls/ })).toBeChecked();
      await chaseDialog.getByRole("button", { name: "Start chase" }).click();
      await expect(chaseDialog).toBeHidden();
      const chase = grid.getByRole("article", { name: "Chase: The thief" });

      await serverIs({ Rockfall: 3, "Climb the cliff": 6, Alarm: 6, "The dam breaks": 4, Invasion: 4, "The party": 10, "The thief": 7 });
      await expect(card("Rockfall").getByTestId("countdown-type")).toContainText("Loop 3");
      await expect(card("Climb the cliff").getByTestId("countdown-type")).toContainText("Progress");
      await expect(card("Alarm").getByTestId("countdown-type")).toContainText("Consequence");
      await expect(card("Invasion").getByTestId("countdown-type")).toContainText("Long-term");
      await expect(card("The dam breaks").getByRole("button", { name: /^Armed/ })).toHaveAttribute("aria-pressed", "false");
      await expect(card("Rockfall").getByRole("button", { name: /^Armed/ })).toHaveAttribute("aria-pressed", "true");

      // ---- 1. Success with Hope (no Difficulty = a success, D3): standard -1, progress -2, consequence 0; chase party -2.
      const first = await roll([8, 3]);
      await serverIs({ Rockfall: 2, "Climb the cliff": 4, Alarm: 6, "The dam breaks": 4, Invasion: 4, "The party": 8, "The thief": 7 });
      await expect(value("Rockfall")).toHaveText("2/3");
      await expect(value("Climb the cliff")).toHaveText("4/6");
      await expect(chase.getByTestId("chase-value-party")).toHaveText("8/10");

      // ---- 2. Failure with Fear: standard -1, progress 0, consequence -3; the thief -3.
      await roll([3, 8], { difficulty: 30 });
      await serverIs({ Rockfall: 1, "Climb the cliff": 4, Alarm: 3, "The dam breaks": 4, Invasion: 4, "The party": 8, "The thief": 4 });
      await expect(value("Alarm")).toHaveText("3/6");
      await expect(chase.getByTestId("chase-value-rivals")).toHaveText("4/10");

      // ---- 3. A critical: the loop reaches 0, triggers and is back at 3 (R6, Q2); progress -3; chase party -3.
      await roll([5, 5]);
      await serverIs({ Rockfall: 3, "Climb the cliff": 1, Alarm: 3, "The dam breaks": 4, Invasion: 4, "The party": 5, "The thief": 4 });
      await expect(value("Rockfall")).toHaveText("3/3");
      await expect(card("Rockfall").getByTestId("countdown-triggers")).toHaveText("Triggered 1 time");
      await expect(card("Rockfall")).toHaveAttribute("data-status", "active");
      // The GM's feed shows the trigger notice, hidden from players (D7).
      const gmFeed = page.getByRole("list", { name: "Rolls" });
      const notice = gmFeed.getByRole("listitem").filter({ hasText: "Rockfall triggered: Stones rain down." });
      await expect(notice).toHaveCount(1);
      await expect(notice).toContainText("hidden");

      // ---- 4. A reaction roll is not an action roll (R11): nothing moves.
      await roll([8, 3], { kind: "reaction" });
      await expect(gmFeed.getByRole("listitem").filter({ hasText: `${hero}: Agility reaction roll` })).toHaveCount(1);
      await serverIs({ Rockfall: 3, "Climb the cliff": 1, Alarm: 3, "The dam breaks": 4, Invasion: 4, "The party": 5, "The thief": 4 });

      // ---- 5. A Tag Team (Liriel + Bryn) counts as ONE action roll (R10). The server rolls, so the outcome is read back;
      // without a Difficulty it is a success (with Hope or Fear) or a critical.
      const side = { trait: "agility" as const, modifier: 0 };
      const { rolls } = await asPlayer.mutation(api.rolls.tagTeam, { characterId: liriel, partnerId: bryn, initiator: side, partner: side, idempotencyKey: crypto.randomUUID() });
      // Still waiting for the pick: nothing moved.
      await serverIs({ Rockfall: 3, "Climb the cliff": 1, Alarm: 3, "The dam breaks": 4, Invasion: 4, "The party": 5, "The thief": 4 });
      const { outcome } = await asPlayer.mutation(api.rolls.tagTeamApply, { entryId: rolls[0]!.entryId, pick: liriel, idempotencyKey: crypto.randomUUID() });
      expect(["successHope", "successFear", "critical"]).toContain(outcome);
      const tag = R4[outcome as keyof typeof R4];
      const afterTag = {
        Rockfall: 2, // once, not twice
        "Climb the cliff": Math.max(0, 1 - tag.progress), // reaches 0 and completes
        Alarm: 3 - tag.consequence,
        "The dam breaks": 4,
        Invasion: 4,
        "The party": 5 - tag.progress,
        "The thief": 4 - tag.consequence,
      };
      await serverIs(afterTag);
      await expect(value("Rockfall")).toHaveText("2/3");
      await expect(card("Climb the cliff")).toHaveAttribute("data-status", "completed");
      await expect(card("Climb the cliff").getByRole("status").filter({ hasText: "THE COUNTDOWN HAS STRUCK" })).toBeVisible();
      await expect(chase.getByTestId("chase-value-party")).toHaveText(`${afterTag["The party"]}/10`);

      // ---- 6. The GM applies the first (older) roll to the unarmed 'Countdown 4' from the feed (Q1 (c), D5).
      const firstSummary = (await gm.query(api.feed.list, { campaignId, paginationOpts: { numItems: 50, cursor: null } })).page.find((r) => r._id === first.entryId)!.summary;
      const olderRow = gmFeed.getByRole("listitem", { name: firstSummary, exact: true });
      await expect(olderRow).toHaveCount(1);
      await olderRow.getByRole("button", { name: /^Tick countdowns/ }).click();
      const tick = page.getByRole("dialog", { name: "Tick countdowns" });
      await expect(tick.getByText("success with Hope")).toBeVisible();
      // The armed countdowns this roll already ticked are checked and disabled.
      await expect(tick.getByRole("checkbox", { name: /Rockfall/ })).toBeChecked();
      await expect(tick.getByRole("checkbox", { name: /Rockfall/ })).toBeDisabled();
      await expect(tick.getByRole("listitem").filter({ hasText: "The dam breaks" })).toContainText("−1");
      await tick.getByRole("checkbox", { name: /The dam breaks/ }).check();
      await tick.getByRole("button", { name: "Apply" }).click();
      await expect(tick).toBeHidden();
      await expect(value("The dam breaks")).toHaveText("3/4");
      const afterFeed = { ...afterTag, "The dam breaks": 3 };
      await serverIs(afterFeed);

      // ---- 7. The player rolls a success with Fear and undoes it: its ticks come back (D11, Q5).
      const undone = await roll([3, 8]);
      const lastSummary = (await gm.query(api.feed.list, { campaignId, paginationOpts: { numItems: 50, cursor: null } })).page.find((r) => r._id === undone.entryId)!.summary;
      await serverIs({
        ...afterFeed,
        Rockfall: 1,
        Alarm: afterFeed.Alarm - 1,
        "The party": afterFeed["The party"] - 1,
        "The thief": afterFeed["The thief"] - 1,
      });
      await player.goto(campaignUrl);
      const playerFeed = player.getByRole("list", { name: "Rolls" });
      const last = playerFeed.getByRole("listitem", { name: lastSummary, exact: true });
      await last.getByRole("button", { name: "Undo" }).click();
      await expect(last.getByText("undone")).toBeVisible();
      await serverIs(afterFeed);
      await expect(value("Rockfall")).toHaveText("2/3");

      // ---- The player's view (D12): public countdowns with their badges; no Armed switch, no steps, no notices, no
      // 'Tick countdowns' button.
      const seen = player.getByRole("region", { name: "Countdowns" });
      await expect(seen.getByRole("article", { name: "Rockfall", exact: true }).getByTestId("countdown-type")).toContainText("Loop 3");
      await expect(seen.getByRole("article", { name: "Rockfall", exact: true }).getByTestId("countdown-triggers")).toHaveText("Triggered 1 time");
      await expect(seen.getByRole("article", { name: "Climb the cliff", exact: true }).getByTestId("countdown-type")).toContainText("Progress");
      await expect(seen.getByRole("article", { name: "Alarm", exact: true }).getByTestId("countdown-type")).toContainText("Consequence");
      await expect(seen.getByRole("article", { name: "Invasion", exact: true }).getByTestId("countdown-type")).toContainText("Long-term");
      await expect(seen.getByRole("article", { name: "Chase: The thief" })).toBeVisible();
      await expect(seen.getByRole("button", { name: /^Armed/ })).toHaveCount(0);
      await expect(seen).not.toContainText("Scouts are seen on the ridge");
      await expect(seen.getByRole("button", { name: "Edit steps" })).toHaveCount(0);
      await expect(playerFeed.getByRole("listitem").filter({ hasText: "triggered" })).toHaveCount(0);
      await expect(playerFeed.getByRole("button", { name: /^Tick countdowns/ })).toHaveCount(0);
      await expect(playerFeed.getByRole("listitem").filter({ hasText: `${hero}: Agility action roll` }).first()).toBeVisible();

      // ---- 8. A finished long rest ticks the armed long-term countdown once and nothing else (R9, Q3).
      const rest = page.getByRole("region", { name: "Rest", exact: true });
      await rest.getByRole("button", { name: "Start long rest" }).click();
      await rest.getByRole("button", { name: "Finish rest" }).click();
      await serverIs({ ...afterFeed, Invasion: 3 });
      await expect(value("Invasion")).toHaveText("3/4");
      const track = card("Invasion").getByTestId("long-term-track");
      await expect(track.getByTestId("track-current")).toContainText("Scouts are seen on the ridge");
      await expect(rest.getByTestId("rest-long-term")).toContainText("Invasion: 3 left - Scouts are seen on the ridge");
      // The GM's feed notice of the rest is undone with the rest (from the rest panel), so it offers no Undo of its own:
      // actionLog.undo refuses any row of a rest's group (K5 gap G1, bead dcm-bxp.72; fix in convex/feed.ts canUndo).
      const restNotice = gmFeed.getByRole("listitem").filter({ hasText: "Long rest: Invasion: 3 left - Scouts are seen on the ridge" });
      await expect(restNotice).toHaveCount(1);
      await expect(restNotice.getByRole("button", { name: "Undo" })).toHaveCount(0);
      // The player sees the ticked box, never the step.
      const theirs = seen.getByRole("article", { name: "Invasion", exact: true });
      await expect(theirs.getByTestId("countdown-value")).toHaveText("3/4");
      await expect(theirs.getByTestId("long-term-track").locator("li[data-ticked=true]")).toHaveCount(1);
      await expect(theirs).not.toContainText("Scouts");

      // No horizontal page scroll at this width.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await context.close();
    });
  });
}
