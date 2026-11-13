import { describe, expect, it } from "vitest";

import { MAX_MAP_H, MAX_MAP_W, MIN_MAP_H, MIN_MAP_W } from "../../convex/lib/combatMaps";
import { MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE, SCALE_STEP, renderScale } from "../../src/lib/combat-map/render-scale";
import { FOG_PAD_SQUARES } from "../../src/lib/domain/combat-map/vision";

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

  // Plan map-editor ME2: maps up to 64 x 64 squares. The map canvas and the GM's editor overlay are 48 px a square at
  // zoom 1 (map-canvas.tsx MAP_CELL, editor-layer.tsx); a player's fog is 12 px a square (vision-layer.tsx FOG_PX) and
  // padded by FOG_PAD_SQUARES on every side, without the board zoom.
  describe("the largest map (64 x 64, ME2)", () => {
    const CELL = 48;
    const FOG_PX = 12;
    const fits = (w: number, h: number, k: number) => w * k <= MAX_CANVAS_SIDE && h * k <= MAX_CANVAS_SIDE && w * k * h * k <= MAX_CANVAS_PIXELS;

    it("is 64 x 64 squares at most", () => {
      expect([MAX_MAP_W, MAX_MAP_H]).toEqual([64, 64]);
      expect([MIN_MAP_W, MIN_MAP_H]).toEqual([12, 10]);
    });

    it("steps the map canvas down to 1 on a 64 x 64 map (3072 px a side: 1.5 would be 21.2 M pixels)", () => {
      const side = MAX_MAP_W * CELL;
      expect(side).toBe(3072);
      for (const device of [1, 1.25, 1.6, 2, 3, 4]) for (const zoom of [0.5, 1, 2, 4]) expect(renderScale(device, zoom, side, side)).toBe(1);
      expect(fits(side, side, 1)).toBe(true);
      expect(fits(side, side, 1.5)).toBe(false);
    });

    it("keeps 1.5 on a 64 x 48 map (4608 x 3456 = 15.9 M pixels fits, 2 would be 28.3 M)", () => {
      expect(renderScale(2, 1, 64 * CELL, 48 * CELL)).toBe(1.5);
      expect(renderScale(1.25, 1, 64 * CELL, 48 * CELL)).toBe(1.5);
      expect(renderScale(1, 1, 64 * CELL, 48 * CELL)).toBe(1);
    });

    it("keeps a player's padded fog sharp on a 64 x 64 map: (64 + 2 x 24) x 12 = 1344 px, up to 3", () => {
      const side = (MAX_MAP_W + 2 * FOG_PAD_SQUARES) * FOG_PX;
      expect(side).toBe(1344);
      expect(renderScale(2, 1, side, side)).toBe(2);
      expect(renderScale(3, 1, side, side)).toBe(3); // 4032 x 4032 = 16.26 M fits
      expect(renderScale(4, 1, side, side)).toBe(3); // 3.5 would be 22.1 M
    });

    it("never passes the caps for any map size up to 64 x 64, any screen and any zoom", () => {
      for (let w = MIN_MAP_W; w <= MAX_MAP_W; w += 4) {
        for (let h = MIN_MAP_H; h <= MAX_MAP_H; h += 6) {
          for (const device of [1, 1.5, 2, 3, 4]) {
            for (const zoom of [1, 2, 4]) {
              const map = renderScale(device, zoom, w * CELL, h * CELL);
              expect(fits(w * CELL, h * CELL, map)).toBe(true);
              const fog = { w: (w + 2 * FOG_PAD_SQUARES) * FOG_PX, h: (h + 2 * FOG_PAD_SQUARES) * FOG_PX };
              expect(fits(fog.w, fog.h, renderScale(device, 1, fog.w, fog.h))).toBe(true);
            }
          }
        }
      }
      // The corner case itself (64 x 64), which the steps above skip.
      expect(fits(MAX_MAP_W * CELL, MAX_MAP_H * CELL, renderScale(4, 4, MAX_MAP_W * CELL, MAX_MAP_H * CELL))).toBe(true);
    });
  });
});
