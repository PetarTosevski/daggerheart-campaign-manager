import { expect, test } from "@playwright/test";

import { expectNoHorizontalScroll, openSheet, visual } from "./helpers";

// GL2: the Experiences box in the guided level-up at 1440 and 390. ▲ (level 2) brings the player to the box with
// a highlighted "New Experience (+2)" input; with the "+1 to two Experiences" advancement in the draft the box shows
// one checkbox per Experience. The spec ticks the advancement in the tier boxes; the draft is saved on the account
// (config N4 b), so a reload restores it. Board counterpart: none (the board has no guided mode).

test("GL2 Experiences in the guided level-up at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { sheet } = await openSheet(page);
  const { shoot } = visual(page, "GL2");
  const box = sheet.getByRole("region", { name: "Experiences" });

  await sheet.getByRole("button", { name: "Level up to 2" }).click();
  await expect(box.getByRole("heading", { name: "Experiences" })).toBeFocused();
  const input = box.getByRole("textbox", { name: "New Experience (+2) for level 2" });
  await input.fill("Court musician");
  const ribbon = sheet.getByRole("region", { name: "Level-up to 2" });
  await expect(ribbon.getByRole("listitem").filter({ hasText: "New Experience" })).toHaveAttribute("data-done", "true");
  await shoot(box, "new-experience");

  // Tick the "+1 to two Experiences" pick (a click: the draft saves on the account at once, config N4 b) and reload.
  await sheet.getByRole("tablist", { name: "Sheet pages" }).getByRole("tab", { name: "Story & Advancement" }).click();
  await sheet.getByLabel("Tier 2: +1 to two Experiences for level 2").check();
  await sheet.getByRole("tablist", { name: "Sheet pages" }).getByRole("tab", { name: "Character Sheet" }).click();
  await expect(box.getByRole("group", { name: "+1 to two Experiences for level 2" })).toBeVisible();
  await page.reload();
  const group = box.getByRole("group", { name: "+1 to two Experiences for level 2" });
  await expect(box.getByRole("textbox", { name: "New Experience (+2) for level 2" })).toHaveValue("Court musician");
  await group.getByRole("checkbox", { name: "+1 to Wandering minstrel" }).check();
  await group.getByRole("checkbox", { name: "+1 to Silver tongue" }).check();
  await expect(group.getByText("Choose two (2/2).")).toBeVisible();
  await shoot(box, "plus-one");

  // 390: the draft controls are 44 px tall and the page does not scroll sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);
  const small = await box.evaluate((root) =>
    Array.from(root.querySelectorAll(".id-lu input, .id-lu-check"))
      .filter((el) => !(el instanceof HTMLInputElement && el.type === "checkbox"))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.height < 43.5).length,
  );
  expect(small).toBe(0);
  await page.setViewportSize({ width: 1440, height: 900 });

  // Cancel removes the draft panels and brings back the direct Add form.
  await ribbon.getByRole("button", { name: "Cancel" }).click();
  await expect(box.locator(".id-lu")).toHaveCount(0);
  await expect(box.getByRole("textbox", { name: "New Experience", exact: true })).toBeVisible();
});
