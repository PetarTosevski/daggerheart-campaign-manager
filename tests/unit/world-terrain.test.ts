import { describe, expect, it } from "vitest";

import { initialMapState, mapStateSchema } from "@/lib/world/map-state";
import {
  BLANK_TERRAIN,
  TERRAIN_COLUMNS,
  TERRAIN_ROWS,
  WITHERWILD_TERRAIN,
  cellOf,
  paintTerrain,
  suggestedTerrain,
  terrainAt,
  terrainPaths,
  upscaleTerrain,
} from "@/lib/world/terrain";

describe("terrain grid", () => {
  it("doubles a 64 × 49 grid into 128 × 98 cells", () => {
    const half = "r" + "w".repeat(64 * 49 - 1);
    const full = upscaleTerrain(half);
    expect(full).toHaveLength(TERRAIN_COLUMNS * TERRAIN_ROWS);
    expect(full.slice(0, 3)).toBe("rrw");
    expect(full.slice(TERRAIN_COLUMNS, TERRAIN_COLUMNS + 3)).toBe("rrw");
    expect(upscaleTerrain("abc")).toBe("abc");
  });

  it("ships the board's Witherwild terrain and blank Wilds elsewhere", () => {
    expect(WITHERWILD_TERRAIN).toHaveLength(TERRAIN_COLUMNS * TERRAIN_ROWS);
    expect(WITHERWILD_TERRAIN).toMatch(/^[rwdmh.#]+$/);
    expect(WITHERWILD_TERRAIN).toContain("h");
    expect(suggestedTerrain("witherwild")).toBe(WITHERWILD_TERRAIN);
    expect(suggestedTerrain("motherboard")).toBe(BLANK_TERRAIN);
    expect(initialMapState("witherwild").terrain).toBe(WITHERWILD_TERRAIN);
    expect(mapStateSchema.safeParse(initialMapState("witherwild")).success).toBe(true);
  });

  it("looks up cells by map percent, clamped", () => {
    const grid = paintTerrain(BLANK_TERRAIN, 0, 0, 1, "#");
    expect(terrainAt(grid, 0, 0)).toBe("#");
    expect(terrainAt(grid, -5, -5)).toBe("#");
    expect(terrainAt(grid, 50, 50)).toBe("w");
    expect(terrainAt(grid, 100, 100)).toBe("w");
    expect(cellOf(50, 50)).toEqual({ c: 64, r: 49 });
  });

  it("paints a round brush clipped to the grid", () => {
    const one = paintTerrain(BLANK_TERRAIN, 10, 10, 1, "r");
    expect([...one].filter((c) => c === "r")).toHaveLength(1);
    const two = paintTerrain(BLANK_TERRAIN, 10, 10, 2, "m");
    // radius 1.5 in a 3 × 3 square: the full square
    expect([...two].filter((c) => c === "m")).toHaveLength(9);
    const corner = paintTerrain(BLANK_TERRAIN, 0, 0, 2, "h");
    expect([...corner].filter((c) => c === "h")).toHaveLength(4);
  });

  it("encodes runs as SVG paths per terrain", () => {
    const grid = paintTerrain(paintTerrain(BLANK_TERRAIN, 0, 0, 1, "."), 1, 0, 1, ".");
    const paths = terrainPaths(grid);
    expect(paths.x).toBe("M0 0h2v1h-2Z");
    expect(paths.b).toBe("M0 0");
    expect(paths.w.startsWith("M2 0h126v1h-126Z")).toBe(true);
  });
});
