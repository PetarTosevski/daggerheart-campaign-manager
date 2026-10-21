/**
 * Magenta keying (sprite packs P2): flat #FF00FF background -> transparency.
 *
 * - Key: a hue-based magenta score (magenta chroma over brightness), so JPEG
 *   noise and the soft drop shadows some sheets draw anyway (darker magenta)
 *   both key out; a soft alpha ramp between two score thresholds.
 * - Despill: inside a thin band next to the background, remove the magenta
 *   component (min(R, B) above G) that JPEG chroma bleed leaves on edges.
 * - Erode: alpha takes the minimum of its 4 neighbours once (1 px), which
 *   drops the last half-keyed fringe ring.
 * - A sheet that already has transparency (a GM's PNG) is left as it is.
 */

import type { FringeScore, RgbaImage } from "./types";

/** Score at or below which a pixel is fully opaque. */
export const KEY_OPAQUE_SCORE = 0.3;
/** Score at or above which a pixel is fully transparent. */
export const KEY_CLEAR_SCORE = 0.55;
/** Share of pixels with alpha < 128 above which a sheet counts as already transparent. */
const ALREADY_TRANSPARENT_SHARE = 0.02;

/**
 * How magenta a colour is, about -1..1: pure #FF00FF is 1, a darkened magenta
 * (shadow on the background) stays near 1, greys, browns and greens are <= 0.
 */
export function magentaScore(r: number, g: number, b: number): number {
  const lo = r < b ? r : b;
  const hi = r < b ? b : r;
  return (lo - g - Math.abs(r - b) * 0.5) / (hi > 1 ? hi : 1);
}

/** Magenta spill of one pixel, 0..255. */
export function spillOf(r: number, g: number, b: number): number {
  const lo = r < b ? r : b;
  return lo > g ? lo - g : 0;
}

/** True when the sheet already carries transparency (no keying needed). */
export function hasTransparency(img: RgbaImage): boolean {
  const { data } = img;
  const n = img.width * img.height;
  let clear = 0;
  for (let i = 3; i < data.length; i += 4) if ((data[i] ?? 255) < 128) clear++;
  return clear > n * ALREADY_TRANSPARENT_SHARE;
}

export interface KeyResult {
  image: RgbaImage;
  alreadyTransparent: boolean;
}

/** Key the magenta background to alpha (a new image; the input is not changed). */
export function keyMagenta(img: RgbaImage): KeyResult {
  const data = new Uint8ClampedArray(img.data);
  const image = { width: img.width, height: img.height, data };
  if (hasTransparency(img)) return { image, alreadyTransparent: true };
  const span = KEY_CLEAR_SCORE - KEY_OPAQUE_SCORE;
  for (let i = 0; i < data.length; i += 4) {
    const s = magentaScore(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
    let a: number;
    if (s <= KEY_OPAQUE_SCORE) a = 255;
    else if (s >= KEY_CLEAR_SCORE) a = 0;
    else {
      const t = (s - KEY_OPAQUE_SCORE) / span;
      a = Math.round(255 * (1 - t * t * (3 - 2 * t)));
    }
    data[i + 3] = a;
  }
  return { image, alreadyTransparent: false };
}

/**
 * Chebyshev distance (in px, capped at `max + 1`) from every pixel to the
 * nearest pixel with alpha 0. Two passes of a 3x3 chamfer.
 */
function distanceToClear(img: RgbaImage, max: number): Uint8Array {
  const { width: w, height: h, data } = img;
  const cap = Math.min(254, max + 1);
  const d = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) d[p] = (data[p * 4 + 3] ?? 0) === 0 ? 0 : cap;
  const at = (x: number, y: number) => d[y * w + x] ?? cap;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let v = d[p] ?? cap;
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, at(x - 1, y) + 1);
      if (y > 0) {
        v = Math.min(v, at(x, y - 1) + 1);
        if (x > 0) v = Math.min(v, at(x - 1, y - 1) + 1);
        if (x < w - 1) v = Math.min(v, at(x + 1, y - 1) + 1);
      }
      d[p] = v;
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const p = y * w + x;
      let v = d[p] ?? cap;
      if (v === 0) continue;
      if (x < w - 1) v = Math.min(v, at(x + 1, y) + 1);
      if (y < h - 1) {
        v = Math.min(v, at(x, y + 1) + 1);
        if (x > 0) v = Math.min(v, at(x - 1, y + 1) + 1);
        if (x < w - 1) v = Math.min(v, at(x + 1, y + 1) + 1);
      }
      d[p] = v;
    }
  return d;
}

/** Width of the despill band next to the background, scaled to the sheet (6 px at 2048). */
export function despillBand(img: RgbaImage): number {
  return Math.max(3, Math.round(Math.min(img.width, img.height) * 0.003));
}

/**
 * Remove magenta spill from every visible pixel within `band` px of the
 * background (in place): min(R, B) drops to G. Wide soft glows drawn over
 * magenta (a will-o'-wisp's aura) keep their pink tint beyond the band: a
 * wider unmix also ate purple objects (mushroom-cavern), so it is not done.
 */
export function despill(img: RgbaImage, band = despillBand(img)): void {
  const d = distanceToClear(img, band);
  const { data } = img;
  for (let p = 0; p < d.length; p++) {
    const dist = d[p] ?? 0;
    if (dist === 0 || dist > band) continue;
    const i = p * 4;
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    const spill = spillOf(r, g, b);
    if (spill === 0) continue;
    data[i] = r - spill;
    data[i + 2] = b - spill;
  }
}

/** 1 px alpha erosion: each alpha becomes the minimum of itself and its 4 neighbours (in place). */
export function erodeAlpha(img: RgbaImage): void {
  const { width: w, height: h, data } = img;
  const src = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) src[p] = data[p * 4 + 3] ?? 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let a = src[p] ?? 0;
      if (a === 0) continue;
      if (x > 0) a = Math.min(a, src[p - 1] ?? 0);
      if (x < w - 1) a = Math.min(a, src[p + 1] ?? 0);
      if (y > 0) a = Math.min(a, src[p - w] ?? 0);
      if (y < h - 1) a = Math.min(a, src[p + w] ?? 0);
      data[p * 4 + 3] = a;
    }
}

/** Zero the colour of fully transparent pixels (smaller files, no hidden magenta when resampled). */
export function clearTransparentColour(img: RgbaImage): void {
  const { data } = img;
  for (let i = 0; i < data.length; i += 4)
    if (data[i + 3] === 0) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
    }
}

/** Mean magenta spill (0..1) over visible pixels that touch a transparent 4-neighbour. */
export function fringeScore(img: RgbaImage): number {
  const { width: w, height: h, data } = img;
  let sum = 0;
  let n = 0;
  const alpha = (p: number) => data[p * 4 + 3] ?? 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (alpha(p) === 0) continue;
      const edge =
        (x > 0 && alpha(p - 1) === 0) ||
        (x < w - 1 && alpha(p + 1) === 0) ||
        (y > 0 && alpha(p - w) === 0) ||
        (y < h - 1 && alpha(p + w) === 0);
      if (!edge) continue;
      const i = p * 4;
      sum += spillOf(data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0);
      n++;
    }
  return n === 0 ? 0 : sum / n / 255;
}

export interface DefringeResult {
  fringe: FringeScore;
}

/** Erode, despill and clear the colour under alpha 0 (in place); reports the fringe before and after. */
export function defringe(img: RgbaImage): DefringeResult {
  const before = fringeScore(img);
  erodeAlpha(img);
  despill(img);
  clearTransparentColour(img);
  return { fringe: { before, after: fringeScore(img) } };
}
