import { expect, test, type Page } from "@playwright/test";

import { openJournal, seedJournal } from "../journal/helpers";
import { visual } from "./helpers";

// Journal JH visual spec (E2E_VISUAL=1): the header actions at 1440x900 and 390x844 (design
// reference/designs/journal/journal_views.jpg, header right): GM live (chip, End, menu, tome, Open threads), the chip
// menu open, the End dialog, the player's read-only chip, the End report and the GM with nothing live ('Start
// session 7').

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

test("JH header actions at 1440 and 390", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(240_000);
  const table = await seedJournal(browser);
  try {
    const { gm, player } = table;
    const head = (page: Page) => page.locator(".jr-head");
    await openJournal(gm, table);
    await expect(gm.getByRole("button", { name: /^Open threads: \d+$/ })).toBeVisible();
    const gmShots = visual(gm, "JOURNAL-JH", VIEWPORTS);
    await gmShots.shoot(head(gm), "gm-live");

    await gm.getByRole("button", { name: "Session options" }).click();
    await gm.locator(".jh-menu-panel").screenshot({ path: "test-results/visual/JOURNAL-JH/gm-menu-1440.png", animations: "disabled" });
    await gm.keyboard.press("Escape");

    await openJournal(player, table);
    await expect(player.getByTestId("journal-live-chip")).toBeVisible();
    await visual(player, "JOURNAL-JH", VIEWPORTS).shoot(head(player), "player-live");

    await gm.getByRole("button", { name: "End session" }).click();
    const end = gm.getByRole("dialog", { name: "End the session?" });
    await end.screenshot({ path: "test-results/visual/JOURNAL-JH/end-dialog-1440.png", animations: "disabled" });
    await end.getByRole("button", { name: "End session", exact: true }).click();
    await expect(gm.locator(".jh-report")).toContainText("Session ended.");
    await gmShots.shoot(head(gm), "gm-ended-report");
    await gm.getByRole("button", { name: "Dismiss the session report" }).click();
    await expect(gm.getByRole("button", { name: "Start session 7" })).toBeVisible();
    await gmShots.shoot(head(gm), "gm-idle");
  } finally {
    await table.close();
  }
});
