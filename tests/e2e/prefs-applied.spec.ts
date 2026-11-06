import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test, type Page } from "@playwright/test";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { signInAsTestGm } from "./fixtures";
import { bardDraft, convexAs } from "./visual/helpers";

// Plan config U6b (docs/tasks/TASK-CONFIG-U6b.md; Q12 a, Q13 a): the account's Text size zooms the app root (Small 0.9,
// Medium 1, Large 1.15) and Reduce motion calms every animation, on every page and live from another device. At Large
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
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).zoom)).toBe("1");
  await shot(page, "dashboard-medium");

  // Another device changes it: this page follows without a reload.
  for (const [size, zoom] of [
    ["small", "0.9"],
    ["large", "1.15"],
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
    // gap under it at Small (globals.css divides its 100dvh by the zoom).
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
  const zoomText = (await page.getByTestId("combat-zoom").textContent()) ?? "100%";
  const step = 48 * (Number.parseInt(zoomText, 10) / 100) * 1.15;
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
