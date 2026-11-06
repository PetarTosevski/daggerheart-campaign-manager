import { describe, expect, it } from "vitest";

import { hexDistance, hexKey, hexToPixel, pixelToHex, remapHex, sameGrid, type HexGrid } from "../../../src/lib/world/hex";
import type { CrawlHex } from "../../../src/lib/world/map-state";
import { LEGACY_DEFAULT_GRID, PRINTED_HEX_GRIDS } from "../../../src/lib/world/printed-grids";
import { remapCrawlScalars, remapHexes, remapToken } from "../../../src/lib/world/recalibrate";

const image = { width: 3400, height: 2228 };
const printed = PRINTED_HEX_GRIDS["journey-to-horizon"]!;
const old = LEGACY_DEFAULT_GRID;

describe("moving a crawl from the old default grid to the printed grid (dcm-kggd)", () => {
  it("each old hex becomes the printed hex holding its centre", () => {
    const h = { q: 30, r: 4 };
    const c = hexToPixel(h, old);
    expect(remapHex(h, old, printed)).toEqual(pixelToHex(c.x, c.y, printed));
  });

  it("no two old hexes over the map land on one printed hex (old hexes are larger)", () => {
    const seen = new Set<string>();
    for (let q = 0; q <= 68; q++)
      for (let r = -Math.ceil(q / 2) - 1; r <= 40; r++) {
        const c = hexToPixel({ q, r }, old);
        if (c.x < 0 || c.y < 0 || c.x > image.width || c.y > image.height) continue;
        const k = hexKey(remapHex({ q, r }, old, printed));
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
    expect(seen.size).toBeGreaterThan(2000);
  });

  it("keeps every hex's fields and merges only true collisions", () => {
    const hexes: CrawlHex[] = [
      { q: 10, r: 3, explored: true, terrain: 2, region: "Ashen Vale" },
      { q: 11, r: 3, explored: false, poi: { text: "Shrine", hidden: true } },
    ];
    const out = remapHexes(hexes, old, printed);
    expect(out).toHaveLength(2);
    expect(out.find((h) => h.region === "Ashen Vale")).toMatchObject(remapHex({ q: 10, r: 3 }, old, printed));
    // A grid with hexes smaller than the printed ones can map two to one: they merge.
    const tiny: HexGrid = { originX: 0, originY: 0, size: 10, orientation: "flat" };
    const merged = remapHexes(
      [
        { q: 0, r: 0, explored: false, habitat: "Forest" },
        { q: 1, r: 0, explored: true, terrain: 3 },
      ],
      tiny,
      printed,
    );
    expect(merged).toEqual([{ q: 0, r: 0, explored: true, habitat: "Forest", terrain: 3 }]);
  });

  it("moves the party, last move and party marker to the printed hex centre; markers snap to theirs", () => {
    const party = { q: 20, r: 2 };
    const crawl = { grid: old, party, lastMove: { q: 20, r: 2, days: 1 } };
    const before = hexToPixel(party, old);
    const { crawl: next, party: marker } = remapCrawlScalars(crawl, { x: 1, y: 1 }, printed, image);
    expect(sameGrid(next.grid, printed)).toBe(true);
    expect(next.party).toEqual(pixelToHex(before.x, before.y, printed));
    expect(next.lastMove).toMatchObject({ ...next.party, days: 1 });
    const c = hexToPixel(next.party!, printed);
    expect(marker.x).toBeCloseTo((c.x / image.width) * 100, 1);
    // Old neighbours stay close (one or two printed hexes apart).
    expect(hexDistance(remapHex({ q: 20, r: 2 }, old, printed), remapHex({ q: 21, r: 2 }, old, printed))).toBeLessThanOrEqual(2);
    const token = remapToken({ id: 1, x: (before.x / image.width) * 100, y: (before.y / image.height) * 100 }, printed, image);
    expect(pixelToHex((token.x / 100) * image.width, (token.y / 100) * image.height, printed)).toEqual(next.party);
    expect(token.id).toBe(1);
  });

  it("a crawl already on the printed grid is left as it is", () => {
    expect(sameGrid({ ...printed }, printed)).toBe(true);
    expect(sameGrid(old, printed)).toBe(false);
  });
});
