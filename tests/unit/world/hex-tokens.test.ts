import { describe, expect, it } from "vitest";

import { hexBox, hexCorners, hexToPixel, pixelToHex, type HexGrid } from "../../../src/lib/world/hex";
import { HEX_SLOTS, hexPoints, layoutHexTokens } from "../../../src/lib/world/hex-tokens";
import { PRINTED_HEX_GRIDS } from "../../../src/lib/world/printed-grids";

const image = { width: 3400, height: 2228 };
const grid = PRINTED_HEX_GRIDS["journey-to-horizon"]!;
const pct = (h: { q: number; r: number }, g: HexGrid = grid) => {
  const c = hexToPixel(h, g);
  return { x: (c.x / image.width) * 100, y: (c.y / image.height) * 100 };
};
const px = (p: { x: number; y: number }) => ({ x: (p.x / 100) * image.width, y: (p.y / 100) * image.height });

describe("hex markers (dcm-kggd)", () => {
  it("a marker alone fills exactly its printed hex, centred on it", () => {
    const at = pct({ q: 40, r: 5 });
    // Stored positions are rounded to 0.01 %: the marker still lands on the exact hex centre.
    const place = layoutHexTokens([{ key: "1", x: Math.round(at.x * 100) / 100, y: Math.round(at.y * 100) / 100 }], grid, image).get("1")!;
    expect(place.hex).toEqual({ q: 40, r: 5 });
    expect(place.x).toBeCloseTo(at.x, 9);
    expect(place.y).toBeCloseTo(at.y, 9);
    const box = hexBox(grid);
    expect((place.width / 100) * image.width).toBeCloseTo(box.width, 9);
    expect((place.height / 100) * image.height).toBeCloseTo(box.height, 9);
    expect(place.slot).toBe(0);
    expect(place.shared).toBe(false);
  });

  it("the box spans the hex's corners: flat tops are corner to corner wide and flat to flat tall", () => {
    const corners = hexCorners({ q: 3, r: 2 }, grid);
    const xs = corners.map((c) => c.x);
    const ys = corners.map((c) => c.y);
    const box = hexBox(grid);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(box.width, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(box.height, 9);
    const pointy: HexGrid = { originX: 0, originY: 0, size: 20, orientation: "pointy" };
    const pc = hexCorners({ q: 0, r: 0 }, pointy);
    expect(Math.max(...pc.map((c) => c.y)) - Math.min(...pc.map((c) => c.y))).toBeCloseTo(hexBox(pointy).height, 9);
    expect(Math.max(...pc.map((c) => c.x)) - Math.min(...pc.map((c) => c.x))).toBeCloseTo(hexBox(pointy).width, 9);
  });

  it("the drawn outline matches the grid's hex in its box (flat and pointy)", () => {
    const flat = hexPoints("flat", 100, 100 * (Math.sqrt(3) / 2)).split(" ").map((p) => p.split(",").map(Number));
    expect(flat[0]).toEqual([100, 43.3]);
    expect(flat[3]).toEqual([0, 43.3]);
    expect(Math.min(...flat.map((p) => p[1]))).toBeCloseTo(0, 1);
    const pointy = hexPoints("pointy", 100 * (Math.sqrt(3) / 2), 100).split(" ").map((p) => p.split(",").map(Number));
    expect(Math.min(...pointy.map((p) => p[1]))).toBeCloseTo(0, 1);
    expect(Math.max(...pointy.map((p) => p[0]))).toBeCloseTo(86.6, 1);
  });

  it("markers sharing a hex become a flower of third-size hexes inside it, the first (the party) in the centre", () => {
    const at = pct({ q: 10, r: 10 });
    const items = Array.from({ length: 7 }, (_, i) => ({ key: i === 0 ? "party" : String(i), ...at }));
    const places = layoutHexTokens(items, grid, image);
    const centre = hexToPixel({ q: 10, r: 10 }, grid);
    const party = places.get("party")!;
    expect(party.slot).toBe(0);
    expect(px(party).x).toBeCloseTo(centre.x, 6);
    const box = hexBox(grid);
    const seen = new Set<string>();
    for (const [key, p] of places) {
      expect((p.width / 100) * image.width).toBeCloseTo(box.width / 3, 6);
      // Every sub-hex lies inside the hex: its centre plus its own radius stays within the hex.
      const c = px(p);
      expect(pixelToHex(c.x, c.y, grid)).toEqual({ q: 10, r: 10 });
      const d = Math.hypot((c.x - centre.x) / grid.size, (c.y - centre.y) / grid.sizeY!);
      expect(d).toBeLessThanOrEqual(Math.sqrt(3) / 3 + 1e-9);
      seen.add(`${c.x.toFixed(3)},${c.y.toFixed(3)}`);
      expect(p.shared).toBe(true);
      if (key !== "party") expect(p.slot).toBeGreaterThan(0);
    }
    // Seven distinct spots: none hides another.
    expect(seen.size).toBe(7);
  });

  it("past seven, the rest stack on the centre and the centre marker counts them", () => {
    const at = pct({ q: 5, r: 5 });
    const items = Array.from({ length: HEX_SLOTS + 2 }, (_, i) => ({ key: String(i), ...at }));
    const places = layoutHexTokens(items, grid, image);
    expect(places.get("0")!.stacked).toBe(2);
    expect(places.get("7")!.slot).toBe(0);
    expect(places.get("8")!.slot).toBe(0);
    expect(places.get("1")!.stacked).toBe(0);
  });

  it("markers in different hexes stay whole and apart", () => {
    const places = layoutHexTokens(
      [
        { key: "party", ...pct({ q: 1, r: 1 }) },
        { key: "1", ...pct({ q: 2, r: 1 }) },
      ],
      grid,
      image,
    );
    expect(places.get("party")!.hex).toEqual({ q: 1, r: 1 });
    expect(places.get("1")!.hex).toEqual({ q: 2, r: 1 });
    expect(places.get("1")!.slot).toBe(0);
    expect((places.get("1")!.width / 100) * image.width).toBeCloseTo(hexBox(grid).width, 6);
  });
});
