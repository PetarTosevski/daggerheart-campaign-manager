import { hexesCovering, hexesPath, neighbours, type Hex, type HexGrid } from "../../../../../../src/lib/world/hex";
import type { HexCrawl } from "../../../../../../src/lib/world/map-state";
import { TERRAIN_OVERLAY_FILLS } from "../../../../../../src/lib/world/terrain-overlay";
import { terrainPaths, type TerrainPaths } from "../../../../../../src/lib/world/terrain";

export type SkiaPathLayer = { id: string; path: string; fill?: string; stroke?: string; strokeWidth?: number; opacity?: number };

const terrainKeys = Object.keys(TERRAIN_OVERLAY_FILLS) as (keyof TerrainPaths)[];

/** One Skia path per terrain overlay (merged runs from `terrainPaths`), not one node per cell. */
export function terrainPathLayers(terrain: string): SkiaPathLayer[] {
  const paths = terrainPaths(terrain);
  const layers: SkiaPathLayer[] = [];
  for (const key of terrainKeys) {
    const path = paths[key];
    if (!path || path === "M0 0") continue;
    layers.push({ id: `terrain-${key}`, path, fill: TERRAIN_OVERLAY_FILLS[key] });
  }
  return layers;
}

export type HexPathInput = {
  crawl: HexCrawl;
  imageWidth: number;
  imageHeight: number;
  showGrid: boolean;
};

/**
 * Hex crawl overlays batched into at most three path nodes: explored fill, party
 * and neighbours stroke, and POI markers (visible POI only — the server already
 * stripped hidden POI from player maps).
 */
export function hexPathLayers({ crawl, imageWidth, imageHeight, showGrid }: HexPathInput): SkiaPathLayer[] {
  const grid: HexGrid = crawl.grid;
  const explored = crawl.hexes.filter((h) => h.explored);
  const layers: SkiaPathLayer[] = [];

  const exploredPath = hexesPath(explored, grid);
  if (exploredPath) {
    layers.push({
      id: "hex-explored",
      path: exploredPath,
      fill: "rgba(227, 180, 90, 0.28)",
      stroke: "rgba(138, 90, 16, 0.85)",
      strokeWidth: 1.5,
    });
  }

  const accentHexes: Hex[] = [];
  if (crawl.party) {
    accentHexes.push(crawl.party, ...neighbours(crawl.party));
  }
  const accentPath = hexesPath(accentHexes, grid);
  if (accentPath) {
    layers.push({
      id: "hex-party-near",
      path: accentPath,
      fill: crawl.party ? "rgba(227, 180, 90, 0.4)" : undefined,
      stroke: "rgba(138, 90, 16, 0.8)",
      strokeWidth: crawl.party ? 3 : 1.5,
    });
  }

  const poi = crawl.hexes.filter((h) => h.poi);
  const poiPath = hexesPath(poi, { ...grid, size: grid.size * 0.28 });
  if (poiPath) {
    layers.push({ id: "hex-poi", path: poiPath, fill: "#f3cf86", stroke: "#2a1f14", strokeWidth: 1 });
  }

  if (showGrid && layers.length < 3) {
    const gridPath = hexesPath(hexesCovering(imageWidth, imageHeight, grid), grid);
    if (gridPath) {
      layers.push({
        id: "hex-grid",
        path: gridPath,
        stroke: "rgba(60, 36, 12, 0.6)",
        strokeWidth: 1,
      });
    }
  }

  return layers.slice(0, 3);
}

/** Count of Skia `Path` nodes the map canvas would mount for terrain and hex overlays. */
export function countSkiaPathNodes(input: {
  terrain: string | null;
  showTerrain: boolean;
  hex: HexPathInput | null;
}): number {
  let count = 0;
  if (input.showTerrain && input.terrain) count += terrainPathLayers(input.terrain).length;
  if (input.hex) count += hexPathLayers(input.hex).length;
  return count;
}
