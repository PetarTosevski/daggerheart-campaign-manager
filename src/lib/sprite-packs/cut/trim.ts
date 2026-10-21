/**
 * Trimming (sprite packs P2): crop a sprite to its alpha bounds plus a margin.
 */

import type { Box, RgbaImage } from "./types";

/** Transparent margin kept around every trimmed sprite, in px. */
export const TRIM_MARGIN = 2;

/** Alpha bounds of `img` (pixels with alpha > 0) inside `within` (whole image by default); null when empty. */
export function alphaBounds(img: RgbaImage, within?: Box): Box | null {
  const { width: w, data } = img;
  const bx = within ?? { x: 0, y: 0, w: img.width, h: img.height };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let y = bx.y; y < bx.y + bx.h; y++)
    for (let x = bx.x; x < bx.x + bx.w; x++)
      if ((data[(y * w + x) * 4 + 3] ?? 0) > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Copy `box` out of `img` (pixels outside the image are transparent). When
 * `keep` is given, only pixels it accepts are copied (the rest transparent).
 */
export function crop(img: RgbaImage, box: Box, keep?: (p: number) => boolean): RgbaImage {
  const out = new Uint8ClampedArray(box.w * box.h * 4);
  for (let y = 0; y < box.h; y++) {
    const sy = box.y + y;
    if (sy < 0 || sy >= img.height) continue;
    for (let x = 0; x < box.w; x++) {
      const sx = box.x + x;
      if (sx < 0 || sx >= img.width) continue;
      const p = sy * img.width + sx;
      if (keep && !keep(p)) continue;
      const s = p * 4;
      const d = (y * box.w + x) * 4;
      out[d] = img.data[s] ?? 0;
      out[d + 1] = img.data[s + 1] ?? 0;
      out[d + 2] = img.data[s + 2] ?? 0;
      out[d + 3] = img.data[s + 3] ?? 0;
    }
  }
  return { width: box.w, height: box.h, data: out };
}

/** Grow a box by `margin` px on every side (it may reach past the image; `crop` pads with transparency). */
export function withMargin(box: Box, margin = TRIM_MARGIN): Box {
  return { x: box.x - margin, y: box.y - margin, w: box.w + margin * 2, h: box.h + margin * 2 };
}

export interface Trimmed {
  image: RgbaImage;
  /** The trimmed box on the source image, margin included. */
  box: Box;
}

/** Trim `img` (optionally only inside `within`) to its alpha bounds plus `margin`; null when nothing is visible. */
export function trimToAlpha(img: RgbaImage, within?: Box, margin = TRIM_MARGIN): Trimmed | null {
  const bounds = alphaBounds(img, within);
  if (!bounds) return null;
  const box = withMargin(bounds, margin);
  return { image: crop(img, box), box };
}
