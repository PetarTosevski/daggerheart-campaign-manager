import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { convexAs, expectNoHorizontalScroll } from "./visual/helpers";

// D11 N4: open threads, search and 'Download my journal' (.omc/plans/d11-notes.yaml). The threads view lists only open
// tasks and unresolved Fears and drops one as soon as it is completed (confirmed on the server through a Convex client
// before the page is left); a search narrows the index and highlights the matching line; the download saves a .md
// file of the caller's own pages. Seed entries go through a Convex client; the behaviour under test through the UI.

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Threads ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name, campaignId: new URL(page.url()).pathname.split("/")[2] as Id<"campaigns"> };
}

/** The GM's journal: 'Session 1' with an open task, a Fear, a note and a done task; 'Rumors & hooks' with an open task. */
async function seed(page: Page, campaignId: Id<"campaigns">) {
  const client = await convexAs(page);
  const add = (template: number, kind: "task" | "fear" | "note", text: string) =>
    client.mutation(api.notesEntries.add, { campaignId, page: { template }, kind, text });
  const { pageId: session1 } = await add(0, "task", "pay the ferryman");
  await add(0, "fear", "ambush at the ford");
  await add(0, "note", "Old Mag runs the ferry at dusk");
  const { entryId: done } = await add(0, "task", "light the lantern");
  await client.mutation(api.notesEntries.cycle, { campaignId, entryId: done });
  const { pageId: rumors } = await add(1, "task", "ask the miller about the mill");
  return { client, session1, rumors };
}

const sheet = (page: Page) => page.getByRole("region", { name: "Journal page" });
const threadsView = (page: Page) => sheet(page).getByRole("article", { name: "Open threads" });
const threadsButton = (page: Page) => page.getByRole("button", { name: /^🧵 Open threads · / });
const pagesNav = (page: Page) => page.getByRole("navigation", { name: "Your pages" });

test("the threads view lists only open entries and updates when one is completed", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  const { client, session1 } = await seed(page, campaignId);
  await page.goto(`/campaigns/${campaignId}/notes`);

  await expect(threadsButton(page)).toHaveText("🧵 Open threads · 3");
  await expect(threadsButton(page)).toHaveAttribute("aria-pressed", "false");
  await threadsButton(page).click();
  await expect(page).toHaveURL(/[?&]view=threads/);
  await expect(threadsButton(page)).toHaveAttribute("aria-pressed", "true");
  const view = threadsView(page);
  await expect(view.getByText("Every unfinished task and every looming Fear, from all pages.")).toBeVisible();
  await expect(view.getByRole("listitem")).toHaveText([/pay the ferryman\s*Session 1 →/, /ambush at the ford\s*Session 1 →/, /ask the miller about the mill\s*Rumors & hooks →/]);
  // Notes, done tasks: not threads.
  await expect(view.getByText("Old Mag runs the ferry at dusk")).toHaveCount(0);
  await expect(view.getByText("light the lantern")).toHaveCount(0);

  // Completing the task drops it at once, and the count follows.
  await view.getByRole("listitem").filter({ hasText: "pay the ferryman" }).getByRole("button", { name: "Task: open. Click to change." }).click();
  await expect(view.getByRole("listitem")).toHaveCount(2);
  await expect(threadsButton(page)).toHaveText("🧵 Open threads · 2");
  await expect.poll(async () => (await client.query(api.notesThreads.threads, { campaignId })).map((r) => r.text)).toEqual([
    "ambush at the ford",
    "ask the miller about the mill",
  ]);
  await expect
    .poll(async () => (await client.query(api.notesEntries.entries, { campaignId, page: session1 })).entries.find((e) => e.text === "pay the ferryman")?.state)
    .toBe("done");

  // '<page title> →' opens the page.
  await view.getByRole("button", { name: "Session 1 →" }).first().click();
  await expect(page).toHaveURL(new RegExp(`[?&]page=${session1}`));
  await expect(page).not.toHaveURL(/view=threads/);
  await expect(sheet(page).getByRole("article", { name: "Page" }).getByText("pay the ferryman")).toBeVisible();
});

test("a search narrows the index and highlights the line", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  const { session1 } = await seed(page, campaignId);
  await page.goto(`/campaigns/${campaignId}/notes?page=${session1}`);
  await expect(pagesNav(page).getByRole("button", { name: /Rumors & hooks/ })).toBeVisible();

  await page.getByRole("searchbox", { name: "Search the journal" }).fill("dusk");
  await expect(pagesNav(page).getByRole("button", { name: /Rumors & hooks/ })).toHaveCount(0);
  await expect(pagesNav(page).getByRole("button", { name: /Loot & debts/ })).toHaveCount(0);
  await expect(pagesNav(page).getByRole("button", { name: /^Session 1/ })).toBeVisible();
  const paper = sheet(page).getByRole("article", { name: "Page" });
  await expect(paper.getByRole("listitem").filter({ hasText: "dusk" })).toHaveClass(/bj-hit/);
  await expect(paper.getByRole("listitem").filter({ hasText: "pay the ferryman" })).not.toHaveClass(/bj-hit/);

  // A page title matches too; nothing matching shows 'No matches.'
  await page.getByRole("searchbox", { name: "Search the journal" }).fill("miller");
  await expect(pagesNav(page).getByRole("button", { name: /Rumors & hooks/ })).toBeVisible();
  await expect(pagesNav(page).getByRole("button", { name: /^Session 1/ })).toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search the journal" }).fill("zzz nothing");
  await expect(pagesNav(page).getByText("No matches.")).toHaveCount(3);

  // Clearing the search shows every page again.
  await page.getByRole("searchbox", { name: "Search the journal" }).fill("");
  await expect(pagesNav(page).getByRole("button", { name: /Loot & debts/ })).toBeVisible();
});

test("'Download my journal' saves a .md file containing a page title", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  await seed(page, campaignId);
  await page.goto(`/campaigns/${campaignId}/notes`);
  const button = page.getByRole("button", { name: "Download my journal" });
  await expect(button).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toMatch(/ journal\.md$/);
  const text = await readFile((await download.path())!, "utf8");
  expect(text).toMatch(/^# .+’s Journal\n/);
  expect(text).toContain("## Session 1");
  expect(text).toContain("## Rumors & hooks");
  expect(text).toContain("- • pay the ferryman");
  expect(text).toContain("- × light the lantern");
});

test("threads and search fit a phone: one column, no horizontal scroll, 44 px controls", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  await seed(page, campaignId);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/campaigns/${campaignId}/notes?view=threads`);
  await expect(threadsView(page).getByRole("listitem")).toHaveCount(3);
  await expectNoHorizontalScroll(page);
  for (const control of [threadsButton(page), page.getByRole("button", { name: "Download my journal" })]) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  const row = threadsView(page).getByRole("listitem").first();
  expect((await row.getByRole("button", { name: /^Task: / }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await row.getByRole("button", { name: /→$/ }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
