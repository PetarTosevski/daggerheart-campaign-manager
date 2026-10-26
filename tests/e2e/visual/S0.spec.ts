import { test } from "@playwright/test";

import { openSheet, openTab, visual } from "./helpers";

// S0: the whole sheet per page and Domains sub-tab, at 1440 and 390 (no horizontal scroll at 390).
// Board counterparts: node scripts/board-shots.mjs sheet-p1 sheet-p2 sheet-p3 sheet-p3-hero header

test("S0 sheet shell, every page at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { sheet } = await openSheet(page);
  const { shoot } = visual(page, "S0");

  await shoot(sheet.locator("header.cs-head"), "header");
  await shoot(sheet, "sheet-p1");
  await openTab(page, "Story & Advancement");
  await shoot(sheet, "sheet-p2");
  await openTab(page, "Domains");
  await shoot(sheet, "sheet-p3");
  await openTab(page, "Heritage & Subclass");
  await shoot(sheet, "sheet-p3-hero");
});
