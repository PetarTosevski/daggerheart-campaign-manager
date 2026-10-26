// Signed-out route sweep (plan d12-hardening, tracer H15; analysis section 3). The GM first creates a real campaign, a
// character and a join code. Then, signed out, every page route lands on /signin?next=<path> (src/proxy.ts; `/` goes
// to plain /signin) and neither the redirect nor the sign-in page carries the campaign or character name. A signed-in
// non-member opening each campaign route sees the "Campaign not found" state, never the campaign's data.
// The server-side half (every Convex function refuses a signed-out caller) is tests/convex/unauthenticated-sweep.test.ts.

import { expect, test, type Browser } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import { signInAsTestGm } from "./fixtures";
import { E2E_PLAYER_EMAIL } from "./live";
import { bardDraft, convexAs } from "./visual/helpers";

type Seed = { campaignId: string; characterId: string; code: string; campaignName: string; characterName: string };

async function seed(browser: Browser): Promise<Seed> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const client = await convexAs(page);
  const campaignName = `Sealed ${crypto.randomUUID().slice(0, 8)}`;
  const characterName = `Vesper${crypto.randomUUID().slice(0, 6)}`;
  const { campaignId } = await client.mutation(api.campaigns.create, { frameId: "witherwild", name: campaignName, idempotencyKey: crypto.randomUUID() });
  const code = await client.mutation(api.members.rotateJoinCode, { campaignId });
  const { characterId } = await client.mutation(api.characters.create, {
    campaignId,
    draft: bardDraft(characterName),
    idempotencyKey: crypto.randomUUID(),
  });
  await context.close();
  return { campaignId, characterId, code, campaignName, characterName };
}

/** Every page route under src/app (analysis section 3), with the seeded ids filled in. */
function pageRoutes(s: Seed): { app: string[]; campaign: string[] } {
  const c = `/campaigns/${s.campaignId}`;
  return {
    app: ["/", "/new", "/frames/witherwild", "/campaigns", `/join/${s.code}`],
    campaign: [
      c,
      `${c}/party`,
      `${c}/party/new`,
      `${c}/party/${s.characterId}`,
      `${c}/world`,
      `${c}/codex`,
      `${c}/adversaries`,
      `${c}/combat-map`,
      `${c}/combat-map/packs`,
      `${c}/sessions`,
      `${c}/notes`,
      // [section] (a slug with no board of its own).
      `${c}/timeline`,
    ],
  };
}

let s: Seed;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);
  s = await seed(browser);
});

test("signed out, every page route redirects to sign-in and leaks no campaign data", async ({ page, request }) => {
  test.setTimeout(240_000);
  const { app, campaign } = pageRoutes(s);
  for (const path of [...app, ...campaign]) {
    const target = path === "/" ? "/signin" : `/signin?next=${encodeURIComponent(path)}`;

    // The server answers with a redirect, before any page renders.
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), `${path} answers with a redirect`).toBeGreaterThanOrEqual(300);
    expect(response.status(), `${path} answers with a redirect`).toBeLessThan(400);
    const location = new URL(response.headers()["location"] ?? "", "http://localhost");
    expect(location.pathname + location.search, `${path} redirect target`).toBe(target);
    const body = await response.text();
    expect(body, `${path} redirect body`).not.toContain(s.campaignName);
    expect(body, `${path} redirect body`).not.toContain(s.characterName);

    // A browser lands on the sign-in page, whose HTML holds neither name.
    await page.goto(path);
    await expect(page, `${path} lands on sign-in`).toHaveURL(target);
    await expect(page.getByRole("form", { name: "Test sign-in" })).toBeVisible();
    const html = await page.content();
    expect(html, `${path} sign-in HTML`).not.toContain(s.campaignName);
    expect(html, `${path} sign-in HTML`).not.toContain(s.characterName);
  }
});

test("a signed-in non-member sees 'Campaign not found' on every campaign route", async ({ page }) => {
  test.setTimeout(300_000);
  await signInAsTestGm(page, E2E_PLAYER_EMAIL);
  await expect(page).toHaveURL("/");
  const { campaign } = pageRoutes(s);
  // Signed in, [section] answers 404 for a slug with no board before any campaign data loads; the rest show the shell.
  for (const path of campaign.filter((p) => !p.endsWith("/timeline"))) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "Campaign not found" }), `${path} not-found state`).toBeVisible({ timeout: 30_000 });
    const html = await page.content();
    expect(html, `${path} HTML`).not.toContain(s.campaignName);
    expect(html, `${path} HTML`).not.toContain(s.characterName);
  }
});
