import { expect, test } from "@playwright/test";

import { openAdversaries, visual } from "./helpers";

// EV1: the Environment tab at 1440 and 390 (no board exists for it; it follows the adversary catalogue, A2).
// Castle High (Hope & Fear on), so the Book row and the Hope & Fear pills show.

test("EV1 environment tab: page, filters, list, stat block, opened adversary and empty state", { tag: "@visual" }, async ({ page }) => {
  await openAdversaries(page, "castle-high");
  await page.getByRole("tab", { name: "Environment" }).click();
  const { shoot } = visual(page, "EV1");
  const list = page.getByRole("region", { name: "Environment list" });
  await expect(list.getByRole("button", { name: /^Abandoned Grove/ })).toHaveAttribute("aria-current", "true");

  await shoot(page.locator(".adv-root"), "page");
  await shoot(list.locator(".adc-filters"), "filters");
  await shoot(list.locator(".adc-list"), "list");
  await list.getByRole("button", { name: /^Deadly Dungeon/ }).click();
  await shoot(page.getByRole("complementary", { name: "Environment stat block" }), "statblock");

  await list.getByRole("group", { name: "Type", exact: true }).getByRole("button", { name: "Social", exact: true }).click();
  await shoot(page.locator(".adc-grid"), "filtered");

  await list.getByRole("searchbox", { name: "Search environments" }).fill("zzzz");
  await expect(list.getByText(/No environments match/)).toBeVisible();
  await shoot(list.locator(".adc-list"), "empty");

  await list.getByRole("group", { name: "Type", exact: true }).getByRole("button", { name: "All" }).click();
  await list.getByRole("searchbox", { name: "Search environments" }).fill("raging");
  await page.getByRole("complementary", { name: "Environment stat block" }).getByRole("button", { name: "Show the Bear stat block" }).click();
  await shoot(page.getByRole("region", { name: "Bear, opened from Raging River" }), "opened");
});
