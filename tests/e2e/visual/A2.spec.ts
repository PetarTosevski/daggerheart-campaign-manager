import { expect, test } from "@playwright/test";

import { openAdversaries, visual } from "./helpers";

// A2 (D8): the adversary catalogue at 1440 and 390. Board counterparts:
// `node scripts/board-shots.mjs adversaries:page adversaries:filters adversaries:list adversaries:statblock adversaries:empty`.
// Castle High (Hope & Fear on), so the Book row and the Hope & Fear pills show as on the board.

test("A2 adversary catalogue: page, filters, list, stat block and empty state", { tag: "@visual" }, async ({ page }) => {
  await openAdversaries(page, "castle-high");
  const { shoot } = visual(page, "A2");
  const list = page.getByRole("region", { name: "Adversary list" });
  await expect(list.getByRole("button", { name: /^Acid Burrower/ })).toHaveAttribute("aria-current", "true");

  await shoot(page.locator(".adv-root"), "page");
  await shoot(list.locator(".adc-filters"), "filters");
  await shoot(list.locator(".adc-list"), "list");
  await shoot(page.getByRole("complementary", { name: "Stat block" }), "statblock");

  await list.getByRole("group", { name: "Tier" }).getByRole("button", { name: "2", exact: true }).click();
  await list.getByRole("group", { name: "Type" }).getByRole("button", { name: "Horde", exact: true }).click();
  await shoot(page.locator(".adc-grid"), "filtered");

  await list.getByRole("searchbox", { name: "Search adversaries" }).fill("zzzz");
  await expect(list.getByText(/No adversaries match/)).toBeVisible();
  await shoot(list.locator(".adc-list"), "empty");
});
