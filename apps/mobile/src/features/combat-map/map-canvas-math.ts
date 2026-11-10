/** The dark the board draws around the map and past an uploaded image's edge. */
export const OFF_MAP = "#0b1214";

export type ImageMapRect = { x: number; y: number; w: number; h: number };

/**
 * Where an uploaded image sits, in squares (dcm-gdzi.11): scaled so one grid square is one map square and shifted by
 * the grid offset, inside the map rectangle (0, 0, w, h), never stretched over the fog margin.
 */
export function imageMapRect(grid: { cell: number; offsetX: number; offsetY: number }, image: { width: number; height: number }): ImageMapRect {
  const k = 1 / grid.cell;
  return { x: -grid.offsetX * k, y: -grid.offsetY * k, w: image.width * k, h: image.height * k };
}
