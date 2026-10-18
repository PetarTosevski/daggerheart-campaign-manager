import { expect, test } from "@playwright/test";

import { expectNoHorizontalScroll, openSheet, visual } from "./helpers";

// GL0: the guided level-up ribbon at 1440 and 390. ▲ starts it, the steps switch the sheet's pages (the Domain
// Deck step opens Domains > Domain Cards), the Finish step lists the problems as buttons to their steps, a reload
// keeps the draft and Cancel drops it. The section inputs come with GL1-GL3, so Finish stays disabled here.
// Board counterpart: none (the board has no guided mode); the ribbon uses the sheet's paper primitives.

test("GL0 level-up ribbon: steps, navigation, summary, reload and cancel at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { sheet } = await openSheet(page);
  const { shoot } = visual(page, "GL0");
  const pageTab = (name: string) => sheet.getByRole("tablist", { name: "Sheet pages" }).getByRole("tab", { name, exact: true });

  await sheet.getByRole("button", { name: "Level up to 2" }).click();
  const ribbon = sheet.getByRole("region", { name: "Level-up to 2" });
  const steps = ribbon.getByRole("list", { name: "Level-up steps" });
  const step = (name: string) => steps.getByRole("listitem").filter({ hasText: name });
  await expect(ribbon.getByText("Level 2 achievements: a new Experience at +2 and +1 Proficiency.")).toBeVisible();
  await expect(steps.getByRole("listitem")).toHaveText(["1New Experience", "2Advancements (0/2)", "3Domain card", "4Finish"]);
  await expect(step("New Experience")).toHaveAttribute("aria-current", "step");
  await expect(pageTab("Character Sheet")).toHaveAttribute("aria-selected", "true");
  await shoot(ribbon, "ribbon");

  await ribbon.getByRole("button", { name: "Next" }).click();
  await expect(pageTab("Story & Advancement")).toHaveAttribute("aria-selected", "true");
  await ribbon.getByRole("button", { name: "Next" }).click();
  await expect(pageTab("Domains")).toHaveAttribute("aria-selected", "true");
  await expect(sheet.getByRole("tab", { name: "Domain Cards" })).toHaveAttribute("aria-selected", "true");
  await ribbon.getByRole("button", { name: "Next" }).click();

  await expect(step("Finish")).toHaveAttribute("aria-current", "step");
  await expect(ribbon.getByRole("heading", { name: "Summary" })).toBeFocused();
  await expect(ribbon.getByRole("button", { name: "Finish level-up" })).toBeDisabled();
  const todo = ribbon.getByRole("list", { name: "Still to do" });
  await expect(todo.getByRole("button", { name: "Choose the level's domain card." })).toBeVisible();
  await shoot(ribbon, "ribbon-finish");

  // A problem takes the player to its step.
  await todo.getByRole("button", { name: "Choose two advancements (Proficiency and multiclass take both)." }).click();
  await expect(pageTab("Story & Advancement")).toHaveAttribute("aria-selected", "true");
  await expect(step("Advancements")).toHaveAttribute("aria-current", "step");

  // The draft survives a reload (sessionStorage) at the step it was on.
  await page.reload();
  await expect(ribbon).toBeVisible();
  await expect(step("Advancements")).toHaveAttribute("aria-current", "step");

  // 390: the ribbon's controls are 44 px and the page does not scroll sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoHorizontalScroll(page);
  const small = await ribbon.evaluate((root) =>
    Array.from(root.querySelectorAll("button"))
      .map((b) => b.getBoundingClientRect())
      .filter((r) => r.width < 43.5 || r.height < 43.5).length,
  );
  expect(small).toBe(0);
  await page.setViewportSize({ width: 1440, height: 900 });

  await ribbon.getByRole("button", { name: "Cancel" }).click();
  await expect(ribbon).toBeHidden();
  await page.reload();
  await expect(sheet.getByRole("button", { name: "Level up to 2" })).toBeVisible();
  await expect(ribbon).toHaveCount(0);
});
