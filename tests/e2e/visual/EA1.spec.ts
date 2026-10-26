import { expect, test, type Locator } from "@playwright/test";

import { openAdversaries, visual } from "./helpers";

// EA1: the rulebook illustration on the environment stat block and the round thumbnails in the Environment list, at
// 1440 and 390. Cult Ritual has art (its half of the CB p.246 painting); the tall Burning Heart of the Woods must stay
// whole and no taller than 340 px; Abandoned Grove has none and must look as before. Castle High (Hope & Fear on).

async function loaded(img: Locator) {
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
}

test("EA1 environment art: stat block with and without art, list thumbnails", { tag: "@visual" }, async ({ page }) => {
  await openAdversaries(page, "castle-high");
  await page.getByRole("tab", { name: "Environment" }).click();
  const { shoot } = visual(page, "EA1");
  const list = page.getByRole("region", { name: "Environment list" });
  const block = page.getByRole("complementary", { name: "Environment stat block" });
  await expect(list.getByRole("button", { name: /^Abandoned Grove/ })).toHaveAttribute("aria-current", "true");
  await expect(block.locator(".adc-sb-art")).toHaveCount(0);
  await shoot(block, "statblock-no-art");

  for (const thumb of await list.locator(".adc-thumb").all()) await loaded(thumb);
  await list.locator(".adc-list").evaluate((el) => el.scrollTo(0, 0));
  await shoot(list.locator(".adc-list"), "list");

  await list.getByRole("button", { name: /^Cult Ritual/ }).click();
  const art = block.getByRole("img", { name: "Cult Ritual illustration" });
  await loaded(art);
  await expect(block.locator(".adc-sb-art")).toHaveAttribute("title", "CB p.246");
  await shoot(block, "statblock-art");

  await list.getByRole("button", { name: /^Burning Heart of the Woods/ }).click();
  const tall = block.getByRole("img", { name: "Burning Heart of the Woods illustration" });
  await loaded(tall);
  const box = await tall.evaluate((el: HTMLImageElement) => ({ h: el.getBoundingClientRect().height, w: el.getBoundingClientRect().width, nw: el.naturalWidth, nh: el.naturalHeight }));
  expect(box.h).toBeLessThanOrEqual(340.5);
  expect(box.w / box.h).toBeCloseTo(box.nw / box.nh, 1);
  await shoot(block, "statblock-tall-art");

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
