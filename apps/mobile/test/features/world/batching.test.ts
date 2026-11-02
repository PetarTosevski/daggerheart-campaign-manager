import { expect, test } from "@jest/globals";

import { initialHexCrawl } from "../../../../../src/lib/world/map-state";
import { WITHERWILD_TERRAIN } from "../../../../../src/lib/world/terrain";
import { countSkiaPathNodes, hexPathLayers, terrainPathLayers } from "../../../src/features/world/paths/layers";

test("terrain overlay uses one batched path per terrain type, not one node per cell", () => {
  const layers = terrainPathLayers(WITHERWILD_TERRAIN);
  expect(layers.length).toBeGreaterThan(0);
  expect(layers.length).toBeLessThanOrEqual(9);
  expect(layers.every((layer) => layer.path.startsWith("M"))).toBe(true);
});

test("a 4,000-hex fixture draws as at most 3 Skia Path nodes", () => {
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
    hexes: [...hexes, { q: 9, r: 9, explored: true, poi: { text: "Hidden ruin", hidden: false } }],
  };

  const layers = hexPathLayers({
    crawl,
    imageWidth: 3400,
    imageHeight: 2228,
    showGrid: true,
  });
  expect(layers.length).toBeLessThanOrEqual(3);

  const nodes = countSkiaPathNodes({
    terrain: null,
    showTerrain: false,
    hex: { crawl, imageWidth: 3400, imageHeight: 2228, showGrid: true },
  });
  expect(nodes).toBeLessThanOrEqual(3);
});
