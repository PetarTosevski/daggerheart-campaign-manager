import { describe, expect, it } from "vitest";

import { MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE, SCALE_STEP, renderScale } from "../../src/lib/combat-map/render-scale";

// A small map at the board's 48 px squares.
const W = 22 * 48;
const H = 16 * 48;

describe("renderScale", () => {
  it("rounds devicePixelRatio x root zoom x board zoom UP to a 0.5 step", () => {
    expect(SCALE_STEP).toBe(0.5);
    expect(renderScale(2 * 0.8, 1, W, H)).toBe(2); // 4K at 200 %, mouse screen: 1.6 -> 2
    expect(renderScale(1.5 * 0.8, 1, W, H)).toBe(1.5); // 1.2 -> 1.5
    expect(renderScale(1.25, 1, W, H)).toBe(1.5);
    expect(renderScale(2, 1, W, H)).toBe(2); // exact steps stay
    expect(renderScale(2 * 0.8, 1.25, W, H)).toBe(2); // 2.0000000000000004 is still 2
    expect(renderScale(1.5, 1.4, W, H)).toBe(2.5); // 2.1 -> 2.5
    expect(renderScale(3, 1, W, H)).toBe(3);
  });

  it("is at least 1 and adds nothing for a board zoom below 1", () => {
    expect(renderScale(0.8, 1, W, H)).toBe(1); // a 1x mouse screen: as before
    expect(renderScale(0.72, 1, W, H)).toBe(1);
    expect(renderScale(1, 0.5, W, H)).toBe(1);
    expect(renderScale(2, 0.4, W, H)).toBe(2);
    expect(renderScale(2 * 0.8, 0.9, W, H)).toBe(2);
    expect(renderScale(1, 2, W, H)).toBe(2); // zoomed in on a 1x screen
  });

  it("treats bad inputs as 1", () => {
    expect(renderScale(Number.NaN, 1, W, H)).toBe(1);
    expect(renderScale(0, 1, W, H)).toBe(1);
    expect(renderScale(-2, 1, W, H)).toBe(1);
    expect(renderScale(2, Number.NaN, W, H)).toBe(2);
    expect(renderScale(2, Number.POSITIVE_INFINITY, W, H)).toBe(2);
  });

  it("caps the side at MAX_CANVAS_SIDE, keeping the largest step that fits", () => {
    expect(MAX_CANVAS_SIDE).toBe(8192);
    // 100 squares wide, 4 high: 4800 px. 1.5 -> 7200 fits, 2 -> 9600 does not.
    expect(renderScale(4, 1, 100 * 48, 4 * 48)).toBe(1.5);
    // Exactly on the cap fits: 4096 x 2 = 8192.
    expect(renderScale(2, 1, 4096, 10)).toBe(2);
    expect(renderScale(2.5, 1, 4096, 10)).toBe(2);
  });

  it("caps the pixel count at MAX_CANVAS_PIXELS, keeping the largest step that fits", () => {
    expect(MAX_CANVAS_PIXELS).toBe(4096 * 4096);
    // 40 x 30 squares (1920 x 1440): 2 -> 11.1 M fits, 2.5 -> 17.3 M does not.
    expect(renderScale(1.5 * 0.8, 2, 40 * 48, 30 * 48)).toBe(2);
    // 2048 x 2048 at 2 is exactly 4096 x 4096: fits.
    expect(renderScale(3, 1, 2048, 2048)).toBe(2);
  });

  it("keeps 1 for a canvas too big even at 1", () => {
    expect(renderScale(2, 1, 10_000, 10)).toBe(1);
    expect(renderScale(2, 1, 5000, 5000)).toBe(1);
  });
});
