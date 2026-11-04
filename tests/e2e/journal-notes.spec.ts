import { expect, test, type Locator, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { expectFitsViewport, expectNoSeriousA11yViolations } from "./a11y";
import { openJournal, seedJournal, type JournalTable } from "./journal/helpers";

// Journal JN (plan .omc/plans/journal.yaml, docs/tasks/TASK-JOURNAL-JN.md): the Journal's Notes sub-tab renders the
// existing Notes UI (src/components/notes/notes-body.tsx, chrome 'journal') on the design's campaign
// (tests/e2e/journal/helpers.ts): no Notes hero (the Journal header holds the H1), the index column with 'Download my
// journal', Quick keys unchanged (Q13), the handwriting font, and the notes params (view, page, journal) beside
// ?tab=notes. The GM adds a task, cycles its bullet, @mentions a Codex entry, opens the threads view and links the page
// to another session; the player gets the same body. Axe and no sideways scroll at 1440x900 and 390x844.

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

const index = (page: Page) => page.getByRole("complementary", { name: "Journal index" });
const paperColumn = (page: Page) => page.getByRole("region", { name: "Journal page" });
const paper = (page: Page) => paperColumn(page).getByRole("article", { name: "Page" });
const rowOf = (page: Page, text: string): Locator => paper(page).getByRole("listitem").filter({ hasText: text });

/** Axe and no sideways scroll at both viewports; ends at 1440x900. */
async function checkViewports(page: Page) {
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
    await expectFitsViewport(page);
    await expectNoSeriousA11yViolations(page);
  }
  await page.setViewportSize(VIEWPORTS[0]);
}

/** The Notes body inside the Journal: one H1 (the Journal's), the index column, Quick keys, Download, the font. */
async function expectJournalChrome(page: Page) {
  await expect(page.getByRole("tablist", { name: "Journal" }).getByRole("tab", { name: /^Notes/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(["Journal"]);
  await expect(page.getByRole("heading", { name: /’s Journal$/ })).toHaveCount(0);
  await expect(index(page).getByRole("searchbox", { name: "Search the journal" })).toBeVisible();
  await expect(index(page).getByText("Quick keys", { exact: true })).toBeVisible();
  await expect(index(page).getByText(/Start a line with \* task · o event · - note · ! idea · \+ Hope · \^ Fear/)).toBeVisible();
  await expect(index(page).getByRole("button", { name: "Download my journal" })).toBeVisible();
  // The hero's own threads button is not rendered: the Journal header (JH) holds Open threads.
  await expect(page.getByRole("button", { name: /^🧵 Open threads/ })).toHaveCount(0);
  // The Caveat handwriting face is loaded and its variable set on the Notes root.
  const caveat = await page.locator(".bj-root").evaluate((el) => getComputedStyle(el).getPropertyValue("--font-caveat").trim());
  expect(caveat).not.toBe("");
}

test("GM: the Notes sub-tab is the Notes UI without its hero; tasks, bullets, @mentions, threads, session link", async () => {
  const { gm, client, campaignId, sessions } = table;
  await gm.setViewportSize(VIEWPORTS[0]);
  const { entryId: npc } = await client.mutation(api.codex.create, { campaignId, kind: "character", idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.codex.update, { entryId: npc, patch: { name: "Tamsin", role: "Woodcutter" } });

  await openJournal(gm, table, "?tab=notes");
  await expectJournalChrome(gm);
  await expect(index(gm).getByText("Players’ journals", { exact: true })).toBeVisible();
  // The default 'Session 1' page is linked to the live session (Session 6, Sun 2 Nov 2025).
  await expect(paper(gm).getByLabel("Page title")).toHaveValue("Session 1");
  await expect(paper(gm).getByText(/^session log · .*2.*2025$/)).toBeVisible();
  await checkViewports(gm);

  // ?page works beside ?tab=notes and survives a reload.
  await openJournal(gm, table, "?tab=notes&page=template-0");
  await expect(paper(gm).getByLabel("Page title")).toHaveValue("Session 1");

  // Add a task and cycle its bullet.
  const input = paper(gm).getByRole("textbox", { name: "New entry" });
  await input.click();
  await gm.keyboard.type("* Return Tamsin’s axe");
  await gm.keyboard.press("Enter");
  const task = rowOf(gm, "Return Tamsin’s axe");
  await task.getByRole("button", { name: "Task: open. Click to change." }).click();
  await expect(task.getByRole("button", { name: "Task: done. Click to change." })).toHaveText("×");

  // @mention a Codex entry with the picker.
  const combobox = paper(gm).getByRole("combobox", { name: "New entry" });
  await input.click();
  await input.pressSequentially("* ask @tam");
  await expect(combobox).toHaveAttribute("aria-expanded", "true");
  await expect(paper(gm).getByRole("listbox", { name: "Codex" }).getByRole("option", { name: /Tamsin/ })).toHaveAttribute("aria-selected", "true");
  await input.press("Enter");
  await input.pressSequentially("about her grandson");
  await input.press("Enter");
  const link = rowOf(gm, "about her grandson").getByRole("link");
  await expect(link).toHaveText("Tamsin");
  await expect(link).toHaveAttribute("href", `/campaigns/${campaignId}/codex?entry=${npc}`);

  // The Journal header's Open threads button opens the threads view (?tab=notes&view=threads).
  await gm.getByRole("button", { name: /^Open threads: \d+$/ }).click();
  await expect(gm).toHaveURL(/[?&]view=threads(&|$)/);
  await expect(gm).toHaveURL(/[?&]tab=notes(&|$)/);
  const threads = paperColumn(gm).getByRole("article", { name: "Open threads" });
  await expect(threads).toBeVisible();
  await expect(threads.getByText("ask Tamsin about her grandson")).toBeVisible();
  await checkViewports(gm);

  // Back to the page from the index column: the Journal's tab param stays, the notes params change.
  await index(gm).getByRole("navigation", { name: "Your pages" }).getByRole("button", { name: /^Session 1/ }).click();
  await expect(gm).toHaveURL(/[?&]tab=notes(&|$)/);
  await expect(gm).not.toHaveURL(/view=threads/);
  await expect(paper(gm).getByLabel("Page title")).toHaveValue("Session 1");

  // Link the page to another session (Session 5, Sun 26 Oct 2025).
  await paper(gm).getByRole("button", { name: "🔗 Session" }).click();
  const picker = gm.getByRole("dialog", { name: "Link a session" });
  await expect(picker.getByRole("radio", { name: /^Session 6/ })).toBeChecked();
  await picker.getByRole("radio", { name: /^Session 5/ }).check();
  await picker.getByRole("button", { name: "Link session" }).click();
  await expect(picker).toBeHidden();
  await expect(paper(gm).getByText(/^session log · .*26.*2025$/)).toBeVisible();
  await expect
    .poll(async () => {
      const view = await client.query(api.notes.journal, { campaignId });
      return view.journal === null ? null : (view.pages.find((p) => p.title === "Session 1")?.sessionId ?? null);
    })
    .toBe(sessions[5]);

  // ?view=journal&journal=… opens the journal view inside the Journal; a bad view falls back to the page.
  await openJournal(gm, table, "?tab=notes&view=journal&journal=placeholder");
  await expect(paperColumn(gm).getByRole("article", { name: "Journal" })).toBeVisible();
  await openJournal(gm, table, "?tab=notes&view=nonsense");
  await expect(paper(gm)).toBeVisible();
});

test("player: the same Notes body in the Journal, own journal, no hero", async () => {
  const { player } = table;
  await player.setViewportSize(VIEWPORTS[0]);
  await openJournal(player, table, "?tab=notes");
  await expectJournalChrome(player);
  await expect(index(player).getByText("Players’ journals", { exact: true })).toHaveCount(0);
  await expect(paper(player)).toBeVisible();
  await checkViewports(player);

  // The 390 px 'Pages' disclosure works inside the Journal.
  await player.setViewportSize(VIEWPORTS[1]);
  const toggle = index(player).getByRole("button", { name: /^Pages/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(index(player).getByRole("searchbox", { name: "Search the journal" })).toBeVisible();
  await player.setViewportSize(VIEWPORTS[0]);
});
