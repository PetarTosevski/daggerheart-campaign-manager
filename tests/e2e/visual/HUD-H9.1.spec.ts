import path from "node:path";
import { pathToFileURL } from "node:url";

import { test } from "@playwright/test";

// Board renders for docs/tasks/TASK-HUD-H9.1.md (E2E_VISUAL=1): the spotlight disc as the boards draw it (GMDesktop,
// GMTablet, Main, PlayerPhone; CmpTokens 'Spotlight'), beside the app's shots that tests/e2e/hud-spotlight.spec.ts and
// hud-spotlight-light.spec.ts take into test-results/visual/HUD-H9.1 and HUD-SPOTLIGHT-LIGHT.

const OUT = "test-results/visual/HUD-H9.1";
const BOARDS = path.resolve("reference/designs/combat-hud/preview");

test("H9.1 board renders: the spotlight disc", { tag: "@visual" }, async ({ page }) => {
  for (const [board, viewport] of [
    ["GMDesktop", { width: 1440, height: 900 }],
    ["GMTablet", { width: 1024, height: 768 }],
    ["Main", { width: 1440, height: 900 }],
    ["PlayerPhone", { width: 1440, height: 900 }],
  ] as const) {
    await page.setViewportSize(viewport);
    await page.goto(pathToFileURL(path.join(BOARDS, `${board}.dc.html`)).href);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${OUT}/board-${board}.png`, animations: "disabled" });
    const disc = page.locator(".spd, .mspot").first();
    if ((await disc.count()) > 0) {
      await disc.click({ trial: board === "GMDesktop" || board === "GMTablet" ? false : true }).catch(() => undefined);
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT}/board-${board}-spotlight.png`, animations: "disabled" });
    }
  }
});
