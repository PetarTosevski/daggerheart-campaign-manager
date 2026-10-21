/**
 * Shared types of the sprite cut core (sprite packs P2).
 *
 * The cut core is pure TypeScript over plain RGBA buffers: no Node, no DOM.
 * The offline script (P4, sharp's raw output) and the browser upload (P8,
 * canvas ImageData) both pass a `{ width, height, data }` buffer, 4 bytes per
 * pixel, row-major, non-premultiplied.
 */

/** A plain RGBA image. `data.length === width * height * 4`. */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

/** A pixel rectangle; `x, y` inclusive top-left, `w, h` in pixels. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Rows x columns of an object sheet. */
export interface SheetGrid {
  rows: number;
  cols: number;
}

/** The sheet layouts of docs/sprite-packs/prompts.md. */
export const SHEET_GRIDS = {
  props: { rows: 4, cols: 4 },
  large: { rows: 3, cols: 3 },
} as const satisfies Record<string, SheetGrid>;

export type SheetKind = keyof typeof SHEET_GRIDS;

/** Something the cutter had to fix or could not decide (shown to the GM / logged by the script). */
export type CutFlag =
  /** Found a different number of objects than the sheet's list names. The cuts are every object found, in reading order. */
  | { code: "count-mismatch"; found: number; expected: number }
  /** The object at `index` (reading order) touches the image border; kept, it may be clipped. */
  | { code: "touches-border"; index: number }
  /** Thin drawn grid lines were removed before cell finding (pixel rows / columns of the line centres). */
  | { code: "lines-removed"; rows: number[]; cols: number[] }
  /** The sheet already had transparency: magenta keying, defringe and erosion were skipped. */
  | { code: "already-transparent" }
  /** The clean row/column bands did not match the grid; objects were found by connected components with nearest-merge. */
  | { code: "components-fallback" }
  /** The sheet has no opaque pixels at all. */
  | { code: "empty" };

/** One cut sprite. */
export interface SpriteCut {
  /** Reading order (left to right, top to bottom), 0-based. */
  index: number;
  /** Where the trimmed sprite (margin included) sits on the sheet; may reach past the sheet edge, which is padded transparent. */
  box: Box;
  /** The trimmed sprite, transparent outside its object. */
  image: RgbaImage;
  /** Separate pieces merged into this object (1 for a single piece). */
  fragments: number;
  touchesBorder: boolean;
}

/** Magenta left on edge pixels: mean of max(0, min(R, B) - G) / 255 over the opaque pixels next to transparency. */
export interface FringeScore {
  /** Before despill (how much JPEG spill the sheet had). */
  before: number;
  /** After despill and erosion (should be ~0). */
  after: number;
}

export interface SheetCut {
  sprites: SpriteCut[];
  expected: number;
  method: "bands" | "components" | "single";
  flags: CutFlag[];
  fringe: FringeScore;
}
