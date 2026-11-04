import { expect, test, type Page } from "@playwright/test";

import { expectFitsViewport, expectNoSeriousA11yViolations } from "./a11y";
import { JOURNAL_SESSIONS, openJournal, seedJournal, type JournalTable } from "./journal/helpers";

// Journal JS (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JS.md): the left column (All sessions, '+ Plan
// session N', Campaign so far) and the session heading on the design's campaign (tests/e2e/journal/helpers.ts). The
// GM plans session 8, renames it, dates it, marks it played and back, and deletes it (asked twice); the live session's
// menu is disabled. A player sees live and played sessions only and reads the heading. Axe and no sideways scroll at
// 1440x900 and 390x844.

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

const list = (page: Page) => page.getByRole("complementary", { name: "All sessions" }).getByRole("list", { name: "Sessions" });
const head = (page: Page) => page.locator(".jr-heading-slot");
const soFar = (page: Page) => page.getByRole("region", { name: "Campaign so far" });

test("GM: list, Campaign so far, plan → rename → date → played → delete", async () => {
  const { gm, liveSessionId } = table;
  await gm.setViewportSize(VIEWPORTS[0]);
  await openJournal(gm, table);

  // The list: 7..2 newest first, Planned / Live chips, the live session selected by default.
  const items = list(gm).getByRole("button");
  await expect(items).toHaveCount(6);
  await expect(list(gm).getByRole("button", { name: new RegExp(`^Session 7: ${JOURNAL_SESSIONS[5].title}, .+, Planned$`) })).toBeVisible();
  await expect(list(gm).getByRole("button", { name: new RegExp(`^Session 2: ${JOURNAL_SESSIONS[0].title}, (?!.*(Planned|Live)$).+$`) })).toBeVisible();
  const live = list(gm).getByRole("button", { name: /^Session 6: Ambush at the Forest Camp, .+, Live$/ });
  await expect(live).toHaveAttribute("aria-current", "true");
  await expect(live).toContainText("Live");

  await expect(soFar(gm)).toContainText("Sessions played4");
  await expect(soFar(gm)).toContainText("Party level1");
  await expect(soFar(gm)).toContainText(/Hours at the table\d+/);
  await expect(soFar(gm)).toContainText(/Open threads\d+/);

  // The live heading: line, title, Live chip; its menu is disabled.
  await expect(head(gm).getByRole("heading", { level: 2, name: "Ambush at the Forest Camp" })).toBeVisible();
  await expect(head(gm)).toContainText(/Session 6·.+·\d{1,2}:\d{2}/);
  await head(gm).getByRole("button", { name: "Session menu" }).click();
  await expect(head(gm).getByRole("button", { name: "Mark as played" })).toBeDisabled();
  await expect(head(gm).getByRole("button", { name: "Delete session" })).toBeDisabled();
  await checkViewports(gm);
  await gm.keyboard.press("Escape");
  await expect(head(gm).getByRole("button", { name: "Delete session" })).toBeHidden();

  // '+ Plan session 8' creates it and opens it on Plan.
  await gm.getByRole("button", { name: "Plan session 8" }).click();
  await expect(gm).toHaveURL(/[?&]s=[^&]+&sv=plan|[?&]sv=plan&s=/);
  expect(new URL(gm.url()).searchParams.get("s")).not.toBe(liveSessionId);
  await expect(head(gm).getByRole("heading", { level: 2, name: "Untitled session" })).toBeVisible();
  await expect(list(gm).getByRole("button")).toHaveCount(7);
  await expect(list(gm).getByRole("button", { name: /^Session 8: Untitled session/ })).toHaveAttribute("aria-current", "true");
  await expect(gm.getByRole("button", { name: "Plan session 9" })).toBeVisible();

  // Rename in place (Enter saves); the list follows.
  await head(gm).getByRole("button", { name: "Untitled session" }).click();
  const title = head(gm).getByRole("textbox", { name: "Session 8 title" });
  await expect(title).toBeFocused();
  await title.fill("The briar gate");
  await title.press("Enter");
  await expect(head(gm).getByRole("heading", { level: 2, name: "The briar gate" })).toBeVisible();
  await expect(list(gm).getByRole("button", { name: /^Session 8: The briar gate/ })).toBeVisible();

  // Escape cancels a rename.
  await head(gm).getByRole("button", { name: "The briar gate" }).click();
  await head(gm).getByRole("textbox", { name: "Session 8 title" }).fill("Nope");
  await head(gm).getByRole("textbox", { name: "Session 8 title" }).press("Escape");
  await expect(head(gm).getByRole("heading", { level: 2, name: "The briar gate" })).toBeVisible();

  // Date in place.
  await head(gm).getByRole("button", { name: "No date set" }).click();
  const date = head(gm).getByLabel("Session 8 date");
  await date.fill("2025-11-16");
  await date.press("Enter");
  await expect(head(gm).getByRole("button", { name: "No date set" })).toBeHidden();
  await expect(head(gm).getByRole("button", { name: /16/ })).toBeVisible();
  await gm.reload();
  await expect(head(gm).getByRole("heading", { level: 2, name: "The briar gate" })).toBeVisible();
  await expect(head(gm).getByRole("button", { name: /16/ })).toBeVisible();

  // Mark as played and back.
  await head(gm).getByRole("button", { name: "Session menu" }).click();
  await head(gm).getByRole("button", { name: "Mark as played" }).click();
  await expect(head(gm).getByText("Played", { exact: true })).toBeVisible();
  await expect(soFar(gm)).toContainText("Sessions played5");
  await head(gm).getByRole("button", { name: "Session menu" }).click();
  await head(gm).getByRole("button", { name: "Mark as not played" }).click();
  await expect(head(gm).getByText("Planned", { exact: true })).toBeVisible();
  await expect(soFar(gm)).toContainText("Sessions played4");

  // Delete asks twice; then the page shows the default (live) session again.
  await head(gm).getByRole("button", { name: "Session menu" }).click();
  await head(gm).getByRole("button", { name: "Delete session" }).click();
  await head(gm).getByRole("button", { name: "Click again to delete" }).click();
  await expect(gm).not.toHaveURL(/[?&]s=/);
  await expect(head(gm).getByRole("heading", { level: 2, name: "Ambush at the Forest Camp" })).toBeVisible();
  await expect(list(gm).getByRole("button")).toHaveCount(6);
  await expect(gm.getByRole("button", { name: "Plan session 8" })).toBeVisible();
});

test("player: live and played sessions only, read-only heading", async () => {
  const { player } = table;
  await player.setViewportSize(VIEWPORTS[0]);
  await openJournal(player, table);
  await expect(list(player).getByRole("button")).toHaveCount(5);
  await expect(list(player)).not.toContainText("Planned");
  await expect(player.getByRole("button", { name: /^Plan session/ })).toHaveCount(0);
  await expect(head(player).getByRole("heading", { level: 2, name: "Ambush at the Forest Camp" })).toBeVisible();
  await expect(head(player).getByRole("button")).toHaveCount(0);
  await expect(soFar(player)).toContainText("Sessions played4");

  await list(player).getByRole("button", { name: /^Session 5: / }).click();
  await expect(player).toHaveURL(/[?&]s=/);
  await expect(head(player).getByRole("heading", { level: 2, name: JOURNAL_SESSIONS[3].title })).toBeVisible();
  await checkViewports(player);
});
