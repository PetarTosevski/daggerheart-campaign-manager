import { expect, test } from "@playwright/test";

import { hudScene } from "../hud/helpers";

// Shots for docs/tasks/TASK-HUD-H9.A.md (E2E_VISUAL=1): the Combat Map app bar for the GM and the player at 1440 × 900
// and 1024 × 768, the whole page at 1440, and the phone's art header at 390. Board renders to compare:
// reference/designs/combat-hud/preview/GMDesktop.dc.html, GMTablet.dc.html, Main.dc.html, PlayerTablet.dc.html.

const OUT = "test-results/visual/HUD-H9.A";

test("HUD-H9.A the Combat Map app bar", { tag: "@visual" }, async ({ browser }) => {
  test.setTimeout(300_000);
  const s = await hudScene(browser);
  const { gm, player } = s;
  try {
    for (const [page, who] of [
      [gm, "gm"],
      [player, "player"],
    ] as const) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(s.url);
      const bar = page.getByTestId("app-bar");
      await expect(page.getByTestId("combat-hud")).toBeVisible();
      await expect(bar.getByTestId("app-bar-live")).toBeVisible();
      await bar.screenshot({ path: `${OUT}/${who}-bar-1440.png`, animations: "disabled" });
      await page.screenshot({ path: `${OUT}/${who}-page-1440.png`, animations: "disabled" });
      await page.setViewportSize({ width: 1024, height: 768 });
      await expect.poll(async () => Math.round((await bar.boundingBox())!.height)).toBe(52);
      await bar.screenshot({ path: `${OUT}/${who}-bar-1024.png`, animations: "disabled" });
      await page.screenshot({ path: `${OUT}/${who}-page-1024.png`, animations: "disabled" });
    }
    await gm.setViewportSize({ width: 1440, height: 900 });
    await gm.getByTestId("app-bar").getByRole("button", { name: "Campaign settings" }).click();
    await expect(gm.getByRole("dialog", { name: "Campaign settings" })).toBeVisible();
    await gm.screenshot({ path: `${OUT}/gm-settings-1440.png`, animations: "disabled" });
    await gm.keyboard.press("Escape");
    await gm.getByTestId("app-bar").getByRole("button", { name: "Full screen: hide the app bar" }).click();
    await expect(gm.getByRole("button", { name: "Show the app bar" })).toBeVisible();
    await gm.screenshot({ path: `${OUT}/gm-full-screen-1440.png`, animations: "disabled" });
    await gm.keyboard.press("Escape");
    await gm.setViewportSize({ width: 390, height: 844 });
    await expect(gm.getByRole("region", { name: "Campaign header" })).toBeVisible();
    await gm.screenshot({ path: `${OUT}/gm-phone-390.png`, animations: "disabled" });
  } finally {
    await s.close();
  }
});
