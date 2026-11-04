import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { signInAsTestGm } from "../fixtures";
import { hudScene } from "../hud/helpers";
import { gmAndPlayer } from "../live";

// Shots for docs/tasks/TASK-GLASS-G0.md (E2E_VISUAL=1): sign-in, the main menu and the dashboard as the GM and as a
// player at 1440 x 900, 1024 x 768 and 390 x 844, a strip of glass buttons in each viewer's colours, a hovered confirm
// and a keyboard-focused close ✕; and the Combat HUD's buttons, with a style fingerprint of every HUD glass button
// (GLASS_G0_LABEL=before on rebuild, after on this branch; the two JSON files must be identical).

const OUT = "test-results/visual/GLASS-G0";
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
] as const;

async function shoot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
}

/** A strip of every role, mounted in the shell's viewer root (the classes brandButton returns). */
async function mountStrip(page: Page) {
  await page.evaluate(() => {
    document.getElementById("glass-strip")?.remove();
    const host = document.querySelector("[data-viewer]") ?? document.body;
    const row = document.createElement("div");
    row.id = "glass-strip";
    row.style.cssText = "display:flex;flex-wrap:wrap;gap:12px;padding:16px 24px;background:#0d1417;position:relative;z-index:50";
    const add = (label: string, cls: string, extra: Record<string, string> = {}) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = label;
      for (const [k, v] of Object.entries(extra)) b.setAttribute(k, v);
      row.appendChild(b);
    };
    add("Save (confirm)", "gb gb-confirm gb-wrap");
    add("Cancel", "gb gb-cancel gb-wrap");
    add("Settings (neutral)", "gb gb-neutral gb-wrap");
    add("Delete", "gb gb-danger gb-wrap");
    add("Chip on", "gb gb-neutral gb-sm gb-wrap", { "aria-pressed": "true" });
    add("Chip off", "gb gb-neutral gb-sm gb-wrap", { "aria-pressed": "false" });
    add("+", "gb gb-neutral gb-sm gb-icon", { "aria-label": "Add one" });
    add("Start Session (confirm, lg)", "gb gb-confirm gb-lg gb-wrap");
    add("Disabled", "gb gb-confirm gb-wrap", { disabled: "" });
    host.prepend(row);
  });
  return page.locator("#glass-strip");
}

test("GLASS-G0 sign-in and the main menu (no viewer: the player's colours)", { tag: "@visual" }, async ({ page }) => {
  test.setTimeout(180_000);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto("/signin");
    await expect(page.getByRole("form", { name: "Sign in with email" })).toBeVisible();
    await shoot(page, `signin-${viewport.width}`);
  }
  await signInAsTestGm(page);
  await expect(page).toHaveURL("/");
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Main menu" })).toBeVisible();
    await shoot(page, `menu-${viewport.width}`);
    await mountStrip(page);
    await page.locator("#glass-strip").screenshot({ path: `${OUT}/menu-strip-${viewport.width}.png`, animations: "disabled" });
  }
});

test("GLASS-G0 the dashboard as the GM and as a player", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const table = await gmAndPlayer(browser);
  try {
    for (const [who, page] of [
      ["gm", table.gm],
      ["player", table.player],
    ] as const) {
      for (const viewport of VIEWPORTS) {
        await page.setViewportSize(viewport);
        await page.goto(`/campaigns/${table.campaignId}`);
        await expect(page.getByRole("heading", { level: 1, name: table.campaignName })).toBeVisible();
        await shoot(page, `dashboard-${who}-${viewport.width}`);
        const strip = await mountStrip(page);
        await strip.screenshot({ path: `${OUT}/strip-${who}-${viewport.width}.png`, animations: "disabled" });
      }
      // Hovered confirm (the fill up, ink swapped) and a keyboard-focused button.
      await page.setViewportSize(VIEWPORTS[0]);
      const strip = page.locator("#glass-strip");
      await strip.getByRole("button", { name: "Save (confirm)" }).hover();
      await page.waitForTimeout(400);
      await strip.screenshot({ path: `${OUT}/strip-${who}-hover-confirm.png` });
      await page.mouse.move(0, 0);
      await strip.getByRole("button", { name: "Cancel" }).focus();
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Tab");
      await page.waitForTimeout(400);
      await strip.screenshot({ path: `${OUT}/strip-${who}-focus-cancel.png` });
    }

    // The Players dialog (a real Modal in the shell): Invite is neutral (G2: it has no side), the ✕ a round cancel in Hope.
    const gm = table.gm;
    for (const viewport of VIEWPORTS) {
      await gm.setViewportSize(viewport);
      await gm.goto(`/campaigns/${table.campaignId}`);
      await gm.getByRole("button", { name: "Players" }).click();
      const dialog = gm.getByRole("dialog", { name: "Players" });
      await expect(dialog).toBeVisible();
      await shoot(gm, `players-dialog-gm-${viewport.width}`);
      if (viewport.width === 1440) {
        await dialog.getByRole("button", { name: "Invite", exact: true }).hover();
        await gm.waitForTimeout(400);
        await shoot(gm, "players-dialog-gm-hover-invite-neutral");
        await gm.mouse.move(0, 0);
        await dialog.getByRole("button", { name: "Close players" }).focus();
        await gm.keyboard.press("Tab");
        await gm.keyboard.press("Shift+Tab");
        await gm.waitForTimeout(400);
        await shoot(gm, "players-dialog-gm-focus-close");
      }
      await dialog.getByRole("button", { name: "Close players" }).click();
    }
  } finally {
    await table.close();
  }
});

/** Every glass button in the HUD with the styles that make its look (for the before / after comparison). */
async function hudFingerprint(page: Page) {
  return page.locator(".hud-root").evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>(".gb")]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          name: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40),
          className: el.className,
          w: Math.round(r.width),
          h: Math.round(r.height),
          color: s.color,
          boxShadow: s.boxShadow,
          backgroundImage: s.backgroundImage,
          borderRadius: s.borderRadius,
          font: `${s.fontWeight} ${s.fontSize} ${s.lineHeight} ${s.fontFamily}`,
          padding: s.padding,
          minHeight: s.minHeight,
          whiteSpace: s.whiteSpace,
        };
      }),
  );
}

test("GLASS-G0 the Combat HUD is unchanged (shots and fingerprint)", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(420_000);
  const label = process.env.GLASS_G0_LABEL ?? "after";
  mkdirSync(OUT, { recursive: true });
  const s = await hudScene(browser);
  const prints: Record<string, unknown> = {};
  try {
    for (const [who, page, viewports] of [
      ["gm", s.gm, [VIEWPORTS[0], VIEWPORTS[1]]],
      ["player", s.player, [VIEWPORTS[0], VIEWPORTS[1], VIEWPORTS[2]]],
    ] as const) {
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.goto(s.url);
        await expect(page.getByTestId("combat-hud")).toBeVisible({ timeout: 30_000 });
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(1500);
        await page.mouse.move(0, 0);
        prints[`${who}-${viewport.width}`] = await hudFingerprint(page);
        await page.screenshot({ path: `${OUT}/hud-${label}-${who}-${viewport.width}.png`, animations: "disabled" });
      }
    }
  } finally {
    await s.close();
  }
  writeFileSync(`${OUT}/hud-fingerprint-${label}.json`, JSON.stringify(prints, null, 2));
});
