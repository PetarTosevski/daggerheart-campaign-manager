import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

import { signInAsTestGm } from "../fixtures";
import { expectNoHorizontalScroll, openSheet, openTab, visual } from "./helpers";

// S13: whole-sheet polish. Every page and Domains sub-tab, for the GM and for a player who reads another
// character's sheet, at 1440 and 390: no horizontal scroll and no control under 44 px at 390, and the player
// sees locked fields and no editor-only controls.
// Board counterparts: node scripts/board-shots.mjs sheet-p1 sheet-p2 sheet-p3 sheet-p3-hero

const PLAYER = "e2e-player@example.test";

/** Every page and sub-tab, in order; `tab` is clicked before the shot. */
const PAGES = [
  { tab: "Character Sheet", shot: "sheet-p1" },
  { tab: "Story & Advancement", shot: "sheet-p2" },
  { tab: "Domains", shot: "sheet-p3" },
  { tab: "Heritage & Subclass", shot: "sheet-p3-hero" },
] as const;

/**
 * Interactive controls in the sheet smaller than 44 x 44 px. A checkbox or radio inside a label is measured by
 * its label (the label is the hit target); hidden controls and display-only (disabled) checkboxes are skipped.
 */
async function smallControls(sheet: Locator) {
  return sheet.evaluate((root) => {
    const selector = "button, a[href], input:not([type=hidden]), select, textarea, summary, [role=tab]";
    const small: string[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
      if (el.closest("[hidden], [aria-hidden=true]") || el.getClientRects().length === 0) continue;
      const input = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio");
      // The Level Up tier boxes are disabled checkboxes that only show taken slots; nobody taps them.
      if (input && el.disabled) continue;
      const target = (input && el.closest("label")) || el;
      const box = target.getBoundingClientRect();
      // A badge may widen its hit area with an absolutely positioned ::before (the level circle's ▲ and −).
      const before = getComputedStyle(target, "::before");
      const hit = before.position === "absolute" ? { w: parseFloat(before.width) || 0, h: parseFloat(before.height) || 0 } : { w: 0, h: 0 };
      const width = Math.max(box.width, hit.w);
      const height = Math.max(box.height, hit.h);
      if (width < 43.5 || height < 43.5) {
        const name = el.getAttribute("aria-label") || (el as HTMLInputElement).labels?.[0]?.textContent?.trim() || el.textContent?.trim().slice(0, 40) || el.className;
        small.push(`${el.tagName.toLowerCase()} "${name}" ${Math.round(width)}x${Math.round(height)}`);
      }
    }
    return small;
  });
}

/** At 390: no horizontal scroll and every control at least 44 px, on every page and sub-tab. */
async function phonePass(page: Page, sheet: Locator) {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const { tab } of PAGES) {
    await openTab(page, tab);
    await expectNoHorizontalScroll(page);
    expect.soft(await smallControls(sheet), `controls under 44 px on ${tab}`).toEqual([]);
  }
  await openTab(page, "Character Sheet");
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function shootPages(page: Page, sheet: Locator, tracer: string, prefix: string) {
  const { shoot } = visual(page, tracer);
  for (const { tab, shot } of PAGES) {
    await openTab(page, tab);
    await shoot(sheet, `${prefix}-${shot}`);
  }
  await openTab(page, "Character Sheet");
}

/** The player joins the GM's campaign with its join code in a second browser context. */
async function playerJoins(page: Page, browser: Browser, campaignId: string) {
  await page.goto(`/campaigns/${campaignId}`);
  await page.getByRole("button", { name: "Players" }).click();
  const dialog = page.getByRole("dialog", { name: "Players" });
  await expect(dialog.getByTestId("join-code")).toHaveText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  const code = (await dialog.getByTestId("join-code").textContent())!;
  await dialog.getByRole("button", { name: "Close players" }).click();

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const player = await context.newPage();
  await signInAsTestGm(player, PLAYER);
  await expect(player).toHaveURL("/");
  await player.getByRole("button", { name: /Join Campaign/ }).click();
  await player.getByRole("dialog", { name: "Join a campaign" }).getByLabel("Join code").fill(code);
  await player.getByRole("button", { name: "Join", exact: true }).click();
  await expect(player).toHaveURL(new RegExp(`/campaigns/${campaignId}`));
  return { player, close: () => context.close() };
}

test("S13 GM sheet: every page at 1440 and 390, 44 px controls, no horizontal scroll", { tag: "@visual" }, async ({ page }) => {
  const { sheet } = await openSheet(page);
  // The status row sits under the footer line.
  await expect(sheet.locator("footer.cs-foot + section").getByRole("group", { name: "Character status" })).toBeVisible();
  await phonePass(page, sheet);
  await shootPages(page, sheet, "S13", "gm");
});

test("S13 player view: locked fields, no editor controls, every page at 1440 and 390", { tag: "@visual" }, async ({ page, browser }) => {
  const { campaignId, url } = await openSheet(page);
  const { player, close } = await playerJoins(page, browser, campaignId);
  try {
    await player.goto(url);
    const sheet = player.getByRole("article", { name: "Liriel" });
    await expect(sheet.getByRole("heading", { level: 1, name: "Liriel" })).toBeVisible();
    await expect(sheet.getByTestId("read-only-note")).toBeVisible();
    await expect(sheet.getByText("Updates live as the table plays.")).toBeVisible();

    for (const { tab } of PAGES) {
      await openTab(player, tab);
      // No editor-only controls: the only buttons are the page tabs (and the vault deck is a picture). The
      // Level Up tier boxes show taken advancements as disabled checkboxes, so only enabled ones count.
      await expect(sheet.getByRole("button").and(sheet.locator(":not([role=tab])"))).toHaveCount(0);
      for (const role of ["textbox", "combobox", "checkbox", "spinbutton", "radio"] as const) {
        await expect(sheet.getByRole(role, { disabled: false }), `${role} on ${tab}`).toHaveCount(0);
      }
    }
    await openTab(player, "Character Sheet");
    await expect(sheet.getByRole("region", { name: "Status" })).toHaveCount(0);
    await expect(sheet.getByRole("button", { name: /^Level up to/ })).toHaveCount(0);
    // Identity fields render in the board's locked style.
    await expect(sheet.locator(".sh-locked, .cs-ro").first()).toBeVisible();
    expect(await sheet.locator(".sh-locked, .cs-ro").count()).toBeGreaterThanOrEqual(7);

    await phonePass(player, sheet);
    await shootPages(player, sheet, "S13", "player");
  } finally {
    await close();
  }
});
