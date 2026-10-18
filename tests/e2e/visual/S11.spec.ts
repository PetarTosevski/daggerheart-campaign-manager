import { expect, test } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import { openSheet, openTab, visual } from "./helpers";

// S11: Story & Advancement boxes (Wealth pips and chest, Inventory, Character Description, Background Questions,
// Connections), at 1440 and 390. Board counterparts:
//   node scripts/board-shots.mjs wealth inventory description background connections

test("S11 Story & Advancement boxes at 1440 and 390", { tag: "@visual" }, async ({ page }) => {
  const { client, characterId, sheet } = await openSheet(page);
  const { shoot } = visual(page, "S11");
  await openTab(page, "Story & Advancement");

  const wealth = sheet.getByRole("region", { name: "Wealth" });
  const gold = async () => (await client.query(api.characters.get, { characterId }))?.sheet.gold;

  // A pip sets the count through the gold update; tapping the last marked pip clears it.
  await wealth.getByRole("button", { name: "Handfuls 3 of 10" }).click();
  await expect(wealth.getByRole("button", { name: "Handfuls 3 of 10" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await gold())?.handfuls).toBe(3);
  await wealth.getByRole("button", { name: "Bags 2 of 10" }).click();
  await expect.poll(async () => (await gold())?.bags).toBe(2);
  await wealth.getByRole("button", { name: "Bags 2 of 10" }).click();
  await expect.poll(async () => (await gold())?.bags).toBe(1);

  // Counts above 10 go through the stepper.
  await wealth.getByRole("button", { name: "Increase Bags of gold" }).click();
  await expect.poll(async () => (await gold())?.bags).toBe(2);

  // The chest is a toggle button.
  const chest = wealth.getByRole("button", { name: "Chest of coins" });
  await expect(chest).toHaveAttribute("aria-pressed", "false");
  await chest.click();
  await expect(chest).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await gold())?.chest).toBe(true);
  await shoot(wealth, "wealth");

  const inventory = sheet.getByRole("region", { name: "Inventory" });
  await expect(inventory).toContainText("Starting inventory:");
  await expect(inventory).toContainText("a romance novel OR a letter never opened");
  await inventory.getByRole("textbox", { name: "New item" }).fill("Lute strings");
  await inventory.getByRole("button", { name: "Add" }).click();
  await expect(inventory.getByRole("list", { name: "Inventory" })).toContainText("Lute strings");
  await shoot(inventory, "inventory");

  const description = sheet.getByRole("region", { name: "Character Description" });
  await expect(description).toContainText("Clothes that are");
  await description.getByRole("textbox", { name: "Description" }).fill("Tall, with ink-stained fingers.");
  await description.getByRole("textbox", { name: "Description" }).blur();
  await expect.poll(async () => (await client.query(api.characters.get, { characterId }))?.sheet.description).toBe("Tall, with ink-stained fingers.");
  await shoot(description, "description");

  const background = sheet.getByRole("region", { name: "Background Questions" });
  await shoot(background, "background");
  await shoot(sheet.getByRole("region", { name: "Connections" }), "connections");
});
