import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectFitsViewport, expectNoSeriousA11yViolations } from "./a11y";
import { openJournal, seedJournal, type JournalTable } from "./journal/helpers";

// Journal JN2 (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JN2.md; user Q12 default): the Notes sub-tab's
// 'Writing as' chips. The GM gets 'Game Master' plus one chip per present player journal (here Moss, the e2e player,
// once they have written); picking Moss opens the existing journal view, where the GM reads Moss's line and adds one
// (labelled ' - GM', D11 Q3); 'Game Master' goes back to the GM's own page. The player gets one chip, their own. Group
// labels and Quick keys stay as they are (Q13 default). Axe and no sideways scroll at 1440x900 and 390x844; the shots
// go to test-results/visual/JOURNAL-JN2/.

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;
const SHOTS = "test-results/visual/JOURNAL-JN2";

let table: JournalTable;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  table = await seedJournal(browser);
  // The player's journal exists once they write: their default 'Session 1' page (the GM reads it by default).
  await table.playerClient.mutation(api.notesEntries.add, {
    campaignId: table.campaignId,
    page: { template: 0 },
    kind: "note",
    text: "The Lieutenant wears a ring with a crow on it",
  });
});

test.afterAll(async () => {
  await table?.close();
});

const chips = (page: Page) => page.getByRole("group", { name: "Writing as" });
const chip = (page: Page, name: string) => chips(page).getByRole("button", { name: new RegExp(`${name}$`) });
const paperColumn = (page: Page) => page.getByRole("region", { name: "Journal page" });

/** Axe and no sideways scroll at both viewports, with a shot at each; ends at 1440x900. */
async function checkViewports(page: Page, shot: string) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expect(chips(page)).toBeVisible();
    await expectFitsViewport(page);
    await expectNoSeriousA11yViolations(page);
    await page.screenshot({ path: `${SHOTS}/${shot}-${viewport.width}.png`, fullPage: true });
  }
  await page.setViewportSize(VIEWPORTS[0]);
}

test("GM: Writing as 'Game Master' or a player's journal; reads and adds a line there", async () => {
  test.setTimeout(120_000); // two axe passes at two sizes, plus a server round trip
  const { gm, campaignId, playerClient } = table;
  await gm.setViewportSize(VIEWPORTS[0]);
  await openJournal(gm, table, "?tab=notes");

  await expect(chips(gm).getByText("Writing as")).toBeVisible();
  await expect(chips(gm).getByRole("button")).toHaveText(["GMGame Master", "MOMoss"]);
  await expect(chip(gm, "Game Master")).toHaveAttribute("aria-pressed", "true");
  await expect(chip(gm, "Moss")).toHaveAttribute("aria-pressed", "false");
  // Q13 default: the Quick keys are today's.
  await expect(gm.getByText(/Start a line with \* task · o event · - note · ! idea · \+ Hope · \^ Fear/)).toBeVisible();
  await checkViewports(gm, "gm-own");

  // Moss's chip opens Moss's journal in the existing journal view.
  await chip(gm, "Moss").click();
  await expect(gm).toHaveURL(/[?&]tab=notes(&|$)/);
  await expect(gm).toHaveURL(/view=journal&journal=/);
  await expect(chip(gm, "Moss")).toHaveAttribute("aria-pressed", "true");
  await expect(chip(gm, "Game Master")).toHaveAttribute("aria-pressed", "false");
  await expect(paperColumn(gm).getByRole("heading", { level: 2, name: "Moss’s Journal" })).toBeVisible();
  await expect(paperColumn(gm).getByText("The Lieutenant wears a ring with a crow on it")).toBeVisible();

  // The GM adds a line to Moss's page: it is the GM's line (' - GM'), and Moss reads it.
  const input = paperColumn(gm).getByRole("textbox", { name: "New entry" });
  await input.fill("Ask Tamsin about her grandson");
  await input.press("Enter");
  await expect(paperColumn(gm).getByText("Ask Tamsin about her grandson - GM")).toBeVisible();
  const journal = await playerClient.query(api.notes.journal, { campaignId });
  const pageId = journal.journal === null ? null : journal.pages[0]!._id;
  expect(pageId).not.toBeNull();
  await expect
    .poll(async () => (await playerClient.query(api.notesEntries.entries, { campaignId, page: pageId! })).entries.map((e) => [e.text, e.authorLabel]))
    .toEqual([
      ["The Lieutenant wears a ring with a crow on it", "Moss"],
      ["Ask Tamsin about her grandson", "GM"],
    ]);
  await checkViewports(gm, "gm-moss");

  // 'Game Master' goes back to the GM's own first page.
  await chip(gm, "Game Master").click();
  await expect(gm).not.toHaveURL(/view=journal/);
  await expect(chip(gm, "Game Master")).toHaveAttribute("aria-pressed", "true");
  await expect(paperColumn(gm).getByRole("article", { name: "Page" }).getByLabel("Page title")).toHaveValue("Session 1");
});

test("player: one chip, their own; no Game Master chip", async () => {
  test.setTimeout(90_000);
  const { player } = table;
  await player.setViewportSize(VIEWPORTS[0]);
  await openJournal(player, table, "?tab=notes");
  await expect(chips(player).getByRole("button")).toHaveText(["MOMoss"]);
  await expect(chip(player, "Moss")).toHaveAttribute("aria-pressed", "true");
  await expect(chips(player).getByRole("button", { name: /Game Master/ })).toHaveCount(0);
  await expect(paperColumn(player).getByText("Ask Tamsin about her grandson - GM")).toBeVisible();
  await checkViewports(player, "player");
});
