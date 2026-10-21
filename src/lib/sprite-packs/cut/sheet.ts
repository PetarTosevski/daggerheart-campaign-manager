/**
 * cutSheet (sprite packs P2): an RGBA sheet -> trimmed, transparent sprite
 * cuts in reading order, plus what the cutter had to fix.
 *
 * Pipeline: key magenta (or keep the sheet's own transparency) -> remove
 * drawn grid lines -> erode + despill -> find objects -> trim each one.
 */

import { findCells } from "./cells";
import { defringe, keyMagenta } from "./key";
import { removeGridLines } from "./lines";
import { crop, withMargin } from "./trim";
import { SHEET_GRIDS } from "./types";
import type { CutFlag, RgbaImage, SheetCut, SheetGrid, SheetKind, SpriteCut } from "./types";

export interface CutOptions {
  /** "props" (4 x 4), "large" (3 x 3), an explicit grid, or "single" (the whole image is one sprite). */
  layout: SheetKind | SheetGrid | "single";
}

/** Assert the buffer shape (programming error otherwise). */
export function assertRgba(img: RgbaImage): void {
  if (!Number.isInteger(img.width) || !Number.isInteger(img.height) || img.width <= 0 || img.height <= 0)
    throw new Error(`cut: bad image size ${img.width} x ${img.height}`);
  if (img.data.length !== img.width * img.height * 4)
    throw new Error(`cut: data length ${img.data.length} is not ${img.width} x ${img.height} x 4`);
}

/** Cut an object sheet (props / large / any grid) or a single sprite. The input is not changed. */
export function cutSheet(img: RgbaImage, options: CutOptions): SheetCut {
  assertRgba(img);
  const grid: SheetGrid | null =
    options.layout === "single"
      ? null
      : typeof options.layout === "string"
        ? SHEET_GRIDS[options.layout]
        : options.layout;
  const expected = grid ? grid.rows * grid.cols : 1;
  const flags: CutFlag[] = [];

  const { image, alreadyTransparent } = keyMagenta(img);
  let fringe = { before: 0, after: 0 };
  if (alreadyTransparent) flags.push({ code: "already-transparent" });
  else {
    const lines = removeGridLines(image);
    if (lines.rows.length > 0 || lines.cols.length > 0)
      flags.push({ code: "lines-removed", rows: lines.rows, cols: lines.cols });
    fringe = defringe(image).fringe;
  }

  const cells = findCells(image, grid);
  if (cells.method === "components") flags.push({ code: "components-fallback" });
  const { width: w, height: h } = image;
  const sprites: SpriteCut[] = cells.clusters.map((c, index) => {
    // Bounds of every pixel this object owns (soft edges included).
    let x0 = w;
    let y0 = h;
    let x1 = -1;
    let y1 = -1;
    const own = index + 1;
    for (let y = Math.max(0, c.y0 - 3); y <= Math.min(h - 1, c.y1 + 3); y++)
      for (let x = Math.max(0, c.x0 - 3); x <= Math.min(w - 1, c.x1 + 3); x++)
        if (cells.owner[y * w + x] === own) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
    const bounds = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    const box = withMargin(bounds);
    const touchesBorder = x0 <= 1 || y0 <= 1 || x1 >= w - 2 || y1 >= h - 2;
    if (touchesBorder) flags.push({ code: "touches-border", index });
    return {
      index,
      box,
      image: crop(image, box, (p) => cells.owner[p] === own),
      fragments: Math.max(1, c.fragments),
      touchesBorder,
    };
  });
  if (sprites.length === 0) flags.push({ code: "empty" });
  if (grid && sprites.length !== expected)
    flags.unshift({ code: "count-mismatch", found: sprites.length, expected });
  return { sprites, expected, method: cells.method, flags, fringe };
}
