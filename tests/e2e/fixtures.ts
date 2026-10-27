import { expect, type Page } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";

import { api } from "../../convex/_generated/api";

export const E2E_GM_EMAIL = "e2e-gm@example.test";

/**
 * The code the e2e backend "sent" to an email (it sends no email and every code is random). Read through
 * `GET /e2e/code`, gated by the e2e secret (convex/e2e.ts); the HTTP-actions port is the Convex port plus one.
 */
export async function readEmailedCode(email: string): Promise<string> {
  const url = new URL(process.env.E2E_CONVEX_URL!);
  url.port = String(Number(url.port) + 1);
  url.pathname = "/e2e/code";
  url.searchParams.set("email", email);
  url.searchParams.set("secret", process.env.E2E_AUTH_SECRET ?? "");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No e2e code for ${email}: HTTP ${res.status}`);
  return ((await res.json()) as { code: string }).code;
}

/** The signed-in user's Convex Auth token, or null before sign-in completes. */
const readToken = () => {
  const key = Object.keys(localStorage).find((k) => k.startsWith("__convexAuthJWT"));
  return key ? localStorage.getItem(key) : null;
};

/**
 * Signs in through the test form. Once signed in, the account's "Style of new maps" is set to Classic: since
 * dcm-bxp.135 a GM who never chose gets Sprites, and the specs were written for Classic maps. Specs about Sprites
 * switch their maps (or the setting) themselves. A refused sign-in (the form's alert) skips this.
 */
export async function signInAsTestGm(page: Page, email = E2E_GM_EMAIL) {
  await page.goto("/signin");
  const form = page.getByRole("form", { name: "Test sign-in" });
  await form.getByLabel("Email").fill(email);
  await form.getByLabel("Secret").fill(process.env.E2E_AUTH_SECRET ?? "");
  await form.getByRole("button", { name: "Test sign-in" }).click();
  const token = await Promise.race([
    page.waitForFunction(readToken, null, { timeout: 30_000 }).then((handle) => handle.jsonValue()),
    form.getByRole("alert").waitFor({ timeout: 30_000 }).then(() => null),
  ]).catch(() => null);
  if (!token) return;
  const client = new ConvexHttpClient(process.env.E2E_CONVEX_URL!);
  client.setAuth(token);
  await client.mutation(api.settings.update, { defaultMapStyle: "classic" });
}

/** Signed-in home is the title menu; the account lives in its Settings dialog. */
export async function expectSignedInAs(page: Page, email = E2E_GM_EMAIL) {
  await expect(page).toHaveURL("/");
  await openSettings(page);
  await expect(page.getByTestId("viewer-email")).toHaveText(email);
}

export async function openSettings(page: Page) {
  await page.getByRole("navigation", { name: "Main menu" }).getByRole("button", { name: /Settings/ }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
}
