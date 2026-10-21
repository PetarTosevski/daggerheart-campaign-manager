/**
 * Terrain sheets (sprite packs P2, D6): four ground swatches in a 2 x 2 grid
 * with a thin magenta cross between them, and often a flat outer frame (the
 * user's sheets have a white one) that is not magenta.
 *
 * cutTerrain finds the frame (flat lines from each edge inward), then the
 * magenta cross inside it (the column / row with the most magenta near the
 * middle), insets each swatch past the JPEG bleed and crops it to a centred
 * square. seamFix makes a swatch tile (offset by half, cross-blend the seam
 * that the offset moves to the middle); tileability scores how well it tiles.
 */

import { magentaScore } from "./key";
import { crop } from "./trim";
import type { Box, RgbaImage } from "./types";

/** A pixel of the magenta gap: clearly magenta and bright (the gap is flat #FF00FF). */
function isGapMagenta(r: number, g: number, b: number): boolean {
  return magentaScore(r, g, b) > 0.5 && Math.max(r, b) > 120;
}

export type TerrainFlag =
  /** No magenta cross was found along this axis; the swatches were split at the middle of the frame. */
  | { code: "no-cross"; axis: "x" | "y" }
  /** The swatches differ in size by more than 10 % before squaring (an off-centre cross). */
  | { code: "uneven-swatches" }
  /** Magenta is still visible in this swatch (more than 0.5 % of its pixels). */
  | { code: "magenta-left"; index: number };

export interface TerrainSwatch {
  /** 0 top left, 1 top right, 2 bottom left, 3 bottom right (the prompts doc's order). */
  index: number;
  /** The square crop on the sheet. */
  box: Box;
  image: RgbaImage;
  /** 0..1, see `tileability`. */
  tileability: number;
}

export interface TerrainCut {
  swatches: TerrainSwatch[];
  /** The inner box inside the frame. */
  inner: Box;
  flags: TerrainFlag[];
}

function px(img: RgbaImage, x: number, y: number): [number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0];
}

/**
 * How many lines from one edge form a flat frame. `line(k)` lists the pixels
 * of the k-th line from that edge. The outermost line sets the frame colour
 * (its non-magenta pixels must be flat); inner lines belong to the frame while
 * 90 % of their non-magenta pixels are within 40 per channel of it.
 */
function frameDepth(img: RgbaImage, line: (k: number) => Array<[number, number]>, limit: number): number {
  const first = line(0)
    .map(([x, y]) => px(img, x, y))
    .filter(([r, g, b]) => !isGapMagenta(r, g, b));
  if (first.length === 0) return 0;
  const mean = [0, 1, 2].map((c) => first.reduce((s, p) => s + (p[c] ?? 0), 0) / first.length);
  const sd = Math.sqrt(
    first.reduce((s, p) => s + [0, 1, 2].reduce((t, c) => t + ((p[c] ?? 0) - (mean[c] ?? 0)) ** 2, 0), 0) /
      (first.length * 3),
  );
  if (sd > 20) return 0;
  let k = 0;
  for (; k < limit; k++) {
    const pts = line(k);
    let other = 0;
    let match = 0;
    for (const [x, y] of pts) {
      const [r, g, b] = px(img, x, y);
      if (isGapMagenta(r, g, b)) continue;
      other++;
      if (
        Math.abs(r - (mean[0] ?? 0)) < 40 &&
        Math.abs(g - (mean[1] ?? 0)) < 40 &&
        Math.abs(b - (mean[2] ?? 0)) < 40
      )
        match++;
    }
    if (other > 0 && match < other * 0.9) break;
  }
  return k;
}

/** The magenta gap along one axis inside [from, to): [start, end] of the gap, or null. */
function findGap(fraction: Float64Array, from: number, to: number): [number, number] | null {
  const lo = Math.round(from + (to - from) * 0.25);
  const hi = Math.round(from + (to - from) * 0.75);
  let peak = lo;
  for (let i = lo; i < hi; i++) if ((fraction[i] ?? 0) > (fraction[peak] ?? 0)) peak = i;
  const top = fraction[peak] ?? 0;
  if (top < 0.25) return null;
  let a = peak;
  let b = peak;
  while (a > from && (fraction[a - 1] ?? 0) >= top * 0.5) a--;
  while (b < to - 1 && (fraction[b + 1] ?? 0) >= top * 0.5) b++;
  return [a, b];
}

/** Centred square inside a box. */
function square(box: Box): Box {
  const s = Math.min(box.w, box.h);
  return { x: box.x + Math.floor((box.w - s) / 2), y: box.y + Math.floor((box.h - s) / 2), w: s, h: s };
}

/** Cut a terrain sheet into its four square swatches (reading order). The input is not changed. */
export function cutTerrain(img: RgbaImage): TerrainCut {
  const { width: w, height: h } = img;
  const flags: TerrainFlag[] = [];
  const limit = Math.round(Math.min(w, h) * 0.2);
  const midX: Array<number> = [];
  for (let x = Math.round(w * 0.2); x < Math.round(w * 0.8); x++) midX.push(x);
  const midY: Array<number> = [];
  for (let y = Math.round(h * 0.2); y < Math.round(h * 0.8); y++) midY.push(y);
  const top = frameDepth(img, (k) => midX.map((x) => [x, k]), limit);
  const bottom = frameDepth(img, (k) => midX.map((x) => [x, h - 1 - k]), limit);
  const left = frameDepth(img, (k) => midY.map((y) => [k, y]), limit);
  const right = frameDepth(img, (k) => midY.map((y) => [w - 1 - k, y]), limit);
  const inner: Box = { x: left, y: top, w: w - left - right, h: h - top - bottom };

  const colFrac = new Float64Array(w);
  const rowFrac = new Float64Array(h);
  for (let y = inner.y; y < inner.y + inner.h; y++)
    for (let x = inner.x; x < inner.x + inner.w; x++) {
      const [r, g, b] = px(img, x, y);
      if (!isGapMagenta(r, g, b)) continue;
      colFrac[x] = (colFrac[x] ?? 0) + 1 / inner.h;
      rowFrac[y] = (rowFrac[y] ?? 0) + 1 / inner.w;
    }
  let gx = findGap(colFrac, inner.x, inner.x + inner.w);
  let gy = findGap(rowFrac, inner.y, inner.y + inner.h);
  if (!gx) {
    flags.push({ code: "no-cross", axis: "x" });
    const m = inner.x + Math.floor(inner.w / 2);
    gx = [m, m - 1];
  }
  if (!gy) {
    flags.push({ code: "no-cross", axis: "y" });
    const m = inner.y + Math.floor(inner.h / 2);
    gy = [m, m - 1];
  }
  const inset = Math.max(2, Math.round(Math.min(w, h) * 0.006));
  const xs: Array<[number, number]> = [
    [inner.x + inset, gx[0] - inset],
    [gx[1] + 1 + inset, inner.x + inner.w - inset],
  ];
  const ys: Array<[number, number]> = [
    [inner.y + inset, gy[0] - inset],
    [gy[1] + 1 + inset, inner.y + inner.h - inset],
  ];
  const raw: Box[] = [];
  for (const [y0, y1] of ys) for (const [x0, x1] of xs) raw.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
  const sides = raw.map((b) => Math.min(b.w, b.h));
  if (Math.min(...sides) < Math.max(...sides) * 0.9) flags.push({ code: "uneven-swatches" });

  const swatches = raw.map((b, index): TerrainSwatch => {
    const box = square(b);
    const image = crop(img, box);
    let magenta = 0;
    for (let i = 0; i < image.data.length; i += 4)
      if (isGapMagenta(image.data[i] ?? 0, image.data[i + 1] ?? 0, image.data[i + 2] ?? 0)) magenta++;
    if (magenta > box.w * box.h * 0.005) flags.push({ code: "magenta-left", index });
    return { index, box, image, tileability: tileability(image) };
  });
  return { swatches, inner, flags };
}

/** Mean absolute channel difference between two pixels (0..255). */
function diff(img: RgbaImage, x0: number, y0: number, x1: number, y1: number): number {
  const a = px(img, x0, y0);
  const b = px(img, x1, y1);
  return (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])) / 3;
}

/**
 * How well a swatch tiles, 0..1: the mean difference between neighbouring
 * pixels inside the swatch divided by the mean difference across its wrap
 * seams (right edge to left edge, bottom to top), capped at 1. 1 = the seams
 * are no rougher than the texture itself.
 */
export function tileability(img: RgbaImage): number {
  const { width: w, height: h } = img;
  if (w < 2 || h < 2) return 1;
  let seam = 0;
  for (let y = 0; y < h; y++) seam += diff(img, w - 1, y, 0, y);
  for (let x = 0; x < w; x++) seam += diff(img, x, h - 1, x, 0);
  seam /= w + h;
  let inside = 0;
  let n = 0;
  const step = Math.max(1, Math.floor(Math.min(w, h) / 128));
  for (let y = 0; y < h - 1; y += step)
    for (let x = 0; x < w - 1; x += step) {
      inside += diff(img, x, y, x + 1, y) + diff(img, x, y, x, y + 1);
      n += 2;
    }
  inside /= n;
  if (seam <= inside) return 1;
  return Math.max(0, Math.min(1, inside / seam));
}

/** Weight of the unshifted swatch at position `i` of `n`: 1 over the middle, fading to 0 at both edges over `band` of the half size. */
function centreWeight(i: number, n: number, band: number): number {
  const tri = 1 - Math.abs((2 * (i + 0.5)) / n - 1);
  const t = Math.min(1, tri / band);
  return t * t * (3 - 2 * t);
}

/** One axis of seamFix: blend the swatch with itself shifted by half along x (or y). */
function seamFixAxis(src: Uint8ClampedArray, w: number, h: number, alongX: boolean, band: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length);
  const n = alongX ? w : h;
  const half = Math.floor(n / 2);
  const weight = Array.from({ length: n }, (_, i) => centreWeight(i, n, band));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = alongX ? x : y;
      const k = weight[i] ?? 1;
      const sx = alongX ? (x + half) % w : x;
      const sy = alongX ? y : (y + half) % h;
      const d = (y * w + x) * 4;
      const s = (sy * w + sx) * 4;
      for (let c = 0; c < 4; c++) out[d + c] = (src[d + c] ?? 0) * k + (src[s + c] ?? 0) * (1 - k);
    }
  return out;
}

/**
 * Make a swatch tile (D6), along x then y: the swatch is cross-blended with
 * itself shifted by half (wrapping). The shifted copy fills the edges, where
 * it is continuous across the wrap; the original fills the middle, where the
 * shifted copy has its seam. `band` (0..1 of the half size) sets how far the
 * blend reaches from the edges; smaller keeps more of the original untouched.
 */
export function seamFix(img: RgbaImage, band = 0.5): RgbaImage {
  const { width: w, height: h } = img;
  const x = seamFixAxis(img.data, w, h, true, band);
  return { width: w, height: h, data: seamFixAxis(x, w, h, false, band) };
}
