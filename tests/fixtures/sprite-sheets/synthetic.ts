/**
 * Synthetic sprite sheets for the cut core tests (sprite packs P2). Small,
 * generated in memory (nothing binary is committed), each mimicking one
 * problem seen on the user's real sheets.
 */

import type { RgbaImage } from "../../../src/lib/sprite-packs/cut";

export type Rgb = [number, number, number];

export const MAGENTA: Rgb = [255, 0, 255];

/** Distinct, clearly non-magenta object colours (index = reading order). */
export const PALETTE: Rgb[] = [
  [200, 40, 40],
  [40, 160, 60],
  [40, 80, 200],
  [220, 180, 40],
  [120, 70, 30],
  [30, 160, 160],
  [230, 120, 30],
  [90, 90, 90],
  [150, 200, 80],
  [200, 200, 200],
  [60, 40, 120],
  [180, 100, 60],
  [20, 110, 40],
  [240, 220, 160],
  [100, 30, 30],
  [70, 140, 220],
];

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function blank(width: number, height: number, fill: Rgb = MAGENTA, alpha = 255): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = alpha;
  }
  return { width, height, data };
}

export function setPx(img: RgbaImage, x: number, y: number, c: Rgb, alpha = 255): void {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 4;
  img.data[i] = c[0];
  img.data[i + 1] = c[1];
  img.data[i + 2] = c[2];
  img.data[i + 3] = alpha;
}

export function getPx(img: RgbaImage, x: number, y: number): [number, number, number, number] {
  const i = (y * img.width + x) * 4;
  return [img.data[i] ?? 0, img.data[i + 1] ?? 0, img.data[i + 2] ?? 0, img.data[i + 3] ?? 0];
}

export function fillRect(img: RgbaImage, x: number, y: number, w: number, h: number, c: Rgb, alpha = 255): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPx(img, xx, yy, c, alpha);
}

/** A filled ellipse inside the box. */
export function fillEllipse(img: RgbaImage, x: number, y: number, w: number, h: number, c: Rgb): void {
  const cx = x + w / 2;
  const cy = y + h / 2;
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++) {
      const dx = (xx + 0.5 - cx) / (w / 2);
      const dy = (yy + 0.5 - cy) / (h / 2);
      if (dx * dx + dy * dy <= 1) setPx(img, xx, yy, c);
    }
}

/**
 * JPEG-like damage: every object pixel next to the magenta gets a 2 px ring
 * of colours half mixed with magenta just outside it, and the whole sheet
 * gets +-`noise` per channel.
 */
export function jpegLike(img: RgbaImage, seed: number, noise = 10): void {
  const { width: w, height: h } = img;
  const src = new Uint8ClampedArray(img.data);
  const isBg = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return src[i] === 255 && src[i + 1] === 0 && src[i + 2] === 255;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!isBg(x, y)) continue;
      // Nearest object pixel within 2 px.
      let found: Rgb | null = null;
      let dist = 3;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || isBg(nx, ny)) continue;
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          if (d < dist) {
            dist = d;
            const i = (ny * w + nx) * 4;
            found = [src[i] ?? 0, src[i + 1] ?? 0, src[i + 2] ?? 0];
          }
        }
      if (!found) continue;
      const t = dist === 1 ? 0.6 : 0.3; // share of the object colour
      setPx(img, x, y, [
        Math.round(found[0] * t + 255 * (1 - t)),
        Math.round(found[1] * t),
        Math.round(found[2] * t + 255 * (1 - t)),
      ]);
    }
  const r = rng(seed);
  for (let i = 0; i < img.data.length; i += 4)
    for (let c = 0; c < 3; c++) img.data[i + c] = (img.data[i + c] ?? 0) + Math.round((r() * 2 - 1) * noise);
}

/** Cell boxes of an even grid. */
export function gridCells(width: number, height: number, rows: number, cols: number) {
  const out: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const x0 = Math.round((c * width) / cols);
      const x1 = Math.round(((c + 1) * width) / cols);
      const y0 = Math.round((r * height) / rows);
      const y1 = Math.round(((r + 1) * height) / rows);
      out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  return out;
}

/**
 * A clean object sheet: one shape per cell, centred, `fill` of the cell
 * size, colour PALETTE[i]; even cells are ellipses, odd ones rectangles.
 * Returns the sheet and the drawn boxes.
 */
export function objectSheet(size: number, rows: number, cols: number, fill = 0.6) {
  const img = blank(size, size);
  const shapes = gridCells(size, size, rows, cols).map((cell, i) => {
    const w = Math.round(cell.w * fill);
    const h = Math.round(cell.h * fill * (i % 3 === 0 ? 0.8 : 1));
    const x = cell.x + Math.round((cell.w - w) / 2);
    const y = cell.y + Math.round((cell.h - h) / 2);
    const colour = PALETTE[i % PALETTE.length] ?? [0, 0, 0];
    if (i % 2 === 0) fillEllipse(img, x, y, w, h, colour);
    else fillRect(img, x, y, w, h, colour);
    return { x, y, w, h, colour };
  });
  return { img, shapes };
}

/**
 * A 2 x 2 terrain sheet: a flat `frame` border, a magenta cross of width
 * `gap`, four noisy swatches with distinct base colours, JPEG-ish bleed on
 * the swatch borders.
 */
export function terrainSheet(size: number, frame: number, gap: number, seed = 7) {
  const img = blank(size, size, [255, 255, 255]);
  const bases: Rgb[] = [
    [90, 140, 60],
    [120, 90, 60],
    [140, 140, 150],
    [70, 90, 130],
  ];
  const r = rng(seed);
  const inner = size - frame * 2;
  const half = Math.floor((inner - gap) / 2);
  const x0s = [frame, frame + half + gap];
  const boxes: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 2; col++) {
      const base = bases[row * 2 + col] ?? [0, 0, 0];
      const bx = x0s[col] ?? 0;
      const by = x0s[row] ?? 0;
      boxes.push({ x: bx, y: by, w: half, h: half });
      for (let y = by; y < by + half; y++)
        for (let x = bx; x < bx + half; x++) {
          const n = (r() - 0.5) * 50;
          setPx(img, x, y, [base[0] + n, base[1] + n, base[2] + n]);
        }
    }
  fillRect(img, frame + half, frame, gap, inner, [255, 0, 255]);
  fillRect(img, frame, frame + half, inner, gap, [255, 0, 255]);
  // Bleed: one px of mixed colour on every swatch side that faces the cross.
  const bleed = (x: number, y: number) => {
    const [pr, pg, pb] = getPx(img, x, y);
    setPx(img, x, y, [(pr + 255) / 2, pg / 2, (pb + 255) / 2]);
  };
  boxes.forEach((b, i) => {
    const right = i % 2 === 0;
    const below = i < 2;
    for (let y = b.y; y < b.y + b.h; y++) bleed(right ? b.x + b.w - 1 : b.x, y);
    for (let x = b.x; x < b.x + b.w; x++) bleed(x, below ? b.y + b.h - 1 : b.y);
  });
  return { img, boxes, bases };
}
