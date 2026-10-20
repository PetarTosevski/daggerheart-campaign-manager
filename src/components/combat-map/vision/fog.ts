/**
 * Fog of war, pure (D9 C8): no React, no Convex. Turns a character's vision masks (C7's `vision`: `seen` = dim or
 * clear, `clear` = clear, in C1's half-square samples) and their explored samples into an RGBA image, and frames
 * the explored squares for the player's Fit (Q1). Levels are never recomputed here: the server's masks already
 * include lights the client does not know about (hidden torch-bearers, Q3).
 *
 * Colours follow the board's `drawFog` (reference/designs/project/Combat.dc.html): clear = no fog, dim = blue-black
 * at 150, explored-but-not-seen = 205, unseen = opaque (the board's 250, raised to 255 so the padding outside the
 * map, which has nothing under it, looks exactly like unexplored fog over the map; Q1).
 */

import type { VisionGrid } from "@/lib/domain/combat-map/vision";

export type Rgba = readonly [r: number, g: number, b: number, a: number];

export const FOG_COLOURS = {
  clear: [0, 0, 0, 0],
  dim: [8, 12, 26, 150],
  explored: [6, 9, 12, 205],
  unseen: [4, 6, 9, 255],
  /** The GM's own view (no preview): the board's night and dim tints over the whole map. */
  gmNight: [10, 16, 40, 60],
  gmDim: [40, 20, 10, 40],
} as const satisfies Record<string, Rgba>;

/** CSS colour of the unseen fog (the padding fill after the blur). */
export const UNSEEN_CSS = `rgba(${FOG_COLOURS.unseen[0]}, ${FOG_COLOURS.unseen[1]}, ${FOG_COLOURS.unseen[2]}, ${FOG_COLOURS.unseen[3] / 255})`;

export type FogMasks = {
  /** Samples per side of the map (C1 `VisionGrid.sw / sh`) and samples per square. */
  sw: number;
  sh: number;
  scale: number;
  /** 1 = seen now (dim or clear). */
  seen: Uint8Array;
  /** 1 = clear now. */
  clear: Uint8Array;
  /** 1 = explored before (stored) or now; null = nothing stored yet. */
  explored: Uint8Array | null;
};

/**
 * Samples (half squares) over which a player's view fades into the fog at the map's edge (Q1): light reaching the
 * edge dies out over two squares like the end of a light's reach, instead of stopping at a straight hard line.
 */
export const EDGE_FADE_SAMPLES = 4;

/** `a` to `b` by `t` (0..1), every channel. */
function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

/** The level a sample is painted with. */
function sampleColour(m: FogMasks, i: number): Rgba {
  if (m.clear[i]) return FOG_COLOURS.clear;
  if (m.seen[i]) return FOG_COLOURS.dim;
  if (m.explored?.[i]) return FOG_COLOURS.explored;
  return FOG_COLOURS.unseen;
}

/**
 * The fog at sample resolution, padded by `pad` squares on every side (`pad` = FOG_PAD_SQUARES for players, 0 for
 * the GM's preview). Returns `width x height` RGBA bytes.
 *
 * - With padding (players, Q1): every sample outside the map, and the map's outermost ring of samples, is unseen
 *   fog, and the next EDGE_FADE_SAMPLES fade from the unseen fog into the view. The ring keeps the later blur from
 *   carrying light past the edge; the fade lets a view that reaches the edge die out like the end of a light's reach
 *   instead of stopping at a straight hard line (the map's edge must never read as a border).
 * - Without padding (the GM's preview): `edge` extra samples are drawn on each side, clamped to the nearest map
 *   sample (the board's trick), so the blur does not darken the map's border.
 */
export function fogImage(m: FogMasks, pad: number, edge = 3): { width: number; height: number; data: Uint8ClampedArray<ArrayBuffer>; offset: number } {
  const ring = pad > 0 ? 1 : 0;
  const offset = pad > 0 ? pad * m.scale : edge;
  const width = m.sw + 2 * offset;
  const height = m.sh + 2 * offset;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sx = x - offset;
      let sy = y - offset;
      let colour: Rgba;
      if (pad > 0) {
        // Samples from the nearest edge: < ring is outside or on the rim (unseen), then a fade into the map.
        const edgeDistance = Math.min(sx, sy, m.sw - 1 - sx, m.sh - 1 - sy);
        if (edgeDistance < ring) colour = FOG_COLOURS.unseen;
        else if (edgeDistance < EDGE_FADE_SAMPLES) colour = mix(FOG_COLOURS.unseen, sampleColour(m, sy * m.sw + sx), edgeDistance / EDGE_FADE_SAMPLES);
        else colour = sampleColour(m, sy * m.sw + sx);
      } else {
        sx = Math.max(0, Math.min(m.sw - 1, sx));
        sy = Math.max(0, Math.min(m.sh - 1, sy));
        colour = sampleColour(m, sy * m.sw + sx);
      }
      const o = (y * width + x) * 4;
      data[o] = colour[0];
      data[o + 1] = colour[1];
      data[o + 2] = colour[2];
      data[o + 3] = colour[3];
    }
  }
  return { width, height, data, offset };
}

/** A rectangle in squares (stage coordinates include the padding: x = square x + pad). */
export type SquareRect = { x: number; y: number; w: number; h: number };

/** The smallest Fit frame for a player, in squares: about a Close range around them on a phone, more elsewhere. */
export const MIN_FIT_SQUARES = { w: 16, h: 12 };
/** Squares of fog kept around the explored area when fitting. */
export const FIT_MARGIN_SQUARES = 3;

/**
 * The player's Fit frame (Q1): the bounding box of what the character has explored or sees now, plus a margin,
 * at least MIN_FIT_SQUARES, in stage squares (padding included). Never the map's own bounds: the frame may run
 * past the edge into the padding, which is fog. Null when nothing is explored yet (Fit then frames the padded
 * area).
 */
export function exploredFrame(mask: Uint8Array, sw: number, sh: number, scale: number, pad: number): SquareRect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) {
      if (!mask[sy * sw + sx]) continue;
      if (sx < x0) x0 = sx;
      if (sx > x1) x1 = sx;
      if (sy < y0) y0 = sy;
      if (sy > y1) y1 = sy;
    }
  }
  if (x0 === Infinity) return null;
  let left = x0 / scale - FIT_MARGIN_SQUARES;
  let top = y0 / scale - FIT_MARGIN_SQUARES;
  let w = (x1 + 1) / scale + FIT_MARGIN_SQUARES - left;
  let h = (y1 + 1) / scale + FIT_MARGIN_SQUARES - top;
  if (w < MIN_FIT_SQUARES.w) {
    left -= (MIN_FIT_SQUARES.w - w) / 2;
    w = MIN_FIT_SQUARES.w;
  }
  if (h < MIN_FIT_SQUARES.h) {
    top -= (MIN_FIT_SQUARES.h - h) / 2;
    h = MIN_FIT_SQUARES.h;
  }
  return { x: left + pad, y: top + pad, w, h };
}

/** The union of two masks (either may be missing). */
export function unionMask(a: Uint8Array | null, b: Uint8Array | null): Uint8Array | null {
  if (a === null) return b;
  if (b === null) return a;
  const out = new Uint8Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = a[i] || b[i] ? 1 : 0;
  return out;
}

/** Whether the sample under a point (in squares) is set in a mask. */
export function maskAt(mask: Uint8Array | null, grid: Pick<VisionGrid, "sw" | "sh" | "scale">, x: number, y: number): boolean {
  if (mask === null) return false;
  const sx = Math.floor(x * grid.scale);
  const sy = Math.floor(y * grid.scale);
  if (sx < 0 || sy < 0 || sx >= grid.sw || sy >= grid.sh) return false;
  return mask[sy * grid.sw + sx] === 1;
}
