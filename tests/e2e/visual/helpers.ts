// Visual comparison helpers for the sheet redesign (.omc/plans/sheet-redesign.yaml). Each tracer's
// tests/e2e/visual/<id>.spec.ts is tagged @visual and runs only with E2E_VISUAL=1 (playwright.config.ts):
//
//   E2E_VISUAL=1 E2E_PORT=<port> E2E_CONVEX_PORT=<port> pnpm test:e2e tests/e2e/visual/S1.spec.ts
//
// Shots land in test-results/visual/<tracer>/<name>-1440.png and <name>-390.png; the matching board shots come
// from `node scripts/board-shots.mjs <region...>` (test-results/visual/board/).

import { ConvexHttpClient } from "convex/browser";
import { expect, type Locator, type Page } from "@playwright/test";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { signInAsTestGm } from "../fixtures";

/** The two viewports every region is shot at: the board's desktop size and the 390 px phone layout. */
export const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
] as const;

/**
 * The three viewports of the combat map plan (.omc/plans/d9-combat-map.yaml): desktop, tablet and phone. Pass them
 * to `visual(page, tracer, D9_VIEWPORTS)`; board counterparts come from `node scripts/board-shots.mjs combat:<region>`.
 */
export const D9_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

/** A level-1 Bard (Troubadour): Rapier, Gambeson, Deft Deceiver + Book of Ava. Override fields per shot. */
export function bardDraft(name: string) {
  return {
    classId: "bard",
    subclassId: "troubadour",
    ancestry: { kind: "single", id: "elf" },
    communityId: "loreborne",
    traits: { agility: 0, strength: -1, finesse: 1, instinct: 0, presence: 2, knowledge: 1 },
    name,
    pronouns: "she/her",
    description: "",
    primaryWeaponId: "rapier",
    armorId: "gambeson-armor",
    potion: "Minor Health Potion",
    classItem: "",
    background: [],
    experiences: ["Wandering minstrel", "Silver tongue"],
    domainCards: ["deft-deceiver", "book-of-ava"],
    connections: [],
  };
}

export type Draft = ReturnType<typeof bardDraft>;

/** A Convex client authenticated as the page's signed-in user. */
export async function convexAs(page: Page): Promise<ConvexHttpClient> {
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("__convexAuthJWT"));
    return key ? localStorage.getItem(key) : null;
  });
  expect(token, "Convex Auth token in localStorage").toBeTruthy();
  const client = new ConvexHttpClient(process.env.E2E_CONVEX_URL!);
  client.setAuth(token!);
  return client;
}

/**
 * Signs in as the test GM, starts a campaign of `frame` through the UI (like the specs), creates a character
 * through the API and opens its sheet. `draft` overrides the Bard; `extra` goes to `characters.create` as is
 * (for example `{ ikonis }` in Motherboard).
 */
export async function openSheet(
  page: Page,
  { frame = "witherwild", draft = {}, extra = {} }: { frame?: string; draft?: Partial<Draft>; extra?: Record<string, unknown> } = {},
) {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const campaignName = `Visual ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto(`/frames/${frame}`);
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(campaignName);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;

  const client = await convexAs(page);
  const name = draft.name ?? "Liriel";
  const { characterId } = await client.mutation(api.characters.create, {
    campaignId,
    draft: { ...bardDraft(name), ...draft },
    ...extra,
    idempotencyKey: crypto.randomUUID(),
  });
  const url = `/campaigns/${campaignId}/party/${characterId}`;
  await page.goto(url);
  const sheet = page.getByRole("article", { name });
  await expect(sheet.getByRole("heading", { level: 1, name })).toBeVisible();
  return { client, campaignId, characterId, url, sheet };
}

/**
 * Signs in as the test GM, starts a campaign of `frame` through the UI and opens its Adversaries page (D8,
 * .omc/plans/d8.yaml). Returns a Convex client for seeding, the campaign id and the page URL.
 */
export async function openAdversaries(page: Page, frame = "witherwild") {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const campaignName = `Visual ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto(`/frames/${frame}`);
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(campaignName);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
  const url = `/campaigns/${campaignId}/adversaries`;
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: "Adversaries" })).toBeVisible();
  return { client: await convexAs(page), campaignId, url };
}

/**
 * Signs in as the test GM, starts a campaign of `frame` through the UI and opens its Combat Map page (D9,
 * .omc/plans/d9-combat-map.yaml). Returns a Convex client for seeding, the campaign id and name, and the page URL.
 */
export async function openCombatMap(page: Page, frame = "witherwild") {
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  const campaignName = `Visual ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto(`/frames/${frame}`);
  await page.getByRole("button", { name: "Choose this Frame" }).click();
  await page.getByRole("dialog", { name: "Name your campaign" }).getByLabel("Campaign name").fill(campaignName);
  await page.getByRole("button", { name: "Start campaign" }).last().click();
  await expect(page.getByRole("heading", { level: 1, name: campaignName })).toBeVisible();
  const campaignId = new URL(page.url()).pathname.split("/")[2] as Id<"campaigns">;
  const url = `/campaigns/${campaignId}/combat-map`;
  await page.goto(url);
  await expect(page.getByRole("heading", { level: 1, name: "Combat Map" })).toBeVisible();
  return { client: await convexAs(page), campaignId, campaignName, url };
}

/** The sheet's page tab ("Character Sheet", "Story & Advancement", "Domains") or a Domains sub-tab. */
export async function openTab(page: Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
  await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
}

/** The page has no horizontal scroll (the 390 px rule of the plan). */
export async function expectNoHorizontalScroll(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
}

/**
 * Shots for one tracer: `shoot(locator, name)` screenshots the region at each viewport (default 1440x900 and
 * 390x844; D9 passes `D9_VIEWPORTS`), checking there is no horizontal scroll below 640 px, then restores the first
 * viewport.
 */
export function visual(page: Page, tracer: string, viewports: readonly { width: number; height: number }[] = VIEWPORTS) {
  return {
    async shoot(locator: Locator, name: string) {
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await expect(locator).toBeVisible();
        if (viewport.width < 640) await expectNoHorizontalScroll(page);
        await locator.screenshot({ path: `test-results/visual/${tracer}/${name}-${viewport.width}.png`, animations: "disabled" });
      }
      await page.setViewportSize(viewports[0] ?? VIEWPORTS[0]);
    },
  };
}
