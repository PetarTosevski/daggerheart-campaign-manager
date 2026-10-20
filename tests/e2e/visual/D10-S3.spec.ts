import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { D10_VIEWPORTS, openSessions, visual } from "./helpers";

// D10 S3 visual spec (E2E_VISUAL=1): the live card of the selected session at 1440, 1024 and 390 in its states (not
// running, live with the start report and the XC1 switch, another session running, played with the End report) and
// the Start confirm dialog. Board counterparts: `node scripts/board-shots.mjs sessions:live sessions:prep`
// (test-results/visual/board/).

test("D10 S3 live card at 1440, 1024 and 390", { tag: "@visual" }, async ({ page }) => {
  const { client, campaignId } = await openSessions(page);
  await client.mutation(api.sessionRecords.create, { campaignId, idempotencyKey: crypto.randomUUID() });
  await page.getByRole("button", { name: "+ New session" }).click();
  await expect(page).toHaveURL(/stage=prep$/);
  const items = page.getByRole("complementary", { name: "Session list" }).getByRole("button");
  await expect(items).toHaveCount(2);
  const card = page.getByRole("region", { name: "Live session" });
  const { shoot } = visual(page, "D10-S3", D10_VIEWPORTS);

  // Not running (planned).
  await expect(card).toContainText("Not running");
  await shoot(card, "idle");

  // The Start dialog, then live with the start report and the XC1 switch.
  await card.getByRole("button", { name: "Start session" }).click();
  const dialog = page.getByRole("dialog", { name: "Start the session?" });
  await expect(dialog).toBeVisible();
  await dialog.screenshot({ path: "test-results/visual/D10-S3/start-dialog-1440.png", animations: "disabled" });
  await dialog.getByRole("button", { name: "Start session" }).click();
  await expect(card).toContainText("Session in progress");
  await expect(card.getByRole("status")).toContainText("Session started.");
  await shoot(card, "live");
  await shoot(page.locator(".ss-detail"), "detail-live");

  // Another session is running (Session 1 selected while Session 2 is live).
  await items.nth(1).click();
  await expect(card).toContainText("Session 2 is still running. Starting this one ends it.");
  await shoot(card, "other-live");

  // Played, with the End report.
  await items.nth(0).click();
  await card.getByRole("button", { name: "End session" }).click();
  await page.getByRole("dialog", { name: "End the session?" }).getByRole("button", { name: "End session" }).click();
  await expect(card).toContainText("This session has been played.");
  await expect(card.getByRole("status")).toContainText("Session ended.");
  await shoot(card, "played");
});
