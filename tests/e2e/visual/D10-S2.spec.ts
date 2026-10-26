import { expect, test, type Browser, type Page } from "@playwright/test";

import { signInAsTestGm } from "../fixtures";
import { D10_VIEWPORTS, openSessions, visual } from "./helpers";

// D10 S2 visual spec (E2E_VISUAL=1): the session list column, the header line and the GM's session header card at
// 1440, 1024 and 390. Board counterparts: `node scripts/board-shots.mjs sessions:list sessions:prep`
// (test-results/visual/board/). Three sessions as on the board's story: 1 played, 2 played, 3 planned and selected.
// The player's read-only view (Q4) has no board counterpart (the board is GM-only).

async function playerJoins(page: Page, browser: Browser, campaignId: string, campaignName: string) {
  await page.goto(`/campaigns/${campaignId}`);
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();
  const context = await browser.newContext();
  const player = await context.newPage();
  await signInAsTestGm(player, "e2e-player@example.test");
  await expect(player).toHaveURL("/");
  await player.getByRole("button", { name: /Join Campaign/ }).click();
  await player.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await player.getByRole("button", { name: "Join", exact: true }).click();
  await expect(player.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  return { player, close: () => context.close() };
}

test("D10 S2 session records at 1440, 1024 and 390", { tag: "@visual" }, async ({ page, browser }) => {
  const { url, campaignId, campaignName } = await openSessions(page);
  const card = page.getByRole("region", { name: "Session detail" }).getByRole("region", { name: "Session", exact: true });
  const titles = ["The Withered Road", "Ashes at Thornwick", "The Bridge at Dawn"];
  const dates = ["2026-10-10", "2026-10-17", "2026-10-24"];
  for (const [i, title] of titles.entries()) {
    await page.getByRole("button", { name: "+ New session" }).click();
    await card.getByLabel(`Session ${i + 1} title`).fill(title);
    await card.getByLabel(`Session ${i + 1} title`).press("Enter");
    await card.getByLabel("Date").fill(dates[i]!);
    await expect(page.getByRole("complementary", { name: "Session list" }).getByRole("button", { name: new RegExp(`SESSION ${i + 1}`) })).toContainText(title);
    if (i < 2) await card.getByRole("button", { name: "Mark as played" }).click();
    if (i < 2) await expect(card.getByRole("button", { name: "Mark as not played" })).toBeVisible();
  }
  await expect(page.getByText(/^3 sessions · 2 played · Next: /)).toBeVisible();
  await card.getByLabel("Date").blur();

  const { shoot } = visual(page, "D10-S2", D10_VIEWPORTS);
  await shoot(page.locator(".ss-root"), "list");
  await shoot(card, "header-card");

  // The second click's state of Delete.
  await card.getByRole("button", { name: "Delete" }).click();
  await expect(card.getByRole("button", { name: "Click again to delete" })).toBeVisible();
  await card.screenshot({ path: "test-results/visual/D10-S2/header-card-confirm-1440.png", animations: "disabled" });
  await page.goto(url);
  await expect(page.getByRole("complementary", { name: "Session list" }).getByRole("button")).toHaveCount(3);

  const { player, close } = await playerJoins(page, browser, campaignId, campaignName);
  try {
    await player.goto(url);
    await expect(player.getByRole("complementary", { name: "Session list" }).getByRole("button")).toHaveCount(2);
    await expect(player.getByRole("heading", { name: "Ashes at Thornwick" })).toBeVisible();
    await visual(player, "D10-S2", D10_VIEWPORTS).shoot(player.locator(".ss-root"), "player");
  } finally {
    await close();
  }
});
