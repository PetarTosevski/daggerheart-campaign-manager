import { hexesCovering, hexesPath, neighbours, scaleGrid, type HexGrid } from "../../../../../../src/lib/world/hex";
import type { HexCrawl } from "../../../../../../src/lib/world/map-state";
import { TERRAIN_OVERLAY_FILLS } from "../../../../../../src/lib/world/terrain-overlay";
import { terrainPaths, type TerrainPaths } from "../../../../../../src/lib/world/terrain";

/**
 * One Skia draw: an SVG path drawn either filled or stroked. Stroke widths and dashes are in screen pixels (the
 * website's `vector-effect: non-scaling-stroke`); the canvas divides them by the map's scale.
 */
export type SkiaPathLayer = {
  id: string;
  path: string;
  style: "fill" | "stroke";
  color: string;
  strokeWidth?: number;
  dash?: readonly [number, number];
};

const terrainKeys = Object.keys(TERRAIN_OVERLAY_FILLS) as (keyof TerrainPaths)[];

/** One Skia path per terrain overlay (merged runs from `terrainPaths`), not one node per cell. */
export function terrainPathLayers(terrain: string): SkiaPathLayer[] {
  const paths = terrainPaths(terrain);
  const layers: SkiaPathLayer[] = [];
  for (const key of terrainKeys) {
    const path = paths[key];
    if (!path || path === "M0 0") continue;
    layers.push({ id: `terrain-${key}`, path, style: "fill", color: TERRAIN_OVERLAY_FILLS[key] });
  }
  return layers;
}

export type HexPathInput = {
  crawl: HexCrawl;
  imageWidth: number;
  imageHeight: number;
  showGrid: boolean;
};

/** Marker hexes for points of interest: 0.28 of a grid hex, as on the website's map view. */
const POI_SCALE = 0.28;

/**
 * The hex crawl overlay as the website draws it (`world/map-view.tsx`): the whole grid (when shown), explored hexes,
 * the party's neighbours (dashed), the party's hex, and points of interest (hidden ones only reach the GM). Each layer
 * is one merged path whatever the hex count, so a 4,000-hex crawl is still a handful of Skia nodes.
 */
export function hexPathLayers({ crawl, imageWidth, imageHeight, showGrid }: HexPathInput): SkiaPathLayer[] {
  const grid: HexGrid = crawl.grid;
  const layers: SkiaPathLayer[] = [];
  const add = (id: string, path: string, draws: Omit<SkiaPathLayer, "id" | "path">[]) => {
    if (!path) return;
    draws.forEach((draw, i) => layers.push({ id: `${id}-${i}`, path, ...draw }));
  };

  if (showGrid) {
    add("hex-grid", hexesPath(hexesCovering(imageWidth, imageHeight, grid), grid), [
      { style: "stroke", color: "rgba(60, 36, 12, 0.6)", strokeWidth: 1 },
    ]);
  }
  add(
    "hex-explored",
    hexesPath(
      crawl.hexes.filter((h) => h.explored),
      grid,
    ),
    [
      { style: "fill", color: "rgba(227, 180, 90, 0.28)" },
      { style: "stroke", color: "rgba(138, 90, 16, 0.85)", strokeWidth: 1.5 },
    ],
  );
  if (crawl.party) {
    add("hex-near", hexesPath(neighbours(crawl.party), grid), [
      { style: "stroke", color: "rgba(138, 90, 16, 0.8)", strokeWidth: 1.5, dash: [4, 3] },
    ]);
    add("hex-party", hexesPath([crawl.party], grid), [
      { style: "fill", color: "rgba(227, 180, 90, 0.4)" },
      { style: "stroke", color: "#8a5a10", strokeWidth: 3 },
    ]);
  }
  const poiGrid = scaleGrid(grid, POI_SCALE);
  add(
    "hex-poi",
    hexesPath(
      crawl.hexes.filter((h) => h.poi),
      poiGrid,
    ),
    [
      { style: "fill", color: "#f3cf86" },
      { style: "stroke", color: "#2a1f14", strokeWidth: 1 },
    ],
  );
  add(
    "hex-hidden-poi",
    hexesPath(
      crawl.hexes.filter((h) => h.poi?.hidden),
      poiGrid,
    ),
    [
      { style: "fill", color: "#5a2a6a" },
      { style: "stroke", color: "#f3cf86", strokeWidth: 1 },
    ],
  );
  return layers;
}

/** Most Skia `Path` nodes the hex overlay can mount: grid 1, explored 2, near 1, party 2, POI 2, hidden POI 2. */
export const MAX_HEX_PATH_NODES = 10;
