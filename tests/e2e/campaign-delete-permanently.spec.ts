import { expect, test, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

/**
 * Load Campaign: a deleted campaign is listed under "Deleted campaigns" and its GM can delete it for good after an
 * in-page confirm that names it (plan followups-5 F7, bead dcm-bxp.30). Desktop and phone width.
 */

// Names are unique per GM and the local backend keeps data between runs.
const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

async function createAndDelete(page: Page, name: string) {
  await page.goto("/frames/beast-feast");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  const dialog = page.getByRole("dialog", { name: "Name your campaign" });
  await dialog.getByLabel("Campaign name").fill(name);
  await dialog.getByRole("button", { name: "Start campaign" }).click();
  // The new campaign's page is slow to load on a busy machine; only its arrival matters here.
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({ timeout: 20_000 });

  await page.goto("/campaigns");
  // The most recently opened campaign starts expanded, but that follows other workers' opens; pin it open by hand.
  const band = page.locator("button[aria-expanded]", { hasText: name });
  if ((await band.getAttribute("aria-expanded")) === "true") await band.click();
  await band.click();
  await expect(band).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: `Delete ${name}`, exact: true }).click();
  await page.getByRole("alertdialog", { name: "Confirm delete" }).getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(new RegExp(`Deleted ${name}`));
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${viewport.width}px`, () => {
    test.use({ viewport });

    test("a deleted campaign is deleted permanently after a confirm that names it", async ({ page }) => {
      test.setTimeout(90_000);
      await signInAsTestGm(page);
      await expect(page).toHaveURL("/");
      const name = unique(`Forever ${viewport.width}`);
      await createAndDelete(page, name);

      const section = page.getByRole("region", { name: "Deleted campaigns" });
      const row = section.getByRole("listitem").filter({ hasText: name });
      await expect(row).toBeVisible();
      await expect(row).toContainText("Beast Feast");

      // The first click only asks; "Keep it" backs out without deleting.
      await row.getByRole("button", { name: `Delete ${name} permanently` }).click();
      const confirm = row.getByRole("alertdialog", { name: "Confirm permanent delete" });
      await expect(confirm).toContainText(`Delete ${name} permanently?`);
      await expect(confirm).toContainText("can't be undone");
      await confirm.getByRole("button", { name: "Keep it" }).click();
      await expect(confirm).toHaveCount(0);
      await expect(row).toBeVisible();

      // No sideways scroll at this width.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // The deliberate second click deletes it for good: gone from the list and the undo toast.
      await row.getByRole("button", { name: `Delete ${name} permanently` }).click();
      await row.getByRole("alertdialog", { name: "Confirm permanent delete" }).getByRole("button", { name: `Delete ${name} forever` }).click();
      await expect(section.getByRole("listitem").filter({ hasText: name })).toHaveCount(0);
      await expect(page.getByRole("status")).toHaveCount(0);

      // It stays gone after a reload.
      await page.reload();
      await expect(page.getByRole("heading", { level: 1, name: "Load Campaign" })).toBeVisible();
      await expect(page.getByText(name)).toHaveCount(0);
    });

    test("a deleted campaign can still be restored from the list", async ({ page }) => {
      test.setTimeout(90_000);
      await signInAsTestGm(page);
      await expect(page).toHaveURL("/");
      const name = unique(`Back ${viewport.width}`);
      await createAndDelete(page, name);

      const row = page.getByRole("region", { name: "Deleted campaigns" }).getByRole("listitem").filter({ hasText: name });
      await row.getByRole("button", { name: `Restore ${name}` }).click();
      await expect(row).toHaveCount(0);
      await expect(page.locator("button[aria-expanded]", { hasText: name })).toBeVisible();
    });
  });
}
