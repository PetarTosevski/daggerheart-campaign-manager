import { expect, test, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

// Names are unique per GM and the local backend keeps data between runs.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

async function signIn(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
}

test("create a Witherwild campaign from the frame picker and continue it", async ({ page }) => {
  await signIn(page);
  const name = unique("Long Spring");

  await page.getByRole("link", { name: /Create New Campaign/ }).click();
  await expect(page).toHaveURL("/new");
  await page.getByRole("button", { name: /The Witherwild/ }).click();
  await expect(page.getByRole("region", { name: "Frame details" })).toContainText("Princess Mononoke");
  await page.getByRole("button", { name: "Start campaign" }).click();

  const dialog = page.getByRole("dialog", { name: "Name your campaign" });
  await dialog.getByLabel("Campaign name").fill(name);
  await dialog.getByRole("button", { name: "Start campaign" }).click();

  await expect(page).toHaveURL(/\/campaigns\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("Active campaign · The Witherwild")).toBeVisible();
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");

  await page.getByRole("link", { name: "Back to main menu" }).click();
  await expect(page.getByRole("link", { name: /Continue/ })).toContainText(name);
});

test("a duplicate name is refused", async ({ page }) => {
  await signIn(page);
  const name = unique("Twice");
  for (const attempt of [1, 2]) {
    await page.goto("/frames/beast-feast");
    await page.getByRole("button", { name: "Choose this Frame" }).click();
    const dialog = page.getByRole("dialog", { name: "Name your campaign" });
    await dialog.getByLabel("Campaign name").fill(name.toUpperCase());
    await dialog.getByRole("button", { name: "Start campaign" }).click();
    if (attempt === 1) await expect(page).toHaveURL(/\/campaigns\//);
    else await expect(dialog.getByRole("alert")).toHaveText("You already have a campaign with that name.");
  }
});

test("create a custom campaign with its own background", async ({ page }) => {
  await signIn(page);
  const name = unique("Saltwake");
  await page.goto("/new");
  await page.getByRole("radio", { name: /Custom/ }).click();
  const form = page.getByRole("region", { name: "Custom frame" });
  await form.getByLabel("Campaign name").fill(name);
  await form.getByLabel("Starting tier").selectOption({ label: "Tier 3 · Lvl 5" });
  await form.getByRole("button", { name: "Dark", exact: true }).click();
  await form.getByRole("button", { name: "Horizon" }).click();
  await page.getByRole("button", { name: "Start campaign" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByText("Tier 3 · Level 5")).toBeVisible();
});

test("delete a campaign from Load Campaign and undo it", async ({ page }) => {
  await signIn(page);
  const name = unique("Doomed");
  await page.goto("/frames/motherboard");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(name);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  await page.goto("/campaigns");
  // The most recently opened campaign is first and expanded.
  await page.getByRole("button", { name: `Delete ${name}` }).click();
  await page.getByRole("alertdialog", { name: "Confirm delete" }).getByRole("button", { name: "Delete" }).click();
  await expect(page.getByRole("status")).toHaveText(new RegExp(`Deleted ${name}`));
  const band = page.locator("button[aria-expanded]", { hasText: name });
  await expect(band).toHaveCount(0);

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(band).toBeVisible();
});

test("settings save the accent colour", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: /Settings/ }).click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("radio", { name: "Violet" }).click();
  await expect(dialog.getByRole("radio", { name: "Violet" })).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue("--brand")))
    .toBe("#8f78d8");
  await dialog.getByRole("radio", { name: "Gold" }).click();
  await expect(dialog.getByRole("radio", { name: "Gold" })).toHaveAttribute("aria-checked", "true");
});

test("an unknown campaign id shows not found", async ({ page }) => {
  await signIn(page);
  await page.goto("/campaigns/not-a-real-id");
  await expect(page.getByRole("heading", { name: "Campaign not found" })).toBeVisible();
});
