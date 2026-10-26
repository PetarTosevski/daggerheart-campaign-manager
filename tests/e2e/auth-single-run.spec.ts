import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

// PF3: the Convex client reuses the server-confirmed cached token
// (`initialAuthTokenReuse` in src/app/convex-client-provider.tsx), so a hard
// load sends one Authenticate frame and no immediate POST /api/auth, and the
// server runs each query once. These tests fail if the double run comes back
// (for example after a Convex upgrade drops the experimental option), and check
// that refreshing and replacing a rejected token still work.

const CONVEX_WS = new RegExp(`:${process.env.E2E_CONVEX_PORT ?? "3212"}/`);
const unique = (label: string) => `${label} ${crypto.randomUUID().slice(0, 8)}`;

type AuthFrame = { tokenType: string; value?: string };

function isAuthenticate(payload: string | Buffer): AuthFrame | null {
  if (typeof payload !== "string") return null;
  try {
    const m = JSON.parse(payload) as { type?: string } & AuthFrame;
    return m.type === "Authenticate" ? m : null;
  } catch {
    return null;
  }
}

/** Records Authenticate frames, AuthError replies and POST /api/auth requests of one page. */
function watchAuth(page: Page) {
  const auths: AuthFrame[] = [];
  const authErrors: string[] = [];
  const authPosts: number[] = [];
  page.on("websocket", (ws) => {
    if (!CONVEX_WS.test(ws.url())) return;
    ws.on("framesent", (f) => {
      const m = isAuthenticate(f.payload);
      if (m) auths.push(m);
    });
    ws.on("framereceived", (f) => {
      if (typeof f.payload === "string" && f.payload.includes('"AuthError"')) authErrors.push(f.payload);
    });
  });
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === "/api/auth") authPosts.push(Date.now());
  });
  return { auths, authErrors, authPosts };
}

/** Signs in, creates a Beast Feast campaign and returns its dashboard URL with the page closed. */
async function campaignDashboard(context: BrowserContext): Promise<{ url: string; name: string }> {
  const page = await context.newPage();
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  await page.goto("/frames/beast-feast");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  const name = unique("Auth");
  const dialog = page.getByRole("dialog", { name: "Name your campaign" });
  await dialog.getByLabel("Campaign name").fill(name);
  await dialog.getByRole("button", { name: "Start campaign" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page).toHaveURL(/\/campaigns\/[^/]+$/);
  const url = new URL(page.url()).pathname;
  await page.close();
  return { url, name };
}

/** Waits out an observation window (no UI event to wait for). */
const observe = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The server accepts the page's current identity: a GM-only mutation round-trips. */
async function expectFearWorks(page: Page) {
  const fear = page.getByRole("region", { name: "GM Fear" }).getByTestId("fear-value");
  await page.getByRole("button", { name: "Fear 5 of 12" }).click();
  await expect(fear).toHaveText("V");
  await page.getByRole("button", { name: "Fear 5 of 12" }).click();
  await expect(fear).toHaveText("IV");
}

test("a hard load of a campaign sends one Authenticate and no token refresh", async ({ context }) => {
  const { url, name } = await campaignDashboard(context);

  const page = await context.newPage();
  const seen = watchAuth(page);
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page.getByRole("region", { name: "GM Fear" }).getByTestId("fear-value")).toBeVisible();
  // A negative assertion over the acceptance window (the first 5 s): there is
  // no event that says "no refresh is coming". The old behavior refreshed
  // about 0.3-1 s after the first queries.
  await observe(5_000);

  expect(seen.auths.map((a) => a.tokenType)).toEqual(["User"]);
  expect(seen.authPosts).toHaveLength(0);
  expect(seen.authErrors).toHaveLength(0);
});

test("the reused token is still refreshed before it expires", async ({ context }) => {
  const { url, name } = await campaignDashboard(context);

  const page = await context.newPage();
  // Fake a short-lived token: the client schedules its refresh about
  // `exp - 10 s` ahead (about an hour for a fresh token); run any timer of
  // half an hour or more after 2 s instead. Nothing else in the app uses
  // timers that long.
  await page.addInitScript(() => {
    const original = window.setTimeout;
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) =>
      original(handler, (timeout ?? 0) >= 30 * 60 * 1000 ? 2_000 : timeout, ...args)) as typeof window.setTimeout;
  });
  const seen = watchAuth(page);
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();

  await expect.poll(() => seen.authPosts.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await expect.poll(() => seen.auths.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  const [first, second] = seen.auths;
  expect(first.tokenType).toBe("User");
  expect(second.tokenType).toBe("User");
  expect(second.value).not.toBe(first.value);
  expect(seen.authErrors).toHaveLength(0);

  await expectFearWorks(page);
  await expect(page).toHaveURL(url);
});

test("a cached token the server rejects is replaced by a refreshed one", async ({ context }) => {
  const { url, name } = await campaignDashboard(context);

  const page = await context.newPage();
  // Simulate an expired cached token: corrupt the signature of the first
  // Authenticate frame on its way to the server.
  let tampered = false;
  await page.routeWebSocket(CONVEX_WS, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const m = isAuthenticate(message);
      if (m && m.tokenType === "User" && m.value && !tampered) {
        tampered = true;
        server.send(JSON.stringify({ ...JSON.parse(message as string), value: `${m.value.slice(0, -8)}AAAAAAAA` }));
        return;
      }
      server.send(message);
    });
  });
  const seen = watchAuth(page);
  await page.goto(url);

  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect.poll(() => seen.authPosts.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  expect(tampered).toBe(true);
  await expectFearWorks(page);
  await expect(page).toHaveURL(url);
});

test("a refresh that returns the rejected token again is retried once", async ({ context }) => {
  // dcm-bxp.123: Convex Auth's JWT is deterministic with `iat` in whole seconds, so a refresh in the same second as
  // the sign-in returns the cached token byte for byte, and the Convex client used to give up ("Your session has
  // ended"). Pin that case: the first refresh answers with the very token the server just rejected.
  const { url, name } = await campaignDashboard(context);

  const page = await context.newPage();
  let cached: string | null = null;
  await page.routeWebSocket(CONVEX_WS, (ws) => {
    const server = ws.connectToServer();
    ws.onMessage((message) => {
      const m = isAuthenticate(message);
      if (m && m.tokenType === "User" && m.value && cached === null) {
        cached = m.value;
        server.send(JSON.stringify({ ...JSON.parse(message as string), value: `${m.value.slice(0, -8)}AAAAAAAA` }));
        return;
      }
      server.send(message);
    });
  });
  let sameTokenServed = false;
  await page.route("**/api/auth", async (route) => {
    const body = route.request().postData() ?? "";
    if (!sameTokenServed && cached !== null && body.includes('"refreshToken"')) {
      sameTokenServed = true;
      await route.fulfill({ json: { tokens: { token: cached, refreshToken: "dummy" } } });
      return;
    }
    await route.continue();
  });
  const seen = watchAuth(page);
  await page.goto(url);

  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible({ timeout: 15_000 });
  // The heading is server-rendered since PF4 (the layout preloads the campaign), so it no longer waits for the refresh.
  await expect.poll(() => sameTokenServed, { timeout: 15_000 }).toBe(true);
  await expect.poll(() => seen.authPosts.length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  const users = seen.auths.filter((a) => a.tokenType === "User").map((a) => a.value);
  expect(users.at(-1)).not.toBe(cached);
  await expectFearWorks(page);
  await expect(page).toHaveURL(url);
});
