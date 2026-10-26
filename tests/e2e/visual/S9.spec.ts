import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { openSheet, visual } from "./helpers";

// S9: the header (alive, unconscious, FALLEN, away with Return to play), the parchment death-move dialog and the
// status row, at 1440 and 390 (no horizontal scroll at 390).
// Board counterparts: node scripts/board-shots.mjs header (alive; the board's FALLEN pill is the same banner).

test("S9 header badges, death-move dialog and status row", { tag: "@visual" }, async ({ page }) => {
  const { sheet, client, characterId } = await openSheet(page);
  const { shoot } = visual(page, "S9");
  const header = sheet.locator("header.cs-head");

  await shoot(header, "header-alive");
  await shoot(sheet.getByRole("region", { name: "Status" }), "status");
  await sheet.getByRole("region", { name: "Status" }).getByRole("button", { name: "Retired", exact: true }).click();
  await shoot(sheet.getByRole("region", { name: "Status" }), "status-confirm");
  await sheet.getByRole("button", { name: "Cancel" }).click();

  await client.mutation(api.characters.adjustResource, { characterId, resource: "hp", delta: 5 });
  const dialog = page.getByRole("dialog", { name: "Death move" });
  await shoot(dialog, "death-move-dialog");
  await dialog.getByRole("button", { name: "Avoid Death" }).click();
  await expect(sheet.getByTestId("death-unconscious")).toBeVisible();
  await shoot(header, "header-unconscious");
  await shoot(sheet.getByRole("region", { name: "Death moves" }), "death-strip");

  await client.mutation(api.characters.setStatus, { characterId, status: "dead" });
  await expect(sheet.getByTestId("character-status")).toHaveText("Fallen");
  await shoot(header, "header-fallen");
});

test("S9 Castle High: away in the banner with the GM's Return to play", { tag: "@visual" }, async ({ page }) => {
  const { sheet, client, characterId } = await openSheet(page, { frame: "castle-high" });
  await client.mutation(api.characters.adjustResource, { characterId, resource: "hp", delta: 5 });
  const dialog = page.getByRole("dialog", { name: "Death move" });
  await expect(dialog.getByRole("group", { name: /Less lethal/ })).toBeVisible();
  await visual(page, "S9").shoot(dialog, "death-move-dialog-less-lethal");
  await dialog.getByRole("button", { name: "Blaze of Glory" }).click();
  await dialog.getByRole("button", { name: "End the action" }).click();
  await expect(sheet.getByTestId("character-status")).toHaveText("Away · in the infirmary");
  await visual(page, "S9").shoot(sheet.locator("header.cs-head"), "header-away");
});
