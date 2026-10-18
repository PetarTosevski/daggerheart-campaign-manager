import { expect, test, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

const next = (page: Page) => page.getByRole("button", { name: /^Next:/ }).click();

test("a Motherboard Warrior gets an Ikonis with a Force augment and no weapon picker (CB 295, 301)", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const name = `Ikonis ${Date.now().toString(36)}`;
  await page.goto("/frames/motherboard");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2];

  await page.goto(`/campaigns/${campaignId}/party/new`);
  await page.getByRole("radio", { name: /^Warrior/ }).check();
  await page.getByRole("radio", { name: "Call of the Brave", exact: true }).check();
  await next(page);
  await page.getByRole("radio", { name: "Dwarf", exact: true }).check();
  await page.getByRole("radio", { name: "Ridgeborne", exact: true }).check();
  await next(page);
  await page.getByRole("button", { name: "Use suggested" }).click();
  await next(page);
  await page.getByLabel("Character name").fill("Vex Coilhand");
  await next(page);

  // Step 5: the Ikonis replaces the weapon pickers.
  await expect(page.getByRole("group", { name: "Primary weapon" })).toHaveCount(0);
  await expect(page.getByRole("group", { name: /Secondary weapon/ })).toHaveCount(0);
  await expect(page.getByText(/Still needed: an Ikonis trait/)).toBeVisible();
  await expect(page.getByText(/Ikonis Training gives you a Force augment/)).toBeVisible();
  await page.getByLabel("Ikonis name").fill("Spark rod");
  await page.getByLabel("Ikonis trait").selectOption("strength");
  await page.getByLabel("Ikonis range and damage").selectOption("Melee");
  await page.getByLabel("Ikonis damage type").selectOption("tech");
  await page.getByRole("button", { name: "Use suggested armor" }).click();
  await page.getByRole("radio", { name: /Minor Health Potion/ }).check();
  await page.getByRole("group", { name: "Class item" }).getByRole("radio").first().check();
  await next(page);
  await next(page);
  await page.getByLabel("First Experience").fill("Scavenger");
  await page.getByLabel("Second Experience").fill("Tinker");
  await next(page);
  const cards = page.getByRole("checkbox", { name: /^Choose / });
  await cards.nth(0).check();
  await cards.nth(1).check();
  await next(page);
  await page.getByRole("button", { name: "Create character" }).click();

  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/party/(?!new$)[a-z0-9]+$`));
  await expect(page.getByTestId("ikonis-augments")).toHaveText(/Installed augments: Force/);
  await expect(page.getByTestId("ikonis-damage")).toContainText("Melee · d12+2 tech");
});
