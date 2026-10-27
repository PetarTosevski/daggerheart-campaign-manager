// OS4 (.omc/plans/open-signup.yaml): axe on every step of the sign-in page, keyboard focus per step, and phone and
// tablet widths. The local e2e backend sends no email; the specs read the random code from /e2e/code.

import { expect, test, type Page } from "@playwright/test";

import { readEmailedCode } from "./fixtures";
import { expectFitsViewport, expectNoSeriousA11yViolations, expectTouchTargets, TABLET_VIEWPORTS } from "./a11y";


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
  const signUp = page.getByRole("form", { name: "Create account" });
  await expect(signUp.getByLabel("Name")).toBeFocused();
  await scan(page);

  await signUp.getByLabel("Name").fill("Os Four");
  await signUp.getByLabel("Email").fill(email);
  await signUp.getByLabel("Password").fill("short");
  await signUp.getByRole("button", { name: "Create account" }).click();
  // minLength 8 blocks the submit in the browser: still on the details step.
  await expect(signUp.getByLabel("Password")).toBeVisible();
  await signUp.getByLabel("Password").fill("a-long-enough-password");
  await signUp.getByRole("button", { name: "Create account" }).click();

  await expect(page.getByLabel("6-digit code")).toBeFocused();
  await expect(page.getByText(`Enter the 6-digit code we emailed to ${email}.`)).toBeVisible();
  await scan(page);

  await page.getByLabel("6-digit code").fill("000000");
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByRole("form", { name: "Enter the code" }).getByRole("alert")).toContainText("Request a new one");
  await scan(page);

  await page.getByLabel("6-digit code").fill(await readEmailedCode(email));
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page).not.toHaveURL(/\/signin/);
});

test("forgot password steps pass axe and phone and tablet widths fit", async ({ page }) => {
  const sizes = [{ width: 390, height: 844 }, ...TABLET_VIEWPORTS];
  await page.goto("/signin");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  const reset = page.getByRole("form", { name: "Reset password" });
  await expect(reset.getByLabel("Email")).toBeFocused();
  for (const size of sizes) {
    await page.setViewportSize(size);
    await scan(page);
  }

  await reset.getByLabel("Email").fill(freshEmail());
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByLabel("6-digit code")).toBeFocused();
  for (const size of sizes) {
    await page.setViewportSize(size);
    await scan(page);
  }
});
