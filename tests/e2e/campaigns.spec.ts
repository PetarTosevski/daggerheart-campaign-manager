import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
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

/** A Convex client authenticated as the page's signed-in user. */
async function convexAs(page: Page): Promise<ConvexHttpClient> {
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("__convexAuthJWT"));
    return key ? localStorage.getItem(key) : null;
  });
  expect(token, "Convex Auth token in localStorage").toBeTruthy();
  const client = new ConvexHttpClient(process.env.E2E_CONVEX_URL!);
  client.setAuth(token!);
  return client;
}

async function createWitherwild(page: Page, name: string) {
  await page.goto("/new");
  await page.getByRole("button", { name: /The Witherwild/ }).click();
  await page.getByRole("button", { name: "Start campaign" }).click();
  const dialog = page.getByRole("dialog", { name: "Name your campaign" });
  await dialog.getByLabel("Campaign name").fill(name);
  await dialog.getByRole("button", { name: "Start campaign" }).click();
  await expect(page).toHaveURL(/\/campaigns\/[a-z0-9]+$/);
}

test("the Expansions setting decides Hope & Fear for new campaigns", async ({ page }) => {
  await signIn(page);
  const client = await convexAs(page);
  try {
    await page.getByRole("button", { name: /Settings/ }).click();
    const dialog = page.getByRole("dialog", { name: "Settings" });
    const hopeAndFear = dialog.getByRole("switch", { name: /Hope & Fear/ });
    await expect(dialog.getByText("New campaigns start with Hope & Fear content.", { exact: false })).toBeVisible();
    if (await hopeAndFear.isChecked()) await hopeAndFear.click();
    await hopeAndFear.click();
    await expect(hopeAndFear).toBeChecked();
    await expect.poll(async () => (await client.query(api.settings.get, {})).expansions.hopeAndFear).toBe(true);

    await createWitherwild(page, unique("Expansions On"));
    const rule = page.getByRole("checkbox", { name: /Hope & Fear content/ });
    await expect(rule).toBeChecked();
    // Each campaign keeps its own switch.
    await rule.click();
    await expect(rule).not.toBeChecked();

    await page.goto("/");
    await page.getByRole("button", { name: /Settings/ }).click();
    await expect(hopeAndFear).toBeChecked();
    await hopeAndFear.click();
    await expect(hopeAndFear).not.toBeChecked();
    await expect.poll(async () => (await client.query(api.settings.get, {})).expansions.hopeAndFear).toBe(false);

    await createWitherwild(page, unique("Expansions Off"));
    await expect(page.getByRole("checkbox", { name: /Hope & Fear content/ })).not.toBeChecked();
  } finally {
    // Other specs rely on each frame's own default.
    await client.mutation(api.settings.update, { expansions: { hopeAndFear: null } });
  }
});

test("an unknown campaign id shows not found", async ({ page }) => {
  await signIn(page);
  await page.goto("/campaigns/not-a-real-id");
  await expect(page.getByRole("heading", { name: "Campaign not found" })).toBeVisible();
});
