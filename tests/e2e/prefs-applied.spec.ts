import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs } from "./visual/helpers";
import { emulateTouch, rootZoom, squarePx } from "./zoom";

// Plan config U6b (docs/tasks/TASK-CONFIG-U6b.md; Q12 a, Q13 a): the account's Text size zooms the app root (Small 0.72,
// Medium 0.8 = the website's base zoom, dcm-1i3z; Large 0.92) and Reduce motion calms every animation, on every page and live from another device. At Large
// the Combat Map's pointer math stays right (a dragged token lands on the square under the pointer).
//
// Each test signs in its own account: preferences are per user, so the shared test GM's must not change under other
// specs running at the same time (TE8).

const SHOTS = process.env.E2E_SHOTS_DIR;

async function shot(page: Page, name: string) {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

const root = (page: Page) => page.locator("html");

/** Signs in a fresh account, starts a Witherwild campaign and gives it a character; returns its client and urls. */
async function freshCampaign(page: Page) {
  await signInAsTestGm(page, `e2e-prefs-${crypto.randomUUID().slice(0, 8)}@example.test`);
  await expect(page).toHaveURL("/");
  const campaignName = `Prefs ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/frames/witherwild");
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(campaignName);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
  const client = await convexAs(page);
  await client.mutation(api.characters.create, { campaignId, draft: bardDraft("Liriel"), idempotencyKey: crypto.randomUUID() });
  return { client, campaignId, dashboard: `/campaigns/${campaignId}`, combatMap: `/campaigns/${campaignId}/combat-map` };
}

/** Collects console errors that mean a hydration mismatch (React's #418 / #425 in production, the text in dev). */
function watchHydration(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /hydrat|#418|#423|#425/i.test(m.text())) errors.push(m.text());
  });
  return errors;
}

test("Text size zooms the whole app, follows the account live and paints at the saved size on a hard load", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const hydration = watchHydration(page);
  const { client, dashboard, combatMap } = await freshCampaign(page);

  await page.goto(dashboard);
  await expect(root(page)).toHaveAttribute("data-text-size", "medium");
  await expect(root(page)).not.toHaveAttribute("data-reduce-motion");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe("0.8");
  await shot(page, "dashboard-medium");

  // Another device changes it: this page follows without a reload.
  for (const [size, zoom] of [
    ["small", "0.72"],
    ["large", "0.92"],
  ] as const) {
    await client.mutation(api.preferences.set, { change: { key: "textSize", value: size } });
    await expect(root(page)).toHaveAttribute("data-text-size", size);
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe(zoom);
    await shot(page, `dashboard-${size}`);
  }

  // A hard load starts at Large before React runs (the layout's inline script reads the display cache): the first
  // time the attribute appears, the document is still being parsed.
  await page.addInitScript(() => {
    const w = window as unknown as { __firstSize?: { value: string | null; readyState: string } };
    new MutationObserver((_, observer) => {
      w.__firstSize = { value: document.documentElement.getAttribute("data-text-size"), readyState: document.readyState };
      observer.disconnect();
      // <html> may not exist yet when this runs, so watch the document's whole subtree.
    }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-text-size"] });
  });
  await page.goto(combatMap);
  await expect(page.getByRole("heading", { level: 1, name: "Combat Map" })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __firstSize?: unknown }).__firstSize)).toEqual({
    value: "large",
    readyState: "loading",
  });
  await expect(root(page)).toHaveAttribute("data-text-size", "large");
  expect(hydration, "no hydration mismatch").toEqual([]);
});

test("Every page on a mouse screen starts at the base zoom 0.8, signed out too, and screen-tall surfaces still fill the screen (dcm-1i3z)", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const zoom = () => page.evaluate(() => getComputedStyle(document.documentElement).zoom);

  // Signed out, outside the (gm) group, with no preference and no script: plain CSS on <html>.
  await page.goto("/signin");
  await expect(root(page)).not.toHaveAttribute("data-text-size");
  expect(await zoom()).toBe("0.8");
  // min-h-page divides 100vh by the zoom: the page still reaches the bottom of the screen.
  const main = (await page.locator("main").first().boundingBox())!;
  expect(main.y + main.height).toBeGreaterThanOrEqual(899);
  await shot(page, "signin-base");

  // Signed in at Medium: the Preferences popover still opens right under the avatar, right edges aligned (account.tsx
  // turns the avatar's client rect into the popover's CSS px).
  const { dashboard } = await freshCampaign(page);
  await page.goto(dashboard);
  await expect(root(page)).toHaveAttribute("data-text-size", "medium");
  expect(await zoom()).toBe("0.8");
  const avatar = page.getByTestId("app-bar-avatar").filter({ visible: true }).first();
  await avatar.click();
  const popover = page.getByTestId("preferences").filter({ visible: true });
  await expect(popover).toBeVisible();
  const a = (await avatar.boundingBox())!;
  const p = (await popover.boundingBox())!;
  expect(Math.abs(p.x + p.width - (a.x + a.width))).toBeLessThanOrEqual(2);
  expect(Math.abs(p.y - (a.y + a.height + 10 * 0.8))).toBeLessThanOrEqual(2);
  await shot(page, "dashboard-preferences");
});

test("Touch screens keep zoom 1 and the breakpoints as written; mouse screens switch layouts where 80% browser zoom did (dcm-jkxa)", async ({ page }) => {
  const zoom = () => page.evaluate(() => getComputedStyle(document.documentElement).zoom);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/signin");
  expect(await zoom()).toBe("0.8");
  // Every width / height query the browser actually loaded chooses between touch and the rest (postcss-zoom-media.mjs):
  // none is left on the raw screen width, Tailwind's included.
  const unscaled = await page.evaluate(() => {
    const out: string[] = [];
    let sized = 0;
    const walk = (rules: CSSRuleList) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSMediaRule) {
          for (const query of Array.from(rule.media)) {
            if (!/\b(width|height)\b/.test(query.replace(/aspect-ratio|device-(width|height)/g, ""))) continue;
            sized += 1;
            if (!query.includes("pointer")) out.push(query);
          }
        }
        if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets)) walk(sheet.cssRules);
    return { out, sized };
  });
  expect(unscaled.out).toEqual([]);
  expect(unscaled.sized).toBeGreaterThan(10);

  // A touch screen: zoom 1, and Text size there is 0.9 / 1 / 1.15 as before.
  await emulateTouch(page);
  await page.reload();
  expect(await zoom()).toBe("1");
  await emulateTouch(page, false);
  await page.reload();
  expect(await zoom()).toBe("0.8");

  // The Combat HUD: its tablet layout (108 px banners) is written for 761-1180 px. A 1280 px desktop and a 1024 px one
  // (1280 CSS px at 0.8, as at 80% browser zoom) get the desktop HUD (146 px); a 1024 px tablet gets the tablet HUD.
  const { client, campaignId, combatMap } = await freshCampaign(page);
  await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Ford", idempotencyKey: crypto.randomUUID() });
  await page.goto(combatMap);
  await page.getByRole("button", { name: "Map tools" }).click();
  const tools = page.getByRole("complementary", { name: "Map tools" });
  await tools.getByRole("region", { name: "Combatants" }).getByRole("button", { name: "＋ Party (1)" }).click();
  await tools.press("Escape");
  const bannerWidth = () => page.locator(".hud-r-banners > .hbn-row").first().evaluate((el) => getComputedStyle(el).getPropertyValue("--hbn-w").trim());
  for (const [width, height, touch, expected] of [
    [1280, 800, false, "146px"],
    [1024, 768, false, "146px"],
    [1024, 768, true, "108px"],
  ] as const) {
    await emulateTouch(page, touch);
    await page.setViewportSize({ width, height });
    await expect.poll(bannerWidth, { message: `${width} ${touch ? "touch" : "mouse"}` }).toBe(expected);
    expect(await zoom()).toBe(touch ? "1" : "0.8");
    await shot(page, `combat-hud-${width}-${touch ? "touch" : "mouse"}`);
  }
  await client.mutation(api.preferences.set, { change: { key: "textSize", value: "large" } });
  await expect.poll(zoom).toBe("1.15");
  await emulateTouch(page, false);
  await expect.poll(zoom).toBe("0.92");
});

test("At Large the Combat Map's pointer math holds: a dragged token lands where it is dropped", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { client, campaignId, combatMap } = await freshCampaign(page);
  await client.mutation(api.combatMaps.create, { campaignId, size: "medium", name: "Ford", idempotencyKey: crypto.randomUUID() });

  for (const size of ["small", "medium", "large"] as const) {
    await client.mutation(api.preferences.set, { change: { key: "textSize", value: size } });
    if (size === "small") {
      await page.goto(combatMap);
      await page.getByRole("button", { name: "Map tools" }).click();
      const tools = page.getByRole("complementary", { name: "Map tools" });
      await tools.getByRole("region", { name: "Combatants" }).getByRole("button", { name: "＋ Party (1)" }).click();
      await tools.press("Escape");
      await expect(tools).toHaveCount(0);
    }
    await expect(root(page)).toHaveAttribute("data-text-size", size);
    // The HUD still ends exactly at the bottom of the screen at every size: no dock pushed off the page at Large, no
    // gap under it at Small (shell.css divides its 100dvh by the zoom: var(--dvh)).
    await expect
      .poll(async () => {
        const hud = await page.locator(".hud-root").first().boundingBox();
        return hud ? { fitsWidth: Math.abs(hud.width - 1440) <= 1, endsAtBottom: Math.abs(hud.y + hud.height - 900) <= 1 } : null;
      })
      .toEqual({ fitsWidth: true, endsAtBottom: true });
    await shot(page, `combat-map-${size}`);
  }

  // Large: drag Liriel two squares right with real pointer moves.
  const board = page.getByRole("region", { name: "Battle map" });
  const token = board.getByRole("button", { name: /^Open Liriel’s sheet/ });
  await expect(token).toBeVisible();
  const step = await squarePx(page);
  expect(await rootZoom(page)).toBeCloseTo(0.92, 2);
  const [x, y] = (await token.getAttribute("data-square"))!.split(",").map(Number) as [number, number];
  const box = (await token.boundingBox())!;
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + step, from.y, { steps: 4 });
  await page.mouse.move(from.x + 2 * step, from.y, { steps: 4 });
  await page.mouse.up();
  await expect(token).toHaveAttribute("data-square", `${x + 2},${y}`);
  await shot(page, "combat-map-large-dragged");
});

test("Reduce motion: on calms the app on any device; off follows the device and never forces motion", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { client, dashboard } = await freshCampaign(page);
  await page.goto(dashboard);
  // A glass button: it has a transition in full motion.
  const button = page.getByRole("button", { name: "Your preferences" }).first();
  await expect(button).toBeVisible();
  const transition = () => button.evaluate((el) => getComputedStyle(el).transitionDuration);
  await expect.poll(transition).not.toBe("0s");

  await client.mutation(api.preferences.set, { change: { key: "reduceMotion", value: true } });
  await expect(root(page)).toHaveAttribute("data-reduce-motion", "");
  await expect.poll(transition).toBe("0s");

  // Off, on a device that asks for less: still calm (the device's own rule).
  await client.mutation(api.preferences.set, { change: { key: "reduceMotion", value: false } });
  await expect(root(page)).not.toHaveAttribute("data-reduce-motion");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(transition).toBe("0s");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(transition).not.toBe("0s");
});
