import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { signInAsTestGm } from "./fixtures";

// PF4: the [campaignId] layout preloads campaigns.get on the server (preloadQuery with the caller's token) and the shell
// reads it with usePreloadedQuery. A hard load therefore renders the shell with the campaign in the HTML, the page
// mounts right after hydration, and the page's queries go out with campaigns.get, without waiting for its result
// (baseline: the page mounted on that result, so its queries left one round trip later). The page itself never sits in
// the server HTML, so React never renders it twice (a server copy waiting to be revealed next to a client copy). The
// header art is a preloaded next/image (CL10).

const CONVEX_WS = new RegExp(`:${process.env.E2E_CONVEX_PORT ?? "3212"}/`);
/** How long the server's replies are held back at most. */
const HOLD_MS = 8_000;

/**
 * Holds back every Convex server message of one page until it has subscribed to all of `queries` (or HOLD_MS passed),
 * and records the functions it subscribed to meanwhile. Nothing answers while the hold lasts, so a query that waits on
 * another's result (the baseline page on campaigns.get) cannot be among them; the outcome does not depend on how fast
 * the host hydrates. Then the held messages are delivered in order and the socket runs as usual.
 */
async function holdRepliesUntilSubscribed(page: Page, queries: string[]) {
  const sentWhileHeld: string[] = [];
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.routeWebSocket(CONVEX_WS, (ws) => {
    const server = ws.connectToServer();
    const held: (string | Buffer)[] = [];
    let holding = true;
    const flush = () => {
      if (!holding) return;
      holding = false;
      for (const message of held.splice(0)) ws.send(message);
      release();
    };
    const timer = setTimeout(flush, HOLD_MS);
    server.onMessage((message) => (holding ? held.push(message) : ws.send(message)));
    ws.onMessage((message) => {
      server.send(message);
      if (!holding || typeof message !== "string") return;
      const m = JSON.parse(message) as { type?: string; modifications?: { type: string; udfPath?: string }[] };
      if (m.type !== "ModifyQuerySet") return;
      for (const mod of m.modifications ?? []) if (mod.type === "Add" && mod.udfPath) sentWhileHeld.push(mod.udfPath);
      if (queries.every((q) => sentWhileHeld.includes(q))) {
        clearTimeout(timer);
        flush();
      }
    });
  });
  return { released, sentWhileHeld };
}

/** Hydration mismatches and uncaught errors of one page (React logs mismatches as console errors). */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat|Minified React error #(418|419|421|422|423|425)/i.test(message.text())) {
      errors.push(message.text());
    }
  });
  return errors;
}

/** The most nodes matching `selector` that were ever in the DOM at once while the page loaded. */
async function watchMaxCount(page: Page, selector: string) {
  await page.addInitScript((sel) => {
    const w = window as unknown as { __maxCount: number };
    w.__maxCount = 0;
    new MutationObserver(() => {
      w.__maxCount = Math.max(w.__maxCount, document.querySelectorAll(sel).length);
    }).observe(document, { childList: true, subtree: true });
  }, selector);
  return () => page.evaluate(() => (window as unknown as { __maxCount: number }).__maxCount);
}

/** Signs in, creates a Beast Feast campaign and returns its dashboard path and name with the page closed. */
async function newCampaign(context: BrowserContext): Promise<{ path: string; name: string }> {
  const page = await context.newPage();
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  await page.goto("/frames/beast-feast");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  const name = `Preload ${crypto.randomUUID().slice(0, 8)}`;
  const dialog = page.getByRole("dialog", { name: "Name your campaign" });
  await dialog.getByLabel("Campaign name").fill(name);
  await dialog.getByRole("button", { name: "Start campaign" }).click();
  await expect(page.getByRole("heading", { level: 1, name })).toBeVisible();
  await expect(page).toHaveURL(/\/campaigns\/[^/]+$/);
  const path = new URL(page.url()).pathname;
  await page.close();
  return { path, name };
}

const PAGES = [
  {
    label: "dashboard",
    suffix: "",
    queries: ["campaigns:get", "sessionWrap:dashboard", "characters:listByCampaign", "campaigns:fear", "feed:list"],
    ready: (page: Page) => page.getByRole("region", { name: "GM Fear" }),
  },
  {
    label: "party",
    suffix: "/party",
    queries: ["campaigns:get", "characters:listByCampaign", "members:roster"],
    ready: (page: Page) => page.getByRole("heading", { level: 1, name: "The Party" }),
  },
];

test("a hard load sends the page's queries together with campaigns.get, renders the campaign on the server and hydrates cleanly", async ({ context }) => {
  const { path, name } = await newCampaign(context);

  for (const target of PAGES) {
    const page = await context.newPage();
    const hold = await holdRepliesUntilSubscribed(page, target.queries);
    const errors = watchErrors(page);
    const maxSections = await watchMaxCount(page, "section, main");
    const response = await page.goto(path + target.suffix);

    // The campaign is in the server-rendered HTML (the layout's preload), not only after a client round trip.
    const html = (await response?.text()) ?? "";
    expect(html, `${target.label} HTML carries the campaign name`).toContain(name);

    // The page subscribes to all its queries while no reply has arrived: none waits on campaigns.get.
    await hold.released;
    expect(hold.sentWhileHeld, `${target.label} queries sent before any reply`).toEqual(expect.arrayContaining(target.queries));
    await expect(page.getByRole("navigation", { name: "Campaign sections" })).toBeVisible();
    expect(errors, `${target.label} hydration and page errors`).toEqual([]);
    // One copy of the page at any moment: count the landmarks once the page has settled, then compare with the peak.
    await expect(target.ready(page)).toBeVisible();
    const settled = await page.locator("section, main").count();
    expect(await maxSections(), `${target.label} never two copies of the page`).toBeLessThanOrEqual(settled);
    await page.close();
  }
});

test("the header art is a preloaded next/image", async ({ context }) => {
  const { path } = await newCampaign(context);
  const page = await context.newPage();
  const response = await page.goto(path);
  const html = (await response?.text()) ?? "";

  const header = page.getByRole("region", { name: "Campaign header" });
  const art = header.locator("img").first();
  await expect(art).toHaveAttribute("src", /\/_next\/image\?url=%2Fdesign-assets%2F/);
  await expect(art).toHaveAttribute("sizes", "100vw");
  await expect(art).toHaveAttribute("alt", "");
  // Preloaded from the document head (next/image `preload`), and actually decoded.
  expect(html).toMatch(/<link rel="preload"[^>]*as="image"[^>]*imageSrcSet="[^"]*%2Fdesign-assets%2F/i);
  await expect.poll(() => art.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  // No CSS background art left on the header.
  const backgrounds = await header.evaluate((el) =>
    [el, ...el.querySelectorAll("*")].map((node) => getComputedStyle(node).backgroundImage).filter((bg) => bg.includes("url(")),
  );
  expect(backgrounds).toEqual([]);
});

test("an unknown campaign id shows not found from the server render", async ({ context }) => {
  const page = await context.newPage();
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  for (const path of ["/campaigns/not-a-real-id", "/campaigns/not-a-real-id/party"]) {
    const response = await page.goto(path);
    expect(await response?.text(), `${path} HTML`).toContain("Campaign not found");
    await expect(page.getByRole("heading", { level: 1, name: "Campaign not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Load a campaign" })).toBeVisible();
  }
});
