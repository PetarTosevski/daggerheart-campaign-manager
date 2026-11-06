import { expect, test } from "@jest/globals";

import { initialHexCrawl } from "../../../../../src/lib/world/map-state";
import { WITHERWILD_TERRAIN } from "../../../../../src/lib/world/terrain";
import { MAX_HEX_PATH_NODES, hexPathLayers, terrainPathLayers } from "../../../src/features/world/paths/layers";

test("terrain overlay uses one batched path per terrain type, not one node per cell", () => {
  const layers = terrainPathLayers(WITHERWILD_TERRAIN);
  expect(layers.length).toBeGreaterThan(0);
  expect(layers.length).toBeLessThanOrEqual(9);
  expect(layers.every((layer) => layer.path.startsWith("M"))).toBe(true);
});

test("a 4,000-hex crawl with the whole grid shown is still a fixed handful of Skia Path nodes", () => {
  const hexes = [];
  for (let q = 0; q < 80; q += 1) {
    for (let r = 0; r < 50; r += 1) {
      hexes.push({ q, r, explored: true });
    }
  }
  expect(hexes).toHaveLength(4000);

  const crawl = {
    ...initialHexCrawl(),
    party: { q: 2, r: 2 },
    hexes: [
      ...hexes,
      { q: 9, r: 9, explored: true, poi: { text: "Ruin", hidden: false } },
      { q: 10, r: 9, explored: true, poi: { text: "Hidden ruin", hidden: true } },
    ],
  };

  const layers = hexPathLayers({ crawl, imageWidth: 3400, imageHeight: 2228, showGrid: true });
  expect(layers).toHaveLength(MAX_HEX_PATH_NODES);
  // The whole grid is drawn (it used to be dropped once three layers were in use).
  expect(layers.some((layer) => layer.id.startsWith("hex-grid"))).toBe(true);
  expect(layers.find((layer) => layer.id.startsWith("hex-near"))?.dash).toEqual([4, 3]);
});

test("the overlay is drawn on the printed Horizon grid", () => {
  const crawl = { ...initialHexCrawl(), party: { q: 0, r: 0 }, hexes: [] };
  const party = hexPathLayers({ crawl, imageWidth: 3400, imageHeight: 2228, showGrid: false }).find((layer) => layer.id === "hex-party-0");
  // Hex (0, 0) of the printed grid is centred at (1.98, 6.05) with a 24.612 px radius: its first corner is due east.
  expect(party?.path.startsWith(`M${(1.98 + 24.612).toFixed(1)} ${(6.05).toFixed(1)}`)).toBe(true);
});
