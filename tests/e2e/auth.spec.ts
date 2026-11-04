import { expect, test } from "@playwright/test";

import { expectSignedInAs, readEmailedCode, signInAsTestGm } from "./fixtures";

test("a signed-out visitor is redirected to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/signin");
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
});

test("the test GM can sign in and out", async ({ page }) => {
  await signInAsTestGm(page);
  await expectSignedInAs(page);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/signin");
  await page.goto("/");
  await expect(page).toHaveURL("/signin");
});

test("a wrong secret is refused", async ({ page }) => {
  await page.goto("/signin");
  const form = page.getByRole("form", { name: "Test sign-in" });
  await form.getByLabel("Email").fill("e2e-gm@example.test");
  await form.getByLabel("Secret").fill("not-the-secret");
  await form.getByRole("button", { name: "Test sign-in" }).click();
  await expect(form.getByRole("alert")).toHaveText("Test sign-in failed.");
  await page.goto("/");
  await expect(page).toHaveURL("/signin");
});

test("any email signs in through the test form (sign-up is open)", async ({ page }) => {
  const email = `anyone-${Date.now()}@example.test`;
  await signInAsTestGm(page, email);
  await expectSignedInAs(page, email);
});

test("a user without a password adds one through Create account and the emailed code (same user)", async ({ page }) => {
  // The test sign-in makes a verified user with no password account, like a Google user.
  const email = `google-like-${Date.now()}@example.test`;
  const password = "correct-horse-battery";
  await signInAsTestGm(page, email);
  await expectSignedInAs(page, email);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/signin");

  await page.getByRole("button", { name: "New here? Create an account" }).click();
  const signUp = page.getByRole("form", { name: "Create account" });
  await signUp.getByLabel("Email").fill(email);
  await signUp.getByLabel("Password").fill(password);
  await signUp.getByRole("button", { name: "Create account" }).click();
  const codeForm = page.getByRole("form", { name: "Enter the code" });
  await expect(codeForm).toBeVisible();
  await codeForm.getByLabel("6-digit code").fill(await readEmailedCode(email));
  await codeForm.getByRole("button", { name: "Verify email" }).click();
  await expectSignedInAs(page, email);
  await page.getByRole("button", { name: "Sign out" }).click();

  const signIn = page.getByRole("form", { name: "Sign in with email" });
  await signIn.getByLabel("Email").fill(email);
  await signIn.getByLabel("Password").fill(password);
  await signIn.getByRole("button", { name: "Sign in" }).click();
  await expectSignedInAs(page, email);
});
