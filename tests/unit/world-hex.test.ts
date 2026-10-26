import { describe, expect, it } from "vitest";

import {
  hexCorners,
  hexDistance,
  hexToPixel,
  hexesCovering,
  isAdjacent,
  neighbours,
  pixelToHex,
  roundHex,
  visibleHexKeys,
  type HexGrid,
} from "@/lib/world/hex";
import { initialMapState, playerMapView, type MapState } from "@/lib/world/map-state";

const flat: HexGrid = { originX: 100, originY: 50, size: 20, orientation: "flat" };
const pointy: HexGrid = { ...flat, orientation: "pointy" };

describe("hex grid", () => {
  it("round-trips hex centres in both orientations", () => {
    for (const grid of [flat, pointy]) {
      for (const h of [{ q: 0, r: 0 }, { q: 3, r: -2 }, { q: -4, r: 5 }]) {
        const c = hexToPixel(h, grid);
        expect(pixelToHex(c.x, c.y, grid)).toEqual(h);
        expect(pixelToHex(c.x + grid.size * 0.4, c.y - grid.size * 0.4, grid)).toEqual(h);
      }
    }
  });

  it("places flat hexes 1.5 sizes apart horizontally", () => {
    expect(hexToPixel({ q: 1, r: 0 }, flat)).toEqual({ x: 130, y: 50 + 20 * Math.sqrt(3) * 0.5 });
    expect(hexToPixel({ q: 0, r: 1 }, pointy)).toEqual({ x: 100 + 20 * Math.sqrt(3) * 0.5, y: 80 });
  });

  it("rounds to the nearest hex without negative zero", () => {
    expect(roundHex(-0.1, 0.05)).toEqual({ q: 0, r: 0 });
    expect(Object.is(roundHex(-0.1, 0.05).q, -0)).toBe(false);
  });

  it("has six neighbours at distance 1", () => {
    const ns = neighbours({ q: 2, r: -1 });
    expect(ns).toHaveLength(6);
    for (const n of ns) expect(isAdjacent(n, { q: 2, r: -1 })).toBe(true);
    expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: -1 })).toBe(3);
    expect(isAdjacent({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(false);
  });

  it("has six corners one size from the centre", () => {
    const c = hexToPixel({ q: 1, r: 1 }, flat);
    for (const p of hexCorners({ q: 1, r: 1 }, flat)) expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(20, 6);
  });

  it("covers the image with hexes", () => {
    const hexes = hexesCovering(400, 300, { originX: 0, originY: 0, size: 20, orientation: "flat" });
    const keys = new Set(hexes.map((h) => `${h.q},${h.r}`));
    for (const [x, y] of [[0, 0], [399, 0], [0, 299], [399, 299], [200, 150]]) {
      const h = pixelToHex(x, y, { originX: 0, originY: 0, size: 20, orientation: "flat" });
      expect(keys.has(`${h.q},${h.r}`)).toBe(true);
    }
  });

  it("players see explored hexes, the party's hex and its neighbours", () => {
    const keys = visibleHexKeys([{ q: 5, r: 5 }], { q: 0, r: 0 });
    expect(keys.size).toBe(8);
    expect(keys.has("5,5")).toBe(true);
    expect(keys.has("1,-1")).toBe(true);
    expect(keys.has("2,0")).toBe(false);
  });
});

describe("player map view", () => {
  it("drops hidden markers, blanks notes and filters the hex crawl", () => {
    const base = initialMapState("journey-to-horizon");
    const state: MapState = {
      ...base,
      tokens: [
        { id: 1, type: "city", x: 1, y: 1, name: "Open", notes: "GM secret", hidden: false, location: true },
        { id: 2, type: "cave", x: 2, y: 2, name: "Lair", notes: "", hidden: true, location: false },
      ],
      hexCrawl: {
        ...base.hexCrawl!,
        party: { q: 0, r: 0 },
        hexes: [
          { q: 0, r: 0, explored: true, terrain: 2 },
          { q: 1, r: 0, explored: false, poi: { text: "Hidden shrine", hidden: true } },
          { q: 0, r: 1, explored: false, poi: { text: "Old tower", hidden: false } },
          { q: 9, r: 9, explored: false, terrain: 4, poi: { text: "Far secret", hidden: false } },
          { q: 7, r: 7, explored: true, habitat: "Glacier" },
        ],
        lastMove: { q: 0, r: 0, days: 2, dice: [1, 3], encounter: true },
      },
    };
    const view = playerMapView(state);
    expect(view.tokens).toEqual([{ id: 1, type: "city", x: 1, y: 1, name: "Open", notes: "", hidden: false, location: true }]);
    expect(view.hexCrawl!.lastMove).toBeUndefined();
    expect(view.hexCrawl!.hexes).toEqual([
      { q: 0, r: 0, explored: true, terrain: 2 },
      { q: 1, r: 0, explored: false },
      { q: 0, r: 1, explored: false, poi: { text: "Old tower", hidden: false } },
      { q: 7, r: 7, explored: true, habitat: "Glacier" },
    ]);
    expect(JSON.stringify(view)).not.toMatch(/GM secret|Lair|Hidden shrine|Far secret/);
  });
});
