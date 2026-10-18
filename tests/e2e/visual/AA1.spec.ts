import { expect, test, type Locator } from "@playwright/test";

import { openAdversaries, visual } from "./helpers";

// AA1: the rulebook illustration as a banner on the parchment stat block, and the round thumbnails in the
// catalogue list, at 1440 and 390. Acid Burrower has art (CB p.210); Bear has none and must look as before.

async function loaded(img: Locator) {
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
}

test("AA1 adversary art: stat block with and without art, list thumbnails", { tag: "@visual" }, async ({ page }) => {
  await openAdversaries(page);
  const { shoot } = visual(page, "AA1");
  const list = page.getByRole("region", { name: "Adversary list" });
  const block = page.getByRole("complementary", { name: "Stat block" });

  await expect(list.getByRole("button", { name: /^Acid Burrower/ })).toHaveAttribute("aria-current", "true");
  const art = block.getByRole("img", { name: "Acid Burrower illustration" });
  await loaded(art);
  await shoot(block, "statblock-art");

  for (const thumb of await list.locator(".adc-thumb").all()) await loaded(thumb);
  await list.locator(".adc-list").evaluate((el) => el.scrollTo(0, 0));
  await shoot(list.locator(".adc-list"), "list");

  await list.getByRole("button", { name: /^Bear/ }).click();
  await expect(block.getByRole("heading", { name: "Bear" })).toBeVisible();
  await expect(block.locator(".adc-sb-art")).toHaveCount(0);
  await shoot(block, "statblock-no-art");
});
