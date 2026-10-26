import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { bardDraft, openSheet, visual } from "./helpers";

// S10: the Downtime box (board reference text) at 1440 and 390, then with a short rest open: the rest picker on
// top of the box and the saved move highlighted in the reference text. Board counterpart:
// node scripts/board-shots.mjs downtime. The board has no rest picker, so the rest-open shots are app-only.

test("S10 Downtime box at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { sheet, client, campaignId } = await openSheet(page);
  const { shoot } = visual(page, "S10");
  const box = sheet.getByRole("region", { name: "Downtime", exact: true });
  await expect(box.getByText("SHORT REST", { exact: true })).toBeVisible();
  await expect(box.getByText("LONG REST", { exact: true })).toBeVisible();
  await expect(box.getByRole("region", { name: "Downtime moves" })).toHaveCount(0);
  await shoot(box, "downtime");

  // A second PC, so Tend to Wounds offers its ally target select.
  await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Tamsin"), idempotencyKey: crypto.randomUUID() });
  await client.mutation(api.rests.start, { campaignId, kind: "short", idempotencyKey: crypto.randomUUID() });
  const picker = box.getByRole("region", { name: "Downtime moves" });
  await picker.getByRole("group", { name: "Move 1" }).getByRole("button", { name: "Tend to Wounds" }).click();
  await picker.getByRole("group", { name: "Move 2" }).getByRole("button", { name: "Prepare", exact: true }).click();
  await expect(picker.getByRole("combobox", { name: "On" })).toBeVisible();
  await picker.getByRole("button", { name: "Save moves" }).click();
  await expect(picker.getByText(/^Saved\./)).toBeVisible();
  await expect(box.getByText(/^Picked/)).toHaveCount(2);
  await shoot(box, "downtime-rest-open");
});
