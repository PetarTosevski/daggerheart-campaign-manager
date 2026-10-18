import { expect, test } from "@playwright/test";

import { expectNoHorizontalScroll, openSheet, visual } from "./helpers";

// GL1: ticking advancements on the Level Up tier boxes in the guided level-up, at 1440 and 390. The ▲ starts the
// mode, the ribbon's Advancements step opens Story & Advancement; the player ticks HP and the traits option (green
// draft marks with a "level 2" tag), chooses two traits inline, and the step reads 2/2. Board counterpart: the tier
// boxes of Party.dc.html (the board has no guided mode; draft marks are green like the ▲).

test("GL1 tier boxes: tick advancements and choose traits for the new level at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { sheet } = await openSheet(page);
  const { shoot } = visual(page, "GL1");

  await sheet.getByRole("button", { name: "Level up to 2" }).click();
  const ribbon = sheet.getByRole("region", { name: "Level-up to 2" });
  await ribbon.getByRole("list", { name: "Level-up steps" }).getByRole("button", { name: /Advancements/ }).click();
  const tiers = sheet.locator("#lu-target-advancements");
  await expect(tiers.getByRole("heading", { name: "Level Up" })).toBeFocused();
  await expect(tiers.getByText("Level 2: 0 / 2 picks")).toBeVisible();

  await tiers.getByRole("checkbox", { name: "Tier 2: +1 Hit Point slot for level 2", exact: true }).check();
  await tiers.getByRole("checkbox", { name: "Tier 2: +1 to two unmarked traits for level 2", exact: true }).check();
  const traits = tiers.getByRole("group", { name: "Traits to raise for level 2" });
  await traits.getByRole("button", { name: /Presence/ }).click();
  await traits.getByRole("button", { name: /Knowledge/ }).click();
  await expect(tiers.getByText("Level 2: 2 / 2 picks")).toBeVisible();
  await expect(tiers.getByRole("checkbox", { name: "Tier 2: +1 Evasion for level 2" })).toBeDisabled();
  await expect(ribbon.getByRole("list", { name: "Level-up steps" }).getByRole("listitem").filter({ hasText: "Advancements (2/2)" })).toHaveAttribute("data-done", "true");

  await shoot(tiers.getByRole("region", { name: "Tier 2" }), "tier-2-draft");

  // 390: the tickable boxes, the chips and their targets are 44 px, and the page does not scroll sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);
  const small = await tiers.evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>("label.adv-hit, .adv-picker button"))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width < 43.5 || r.height < 43.5).length,
  );
  expect(small).toBe(0);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Unticking a draft mark gives the pick back; cancelling leaves the boxes read-only.
  await tiers.getByRole("checkbox", { name: "Tier 2: +1 Hit Point slot for level 2", exact: true }).uncheck();
  await expect(tiers.getByText("Level 2: 1 / 2 picks")).toBeVisible();
  await ribbon.getByRole("button", { name: "Cancel" }).click();
  await expect(tiers.getByRole("checkbox", { name: /for level 2/ })).toHaveCount(0);
});
