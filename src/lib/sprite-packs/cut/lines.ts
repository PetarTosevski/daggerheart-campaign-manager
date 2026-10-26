/**
 * Drawn grid-line removal (sprite packs P2).
 *
 * Some generated sheets draw thin lines between the cells despite the prompt
 * (grassland-and-road/large). After keying, such a line is a long, thin run
 * of opaque pixels. A pixel is "thin across" a row when its vertical run of
 * visible pixels is at most `maxThickness` long; a pixel row where more than
 * half the sheet is thin is a horizontal line (columns likewise). Every thin
 * run that crosses a line row (column) is cleared, so objects the line
 * touches keep their own pixels.
 */

import type { RgbaImage } from "./types";

/** Share of the sheet width (height) a line row (column) must cover with thin pixels. */
const LINE_COVERAGE = 0.5;

/** Thickest drawn line removed, scaled to the sheet (12 px at 2048). */
export function maxLineThickness(img: RgbaImage): number {
  return Math.max(3, Math.round(Math.min(img.width, img.height) * 0.006));
}

export interface LinesResult {
  /** Centres of the removed horizontal lines (pixel rows). */
  rows: number[];
  /** Centres of the removed vertical lines (pixel columns). */
  cols: number[];
}

/** Group sorted indices into runs of neighbours and return each run's centre. */
function centres(indices: number[]): number[] {
  const out: number[] = [];
  let start = -1;
  let prev = -2;
  for (const i of indices) {
    if (i !== prev + 1) {
      if (start >= 0) out.push(Math.round((start + prev) / 2));
      start = i;
    }
    prev = i;
  }
  if (start >= 0) out.push(Math.round((start + prev) / 2));
  return out;
}

/**
 * Runs along one axis. `vertical` true: runs down each column (thin runs are
 * horizontal lines). Returns, per pixel, the run length it belongs to (0 when
 * clear).
 */
function runLengths(visible: Uint8Array, w: number, h: number, vertical: boolean): Uint16Array {
  const out = new Uint16Array(w * h);
  const outer = vertical ? w : h;
  const inner = vertical ? h : w;
  const idx = vertical ? (o: number, i: number) => i * w + o : (o: number, i: number) => o * w + i;
  for (let o = 0; o < outer; o++) {
    let i = 0;
    while (i < inner) {
      if (!visible[idx(o, i)]) {
        i++;
        continue;
      }
      let j = i;
      while (j < inner && visible[idx(o, j)]) j++;
      const len = Math.min(65535, j - i);
      for (let k = i; k < j; k++) out[idx(o, k)] = len;
      i = j;
    }
  }
  return out;
}

/** Find and clear thin drawn grid lines (in place on the keyed image). */
export function removeGridLines(img: RgbaImage, maxThickness = maxLineThickness(img)): LinesResult {
  const { width: w, height: h, data } = img;
  const visible = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) visible[p] = (data[p * 4 + 3] ?? 0) > 0 ? 1 : 0;

  const vRuns = runLengths(visible, w, h, true);
  const hRuns = runLengths(visible, w, h, false);
  const lineRows: number[] = [];
  for (let y = 0; y < h; y++) {
    let thin = 0;
    for (let x = 0; x < w; x++) {
      const r = vRuns[y * w + x] ?? 0;
      if (r > 0 && r <= maxThickness) thin++;
    }
    if (thin > w * LINE_COVERAGE) lineRows.push(y);
  }
  const lineCols: number[] = [];
  for (let x = 0; x < w; x++) {
    let thin = 0;
    for (let y = 0; y < h; y++) {
      const r = hRuns[y * w + x] ?? 0;
      if (r > 0 && r <= maxThickness) thin++;
    }
    if (thin > h * LINE_COVERAGE) lineCols.push(x);
  }

  const clear = new Uint8Array(w * h);
  const rowSet = new Uint8Array(h);
  for (const y of lineRows) rowSet[y] = 1;
  const colSet = new Uint8Array(w);
  for (const x of lineCols) colSet[x] = 1;
  // Horizontal lines: clear every thin vertical run that crosses a line row.
  if (lineRows.length > 0)
    for (let x = 0; x < w; x++) {
      let y = 0;
      while (y < h) {
        const r = vRuns[y * w + x] ?? 0;
        if (r === 0) {
          y++;
          continue;
        }
        if (r <= maxThickness) {
          let hits = false;
          for (let k = y; k < y + r; k++) if (rowSet[k]) hits = true;
          if (hits) for (let k = y; k < y + r; k++) clear[k * w + x] = 1;
        }
        y += r;
      }
    }
  if (lineCols.length > 0)
    for (let y = 0; y < h; y++) {
      let x = 0;
      while (x < w) {
        const r = hRuns[y * w + x] ?? 0;
        if (r === 0) {
          x++;
          continue;
        }
        if (r <= maxThickness) {
          let hits = false;
          for (let k = x; k < x + r; k++) if (colSet[k]) hits = true;
          if (hits) for (let k = x; k < x + r; k++) clear[y * w + k] = 1;
        }
        x += r;
      }
    }
  for (let p = 0; p < w * h; p++) if (clear[p]) visible[p] = 0;
  // Where lines cross, a small square is left that was thick both ways; with
  // the lines gone it is short in both directions: clear it too.
  const rows = centres(lineRows);
  const cols = centres(lineCols);
  if (rows.length > 0 && cols.length > 0) {
    const v2 = runLengths(visible, w, h, true);
    const h2 = runLengths(visible, w, h, false);
    const half = maxThickness;
    for (const y of rows)
      for (const x of cols)
        for (let yy = Math.max(0, y - half); yy <= Math.min(h - 1, y + half); yy++)
          for (let xx = Math.max(0, x - half); xx <= Math.min(w - 1, x + half); xx++) {
            const p = yy * w + xx;
            if ((v2[p] ?? 0) <= half * 2 + 1 && (h2[p] ?? 0) <= half * 2 + 1) clear[p] = 1;
          }
  }
  for (let p = 0; p < w * h; p++)
    if (clear[p]) {
      data[p * 4] = 0;
      data[p * 4 + 1] = 0;
      data[p * 4 + 2] = 0;
      data[p * 4 + 3] = 0;
    }
  return { rows, cols };
}
