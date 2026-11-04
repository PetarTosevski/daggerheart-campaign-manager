import { expect, test, type Page } from "@playwright/test";

import { openJournal, seedJournal } from "../journal/helpers";
import { visual } from "./helpers";

// Journal JS visual spec (E2E_VISUAL=1): the left column (All sessions, '+ Plan session 8', Campaign so far) and the
// session heading at 1440x900 and 390x844, to compare with the design's left column and heading
// (reference/designs/journal/journal_views.jpg, panel 1): the GM on the live session, the GM's menu open, the GM
// renaming a planned session, and the player's read-only view.

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

test("JS session list and heading at 1440 and 390", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(240_000);
  const table = await seedJournal(browser);
  try {
    const { gm, player, sessions } = table;
    const aside = (page: Page) => page.getByRole("complementary", { name: "All sessions" });
    const top = (page: Page) => page.locator(".jr-session-top");
    const band = (page: Page) => page.locator(".jr-sessions");

    await openJournal(gm, table);
    await expect(aside(gm).getByRole("region", { name: "Campaign so far" })).not.toContainText("loading");
    const gmShots = visual(gm, "JOURNAL-JS", VIEWPORTS);
    await gmShots.shoot(band(gm), "gm-live");
    await gmShots.shoot(aside(gm), "gm-list");
    await gmShots.shoot(top(gm), "gm-heading");

    await top(gm).getByRole("button", { name: "Session menu" }).click();
    await gm.locator(".jr-sessions").screenshot({ path: "test-results/visual/JOURNAL-JS/gm-menu-live-1440.png", animations: "disabled" });
    await gm.keyboard.press("Escape");

    await openJournal(gm, table, `?s=${sessions[7]}`);
    await top(gm).getByRole("button", { name: "The chapel in the briar" }).click();
    await expect(top(gm).getByRole("textbox", { name: "Session 7 title" })).toBeFocused();
    await top(gm).screenshot({ path: "test-results/visual/JOURNAL-JS/gm-rename-1440.png", animations: "disabled" });
    await gm.keyboard.press("Escape");
    await top(gm).getByRole("button", { name: "Session menu" }).click();
    await gm.locator(".jr-sessions").screenshot({ path: "test-results/visual/JOURNAL-JS/gm-menu-planned-1440.png", animations: "disabled" });
    await gm.keyboard.press("Escape");

    await openJournal(player, table);
    await expect(aside(player).getByRole("region", { name: "Campaign so far" })).not.toContainText("loading");
    await visual(player, "JOURNAL-JS", VIEWPORTS).shoot(band(player), "player-live");
  } finally {
    await table.close();
  }
});
