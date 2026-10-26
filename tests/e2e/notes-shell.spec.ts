import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";
import { expectNoHorizontalScroll, visual } from "./visual/helpers";

// D11 N0: the Notes page shell (.omc/plans/d11-notes.yaml). The GM and a player each open Notes from the nav and get
// the board's hero, the index column (search, the three page groups, the Shared tabs 'Shared by players' / 'Shared by
// GM', the journals lists, the bin, Quick keys) and the paper column, driven by ?view. No PIN control (A1), no
// 'Writing as' switcher (A2). An outsider gets the campaign not-found page. N0 has no notes functions yet: the slots are
// stubs.

const PLAYER = "e2e-player@example.test";
// An allowlisted account (scripts/e2e-setup.mjs) that is not in the campaign.
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
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();
  const { page: player, close } = await signedInContext(browser, PLAYER);
  await player.getByRole("button", { name: /Join Campaign/ }).click();
  await player.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await player.getByRole("button", { name: "Join", exact: true }).click();
  await expect(player.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  return { player, close };
}

/** The shell every member sees: index column with the Shared tabs, paper column, Quick keys, and no PIN control. */
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
  await expect(page.getByText(/PIN|Writing as/)).toHaveCount(0);
}

test("the GM opens Notes from the nav: hero, index column with the Shared tabs and the paper column", async ({ page }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const nav = page.getByRole("navigation", { name: "Campaign sections" });
  await nav.getByRole("link", { name: "Notes" }).click();
  await expect(page).toHaveURL(`/campaigns/${campaignId}/notes`);
  await expect(page).toHaveTitle(`Notes · ${name}`);
  await expect(nav.getByRole("link", { name: "Notes" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1, name: "Game Master’s Journal" })).toBeVisible();
  await expect(page.getByText("GM journal · private to the GM")).toBeVisible();
  await expectShell(page);
  await expect(page.getByText("Players’ journals", { exact: true })).toBeVisible();

  // The Shared tabs are ARIA tabs: arrow keys move between them.
  const tabs = page.getByRole("tablist", { name: "Shared pages" });
  await tabs.getByRole("tab", { name: "Shared by players" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(tabs.getByRole("tab", { name: "Shared by GM" })).toBeFocused();
  await expect(tabs.getByRole("tab", { name: "Shared by GM" })).toHaveAttribute("aria-selected", "true");

  // ?view drives the paper column; the threads button toggles it.
  const threads = page.getByRole("button", { name: /Open threads/ });
  await threads.click();
  await expect(page).toHaveURL(`/campaigns/${campaignId}/notes?view=threads`);
  await expect(threads).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Nothing dangling. Suspicious…")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("article", { name: "Open threads" })).toBeVisible();
  await threads.click();
  await expect(page).toHaveURL(`/campaigns/${campaignId}/notes`);
  await page.goto(`/campaigns/${campaignId}/notes?view=journal&journal=placeholder`);
  await expect(page.getByRole("article", { name: "Journal" })).toBeVisible();
  await page.goto(`/campaigns/${campaignId}/notes?view=nonsense`);
  await expect(page.getByRole("article", { name: "Page" })).toBeVisible();
});

test("a player opens Notes and gets the same shell with the two Shared tabs; an outsider gets not found", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const { player, close } = await playerJoins(page, browser, name);
  try {
    await player.getByRole("navigation", { name: "Campaign sections" }).getByRole("link", { name: "Notes" }).click();
    await expect(player).toHaveURL(`/campaigns/${campaignId}/notes`);
    await expect(player).toHaveTitle(`Notes · ${name}`);
    await expect(player.getByRole("heading", { level: 1, name: "Player’s Journal" })).toBeVisible();
    await expectShell(player);
    await expect(player.getByText("Players’ journals", { exact: true })).toHaveCount(0);
  } finally {
    await close();
  }

  const outsider = await signedInContext(browser, OUTSIDER);
  try {
    await outsider.page.goto(`/campaigns/${campaignId}/notes`);
    await expect(outsider.page.getByRole("heading", { name: "Campaign not found" })).toBeVisible();
    await expect(outsider.page.getByRole("complementary", { name: "Journal index" })).toHaveCount(0);
  } finally {
    await outsider.close();
  }
});

test("the shell fits a phone: one column, no horizontal scroll, 44 px targets at 390 px", async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/campaigns/${campaignId}/notes`);
  await expect(page.getByRole("heading", { level: 1, name: "Game Master’s Journal" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  const index = await page.getByRole("complementary", { name: "Journal index" }).boundingBox();
  const paper = await page.getByRole("region", { name: "Journal page" }).boundingBox();
  expect(paper!.y).toBeGreaterThan(index!.y + index!.height - 1);
  for (const tab of await page.getByRole("tab").all()) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect((await page.getByRole("button", { name: /Open threads/ }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

// Shots for the N0 task doc (E2E_VISUAL=1); board counterparts: `node scripts/board-shots.mjs notes:empty notes:threads`.
test("D11 N0 notes shell at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { campaignId } = await gmCreatesCampaign(page);
  await page.goto(`/campaigns/${campaignId}/notes`);
  await expect(page.getByRole("heading", { level: 1, name: "Game Master’s Journal" })).toBeVisible();
  const { shoot } = visual(page, "D11-N0");
  await shoot(page.locator(".bj-root"), "shell");
  await page.goto(`/campaigns/${campaignId}/notes?view=threads`);
  await expect(page.getByRole("article", { name: "Open threads" })).toBeVisible();
  await shoot(page.locator(".bj-root"), "threads");
});
