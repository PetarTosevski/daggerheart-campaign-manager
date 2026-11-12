import { chromium, expect, test, type Page } from "@playwright/test";

import { hudScene } from "./hud/helpers";

// The battle map's zoom stays where the viewer puts it, with classic scrollbars too (Windows with a mouse): zooming in
// from Fit makes the viewport's scrollbars appear, which shrinks its inner size but is not a resize, so the map must not
// refit (it snapped back to Fit about a frame later). Playwright hides scrollbars by default, so this spec launches its
// own browser with them shown. The Zoom buttons and Ctrl + scroll for the GM and for a player; a real resize still refits.

test.use({ actionTimeout: 30_000 });

const zoomOf = async (page: Page) => Number.parseInt((await page.getByTestId("combat-zoom").textContent()) ?? "0", 10);

/** The zoom after it has had time to snap back. */
async function settledZoom(page: Page) {
  await page.waitForTimeout(1000);
  return zoomOf(page);
}

test("zoom stays after Zoom in and Ctrl + scroll with classic scrollbars; a resize refits", async () => {
  test.setTimeout(300_000);
  const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
  const s = await hudScene(browser);
  try {
    for (const page of [s.gm, s.player]) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(s.url);
      await expect(page.getByTestId("combat-hud")).toBeVisible();
      const board = page.getByRole("region", { name: "Battle map" });
      await expect(board.getByTestId("combat-map-canvas")).toBeVisible();
      const controls = page.getByRole("toolbar", { name: "Map controls" });
      const fitted = await settledZoom(page);

      await controls.getByRole("button", { name: "Zoom in" }).click();
      await expect.poll(() => zoomOf(page)).toBeGreaterThan(fitted);
      const zoomedIn = await settledZoom(page);
      expect(zoomedIn).toBeGreaterThan(fitted);

      const vp = (await board.getByTestId("combat-viewport").boundingBox())!;
      await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, -100);
      await page.keyboard.up("Control");
      await expect.poll(() => zoomOf(page)).toBeGreaterThan(zoomedIn);
      expect(await settledZoom(page)).toBeGreaterThan(zoomedIn);

      await controls.getByRole("button", { name: "Zoom out" }).click();
      await controls.getByRole("button", { name: "Zoom out" }).click();
      await controls.getByRole("button", { name: "Zoom out" }).click();
      expect(await settledZoom(page)).toBeLessThan(fitted);

      // A real resize of the viewport refits the map.
      await page.setViewportSize({ width: 1280, height: 800 });
      await expect.poll(() => zoomOf(page)).toBeGreaterThan((fitted * 3) / 4);
    }
  } finally {
    await s.close();
    await browser.close();
  }
});
