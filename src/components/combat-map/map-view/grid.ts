/**
 * The square grid over an uploaded map image (D9 C3, R1: "The GM sizes and aligns the grid over an uploaded
 * image"). Pure, shared by `convex/combatMaps.ts` (attachImage, setGrid) and the client (optimistic size, drawing).
 */

import { MAP_H_MAX, MAP_H_MIN, MAP_W_MAX, MAP_W_MIN } from "../../../lib/domain/combat-map/spec";

/** Square size and offset in image pixels (`combatMaps.image.grid`). */
export type ImageGrid = { readonly cell: number; readonly offsetX: number; readonly offsetY: number };

/** Smallest square size over an image, in image pixels (the board's minimum). */
export const MIN_GRID_CELL = 8;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/**
 * The map's size in squares for an image and its grid: whole squares from the offset on (the board's rule),
 * within the grid bounds (12..44 x 10..32). Squares past the image's edge are drawn dark.
 */
export function imageMapSize(image: { width: number; height: number }, grid: ImageGrid): { w: number; h: number } {
  return {
    w: clamp(Math.floor((image.width - grid.offsetX) / grid.cell), MAP_W_MIN, MAP_W_MAX),
    h: clamp(Math.floor((image.height - grid.offsetY) / grid.cell), MAP_H_MIN, MAP_H_MAX),
  };
}
