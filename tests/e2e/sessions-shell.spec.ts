import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";
import { D10_VIEWPORTS, expectNoHorizontalScroll, openSessions, visual } from "./visual/helpers";

// D10 S0: the Sessions page shell (.omc/plans/d10-sessions.yaml). The GM gets the board's header ('Sessions', the
// header line, '+ New session'), the list column and the detail column; with a session in the URL the Prep / Play /
// Wrap-up tabs follow ?stage. A player opens the same tab (it is not GM-only) and never gets stage tabs (Q4).
// S0 has no session functions yet, so the URL's session id is a placeholder: the stubs do not read it.

const PLAYER = "e2e-player@example.test";
const SESSION = "placeholder-session";

async function gmCreatesCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Sessions ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  return { name, campaignId: new URL(page.url()).pathname.split("/")[2]! };
}

async function playerJoins(page: Page, browser: Browser, campaignName: string) {
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

test("the GM opens Sessions from the nav: header, list column and the empty detail column", async ({ page }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const nav = page.getByRole("navigation", { name: "Campaign sections" });
  await nav.getByRole("link", { name: "Sessions" }).click();
  await expect(page).toHaveURL(`/campaigns/${campaignId}/sessions`);
  await expect(page).toHaveTitle(`Sessions · ${name}`);
  await expect(page.getByRole("heading", { level: 1, name: "Sessions" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Sessions" })).toHaveAttribute("aria-current", "page");

  await expect(page.getByText("0 sessions · 0 played")).toBeVisible();
  await expect(page.getByRole("button", { name: "+ New session" })).toBeVisible();
  const list = page.getByRole("complementary", { name: "Session list" });
  await expect(list.getByText("All sessions")).toBeVisible();
  await expect(list.getByText("No sessions yet. Create one to start prepping.")).toBeVisible();
  const detail = page.getByRole("region", { name: "Session detail" });
  await expect(detail.getByRole("heading", { name: "No session selected" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Session stage" })).toHaveCount(0);
});

test("with a session in the URL the GM gets the stage tabs, driven by ?stage", async ({ page }) => {
  const { url } = await openSessions(page, { query: `?s=${SESSION}&stage=play` });
  const tabs = page.getByRole("tablist", { name: "Session stage" });
  await expect(tabs.getByRole("tab")).toHaveText(["Prep", "Play", "Wrap-up"]);
  await expect(tabs.getByRole("tab", { name: "Play" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel", { name: "Play" }).getByRole("region", { name: "Play stage" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Live session" })).toBeVisible();

  await tabs.getByRole("tab", { name: "Wrap-up" }).click();
  await expect(page).toHaveURL(`${url}?s=${SESSION}&stage=wrap`);
  await expect(page.getByRole("region", { name: "Wrap-up stage" })).toBeVisible();

  // Keyboard: arrow keys move between the tabs (ARIA tabs), and the URL follows.
  await tabs.getByRole("tab", { name: "Wrap-up" }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.getByRole("tab", { name: "Play" })).toBeFocused();
  await expect(page).toHaveURL(`${url}?s=${SESSION}&stage=play`);
  await page.keyboard.press("Home");
  await expect(tabs.getByRole("tab", { name: "Prep" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Prep stage" })).toBeVisible();

  // A reload keeps the view; a bad stage falls back to Prep.
  await page.reload();
  await expect(tabs.getByRole("tab", { name: "Prep" })).toHaveAttribute("aria-selected", "true");
  await page.goto(`${url}?s=${SESSION}&stage=nonsense`);
  await expect(tabs.getByRole("tab", { name: "Prep" })).toHaveAttribute("aria-selected", "true");
});

test("a player opens Sessions and gets the read-only layout: no new session, no stage tabs", async ({ page, browser }) => {
  const { name, campaignId } = await gmCreatesCampaign(page);
  const { player, close } = await playerJoins(page, browser, name);
  try {
    const nav = player.getByRole("navigation", { name: "Campaign sections" });
    await nav.getByRole("link", { name: "Sessions" }).click();
    await expect(player).toHaveURL(`/campaigns/${campaignId}/sessions`);
    await expect(player.getByRole("heading", { level: 1, name: "Sessions" })).toBeVisible();
    await expect(player.getByRole("complementary", { name: "Session list" }).getByText("No sessions played yet.")).toBeVisible();
    await expect(player.getByRole("button", { name: "+ New session" })).toHaveCount(0);

    // Even with a session and a stage in the URL, a player gets the read-only view only (Q4).
    await player.goto(`/campaigns/${campaignId}/sessions?s=${SESSION}&stage=prep`);
    await expect(player.getByRole("region", { name: "Session detail" }).getByRole("region", { name: "Session" })).toBeVisible();
    await expect(player.getByRole("tablist", { name: "Session stage" })).toHaveCount(0);
    await expect(player.getByRole("region", { name: "Prep stage" })).toHaveCount(0);
    await expect(player.getByRole("region", { name: "Live session" })).toHaveCount(0);
  } finally {
    await close();
  }
});

test("the shell fits a phone: one column, no horizontal scroll at 390 px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSessions(page, { query: `?s=${SESSION}&stage=prep` });
  await expect(page.getByRole("tablist", { name: "Session stage" })).toBeVisible();
  await expectNoHorizontalScroll(page);
  const list = await page.getByRole("complementary", { name: "Session list" }).boundingBox();
  const detail = await page.getByRole("region", { name: "Session detail" }).boundingBox();
  expect(detail!.y).toBeGreaterThan(list!.y + list!.height - 1);
  for (const tab of await page.getByRole("tab").all()) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
});

// Shots for the S0 task doc (E2E_VISUAL=1); board counterparts: `node scripts/board-shots.mjs sessions:empty sessions:prep`.
test("D10 S0 sessions shell at 1440, 1024 and 390", { tag: "@visual" }, async ({ page }) => {
  const { url } = await openSessions(page);
  const { shoot } = visual(page, "D10-S0", D10_VIEWPORTS);
  await shoot(page.locator(".ss-root"), "empty");
  await page.goto(`${url}?s=${SESSION}&stage=prep`);
  await expect(page.getByRole("tablist", { name: "Session stage" })).toBeVisible();
  await shoot(page.locator(".ss-root"), "prep");
});
