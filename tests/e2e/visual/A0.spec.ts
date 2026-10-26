import { expect, test } from "@playwright/test";

import { openAdversaries, visual } from "./helpers";

// A0 (D8): the Adversaries page shell at 1440 and 390: the board header (H1, count line, blurb), the tabs and each
// tab's stub slots. Board counterparts: `node scripts/board-shots.mjs adversaries:header adversaries:page`
// (the board has no tabs; they are drawn with its chip tokens).

test("A0 adversaries shell: header, tabs and slots at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  await openAdversaries(page);
  const { shoot } = visual(page, "A0");

  await shoot(page.locator(".adv-top"), "header");
  await shoot(page.getByRole("tablist", { name: "Adversary views" }), "tabs");
  await shoot(page.locator(".adv-root"), "page-catalogue");

  await page.getByRole("tab", { name: "Encounters" }).click();
  await expect(page.getByRole("tabpanel", { name: "Encounters" })).toBeVisible();
  await shoot(page.locator(".adv-root"), "page-encounters");
});
