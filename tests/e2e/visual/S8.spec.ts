import { expect, test } from "@playwright/test";

import { openSheet, openTab, visual } from "./helpers";

// S8: level circle (▲ / −), the level-up stepper dialog and the Level Up tier boxes at 1440 and 390.
// Board counterparts: node scripts/board-shots.mjs level-circle level-up-head level-up

test("S8 level circle, stepper and advancement tiers at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { sheet } = await openSheet(page);
  const { shoot } = visual(page, "S8");

  const circle = sheet.locator(".lvl-row");
  await expect(sheet.getByRole("button", { name: "Level up to 2" })).toBeVisible();
  await shoot(circle, "level-circle");

  await sheet.getByRole("button", { name: "Level up to 2" }).click();
  const stepper = page.getByRole("dialog", { name: "Level up to 2" });
  await stepper.getByLabel("New Experience").fill("Never misses a cue");
  await stepper.getByRole("button", { name: "Next" }).click();
  await stepper.getByRole("button", { name: "Take tier 2: +1 Hit Point slot" }).click();
  await stepper.getByRole("button", { name: "Take tier 2: +1 to two Experiences" }).click();
  const exps = stepper.getByRole("group", { name: "Experiences to raise" });
  await exps.getByRole("button", { name: /Wandering minstrel/ }).click();
  await exps.getByRole("button", { name: /Silver tongue/ }).click();
  await shoot(stepper.locator(".sh-modal-body"), "stepper");
  await stepper.getByRole("button", { name: "Next" }).click();
  await stepper.getByRole("button", { name: "Next" }).click();
  await stepper.getByRole("button", { name: "Confirm level 2" }).click();
  await expect(stepper).toBeHidden();

  await expect(sheet.getByRole("button", { name: "Undo level 2" })).toBeVisible();
  await shoot(circle, "level-circle-undo");

  await openTab(page, "Story & Advancement");
  const levelUp = sheet.getByRole("region", { name: "Level Up" });
  await expect(levelUp.getByText("2 / 2 advancements used")).toBeVisible();
  await shoot(levelUp.locator(".adv-head"), "level-up-head");
  await shoot(levelUp, "level-up");
  await shoot(sheet.locator(".adv-correct"), "correct-level");
});
