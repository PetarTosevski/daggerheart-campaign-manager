// Open sign-up in the browser (plan open-signup, OS6): create an account with the emailed code, the three errors of its
// own (src/lib/errors/auth.ts), and a password reset by code. The e2e backend sends no email: each code is random and is
// read through readEmailedCode (docs/testing.md). Every test signs up a fresh, unique email, so specs never share an
// account and a rerun on the same backend starts clean.

import { expect, test, type Browser, type Page } from "@playwright/test";

import { authMessages } from "../../src/lib/errors/auth";
import { expectSignedInAs, readEmailedCode } from "./fixtures";

const PASSWORD = "correct-horse-battery";
const freshEmail = (label: string) => `signup-${label}-${crypto.randomUUID().slice(0, 8)}@example.test`;

/** Fills Create account and submits; the caller checks what comes next. */
async function submitSignUp(page: Page, email: string, password = PASSWORD) {
  await page.goto("/signin");
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  const signUp = page.getByRole("form", { name: "Create account" });
  await signUp.getByLabel("Name").fill("New Player");
  await signUp.getByLabel("Email").fill(email);
  await signUp.getByLabel("Password").fill(password);
  await signUp.getByRole("button", { name: "Create account" }).click();
  return signUp;
}

async function enterCode(page: Page, code: string) {
  const codeForm = page.getByRole("form", { name: "Enter the code" });
  await codeForm.getByLabel("6-digit code").fill(code);
  await codeForm.getByRole("button", { name: "Verify email" }).click();
  return codeForm;
}

/** A verified password account: sign up, enter the code, signed in. */
async function createAccount(page: Page, email: string) {
  await submitSignUp(page, email);
  await expect(page.getByRole("form", { name: "Enter the code" })).toBeVisible();
  await enterCode(page, await readEmailedCode(email));
  await expect(page).toHaveURL("/");
}

/** Signs in with email + password in a fresh browser context; returns the page. */
async function signInFresh(browser: Browser, email: string, password: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/signin");
  const signIn = page.getByRole("form", { name: "Sign in with email" });
  await signIn.getByLabel("Email").fill(email);
  await signIn.getByLabel("Password").fill(password);
  await signIn.getByRole("button", { name: "Sign in" }).click();
  return { page, signIn, close: () => context.close() };
}

const hasAuthToken = (page: Page) =>
  page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith("__convexAuthJWT") && localStorage.getItem(k)));

test("create an account: details, then the emailed code, then signed in; no session before the code", async ({ page }) => {
  const email = freshEmail("new");
  await submitSignUp(page, email);
  const codeForm = page.getByRole("form", { name: "Enter the code" });
  await expect(codeForm).toBeVisible();
  await expect(codeForm).toContainText(`Enter the 6-digit code we emailed to ${email}.`);

  // Before the code: no token in the page, and the app still sends the same browser to sign-in.
  expect(await hasAuthToken(page)).toBe(false);
  const probe = await page.context().newPage();
  await probe.goto("/campaigns");
  await expect(probe).toHaveURL("/signin?next=%2Fcampaigns");
  await probe.close();

  await enterCode(page, await readEmailedCode(email));
  await expectSignedInAs(page, email);
});

test("a wrong code shows the code error, and the right code then works", async ({ page }) => {
  const email = freshEmail("wrong-code");
  await submitSignUp(page, email);
  await expect(page.getByRole("form", { name: "Enter the code" })).toBeVisible();
  const code = await readEmailedCode(email);
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");

  const codeForm = await enterCode(page, wrong);
  await expect(codeForm.getByRole("alert")).toHaveText(authMessages.CODE_INVALID);
  await expect(page).toHaveURL(/\/signin/);
  expect(await hasAuthToken(page)).toBe(false);

  await enterCode(page, code);
  await expectSignedInAs(page, email);
});

test("a password under 8 characters is blocked in the form and refused by the server with its own error", async ({ page }) => {
  const email = freshEmail("short");
  const signUp = await submitSignUp(page, email, "short");
  // The browser blocks the submit (minLength 8): still on the details step, nothing sent.
  await expect(signUp).toBeVisible();
  await expect(signUp.getByLabel("Password")).toHaveJSProperty("validity.tooShort", true);
  await expect(page.getByRole("form", { name: "Enter the code" })).toHaveCount(0);

  // Past the browser check, the server answers PASSWORD_TOO_SHORT.
  await signUp.evaluate((form: HTMLFormElement) => (form.noValidate = true));
  await signUp.getByRole("button", { name: "Create account" }).click();
  await expect(signUp.getByRole("alert")).toHaveText(authMessages.PASSWORD_TOO_SHORT);
  await expect(page.getByRole("form", { name: "Enter the code" })).toHaveCount(0);
});

test("signing up again with an email that has an account shows 'already has an account'", async ({ page, browser }) => {
  const email = freshEmail("taken");
  await createAccount(page, email);

  const other = await browser.newContext();
  const second = await other.newPage();
  const signUp = await submitSignUp(second, email, "another-long-password");
  await expect(signUp.getByRole("alert")).toHaveText(authMessages.EMAIL_TAKEN);
  await expect(second.getByRole("form", { name: "Enter the code" })).toHaveCount(0);
  await other.close();
});

test("forgot password: a code by email sets a new password, which signs in; the old one stops working", async ({ page, browser }) => {
  const email = freshEmail("reset");
  const newPassword = "brand-new-battery-staple";
  await createAccount(page, email);

  const context = await browser.newContext();
  const reset = await context.newPage();
  await reset.goto("/signin");
  await reset.getByRole("button", { name: "Forgot password?" }).click();
  const resetForm = reset.getByRole("form", { name: "Reset password" });
  await resetForm.getByLabel("Email").fill(email);
  await resetForm.getByRole("button", { name: "Send code" }).click();
  const choose = reset.getByRole("form", { name: "Choose a new password" });
  await expect(choose).toContainText(`If ${email} has an account, we emailed it a 6-digit code.`);
  await choose.getByLabel("6-digit code").fill(await readEmailedCode(email));
  await choose.getByLabel("New password").fill(newPassword);
  await choose.getByRole("button", { name: "Set password" }).click();
  await expectSignedInAs(reset, email);
  await context.close();

  const old = await signInFresh(browser, email, PASSWORD);
  await expect(old.signIn.getByRole("alert")).toBeVisible();
  await old.page.goto("/");
  await expect(old.page).toHaveURL("/signin");
  await old.close();

  const fresh = await signInFresh(browser, email, newPassword);
  await expectSignedInAs(fresh.page, email);
  await fresh.close();
});
