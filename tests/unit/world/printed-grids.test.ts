import { describe, expect, it } from "vitest";

import { PUBLISHED_FRAME_IDS } from "../../../src/lib/frames/index";
import { hexBox, hexCorners, hexToPixel, pixelToHex } from "../../../src/lib/world/hex";
import { HORIZON_FRAME, WORLD_MAPS, initialHexCrawl } from "../../../src/lib/world/map-state";
import { LEGACY_DEFAULT_GRID, PRINTED_HEX_GRIDS, printedHexGrid } from "../../../src/lib/world/printed-grids";

describe("printed hex grids of the built-in maps (dcm-kggd)", () => {
  it("only Journey to Horizon's art prints a hex grid", () => {
    expect(Object.keys(PRINTED_HEX_GRIDS)).toEqual([HORIZON_FRAME]);
    for (const id of PUBLISHED_FRAME_IDS) expect(printedHexGrid(id) !== null).toBe(id === HORIZON_FRAME);
    expect(printedHexGrid("custom")).toBeNull();
  });

  describe("Journey to Horizon", () => {
    const grid = PRINTED_HEX_GRIDS["journey-to-horizon"]!;

    it("pins the measured grid: flat tops, 24.6 px radius, hex (0, 0) in the top-left corner", () => {
      expect(grid).toEqual({ originX: 1.98, originY: 6.05, size: 24.612, sizeY: 24.592, orientation: "flat" });
      expect(WORLD_MAPS[HORIZON_FRAME]).toMatchObject({ width: 3400, height: 2228 });
      const box = hexBox(grid);
      expect(box.width).toBeCloseTo(49.22, 2);
      expect(box.height).toBeCloseTo(42.59, 2);
    });

    it("new crawls start on the printed grid, not the old default", () => {
      expect(initialHexCrawl().grid).toEqual(grid);
      expect(LEGACY_DEFAULT_GRID.size).toBeGreaterThan(grid.size);
    });

    // Centres of printed hexes found one at a time from the lines of that hex and its six neighbours only
    // (not from the whole-map fit the grid came from): the four corners, the middle and a land hex.
    const printed: { hex: { q: number; r: number }; at: [number, number] }[] = [
      { hex: { q: 2, r: 1 }, at: [76.4, 91.4] },
      { hex: { q: 40, r: 5 }, at: [1478.4, 1071.0] },
      { hex: { q: 60, r: 0 }, at: [2217.5, 1283.9] },
      { hex: { q: 90, r: -40 }, at: [3324.5, 219.0] },
      { hex: { q: 4, r: 48 }, at: [149.6, 2135.8] },
      { hex: { q: 88, r: 5 }, at: [3250.6, 2092.9] },
    ];

    it.each(printed)("overlay hex $hex.q,$hex.r sits on the printed hex", ({ hex, at }) => {
      const c = hexToPixel(hex, grid);
      // Within 1.5 px (3% of a hex across) of the printed centre, so outlines sit on the printed lines.
      expect(Math.abs(c.x - at[0])).toBeLessThan(1.5);
      expect(Math.abs(c.y - at[1])).toBeLessThan(1.5);
      // And a click on the printed hex picks that hex.
      expect(pixelToHex(at[0], at[1], grid)).toEqual(hex);
    });

    it("overlay corners land on the printed corners (flat top: corners left and right)", () => {
      const [right, , , left] = hexCorners({ q: 40, r: 5 }, grid);
      expect(right.x - left.x).toBeCloseTo(2 * grid.size, 6);
      expect(right.y).toBeCloseTo(left.y, 6);
    });

    it("the old default grid did not match: its hexes were a third larger and off the printed centres", () => {
      const old = hexToPixel({ q: 40, r: 5 }, LEGACY_DEFAULT_GRID);
      const nearest = hexToPixel(pixelToHex(old.x, old.y, grid), grid);
      expect(LEGACY_DEFAULT_GRID.size / grid.size).toBeGreaterThan(1.3);
      expect(Math.hypot(old.x - nearest.x, old.y - nearest.y)).toBeGreaterThan(3);
    });
  });
});
