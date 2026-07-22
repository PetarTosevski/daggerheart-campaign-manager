import { expect, test } from "@playwright/test";

const liveAuthEnabled = process.env.RUN_SUPABASE_E2E === "1";
const testEmail = process.env.E2E_TEST_EMAIL ?? "";
const testPassword = process.env.E2E_TEST_PASSWORD ?? "";

test.describe("authentication", () => {
  test("anonymous user is redirected from a protected route to sign-in", async ({
    page,
  }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("heading", { name: /sign in/i }),
    ).toBeVisible();
  });

  test("sign-in form shows an actionable error for invalid credentials", async ({
    page,
  }) => {
    test.skip(
      liveAuthEnabled,
      "Invalid-credential error is asserted against the live path in the sign-in test suite.",
    );
    await page.goto("/login");
    await page.getByLabel(/email/i).fill("nobody@example.com");
    await page.getByLabel(/password/i).fill("wrong-password");
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("valid user signs in, reaches the shell, and signs out", async ({
    page,
  }) => {
    test.skip(
      !liveAuthEnabled,
      "Requires a running local Supabase instance and a test user (set RUN_SUPABASE_E2E=1).",
    );
    expect(testEmail, "E2E_TEST_EMAIL must be set").not.toBe("");
    expect(testPassword, "E2E_TEST_PASSWORD must be set").not.toBe("");

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(testEmail);
    await page.getByLabel(/password/i).fill(testPassword);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(/signed in as/i)).toBeVisible();

    // The Supabase session cookie persists across a normal browser refresh.
    await page.reload();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByText(/signed in as/i)).toContainText(testEmail);

    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Session is gone: protected route redirects back to sign-in.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("remember me controls whether the auth cookie persists", async ({
    page,
    context,
  }) => {
    test.skip(
      !liveAuthEnabled,
      "Requires a running local Supabase instance and a test user (set RUN_SUPABASE_E2E=1).",
    );

    async function signIn(remember: boolean) {
      await page.goto("/login");
      await page.getByLabel(/email/i).fill(testEmail);
      await page.getByLabel(/password/i).fill(testPassword);
      const checkbox = page.getByRole("checkbox", { name: /remember me/i });
      if (remember) await checkbox.check();
      else await checkbox.uncheck();
      await page.getByRole("button", { name: /sign in/i }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
    }

    async function authCookieExpiry(): Promise<number> {
      const cookies = await context.cookies();
      const authCookie = cookies.find((c) => /^sb-.*auth-token/.test(c.name));
      expect(authCookie, "auth cookie should be set").toBeTruthy();
      return authCookie!.expires;
    }

    // Unchecked: the auth cookie is a session cookie (expires === -1).
    await signIn(false);
    expect(await authCookieExpiry()).toBe(-1);
    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Checked: the auth cookie persists with a future expiry.
    await signIn(true);
    expect(await authCookieExpiry()).toBeGreaterThan(0);
  });
});
