import { expect, test, type Page, type Request } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

/*
 * PF1: a campaign tab click gives feedback at once. With 80 ms of network latency (PF0's wan profile), a click must
 * show either the target page (its URL committed, which happens with its render) or the campaign loading skeleton within
 * 100 ms; a revisit inside the router cache window sends no RSC request.
 *
 * The time is taken inside the page: a capture-phase click listener starts a requestAnimationFrame loop that stops on
 * the first frame showing the skeleton or the new URL, so Playwright's own round trips are not counted.
 */

test.describe.configure({ timeout: 120_000 });

const unique = (label: string) => `${label} ${Date.now().toString(36)}`;

type NavTiming = { target: string; ms: number; shown: "page" | "skeleton" };

async function newCampaign(page: Page) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  const name = unique("Nav perf");
  const dialog = page.getByRole("dialog", { name: "Name your campaign" });
  await dialog.getByLabel("Campaign name").fill(name);
  await dialog.getByRole("button", { name: "Start campaign" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
}

/** Records, per link click, how long until the skeleton or the target URL shows (in-page, frame accurate). */
async function instrumentClicks(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __navTimings: NavTiming[] };
    w.__navTimings = [];
    document.addEventListener(
      "click",
      (event) => {
        const link = (event.target as Element | null)?.closest("a");
        if (!link) return;
        const t0 = performance.now();
        const target = new URL(link.href).pathname;
        const tick = () => {
          const atTarget = location.pathname === target;
          if (atTarget || document.querySelector('[data-testid="campaign-loading"]')) {
            w.__navTimings.push({ target, ms: performance.now() - t0, shown: atTarget ? "page" : "skeleton" });
            return;
          }
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      true,
    );
  });
}

async function lastTiming(page: Page): Promise<NavTiming> {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __navTimings: NavTiming[] }).__navTimings.length)).toBeGreaterThan(0);
  return page.evaluate(() => (window as unknown as { __navTimings: NavTiming[] }).__navTimings.pop()!);
}

const isRsc = (request: Request) => request.url().includes("_rsc=") || request.headers()["rsc"] === "1";

test("campaign tabs show their page or the loading skeleton within 100 ms; revisits send no RSC request", async ({ page, context }) => {
  // HTTP requests in flight (the Convex WebSocket is not one), so each click can start from a settled page.
  const inflight = new Set<Request>();
  page.on("request", (request) => inflight.add(request));
  page.on("requestfinished", (request) => inflight.delete(request));
  page.on("requestfailed", (request) => inflight.delete(request));
  const settled = () => expect.poll(() => inflight.size, { timeout: 30_000 }).toBe(0);

  await newCampaign(page);
  const nav = page.getByRole("navigation", { name: "Campaign sections" });
  const tabs = (await nav.getByRole("link").allTextContents()).map((t) => t.trim());
  expect(tabs).toHaveLength(9);

  // Let the nav's prefetches finish.
  await settled();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 80,
    downloadThroughput: (10 * 1024 * 1024) / 8,
    uploadThroughput: (5 * 1024 * 1024) / 8,
  });
  await instrumentClicks(page);

  const rsc: string[] = [];
  page.on("request", (request) => {
    if (isRsc(request)) rsc.push(request.url());
  });

  const order = [...tabs.filter((t) => t !== "Dashboard"), "Dashboard"];
  const report: string[] = [];
  const slow: string[] = [];
  const revisitRsc: string[] = [];
  for (const pass of ["first", "revisit"] as const) {
    for (const tab of order) {
      const link = nav.getByRole("link", { name: tab, exact: true });
      const href = (await link.getAttribute("href"))!;
      // Each click starts from a settled page (as in PF0's harness): no prefetch or page request in flight.
      await settled();
      rsc.length = 0;
      await link.click();
      const timing = await lastTiming(page);
      expect(timing.target).toBe(href);
      await expect(link).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId("campaign-loading")).toHaveCount(0);
      const line = `${pass} ${tab}: ${timing.shown} after ${Math.round(timing.ms)} ms, ${rsc.length} RSC`;
      report.push(line);
      if (timing.ms > 100) slow.push(line);
      if (pass === "revisit" && rsc.length > 0) revisitRsc.push(`${line}: ${rsc.join(", ")}`);
    }
  }
  test.info().annotations.push({ type: "navigation", description: report.join("\n") });
  expect(slow, report.join("\n")).toEqual([]);
  expect(revisitRsc, report.join("\n")).toEqual([]);
});

test("Load Campaign shows its header at once, then the list", async ({ page, context }) => {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  // The title menu's link auto-prefetches /campaigns down to its loading boundary; let that land first.
  await page.waitForLoadState("networkidle");
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 80, downloadThroughput: -1, uploadThroughput: -1 });
  // The skeleton and the page share the board's header, so the heading shows within a frame or two of the click.
  const shown = await page.evaluate(async () => {
    const link = [...document.querySelectorAll("a")].find((a) => a.textContent?.includes("Load Campaign"))!;
    const t0 = performance.now();
    link.click();
    for (;;) {
      await new Promise(requestAnimationFrame);
      const h1 = [...document.querySelectorAll("h1")].some((h) => h.textContent === "Load Campaign");
      if (h1) return performance.now() - t0;
      if (performance.now() - t0 > 5_000) return Infinity;
    }
  });
  expect(shown).toBeLessThanOrEqual(100);
  await expect(page.getByTestId("campaigns-loading")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Load Campaign" })).toBeVisible();
});
