import path from "node:path";
import { pathToFileURL } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { hudScene } from "../hud/helpers";

// Shots for docs/tasks/TASK-HUD-H9.0.md (E2E_VISUAL=1): the GM's bottom dock on the real seed (1440 x 900 and
// 1024 x 768; Dice open; a sheet open; Measure), beside the board renders it matches (GMDesktop, GMTablet `.dock`;
// CmpTokensDesign for the colours).

const OUT = "test-results/visual/HUD-H9.0";
const BOARDS = path.resolve("reference/designs/combat-hud/preview");
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
] as const;

async function shoot(page: Page, name: string) {
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
}

test("H9.0 board renders: GMDesktop, GMTablet (the dock)", { tag: "@visual" }, async ({ page }) => {
  for (const [board, viewport] of [
    ["GMDesktop", VIEWPORTS[0]],
    ["GMTablet", VIEWPORTS[1]],
  ] as const) {
    await page.setViewportSize(viewport);
    await page.goto(pathToFileURL(path.join(BOARDS, `${board}.dc.html`)).href);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/board-${board}.png`, animations: "disabled" });
    await page.locator(".dock").first().screenshot({ path: `${OUT}/board-${board}-dock.png`, animations: "disabled" });
  }
});

test("H9.0 the dock on the seed", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player } = s;
  try {
    for (const viewport of VIEWPORTS) {
      await gm.setViewportSize(viewport);
      await gm.goto(s.url);
      const hud = gm.getByTestId("combat-hud");
      await expect(gm.getByRole("list", { name: "The party" }).getByRole("button").first()).toBeVisible({ timeout: 30_000 });
      await hud.evaluate((el) => el.scrollIntoView());
      const dock = gm.getByRole("toolbar", { name: "Map controls" });
      await shoot(gm, `gm-${viewport.width}`);
      await dock.screenshot({ path: `${OUT}/gm-${viewport.width}-dock.png`, animations: "disabled" });
      await dock.getByRole("button", { name: "Dice" }).click();
      await expect(gm.getByRole("dialog", { name: "Dice" })).toBeVisible();
      await shoot(gm, `gm-${viewport.width}-dice`);
      await gm.getByRole("dialog", { name: "Dice" }).press("Escape");
      await gm.getByRole("list", { name: "The party" }).getByRole("button", { name: /^Open Moss/ }).click();
      await expect(hud).toHaveClass(/hud-sh-open/);
      await shoot(gm, `gm-${viewport.width}-sheet`);
    }
    await player.setViewportSize(VIEWPORTS[0]);
    await player.goto(s.url);
    await expect(player.getByRole("toolbar", { name: "Map controls" })).toBeVisible({ timeout: 30_000 });
    await player.getByTestId("combat-hud").evaluate((el) => el.scrollIntoView());
    await shoot(player, "player-1440");
  } finally {
    await s.close();
  }
});
