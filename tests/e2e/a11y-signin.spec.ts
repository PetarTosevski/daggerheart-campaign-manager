// OS4 (.omc/plans/open-signup.yaml): axe on every step of the sign-in page, keyboard focus per step, and phone and
// tablet widths. The local e2e backend sends no email and accepts the fixed code 123456.

import { expect, test, type Page } from "@playwright/test";

import { expectFitsViewport, expectNoSeriousA11yViolations, expectTouchTargets, TABLET_VIEWPORTS } from "./a11y";

const FIXED_CODE = "123456";

function freshEmail() {
  return `os4-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

async function scan(page: Page) {
  await expectNoSeriousA11yViolations(page);
  await expectFitsViewport(page);
  await expectTouchTargets(page.locator("form button, form input"));
}

test("every step of create account and forgot password passes axe", async ({ page }) => {
  const email = freshEmail();
  await page.goto("/signin");
  await scan(page);

  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await expect(page.getByLabel("Name")).toBeFocused();
  await scan(page);

  await page.getByLabel("Name").fill("Os Four");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("short");
  await page.getByRole("button", { name: "Create account" }).click();
  // minLength 8 blocks the submit in the browser: still on the details step.
  await expect(page.getByLabel("Password")).toBeVisible();
  await page.getByLabel("Password").fill("a-long-enough-password");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByLabel("6-digit code")).toBeFocused();
  await expect(page.getByText(`Enter the 6-digit code we emailed to ${email}.`)).toBeVisible();
  await scan(page);

  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByRole("alert")).toContainText("Request a new one");
  await scan(page);

  await page.getByLabel("6-digit code").fill(FIXED_CODE);
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page).not.toHaveURL(/\/signin/);
});

test("forgot password steps pass axe and phone and tablet widths fit", async ({ page }) => {
  const sizes = [{ width: 390, height: 844 }, ...TABLET_VIEWPORTS];
  await page.goto("/signin");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByLabel("Email")).toBeFocused();
  for (const size of sizes) {
    await page.setViewportSize(size);
    await scan(page);
  }

  await page.getByLabel("Email").fill(freshEmail());
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("6-digit code")).toBeFocused();
  for (const size of sizes) {
    await page.setViewportSize(size);
    await scan(page);
  }
});
