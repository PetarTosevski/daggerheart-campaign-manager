import { expect, test } from "@playwright/test";

import { openSheet, visual } from "./helpers";

// S5: the dice box in the board's toolbar format, idle and after a roll, at 1440 and 390 (no horizontal scroll at 390).
// Board counterparts: node scripts/board-shots.mjs dice (idle); the board after a roll is
// board-dice-section-1440.png in the analysis's screenshot folder (.omc/autopilot/sheet-redesign-analysis.md).

test("S5 dice box, idle and after a roll, at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { sheet } = await openSheet(page);
  const { shoot } = visual(page, "S5");
  const box = sheet.getByRole("region", { name: "Dice", exact: true });

  // 2D results only: the 3D overlay would cover the box in the shot.
  await box.getByLabel("3D dice").uncheck();
  await shoot(box, "dice");

  await box.getByLabel("Difficulty").fill("12");
  await box.getByRole("button", { name: "Roll", exact: true }).click();
  await expect(box.getByTestId("last-roll")).toBeVisible();
  await box.getByRole("button", { name: "Roll", exact: true }).click();
  await expect(box.getByRole("list", { name: "Earlier" })).toBeVisible();
  await shoot(box, "dice-rolled");

  await box.getByText("Damage", { exact: true }).click();
  await box.getByRole("button", { name: "Roll", exact: true }).click();
  await expect(box.getByTestId("last-roll")).toContainText("Damage");
  await shoot(box, "dice-damage");
});
