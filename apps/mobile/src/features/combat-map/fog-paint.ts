/**
 * Mobile re-export of the website fog painter with imports the Expo tsconfig can resolve.
 * Logic matches `src/components/combat-map/vision/fog.ts`.
 */

import type { VisionGrid } from "../../../../../src/lib/domain/combat-map/vision";

export type Rgba = readonly [r: number, g: number, b: number, a: number];

export const FOG_COLOURS = {
  clear: [0, 0, 0, 0],
  dim: [8, 12, 26, 150],
  explored: [6, 9, 12, 205],
  unseen: [4, 6, 9, 255],
  gmNight: [10, 16, 40, 60],
  gmDim: [40, 20, 10, 40],
} as const satisfies Record<string, Rgba>;

export type FogMasks = {
  sw: number;
  sh: number;
  scale: number;
  seen: Uint8Array;
  clear: Uint8Array;
  explored: Uint8Array | null;
};

export const EDGE_FADE_SAMPLES = 4;

function mix(a: Rgba, b: Rgba, t: number): Rgba {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

function sampleColour(m: FogMasks, i: number): Rgba {
  if (m.clear[i]) return FOG_COLOURS.clear;
  if (m.seen[i]) return FOG_COLOURS.dim;
  if (m.explored?.[i]) return FOG_COLOURS.explored;
  return FOG_COLOURS.unseen;
}

export function fogImage(m: FogMasks, pad: number, edge = 3): { width: number; height: number; data: Uint8ClampedArray; offset: number } {
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

export function unionMask(a: Uint8Array | null, b: Uint8Array | null): Uint8Array | null {
  if (a === null) return b;
  if (b === null) return a;
  const out = new Uint8Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = a[i] || b[i] ? 1 : 0;
  return out;
}

export function maskAt(mask: Uint8Array | null, grid: Pick<VisionGrid, "sw" | "sh" | "scale">, x: number, y: number): boolean {
  if (mask === null) return false;
  const sx = Math.floor(x * grid.scale);
  const sy = Math.floor(y * grid.scale);
  if (sx < 0 || sy < 0 || sx >= grid.sw || sy >= grid.sh) return false;
  return mask[sy * grid.sw + sx] === 1;
}
