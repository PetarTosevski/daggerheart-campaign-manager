import { expect, test } from "@playwright/test";

import { openSheet, visual } from "./helpers";

// S1: portrait, identity grid, traits and Experiences at 1440 and 390 (no horizontal scroll at 390).
// Board counterparts: node scripts/board-shots.mjs portrait identity traits experiences

test("S1 identity, portrait, traits and Experiences at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { sheet } = await openSheet(page);
  const { shoot } = visual(page, "S1");

  await expect(sheet.getByText("Transformation", { exact: true })).toBeVisible();
  await shoot(sheet.locator(".id-portrait"), "portrait");
  await shoot(sheet.locator(".id-grid"), "identity");
  await shoot(sheet.getByRole("list", { name: "Traits" }), "traits");
  await shoot(sheet.getByRole("region", { name: "Experiences" }), "experiences");
  await shoot(sheet.locator(".id-top"), "top");
});
