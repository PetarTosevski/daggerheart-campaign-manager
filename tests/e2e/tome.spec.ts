import { expect, test } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

test("the frame intro opens the lore book at a chapter", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  await page.goto("/frames/journey-to-horizon");
  await page.getByRole("button", { name: /hex crawl/i }).click();
  const book = page.getByRole("dialog", { name: "Journey to Horizon tome" });
  await expect(book.getByRole("heading", { name: "Campaign Mechanics" })).toBeVisible();
  await book.getByRole("navigation", { name: "Chapters" }).getByRole("button", { name: /Inciting Incident/ }).click();
  await expect(book.getByText("KEY FIGURES")).toBeVisible();
  await book.getByRole("button", { name: "Close tome" }).click();
  await expect(book).toBeHidden();
});

test("dashboard tome and key figures for a published frame", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  await page.goto("/frames/five-banners-burning");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(unique("Banners"));
  await page.getByRole("button", { name: "Start campaign" }).last().click();

  await expect(page.getByRole("region", { name: "Key Figures" })).toContainText("Clover of Towers");
  await page.getByRole("region", { name: "Campaign Tome" }).getByRole("button", { name: /Campaign Mechanics/ }).click();
  const book = page.getByRole("dialog", { name: "Five Banners Burning tome" });
  await expect(book.getByRole("heading", { name: "Campaign Mechanics" })).toBeVisible();
  await book.getByRole("button", { name: "Close tome" }).click();
  await page.getByRole("button", { name: "Open the Tome" }).click();
  await expect(book.getByRole("heading", { name: "Overview" })).toBeVisible();
});

test("a custom campaign's GM writes the tome, and it saves", async ({ page }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  await page.goto("/new");
  await page.getByRole("radio", { name: /Custom/ }).click();
  const name = unique("Inkwell");
  await page.getByRole("region", { name: "Custom frame" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("region", { name: "Custom frame" }).getByLabel("The pitch").fill("Libraries that eat people.");
  await page.getByRole("button", { name: "Start campaign" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  await page.getByRole("button", { name: "Open the Tome" }).click();
  const book = page.getByRole("dialog", { name: `${name} tome` });
  await expect(book.getByText("Libraries that eat people.")).toBeVisible();
  await book.getByRole("button", { name: /The Inciting Incident/ }).first().click();
  await book.getByLabel(/Your Inciting Incident/i).fill("A book falls open on its own.");
  await expect(book.getByText("Saved.")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Open the Tome" }).click();
  await book.getByRole("button", { name: /The Inciting Incident/ }).first().click();
  await expect(book.getByLabel(/Your Inciting Incident/i)).toHaveValue("A book falls open on its own.");
});
