import { expect, test, type Page } from "@playwright/test";

import { expectFitsViewport, expectNoSeriousA11yViolations } from "./a11y";
import { openJournal, seedJournal, type JournalTable } from "./journal/helpers";

// Journal JH (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JH.md): the header actions on the design's campaign
// (tests/e2e/journal/helpers.ts, session 6 live). Player: the read-only live chip, the tome, Open threads -> Notes
// threads view. GM: the chip menu's extras switch (Q10), End with the Wither choice and its report, then 'Start
// session 7' (the newest planned) opening its Log & recap. Axe and no sideways scroll at 1440x900 and 390x844.

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

let table: JournalTable;

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
  table = await seedJournal(browser);
});

test.afterAll(async () => {
  await table?.close();
});

async function checkViewports(page: Page) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
    await expectFitsViewport(page);
    await expectNoSeriousA11yViolations(page);
  }
  await page.setViewportSize(VIEWPORTS[0]);
}

test("player: read-only live chip, tome, Open threads opens the Notes threads view", async () => {
  const { player } = table;
  await player.setViewportSize(VIEWPORTS[0]);
  await openJournal(player, table);
  const chip = player.getByTestId("journal-live-chip");
  await expect(chip).toContainText("Session 6 · live");
  await expect(chip.getByRole("button")).toHaveCount(0);
  await expect(player.getByRole("button", { name: /Start session/ })).toHaveCount(0);
  await expect(player.getByRole("button", { name: /^Open threads: \d+$/ })).toBeVisible();
  await checkViewports(player);

  await player.getByRole("button", { name: "Open the Campaign Tome" }).click();
  await expect(player.getByRole("dialog", { name: /tome$/ })).toBeVisible();
  await player.keyboard.press("Escape");
  await expect(player.getByRole("dialog", { name: /tome$/ })).toBeHidden();

  await player.getByRole("button", { name: /^Open threads: \d+$/ }).click();
  await expect(player).toHaveURL(/tab=notes/);
  await expect(player).toHaveURL(/view=threads/);
});

test("GM: extras switch in the chip menu, End with the Wither choice, Start session 7", async () => {
  const { gm, sessions } = table;
  await gm.setViewportSize(VIEWPORTS[0]);
  await openJournal(gm, table);
  const chip = gm.getByTestId("journal-live-chip");
  await expect(chip).toContainText("Session 6 · live");
  await checkViewports(gm);

  // Q10: the extras switch lives in the chip's menu.
  const options = chip.getByRole("button", { name: "Session options" });
  await options.click();
  const extras = gm.getByRole("switch", { name: /Allow extra characters this session/ });
  await expect(extras).not.toBeChecked();
  await extras.click();
  await expect(extras).toBeChecked();
  await expectNoSeriousA11yViolations(gm);
  await gm.keyboard.press("Escape");
  await expect(extras).toBeHidden();

  // End: the dialog's Wither choice (untick to keep the tokens), then the report in the polite status.
  await chip.getByRole("button", { name: "End session" }).click();
  const end = gm.getByRole("dialog", { name: "End the session?" });
  await expect(end).toContainText("Extra characters are no longer allowed");
  const wither = end.getByRole("checkbox", { name: /Turn Wither tokens into Fear/ });
  await expect(wither).toBeChecked();
  await wither.uncheck();
  await expect(end).toContainText("Wither tokens stay on the PCs' sheets.");
  await expectNoSeriousA11yViolations(gm);
  await end.getByRole("button", { name: "End session", exact: true }).click();
  const report = gm.locator(".jh-report");
  await expect(report).toContainText("Session ended.");
  await expect(chip).toHaveCount(0);

  // Nothing live: Start the newest planned session (7; the selected 6 is played now), which opens its Log & recap.
  const startButton = gm.getByRole("button", { name: "Start session 7" });
  await expect(startButton).toBeVisible();
  await checkViewports(gm);
  await startButton.click();
  const start = gm.getByRole("dialog", { name: "Start session 7?" });
  await start.getByRole("button", { name: "Start session", exact: true }).click();
  await expect(gm).toHaveURL(new RegExp(`s=${sessions[7]}`));
  await expect(gm).toHaveURL(/sv=log/);
  await expect(gm.getByTestId("journal-live-chip")).toContainText("Session 7 · live");
  await expect(report).toContainText("Session started.");
  await gm.getByRole("button", { name: "Dismiss the session report" }).click();
  await expect(report).toBeEmpty();
});
