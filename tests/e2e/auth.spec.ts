import { expect, test } from "@playwright/test";

import { expectSignedInAs, signInAsTestGm } from "./fixtures";

test("a signed-out visitor is redirected to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL("/signin");
  await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
});

test("the allowlisted test GM can sign in and out", async ({ page }) => {
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
  await expect(page.getByRole("alert")).toHaveText("Test sign-in failed.");
  await page.goto("/");
  await expect(page).toHaveURL("/signin");
});

test("an email that is not allowlisted is refused", async ({ page }) => {
  await signInAsTestGm(page, "intruder@example.test");
  await expect(page.getByRole("alert")).toHaveText("Test sign-in failed.");
  await page.goto("/");
  await expect(page).toHaveURL("/signin");
});
