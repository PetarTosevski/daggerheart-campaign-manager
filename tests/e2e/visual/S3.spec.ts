import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { openSheet, visual } from "./helpers";

// S3: the Hit Points & Stress box (thresholds, Take damage, HP and Stress rows, Wither row) at 1440 and 390.
// Board counterpart: node scripts/board-shots.mjs hp-stress. The board has no Wither counter, so the Witherwild
// shot is app-only; the Age of Umbra shot has no Wither row.

test("S3 Hit Points & Stress box at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { sheet, client, campaignId, characterId } = await openSheet(page);
  const { shoot } = visual(page, "S3");
  const box = sheet.getByRole("region", { name: "Hit Points & Stress" });

  await client.mutation(api.wither.adjust, { campaignId, characterId, delta: 3, idempotencyKey: crypto.randomUUID() });
  await expect(box.getByTestId("wither-tokens")).toHaveText("3");
  await expect(box.getByRole("img", { name: "3 Wither tokens" })).toBeVisible();
  await box.getByRole("button", { name: "Hit Point 2 of 5" }).click();
  await expect(box.getByRole("group", { name: "Hit Point: 2 of 5 marked" })).toBeVisible();
  await box.getByLabel("Damage roll").fill("8");
  await expect(box.getByText("Major damage: mark 2 Hit Points.")).toBeVisible();
  await shoot(box, "hp-stress");
});

test("S3 Hit Points & Stress box without Wither", { tag: "@visual" }, async ({ page }) => {
  const { sheet } = await openSheet(page, { frame: "age-of-umbra" });
  const { shoot } = visual(page, "S3");
  const box = sheet.getByRole("region", { name: "Hit Points & Stress" });
  await expect(box.getByRole("group", { name: /^Hit Point: 0 of/ })).toBeVisible();
  await expect(box.getByRole("region", { name: "Wither tokens" })).toHaveCount(0);
  await shoot(box, "hp-stress-no-wither");
});
