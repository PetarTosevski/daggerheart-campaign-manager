import { ConvexHttpClient } from "convex/browser";
import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";

// B5 (plan d12-bugs; user answer 2026-10-22): a session that ends mid-use (its refresh token revoked server-side)
// lands on /signin?next=<path + search>, never on the error screen; signing in returns there, and nothing loops.
//
// The session is revoked through Convex Auth's own `auth:signOut` action, called with the page's access token from a
// separate client (as a sign-out on another device would): it deletes the session row and its refresh tokens on the
// server, while the page keeps its still-valid access token. The page notices at its next token refresh, which
// Convex schedules shortly before the token expires (about an hour); the init script below holds such long timers
// and the test fires them once the session is revoked.
//
// Signing back in uses the email + password form, because the test-only form always goes to "/". The account is this
// spec's own password-only one (docs/testing.md: one email per sign-in method; never signed in through the test form).

const PASSWORD_ONLY_EMAIL = "e2e-session-ended@example.test";
const PASSWORD = "session-ended-horse-battery";
const unique = (label: string) => `${label} ${crypto.randomUUID().slice(0, 8)}`;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

declare global {
  interface Window {
    __b5FireLongTimers?: () => number;
    __b5SawStatus?: boolean;
  }
}

/** Holds every timer of half an hour or more until the test fires it (nothing else in the app uses timers that long). */
async function holdLongTimers(page: Page) {
  await page.addInitScript(() => {
    const originalSet = window.setTimeout;
    const originalClear = window.clearTimeout;
    const held = new Map<number, () => void>();
    let nextId = -1;
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if ((timeout ?? 0) >= 30 * 60 * 1000 && typeof handler === "function") {
        const id = nextId--;
        held.set(id, () => (handler as (...a: unknown[]) => void)(...args));
        return id;
      }
      return originalSet(handler, timeout, ...args);
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => {
      if (id !== undefined && held.delete(id)) return;
      originalClear(id);
    }) as typeof window.clearTimeout;
    window.__b5FireLongTimers = () => {
      const due = [...held.values()];
      held.clear();
      for (const run of due) run();
      return due.length;
    };
  });
}

/** Notes whether the boundary's "Your session ended" status was ever on screen (it shows only for a moment). */
async function watchForStatus(page: Page) {
  await page.addInitScript(() => {
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('[role="status"]')) {
        if (el.textContent?.includes("Your session ended")) window.__b5SawStatus = true;
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
}

/** Fills and submits the email + password sign-in form; on a fresh backend, creates the account first. */
async function signInWithPassword(page: Page) {
  const signIn = page.getByRole("form", { name: "Sign in with email" });
  await signIn.getByLabel("Email").fill(PASSWORD_ONLY_EMAIL);
  await signIn.getByLabel("Password").fill(PASSWORD);
  await signIn.getByRole("button", { name: "Sign in" }).click();
  const outcome = await Promise.race([
    page.waitForURL((url) => url.pathname !== "/signin").then(() => "in" as const),
    signIn.getByRole("alert").waitFor().then(() => "no account" as const),
  ]);
  if (outcome === "in") return;
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  const signUp = page.getByRole("form", { name: "Create account" });
  await signUp.getByLabel("Name").fill("Pass Word");
  await signUp.getByLabel("Email").fill(PASSWORD_ONLY_EMAIL);
  await signUp.getByLabel("Password").fill(PASSWORD);
  await signUp.getByRole("button", { name: "Create account" }).click();
}

/** Signs in, creates a campaign and opens its dashboard with a search string; returns the name and path + search. */
async function openCampaign(page: Page): Promise<{ name: string; back: string }> {
  await page.goto("/signin");
  await signInWithPassword(page);
  await expect(page).toHaveURL("/");
  await page.goto("/frames/beast-feast");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  const name = unique("Ended");
  const dialog = page.getByRole("dialog", { name: "Name your campaign" });
  await dialog.getByLabel("Campaign name").fill(name);
  await dialog.getByRole("button", { name: "Start campaign" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page).toHaveURL(/\/campaigns\/[^/]+$/);
  // Path and search both come back.
  const back = `${new URL(page.url()).pathname}?from=b5`;
  await page.goto(back);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByTestId("fear-value")).toBeVisible();
  return { name, back };
}

/** Every main-frame URL change to /signin from now on. */
function countSignInVisits(page: Page): string[] {
  const visits: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame() && new URL(frame.url()).pathname === "/signin") visits.push(frame.url());
  });
  return visits;
}

async function accessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("__convexAuthJWT"));
    return key ? localStorage.getItem(key) : null;
  });
  expect(token, "Convex Auth token in localStorage").toBeTruthy();
  return token!;
}

/** Revokes the page's session on the server: `auth:signOut` with the page's access token. */
async function revokeSession(page: Page) {
  const client = new ConvexHttpClient(process.env.E2E_CONVEX_URL!);
  client.setAuth(await accessToken(page));
  await client.action(api.auth.signOut, {});
}

/** The page's scheduled token refresh, now. */
async function fireRefresh(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__b5FireLongTimers?.() ?? 0), { timeout: 15_000 }).toBeGreaterThan(0);
}

/** On /signin with `next`, the sign-in form showing, no error screen, and the URL stays put (no loop). */
async function expectSignInWithNext(page: Page, back: string, visits: string[]) {
  const expected = `/signin?next=${encodeURIComponent(back)}`;
  await expect(page).toHaveURL(expected, { timeout: 20_000 });
  await expect(page.getByRole("form", { name: "Sign in with email" })).toBeVisible();
  await expect(page.getByText("Your session has ended")).toHaveCount(0);
  const arrived = visits.length;
  expect(arrived).toBeGreaterThanOrEqual(1);
  await pause(2_000);
  await expect(page).toHaveURL(expected);
  expect(visits).toHaveLength(arrived);
}

/** Signs in again and is back on the page it left, working. */
async function expectSignInReturns(page: Page, name: string, back: string) {
  await signInWithPassword(page);
  await expect(page).toHaveURL(back);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByTestId("fear-value")).toBeVisible();
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test.describe(`at ${viewport.width}`, () => {
    test.use({ viewport });

    test("a session revoked mid-use goes to sign-in and back to the page, with no loop", async ({ page }) => {
      // Convex Auth's refresh fails, it erases the tokens and the sign-in page renders (src/lib/auth/sign-in-url.tsx).
      await holdLongTimers(page);
      const { name, back } = await openCampaign(page);
      const visits = countSignInVisits(page);

      await revokeSession(page);
      await fireRefresh(page);

      await expectSignInWithNext(page, back, visits);
      await expectSignInReturns(page, name, back);
    });

    test("when Convex gives up on the token, the error boundary signs out and goes to sign-in and back", async ({ page }) => {
      // The other way an ended session shows (dcm-bxp.123): the Convex client rejects the refreshed tokens and clears
      // its auth while Convex Auth still holds a token, so the page's queries throw UNAUTHENTICATED into the route
      // error boundary (src/components/route-error.tsx). Here the session is revoked and every refresh answers with
      // a token the server rejects.
      await holdLongTimers(page);
      await watchForStatus(page);
      const { name, back } = await openCampaign(page);
      const visits = countSignInVisits(page);

      const held = await accessToken(page);
      let refreshes = 0;
      await page.route("**/api/auth", async (route) => {
        if ((route.request().postData() ?? "").includes('"refreshToken"')) {
          refreshes += 1;
          await route.fulfill({ json: { tokens: { token: `${held.slice(0, -8)}AAAAAAA${refreshes % 10}`, refreshToken: "dummy" } } });
          return;
        }
        await route.continue();
      });
      await revokeSession(page);
      await fireRefresh(page);

      await expectSignInWithNext(page, back, visits);
      expect(refreshes).toBeGreaterThanOrEqual(1);
      expect(await page.evaluate(() => window.__b5SawStatus === true), "the boundary's status was shown").toBe(true);
      await page.unroute("**/api/auth");
      await expectSignInReturns(page, name, back);
    });
  });
}
