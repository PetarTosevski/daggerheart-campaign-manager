import { mkdirSync, writeFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { hudScene, openMapTools } from "../hud/helpers";
import { gmAndPlayer } from "../live";

// Shots for docs/tasks/TASK-GLASS-GZ.md (E2E_VISUAL=1), the clean-up of the glass buttons roll-out:
// - one page per area as the GM and as a player at 1440 x 900 (and the dashboard at 1024 / 390);
// - the Combat HUD before / after: a style fingerprint of every HUD button GZ could touch (the glass buttons, the
//   dock's Player view and its menu, which kept the old `.cm-btn` look, and the stat block's `trk-btn`s), with
//   screenshots. GLASS_GZ_LABEL=before on rebuild, after on this branch; the two JSON files must be identical.

const OUT = process.env.GLASS_GZ_OUT ?? "test-results/visual/GLASS-GZ";
const DESKTOP = { width: 1440, height: 900 };

async function shoot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
}

const AREAS: [string, string][] = [
  ["dashboard", ""],
  ["party", "/party"],
  ["countdowns", "/countdowns"],
  ["codex", "/codex"],
  ["world", "/world"],
  ["lorekeeper", "/lorekeeper"],
  ["adversaries", "/adversaries"],
  ["journal", "/journal"],
  ["notes", "/notes"],
];

test("GLASS-GZ one page per area as the GM and as a player", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(480_000);
  const table = await gmAndPlayer(browser);
  try {
    for (const [who, page] of [
      ["gm", table.gm],
      ["player", table.player],
    ] as const) {
      await page.setViewportSize(DESKTOP);
      for (const [name, path] of AREAS) {
        await page.goto(`/campaigns/${table.campaignId}${path}`);
        await page.waitForLoadState("networkidle");
        // A page the campaign's frame has not (the World Map, say) is a 404: no shot.
        if ((await page.getByRole("heading", { name: "404" }).count()) > 0) continue;
        await expect(page.locator("[data-viewer]").first()).toBeAttached({ timeout: 30_000 });
        await shoot(page, `${name}-${who}-1440`);
      }
      for (const viewport of [
        { width: 1024, height: 768 },
        { width: 390, height: 844 },
      ]) {
        await page.setViewportSize(viewport);
        await page.goto(`/campaigns/${table.campaignId}`);
        await expect(page.getByRole("heading", { level: 1, name: table.campaignName })).toBeVisible();
        await shoot(page, `dashboard-${who}-${viewport.width}`);
      }
    }
  } finally {
    await table.close();
  }
});

/** The buttons GZ could touch inside the HUD, with the styles that make their look. */
async function hudFingerprint(page: Page) {
  return page.locator(".hud-root").evaluate((root) =>
    [...root.querySelectorAll<HTMLElement>(".gb, .cm-pv-btn, .cm-pv-item, .trk-btn")]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          name: el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40),
          w: Math.round(r.width),
          h: Math.round(r.height),
          color: s.color,
          boxShadow: s.boxShadow,
          background: `${s.backgroundColor} ${s.backgroundImage}`,
          border: `${s.borderTopWidth} ${s.borderTopStyle} ${s.borderTopColor}`,
          borderRadius: s.borderRadius,
          font: `${s.fontWeight} ${s.fontSize} ${s.lineHeight} ${s.fontFamily}`,
          padding: s.padding,
          minHeight: s.minHeight,
          minWidth: s.minWidth,
          gap: s.gap,
          cursor: s.cursor,
          opacity: s.opacity,
          justify: s.justifyContent,
          whiteSpace: s.whiteSpace,
          boxSizing: s.boxSizing,
        };
      }),
  );
}

test("GLASS-GZ the Combat HUD is unchanged (shots and fingerprint)", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(480_000);
  const label = process.env.GLASS_GZ_LABEL ?? "after";
  mkdirSync(OUT, { recursive: true });
  const s = await hudScene(browser);
  const prints: Record<string, unknown> = {};
  try {
    for (const [who, page, viewports] of [
      ["gm", s.gm, [DESKTOP, { width: 1024, height: 768 }]],
      ["player", s.player, [DESKTOP, { width: 1024, height: 768 }, { width: 390, height: 844 }]],
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

    // The GM's dock: Player view open (its menu items), hovered; then a stat block (its trk-btn Use / result buttons).
    const gm = s.gm;
    await gm.setViewportSize(DESKTOP);
    await gm.goto(s.url);
    await expect(gm.getByTestId("combat-hud")).toBeVisible({ timeout: 30_000 });
    await gm.waitForLoadState("networkidle");
    await gm.waitForTimeout(1500);
    const pv = gm.getByRole("button", { name: /Player view/ });
    await pv.hover();
    await gm.waitForTimeout(300);
    prints["gm-pv-hover"] = await hudFingerprint(gm);
    await pv.click();
    await expect(gm.getByRole("menu", { name: "Open the player view as" })).toBeVisible();
    await gm.mouse.move(0, 0);
    await gm.waitForTimeout(300);
    prints["gm-pv-open"] = await hudFingerprint(gm);
    await gm.screenshot({ path: `${OUT}/hud-${label}-gm-pv-open.png`, animations: "disabled" });
    await gm.keyboard.press("Escape");

    const lt = gm.getByRole("region", { name: "Battle map" }).getByRole("button", { name: new RegExp(`^Open the ${s.enemies.lieutenant.name}’s stat block`) });
    await lt.focus();
    await gm.keyboard.press("Enter");
    const block = gm.getByRole("complementary", { name: `${s.enemies.lieutenant.name}’s stat block` });
    await expect(block.getByTestId("hud-statblock-body")).toBeVisible();
    await block.evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((a) => a.finished));
    });
    await gm.mouse.move(0, 0);
    await gm.waitForTimeout(500);
    prints["gm-statblock"] = await hudFingerprint(gm);
    await gm.screenshot({ path: `${OUT}/hud-${label}-gm-statblock.png`, animations: "disabled" });

    // The tools drawer (G10's panels, glass in the HUD too).
    await gm.goto(s.url);
    await openMapTools(gm);
    await gm.mouse.move(0, 0);
    await gm.waitForTimeout(800);
    prints["gm-tools"] = await hudFingerprint(gm);
    await gm.screenshot({ path: `${OUT}/hud-${label}-gm-tools.png`, animations: "disabled" });
  } finally {
    await s.close();
  }
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}/hud-fingerprint-${label}.json`, JSON.stringify(prints, null, 2));
});
