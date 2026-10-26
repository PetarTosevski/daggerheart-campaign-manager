import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";
import { expectNoHorizontalScroll, openSessions } from "./visual/helpers";

// D10 S2: session records (B1, Q4, Q10). The GM creates sessions, titles and dates them, marks one played and deletes
// one with two clicks; a player sees only live and played sessions, read-only, without the stage tabs.

const PLAYER = "e2e-player@example.test";

async function playerJoins(page: Page, browser: Browser, campaignId: string, campaignName: string) {
  await page.goto(`/campaigns/${campaignId}`);
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();

  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  await player.getByRole("button", { name: /Join Campaign/ }).click();
  await player.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await player.getByRole("button", { name: "Join", exact: true }).click();
  await expect(player.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  return { player, close: () => context.close() };
}

test("the GM creates, titles, dates, marks played and deletes sessions; a player sees only the played one", async ({ page, browser }) => {
  const { campaignId, campaignName, url } = await openSessions(page);
  const list = page.getByRole("complementary", { name: "Session list" });
  const card = page.getByRole("region", { name: "Session detail" }).getByRole("region", { name: "Session", exact: true });

  // '+ New session' opens the new session on Prep.
  await page.getByRole("button", { name: "+ New session" }).click();
  await expect(page).toHaveURL(new RegExp(`${url}\\?s=[^&]+&stage=prep$`));
  await expect(page.getByRole("tab", { name: "Prep" })).toHaveAttribute("aria-selected", "true");
  const first = new URL(page.url()).searchParams.get("s")!;
  await expect(card.getByLabel("Session 1 title")).toHaveValue("");
  await card.getByLabel("Session 1 title").fill("The Bridge at Dawn");
  await card.getByLabel("Session 1 title").press("Enter");
  await card.getByLabel("Date").fill("2026-10-24");
  await expect(list.getByRole("button", { name: /SESSION 1/ })).toContainText("The Bridge at Dawn");
  await expect(page.getByText(/^1 session · 0 played · Next: /)).toBeVisible();

  await page.getByRole("button", { name: "+ New session" }).click();
  await expect(page).not.toHaveURL(new RegExp(`s=${first}`));
  await card.getByLabel("Session 2 title").fill("Into the Wither");
  await card.getByLabel("Session 2 title").blur();
  await card.getByLabel("Date").fill("2026-10-31");

  // Newest first, chips per status, the current one ringed.
  const items = list.getByRole("button");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText("SESSION 2");
  await expect(items.nth(0)).toContainText("Into the Wither");
  await expect(items.nth(0)).toHaveAttribute("aria-current", "true");
  await expect(items.nth(1)).toContainText("SESSION 1");
  await expect(items.nth(1)).toContainText("Planned");

  // Mark the first played (no start / end effects; the chip and the header line follow).
  await items.nth(1).click();
  await expect(items.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(card.getByLabel("Session 1 title")).toHaveValue("The Bridge at Dawn");
  await expect(card.getByLabel("Date")).toHaveValue("2026-10-24");
  await card.getByRole("button", { name: "Mark as played" }).click();
  await expect(card.getByRole("button", { name: "Mark as not played" })).toBeVisible();
  await expect(items.nth(1).locator(".ss-chip")).toHaveText("Played");
  await expect(page.getByText(/^2 sessions · 1 played · Next: /)).toBeVisible();
  // The toggle goes back and forth by hand.
  await card.getByRole("button", { name: "Mark as not played" }).click();
  await expect(items.nth(1).locator(".ss-chip")).toHaveText("Planned");
  await card.getByRole("button", { name: "Mark as played" }).click();
  await expect(items.nth(1).locator(".ss-chip")).toHaveText("Played");

  // Delete the second: the first click asks, the second deletes; the page falls back to the newest session.
  await items.nth(0).click();
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(card.getByRole("button", { name: "Click again to delete" })).toBeVisible();
  await expect(items).toHaveCount(2);
  await card.getByRole("button", { name: "Click again to delete" }).click();
  await expect(items).toHaveCount(1);
  await expect(page).toHaveURL(url);
  await expect(items.nth(0)).toContainText("The Bridge at Dawn");
  await expect(page.getByText("1 session · 1 played", { exact: true })).toBeVisible();

  // A planned session stays GM-only (Q4).
  await page.getByRole("button", { name: "+ New session" }).click();
  await expect(items).toHaveCount(2);

  const { player, close } = await playerJoins(page, browser, campaignId, campaignName);
  try {
    await player.goto(url);
    const playerList = player.getByRole("complementary", { name: "Session list" });
    await expect(playerList.getByRole("button")).toHaveCount(1);
    await expect(playerList.getByRole("button")).toContainText("SESSION 1");
    await expect(playerList.getByRole("button")).toContainText("Played");
    await expect(player.getByText("1 session · 1 played", { exact: true })).toBeVisible();
    const view = player.getByRole("region", { name: "Session detail" }).getByRole("region", { name: "Session", exact: true });
    await expect(view.getByRole("heading", { name: "The Bridge at Dawn" })).toBeVisible();
    await expect(view.getByRole("heading", { name: "Recap" })).toBeVisible();
    await expect(view.getByText("No recap was written for this session.")).toBeVisible();
    // Read-only: no inputs, no buttons, no stage tabs, no new-session button.
    await expect(view.getByRole("textbox")).toHaveCount(0);
    await expect(view.getByRole("button")).toHaveCount(0);
    await expect(player.getByRole("tablist", { name: "Session stage" })).toHaveCount(0);
    await expect(player.getByRole("button", { name: "+ New session" })).toHaveCount(0);
  } finally {
    await close();
  }
});

test("the header card fits a phone: one column, labelled controls, 44 px targets, no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSessions(page);
  await page.getByRole("button", { name: "+ New session" }).click();
  const card = page.getByRole("region", { name: "Session detail" }).getByRole("region", { name: "Session", exact: true });
  await expect(card.getByLabel("Session 1 title")).toBeVisible();
  await expectNoHorizontalScroll(page);
  for (const control of [card.getByLabel("Session 1 title"), card.getByLabel("Date"), card.getByRole("button", { name: "Mark as played" }), card.getByRole("button", { name: "Delete" })]) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect((await page.getByRole("button", { name: "+ New session" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
});
