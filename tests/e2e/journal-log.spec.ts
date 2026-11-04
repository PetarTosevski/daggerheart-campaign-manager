import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectFitsViewport, expectNoSeriousA11yViolations } from "./a11y";
import { openJournal, seedJournal, type JournalTable } from "./journal/helpers";

// Journal JL (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JL.md): the session log on the design's campaign
// (tests/e2e/journal/helpers.ts, session 6 live). Live: the player's roll shows in the GM's and the player's open log
// without a reload. GM: hide (the player loses the line), 'Show 1 hidden' + Unhide, re-word a title, add and delete a
// line. Player (Q5): read only. Axe and no sideways scroll at 1440x900 and 390x844.

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

const presence = {
  kind: "action" as const,
  trait: "presence" as const,
  modifier: 0,
  experienceIds: [],
  advantage: 0,
  disadvantage: 0,
  help: 0,
  attack: false,
  options: [],
};

let table: JournalTable;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  table = await seedJournal(browser);
});

test.afterAll(async () => {
  await table?.close();
});

const logOf = (page: Page) => page.getByRole("region", { name: "Session log" });
const lineOf = (page: Page, text: string | RegExp) => logOf(page).getByRole("listitem").filter({ hasText: text });
const ROLL = /Presence action roll/;

async function checkViewports(page: Page) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expect(logOf(page)).toBeVisible();
    await expectFitsViewport(page);
    await expectNoSeriousA11yViolations(page);
  }
  await page.setViewportSize(VIEWPORTS[0]);
}

test("live: a roll shows in both open logs without a reload; the player reads only", async () => {
  const { gm, player, playerClient, characterId, liveSessionId } = table;
  await openJournal(gm, table, `?s=${liveSessionId}&sv=log`);
  await openJournal(player, table, `?s=${liveSessionId}`);
  await expect(logOf(gm).getByText("Written by the Combat Map as you play · edit anything")).toBeVisible();
  await expect(lineOf(gm, "Session started.")).toBeVisible();
  await expect(lineOf(player, "Session started.")).toBeVisible();

  await playerClient.mutation(api.rolls.manualRoll, { characterId, roll: presence, values: [9, 4], idempotencyKey: crypto.randomUUID() });
  await expect(lineOf(gm, ROLL)).toBeVisible();
  await expect(lineOf(gm, ROLL)).toContainText("Moss rolled");
  await expect(lineOf(player, ROLL)).toBeVisible();

  // Q5: the player's log has no ×, no re-word, no add form.
  await expect(logOf(player).getByRole("button")).toHaveCount(0);
  await expect(logOf(player).getByRole("textbox")).toHaveCount(0);
  await checkViewports(player);
  await checkViewports(gm);
});

test("GM: hide, Show 1 hidden, Unhide, re-word, add and delete", async () => {
  const { gm, player } = table;

  // Hide: gone for the GM and the player; 'Show 1 hidden' brings it back dimmed with Unhide.
  await lineOf(gm, ROLL).getByRole("button", { name: /^Hide log line:/ }).click();
  await expect(lineOf(gm, ROLL)).toHaveCount(0);
  await expect(lineOf(player, ROLL)).toHaveCount(0);
  await gm.getByRole("button", { name: "Show 1 hidden" }).click();
  await expect(lineOf(gm, ROLL)).toContainText("hidden");
  await expectNoSeriousA11yViolations(gm);
  await lineOf(gm, ROLL).getByRole("button", { name: /^Unhide log line:/ }).click();
  await expect(gm.getByRole("button", { name: /hidden$/ })).toHaveCount(0);
  await expect(lineOf(player, ROLL)).toBeVisible();

  // Re-word: the new title shows for both, marked edited for the GM.
  await lineOf(gm, ROLL).getByRole("button", { name: /, re-word$/ }).click();
  const field = logOf(gm).getByRole("textbox", { name: "Re-word the line" });
  await field.fill("Tamsin agreed to help");
  await field.press("Enter");
  await expect(lineOf(gm, "Tamsin agreed to help")).toContainText("edited");
  await expect(lineOf(player, "Tamsin agreed to help")).toBeVisible();

  // Add, then delete a GM line.
  const line = "The Sniper slipped into the trees";
  const add = logOf(gm).getByRole("textbox", { name: "New log entry" });
  await add.fill(line);
  await logOf(gm).getByRole("button", { name: "Add" }).click();
  await expect(add).toHaveValue("");
  await expect(lineOf(gm, line)).toBeVisible();
  await expect(lineOf(player, line)).toBeVisible();
  await lineOf(gm, line).getByRole("button", { name: /^Delete log line:/ }).click();
  await expect(lineOf(gm, line)).toHaveCount(0);
  await expect(lineOf(player, line)).toHaveCount(0);

  // After a reload the server's state holds.
  await gm.reload();
  await expect(lineOf(gm, "Tamsin agreed to help")).toBeVisible();
  await expect(gm.getByRole("button", { name: /hidden$/ })).toHaveCount(0);
});
