import { expect, type Page } from "@playwright/test";

export const E2E_GM_EMAIL = "e2e-gm@example.test";

export async function signInAsTestGm(page: Page, email = E2E_GM_EMAIL) {
  await page.goto("/signin");
  const form = page.getByRole("form", { name: "Test sign-in" });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Secret").fill(process.env.E2E_AUTH_SECRET ?? "");
  await form.getByRole("button", { name: "Test sign-in" }).click();
}

export async function expectSignedInAs(page: Page, email = E2E_GM_EMAIL) {
  await expect(page).toHaveURL("/");
  await expect(page.getByTestId("viewer-email")).toHaveText(email);
}
