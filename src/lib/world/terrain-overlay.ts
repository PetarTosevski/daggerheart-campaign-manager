import type { TerrainPaths } from "./terrain";

/**
 * Overlay fill per terrain path key. The Terrain view and Paint mode share it,
 * so Water (`x`) is tinted blue in both (it was transparent outside Paint mode).
 */
export const TERRAIN_OVERLAY_FILLS: Record<keyof TerrainPaths, string> = {
  h: "rgba(176, 58, 46, 0.42)",
  w: "rgba(70, 150, 80, 0.30)",
  p: "rgba(232, 209, 58, 0.4)",
  d: "rgba(20, 80, 40, 0.55)",
  k: "rgba(240, 122, 30, 0.5)",
  m: "rgba(70, 120, 110, 0.5)",
  r: "rgba(185, 178, 164, 0.6)",
  x: "rgba(63, 134, 224, 0.4)",
  b: "rgba(12, 9, 6, 0.78)",
};
