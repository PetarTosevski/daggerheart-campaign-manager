import { expect, test } from "@playwright/test";

test("landing page redirects to sign-in and renders it", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: /sign in/i }),
  ).toBeVisible();
});
