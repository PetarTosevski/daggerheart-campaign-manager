import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";
import { expectNoHorizontalScroll, visual } from "./visual/helpers";
import { gmJoinCode } from "./config/helpers";
import { TOUCH_FLOOR_ON_SCREEN } from "./zoom";

// D11 N0: the Notes shell (.omc/plans/d11-notes.yaml), since Journal JX1 the Journal's Notes sub-tab. The GM and a
// player each open the Journal from the nav, pick Notes and get the index column (search, the three page groups, the
// Shared tabs 'Shared by players' / 'Shared by GM', the journals lists, the bin, Quick keys) and the paper column,
// driven by ?view. No PIN control (A1); the 'Writing as' chips are there (JN2, Q12, reversing A2). An outsider gets the
// campaign not-found page.

const PLAYER = "e2e-player@example.test";
// A test sign-in account (scripts/e2e-setup.mjs) that is not in the campaign.
const OUTSIDER = "e2e-player2@example.test";

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Notes ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name, campaignId: new URL(page.url()).pathname.split("/")[2]! };
}

async function signedInContext(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAsTestGm(page, email);
  await expect(page).toHaveURL("/");
  return { page, close: () => context.close() };
}

async function playerJoins(page: Page, browser: Browser, campaignName: string) {
  const code = await gmJoinCode(page);
  const { page: player, close } = await signedInContext(browser, PLAYER);
  await player.getByRole("button", { name: /Join Campaign/ }).click();
  await player.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await player.getByRole("button", { name: "Join", exact: true }).click();
  await expect(player.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  return { player, close };
}

/** From the campaign nav: the Journal link, then its Notes sub-tab. */
async function openNotesFromNav(page: Page, campaignId: string, name: string) {
  const nav = page.getByRole("navigation", { name: "Campaign sections" });
  await expect(nav.getByRole("link", { name: "Notes" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Sessions" })).toHaveCount(0);
  await nav.getByRole("link", { name: "Journal" }).click();
  await expect(page).toHaveURL(`/campaigns/${campaignId}/journal`);
  await expect(page).toHaveTitle(`Journal · ${name}`);
  await expect(nav.getByRole("link", { name: "Journal" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1, name: "Journal" })).toBeVisible();
  await page.getByRole("tablist", { name: "Journal" }).getByRole("tab", { name: /^Notes/ }).click();
  await expect(page).toHaveURL(`/campaigns/${campaignId}/journal?tab=notes`);
}

/** The shell every member sees: index column with the Shared tabs, paper column, Quick keys, Writing as, no PIN. */
async function expectShell(page: Page) {
  const index = page.getByRole("complementary", { name: "Journal index" });
  await expect(index.getByRole("searchbox", { name: "Search the journal" })).toBeVisible();
  await expect(index.getByText("Session logs", { exact: true })).toBeVisible();
  await expect(index.getByText("Collections", { exact: true })).toBeVisible();
  await expect(index.getByRole("button", { name: "New future page" })).toBeVisible();
  const tabs = index.getByRole("tablist", { name: "Shared pages" });
  await expect(tabs.getByRole("tab")).toHaveText(["Shared by players", "Shared by GM"]);
  await expect(index.getByText("Past journals", { exact: true })).toBeVisible();
  await expect(index.getByText("Torn-out pages", { exact: true })).toBeVisible();
  await expect(index.getByText("Quick keys", { exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Journal page" }).getByRole("article", { name: "Page" })).toBeVisible();
  await expect(page.getByText(/PIN/)).toHaveCount(0);
  // JX1 flipped the old page's 'no Writing as' check (JN2, Q12): the chips sit over the paper.
  await expect(page.getByRole("group", { name: "Writing as" })).toBeVisible();
}

test("the GM opens the Journal's Notes from the nav: index column with the Shared tabs and the paper column", async ({ page }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  await openNotesFromNav(page, campaignId, name);
  await expect(page.getByRole("group", { name: "Writing as" }).getByRole("button", { name: "Game Master", pressed: true })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Journal" }).getByRole("tab", { name: "Notes 4 pages" })).toHaveAttribute("aria-selected", "true");
  await expectShell(page);
  await expect(page.getByText("Players’ journals", { exact: true })).toBeVisible();

  // The Shared tabs are ARIA tabs: arrow keys move between them.
  const tabs = page.getByRole("tablist", { name: "Shared pages" });
  await tabs.getByRole("tab", { name: "Shared by players" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Shared by GM" })).toBeFocused();
  await expect(tabs.getByRole("tab", { name: "Shared by GM" })).toHaveAttribute("aria-selected", "true");

  // ?view drives the paper column; the Journal header's Open threads opens the threads view, 'Game Master' goes back.
  await page.getByRole("button", { name: /^Open threads: \d+$/ }).click();
  await expect(page).toHaveURL(`/campaigns/${campaignId}/journal?tab=notes&view=threads`);
  await expect(page.getByText("Nothing dangling. Suspicious…")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("article", { name: "Open threads" })).toBeVisible();
  await page.getByRole("group", { name: "Writing as" }).getByRole("button", { name: "Game Master" }).click();
  await expect(page).not.toHaveURL(/view=threads/);
  await expect(page.getByRole("region", { name: "Journal page" }).getByRole("article", { name: "Page" })).toBeVisible();
  await page.goto(`/campaigns/${campaignId}/journal?tab=notes&view=journal&journal=placeholder`);
  await expect(page.getByRole("article", { name: "Journal" })).toBeVisible();
  await page.goto(`/campaigns/${campaignId}/journal?tab=notes&view=nonsense`);
  await expect(page.getByRole("article", { name: "Page" })).toBeVisible();
});

test("a player opens Notes and gets the same shell with the two Shared tabs; an outsider gets not found", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const { player, close } = await playerJoins(page, browser, name);
  try {
    await openNotesFromNav(player, campaignId, name);
    await expect(player.getByRole("group", { name: "Writing as" }).getByRole("button", { name: "Player", pressed: true })).toBeVisible();
    await expectShell(player);
    await expect(player.getByText("Players’ journals", { exact: true })).toHaveCount(0);
  } finally {
    await close();
  }

  const outsider = await signedInContext(browser, OUTSIDER);
  try {
    await outsider.page.goto(`/campaigns/${campaignId}/journal?tab=notes`);
    await expect(outsider.page.getByRole("heading", { name: "Campaign not found" })).toBeVisible();
    await expect(outsider.page.getByRole("complementary", { name: "Journal index" })).toHaveCount(0);
  } finally {
    await outsider.close();
  }
});

test("the shell fits a phone: one column, no horizontal scroll, 44 px targets at 390 px", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/campaigns/${campaignId}/journal?tab=notes`);
  await expect(page.getByRole("group", { name: "Writing as" }).getByRole("button", { name: "Game Master", pressed: true })).toBeVisible();
  await expectNoHorizontalScroll(page);
  const index = await page.getByRole("complementary", { name: "Journal index" }).boundingBox();
  const paper = await page.getByRole("region", { name: "Journal page" }).boundingBox();
  expect(paper!.y).toBeGreaterThan(index!.y + index!.height - 1);
  for (const tab of await page.getByRole("tab").all()) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(TOUCH_FLOOR_ON_SCREEN);
  expect((await page.getByRole("button", { name: /^Open threads: \d+$/ }).boundingBox())!.height).toBeGreaterThanOrEqual(TOUCH_FLOOR_ON_SCREEN);
});

// Shots for the N0 task doc (E2E_VISUAL=1); board counterparts: `node scripts/board-shots.mjs notes:empty notes:threads`.
test("D11 N0 notes shell at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  await page.goto(`/campaigns/${campaignId}/journal?tab=notes`);
  await expect(page.getByRole("group", { name: "Writing as" }).getByRole("button", { name: "Game Master", pressed: true })).toBeVisible();
  const { shoot } = visual(page, "D11-N0");
  await shoot(page.locator(".bj-root"), "shell");
  await page.goto(`/campaigns/${campaignId}/journal?tab=notes&view=threads`);
  await expect(page.getByRole("article", { name: "Open threads" })).toBeVisible();
  await shoot(page.locator(".bj-root"), "threads");
});
