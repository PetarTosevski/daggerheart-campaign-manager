import type { CDPSession, Page } from "@playwright/test";

import { TEXT_SIZE_ZOOM } from "../../src/lib/config/preferences";

/**
 * The website's root zoom as screen pixels per CSS pixel (dcm-1i3z, dcm-jkxa: 0.8 on mouse screens, 1 on touch; Text
 * size 0.72 / 0.92, touch 0.9 / 1.15). A spec that turns a CSS length (a 48 px map square, a 44 px touch floor) into
 * mouse moves or bounding boxes multiplies by it. Measured like the app's `rootScale` (src/lib/css-zoom.ts).
 */
export async function rootZoom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const html = document.documentElement;
    const width = html.getBoundingClientRect().width;
    return html.offsetWidth > 0 && width > 0 ? width / html.offsetWidth : 1;
  });
}

/** One map square in screen pixels: 48 CSS px times the board's zoom (its "combat-zoom" readout) times the root zoom. */
export async function squarePx(page: Page): Promise<number> {
  const text = (await page.getByTestId("combat-zoom").textContent()) ?? "100%";
  return 48 * (Number.parseInt(text, 10) / 100) * (await rootZoom(page));
}

/**
 * The 44 CSS px touch floor in screen pixels on a mouse screen at the default Text size (44 x 0.8), with half a pixel
 * of slack for fractional boxes; for specs that check a bounding box directly in a desktop browser narrowed to phone
 * width. A spec under `emulateTouch` (zoom 1) checks 44 itself.
 */
export const TOUCH_FLOOR_ON_SCREEN = 44 * TEXT_SIZE_ZOOM.desktop.medium - 0.5;

/**
 * Makes `page` a touch screen (`(pointer: coarse)`, `(hover: none)`; Chromium's touch emulation, as Playwright's
 * `hasTouch` does for a whole context): zoom 1 and the breakpoints as written (dcm-jkxa), like a phone or a tablet.
 * Lasts across navigations; `false` turns it off again. Mouse input (click, page.mouse) keeps working.
 */
export async function emulateTouch(page: Page, enabled = true): Promise<void> {
  // One CDP session per page: emulation is held per session, so a second session couldn't turn the first one's off.
  let cdp = sessions.get(page);
  if (!cdp) {
    cdp = await page.context().newCDPSession(page);
    sessions.set(page, cdp);
  }
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled, maxTouchPoints: 5 });
}

const sessions = new WeakMap<Page, CDPSession>();

/**
 * The same signed-in user on a real touch screen: a new `hasTouch` context with `page`'s cookies and storage, at
 * `viewport`. For specs whose pages come from a shared fixture; close its context when done.
 */
export async function touchTwin(page: Page, viewport: { width: number; height: number }): Promise<Page> {
  const browser = page.context().browser();
  if (!browser) throw new Error("touchTwin: the page has no browser");
  const context = await browser.newContext({ hasTouch: true, viewport, storageState: await page.context().storageState() });
  return context.newPage();
}
