import { expect, test, type Page } from "@playwright/test";

import { openAdversaries } from "./visual/helpers";

// D8 A2: the adversary catalogue in the board's look: search, chips, tier groups, paging, empty state and the parchment
// stat block; Hope & Fear and Weredragon entries follow the campaign (H&F switch, frame).

const list = (page: Page) => page.getByRole("region", { name: "Adversary list" });
const statBlock = (page: Page) => page.getByRole("complementary", { name: "Stat block" });
const row = (page: Page, name: string) => list(page).getByRole("button", { name: new RegExp(`^${name}`) });

test("search 'burrower' shows Acid Burrower and its stat block", async ({ page }) => {
  await openAdversaries(page, "witherwild");
  await expect(page.getByTestId("catalogue-count")).toHaveText("129 adversaries");
  await list(page).getByRole("searchbox", { name: "Search adversaries" }).fill("burrower");
  await expect(page.getByTestId("catalogue-count")).toHaveText("1 of 129 shown");
  await expect(row(page, "Acid Burrower")).toHaveAttribute("aria-current", "true");
  await expect(list(page).locator(".adc-item")).toHaveCount(1);

  const block = statBlock(page);
  await expect(block.getByRole("heading", { level: 2, name: "Acid Burrower" })).toBeVisible();
  await expect(block.getByText("Tier 1 Solo")).toBeVisible();
  const stats = block.locator(".adc-sb-stats");
  await expect(stats.getByRole("term")).toHaveText(["Difficulty", "Thresholds", "HP", "Stress"]);
  await expect(stats.getByRole("definition")).toHaveText(["14", "8/15", "8", "3"]);
  await expect(block.getByText("Tremor Sense +2")).toBeVisible();
  await expect(block.getByText("Relentless (3)")).toBeVisible();
});

test("Tier 2 + Horde filter, a second click clears a chip, and the empty state", async ({ page }) => {
  await openAdversaries(page, "witherwild");
  const tier = list(page).getByRole("group", { name: "Tier" });
  const type = list(page).getByRole("group", { name: "Type" });
  await tier.getByRole("button", { name: "2", exact: true }).click();
  await type.getByRole("button", { name: "Horde", exact: true }).click();
  await expect(type.getByRole("button", { name: "Horde", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(list(page).getByRole("heading", { level: 3 })).toHaveText([/^Tier 2/]);
  const types = await list(page).locator(".adc-type").allTextContents();
  expect(types.length).toBeGreaterThan(0);
  for (const t of types) expect(t).toMatch(/^Horde \(\d+\/HP\)$/);

  await tier.getByRole("button", { name: "2", exact: true }).click();
  await expect(tier.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
  await expect(list(page).getByRole("heading", { level: 3, name: "Tier 1" })).toBeVisible();

  await list(page).getByRole("searchbox", { name: "Search adversaries" }).fill("zzzz no such adversary");
  await expect(list(page).getByText("No adversaries match these filters. Clear the search or pick another tier or type.")).toBeVisible();
  await expect(statBlock(page).locator(".adc-sb")).toHaveCount(0);
});

test("'Show more' is reachable in the scrolling list and adds 60 rows", async ({ page }) => {
  await openAdversaries(page, "witherwild");
  await expect(list(page).locator(".adc-item")).toHaveCount(40);
  const more = list(page).getByRole("button", { name: "Show 60 more · 89 left" });
  await more.scrollIntoViewIfNeeded();
  await more.click();
  await expect(list(page).locator(".adc-item")).toHaveCount(100);
  await expect(list(page).getByRole("button", { name: "Show 29 more · 29 left" })).toBeVisible();
  // Selection by keyboard: Tab to a row and press Enter.
  await row(page, "Bear").focus();
  await page.keyboard.press("Enter");
  await expect(statBlock(page).getByRole("heading", { level: 2, name: "Bear" })).toBeVisible();
});

test("a Witherwild campaign (Hope & Fear off) shows no Hope & Fear entries and no Book row", async ({ page }) => {
  await openAdversaries(page, "witherwild");
  await expect(list(page).getByRole("group", { name: "Book" })).toHaveCount(0);
  await list(page).getByRole("searchbox", { name: "Search adversaries" }).fill("ahuizotl");
  await expect(list(page).getByText("No adversaries match these filters.", { exact: false })).toBeVisible();
  await expect(list(page).getByRole("img", { name: "Hope and Fear" })).toHaveCount(0);
});

test("a Castle High campaign shows Hope & Fear entries with their pill and source line", async ({ page }) => {
  await openAdversaries(page, "castle-high");
  await expect(page.getByTestId("catalogue-count")).toHaveText("264 adversaries · 129 core, 135 Hope & Fear");
  await list(page).getByRole("group", { name: "Book" }).getByRole("button", { name: "Hope & Fear" }).click();
  await expect(page.getByTestId("catalogue-count")).toHaveText("135 of 264 shown");
  await list(page).getByRole("searchbox", { name: "Search adversaries" }).fill("ahuizotl");
  await expect(row(page, "Ahuizotl")).toBeVisible();
  const block = statBlock(page);
  await expect(block.getByRole("heading", { level: 2, name: "Ahuizotl" })).toBeVisible();
  await expect(block.getByRole("img", { name: "Hope and Fear" })).toBeVisible();
  await expect(block.getByText("Hope & Fear · p. 62")).toBeVisible();
  // Weredragon entries are frame-exclusive.
  await list(page).getByRole("searchbox", { name: "Search adversaries" }).fill("weredrake");
  await expect(list(page).getByText("No adversaries match these filters.", { exact: false })).toBeVisible();
});

test("at 390 px the stat block follows the list, picking a row brings it into view, no horizontal scroll", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAdversaries(page, "witherwild");
  await row(page, "Bear").click();
  await expect(statBlock(page).getByRole("heading", { level: 2, name: "Bear" })).toBeInViewport();
  const [listBox, blockBox] = await Promise.all([list(page).boundingBox(), statBlock(page).boundingBox()]);
  expect(blockBox!.y).toBeGreaterThan(listBox!.y + listBox!.height - 1);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
