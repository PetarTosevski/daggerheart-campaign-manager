/**
 * Painted cells of a combat map (D9 C3): the one decoder from `combatMapCells` rows to the shapes the painter
 * (C2: `PaintedTerrain`) and the vision engine (C1: `prepareMap`'s `paint` and `block`, `createView`'s `fog`) take.
 * Pure TypeScript with no React and no Convex imports, so the client (C3, C5, C8) and the server (C7, by import)
 * decode the same way.
 *
 * Encoding (C0, `convex/lib/combatMaps.ts`, which keeps the server's copy of these constants; the C3 Convex test
 * checks the two agree): a layer is stored in tiles of `CELL_TILE_ROWS` map rows; tile `t` holds rows
 * `t * CELL_TILE_ROWS` up to the next tile, one character per square, row by row (`CELL_TILE_ROWS * w`
 * characters). Codes: `.` unpainted; terrain `a`..`n` = `TERRAINS[i]` (C1, the board's order); block `#`;
 * fog `r` reveal / `h` hide.
 */

import { TERRAINS, type Terrain } from "../../../lib/domain/combat-map/spec";
import type { FogMark } from "../../../lib/domain/combat-map/vision";

export const CELL_TILE_ROWS = 8;
export const CELL_UNPAINTED = ".";
export const TERRAIN_CODES = "abcdefghijklmn";
export const BLOCK_CODE = "#";
export const FOG_REVEAL = "r";
export const FOG_HIDE = "h";

export type CellLayer = "terrain" | "block" | "fog";

/** A stored tile as the layout queries return it (`combatMapCells` without ids). */
export type CellTile = { readonly layer: CellLayer; readonly tile: number; readonly cells: string };

/** Every layer decoded, keyed by square: `cellKey(x, y)` = "x,y" (the painter's `paintKey`, C1's square keys). */
export type DecodedCells = {
  /** Hand-painted terrain: C2 `paintMap(..., { paint })` and C1 `prepareMap({ paint })`. */
  paint: Record<string, Terrain>;
  /** Painted sight blockers: C1 `prepareMap({ block })`. */
  block: Set<string>;
  /** The GM's fog marks (R12): C1 `createView(..., { fog })`. */
  fog: Record<string, FogMark>;
};

export const cellKey = (x: number, y: number): string => `${x},${y}`;

/** The terrain a code stands for, or null (unpainted or unknown code). */
export function terrainOfCode(code: string): Terrain | null {
  const i = code.length === 1 ? TERRAIN_CODES.indexOf(code) : -1;
  return i >= 0 ? (TERRAINS[i] ?? null) : null;
}

/** The code of a terrain. */
export function codeOfTerrain(terrain: Terrain): string {
  return TERRAIN_CODES[TERRAINS.indexOf(terrain)]!;
}

/** The tile holding map row `y`. */
export const tileOf = (y: number): number => Math.floor(y / CELL_TILE_ROWS);

/** The index of square (x, y) inside its tile's `cells` string, for a map `w` squares wide. */
export const indexInTile = (x: number, y: number, w: number): number => (y - tileOf(y) * CELL_TILE_ROWS) * w + x;

/**
 * Decodes a map's tiles (any layers, any order) for a map of `w` x `h` squares. Squares outside the map (a tile
 * longer than the map, rows below `h`) and unknown codes are ignored, so a resized map never paints off its edge.
 */
export function decodeCells(tiles: readonly CellTile[], w: number, h: number): DecodedCells {
  const out: DecodedCells = { paint: {}, block: new Set(), fog: {} };
  for (const { layer, tile, cells } of tiles) {
    const top = tile * CELL_TILE_ROWS;
    for (let i = 0; i < cells.length; i++) {
      const code = cells[i]!;
      if (code === CELL_UNPAINTED) continue;
      const x = i % w;
      const y = top + Math.floor(i / w);
      if (y < 0 || y >= h || x >= w) continue;
      const key = cellKey(x, y);
      if (layer === "terrain") {
        const terrain = terrainOfCode(code);
        if (terrain !== null) out.paint[key] = terrain;
      } else if (layer === "block") {
        if (code === BLOCK_CODE) out.block.add(key);
      } else if (code === FOG_REVEAL) out.fog[key] = "reveal";
      else if (code === FOG_HIDE) out.fog[key] = "hide";
    }
  }
  return out;
}
