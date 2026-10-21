// Sprite painter terrain (sprite packs P6, D6): pack textures tiled in world space over the Classic terrain.
//
// - Which texture: a texture cell (layer "texture") wins, then the texture of the area that painted the square, then
//   the textures of the square's Classic terrain class in the setting and in common (resolve.ts). A class with
//   several textures mixes them by a seeded low-frequency noise mask, with soft transitions.
// - Tiling: one swatch covers TEXTURE_SQUARES x TEXTURE_SQUARES squares, sampled at world coordinates, so tiles line
//   up across the whole map and every repaint of a rectangle gives the same pixels. Rotatable textures get a seeded
//   rotation / flip per tile, cross-faded with their neighbours' orientation near the tile edges, so the seams of
//   rotated tiles do not show. A faint low-frequency brightness variation hides the repeat of single textures.
// - Boundaries: the noisy edge displacement of the Classic painter (same noise, so textured and Classic edges agree)
//   plus a feather of about 0.35 square (nine jittered taps). Terrains without a texture (wall, void, ... when the packs have
//   none) keep the Classic pixels already painted underneath and are feathered the same way.

import type { PreparedMap } from "../painter";
import { WALLISH, areaHits, isTerrain, paintKey, type PaintArea, type PaintedTerrain, type TerrainId } from "../raster";
import { TEXTURE_SQUARES } from "../../sprite-packs/catalog/index";
import type { SpriteRef } from "../../sprite-packs/traits";
import type { SpriteArt } from "./loader";
import { refTextureArt, terrainTextures, type TextureArt, type UploadedSprites } from "./resolve";

/** A layout area on a Sprites map: a Classic area that may carry a texture ref (D1). */
export interface SpritePaintArea extends PaintArea {
  readonly texture?: SpriteRef;
}

/** What a fine cell draws: explicit textures (one) or the mixed textures of its terrain class; none = Classic. */
type TextureSource = { readonly key: string; readonly arts: readonly TextureArt[] };

export interface TexturePlan {
  /** Sub-cells per square (the Classic painter's supersampling). */
  readonly ff: number;
  readonly fw: number;
  readonly fh: number;
  /** Per fine cell: index into `sources`; 0 = no texture (Classic pixels). */
  readonly cells: Uint16Array;
  /** sources[0] is the empty source. */
  readonly sources: readonly TextureSource[];
}

/** Feather half-width in squares (the blend band is about twice this: 0.35 square, D6). */
export const FEATHER = 0.175;
/** Width of the cross-fade at tile edges of rotatable textures, as a share of a tile. */
const TILE_BLEND = 0.18;
/** Variant mix: noise frequency (squares per feature) and the softness of the transition. */
const MIX_SQUARES = 4.5;
const MIX_SOFT = 0.09;
/** Brightness variation that hides the repeat of a single texture: +-MACRO_AMP over MACRO_SQUARES. */
const MACRO_SQUARES = 3;
const MACRO_AMP = 0.09;
/** Darkening of textured pixels within 7 and 14 px of a wall (the Classic painter's rim). */
const WALL_RIM = [0.58, 0.82] as const;
/** Spacing in pixels of the grid the low-frequency noise is evaluated on (interpolated in between). */
const NOISE_STEP = 8;

// ------------------------------------------------------------------------------------------- noise (the Classic one)
// The Classic painter's hash / value noise / fbm, copied so the noisy terrain edges here match its edges exactly.

const hash = (x: number, y: number, s: number): number => {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

const vnoise = (x: number, y: number, s: number): number => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};

const fbm = (x: number, y: number, s: number): number =>
  vnoise(x, y, s) * 0.55 + vnoise(x * 2.1, y * 2.1, s + 7) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 13) * 0.15;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------------------------------------------- planning

/**
 * Which texture every fine cell draws. `prepared` is the Classic preparation of the same layout (its fine terrain
 * grid); `textures` the hand-painted texture cells by square key.
 */
export function planTextures(
  prepared: PreparedMap,
  areas: ReadonlyArray<SpritePaintArea>,
  paint: PaintedTerrain | undefined,
  textures: Readonly<Record<string, SpriteRef>> | undefined,
  setting: string,
  uploaded: UploadedSprites,
): TexturePlan {
  const { w, h, fine } = prepared;
  const ff = w > 0 ? Math.round((fine[0]?.length ?? 0) / w) || 1 : 1;
  const fw = w * ff, fh = h * ff;
  const cells = new Uint16Array(fw * fh);
  const sources: TextureSource[] = [{ key: "", arts: [] }];
  const index = new Map<string, number>();
  const sourceOf = (key: string, make: () => readonly TextureArt[]): number => {
    const known = index.get(key);
    if (known !== undefined) return known;
    const arts = make();
    const i = arts.length === 0 ? 0 : sources.push({ key, arts }) - 1;
    index.set(key, i);
    return i;
  };
  const explicit = (ref: SpriteRef): number => {
    const art = refTextureArt(ref, uploaded);
    return art ? sourceOf(`e:${art.url}`, () => [art]) : -1;
  };
  const mapped = (t: TerrainId) => sourceOf(`m:${t}`, () => terrainTextures(t, setting));

  // The area that painted each fine cell, only needed when some area carries a texture.
  const areaTex = areas.map((a) => (a && isTerrain(a.terrain) && a.texture ? explicit(a.texture) : -1));
  let winner: Int16Array | null = null;
  if (areaTex.some((s) => s > 0)) {
    winner = new Int16Array(fw * fh).fill(-1);
    areas.forEach((a, i) => {
      if (!a || !isTerrain(a.terrain)) return;
      for (let y = 0; y < fh; y++) {
        const cy = (y + 0.5) / ff;
        for (let x = 0; x < fw; x++) if (areaHits(a, (x + 0.5) / ff, cy, w, h)) winner![y * fw + x] = i;
      }
    });
  }
  const cellTex = new Map<string, number>();
  for (const key of Object.keys(textures ?? {})) {
    const s = explicit(textures![key]!);
    if (s > 0) cellTex.set(key, s);
  }

  for (let y = 0; y < fh; y++) {
    const row = fine[y]!;
    const sy = Math.floor(y / ff);
    for (let x = 0; x < fw; x++) {
      const sx = Math.floor(x / ff);
      const key = paintKey(sx, sy);
      const t = row[x]!;
      let s = cellTex.get(key) ?? -1;
      if (s < 0 && winner && !(paint && isTerrain(paint[key]))) {
        const a = winner[y * fw + x]!;
        if (a >= 0 && areaTex[a]! > 0 && areas[a]!.terrain === t) s = areaTex[a]!;
      }
      cells[y * fw + x] = s > 0 ? s : mapped(t);
    }
  }
  return { ff, fw, fh, cells, sources };
}

/** Every texture URL a plan may draw (the canvas repaints the map when one of them arrives). */
export function planUrls(plan: TexturePlan): Set<string> {
  const urls = new Set<string>();
  for (const s of plan.sources) for (const a of s.arts) urls.add(a.url);
  return urls;
}

// ------------------------------------------------------------------------------------------------------ compositing

type Tile = { readonly data: Uint8ClampedArray; readonly rot: boolean; readonly salt: number };

/** Seeded orientation of tile (tx, ty), remembered for the last tile asked (pixels come row by row). */
function orientation(seed: number) {
  let lx = NaN, ly = NaN, lo = 0;
  return (tx: number, ty: number): number => {
    if (tx !== lx || ty !== ly) {
      lx = tx; ly = ty;
      lo = Math.floor(hash(tx, ty, seed) * 8) & 7;
    }
    return lo;
  };
}

type OrientedTile = Tile & { readonly own: (tx: number, ty: number) => number; readonly nbx: (tx: number, ty: number) => number; readonly nby: (tx: number, ty: number) => number };

/** (lx, ly) inside a tile of size T, turned by orientation o (bit 2 = flip, bits 0-1 = quarter turns). */
function orient(o: number, lx: number, ly: number, T: number): number {
  let x = o & 4 ? T - 1 - lx : lx;
  let y = ly;
  switch (o & 3) {
    case 1: { const t = x; x = T - 1 - y; y = t; break; }
    case 2: x = T - 1 - x; y = T - 1 - y; break;
    case 3: { const t = x; x = y; y = T - 1 - t; break; }
  }
  return (y * T + x) * 4;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

/** The loaded tiles of every source of a plan at `cell` pixels per square; a source with none loaded draws Classic. */
export type LoadedTiles = readonly (readonly OrientedTile[])[];

export function loadTiles(plan: TexturePlan, art: SpriteArt, cell: number, seed: number): LoadedTiles {
  const T = Math.max(1, Math.round(TEXTURE_SQUARES * cell));
  return plan.sources.map((src) =>
    src.arts.flatMap((a) => {
      const d = art.texture(a.url, T);
      if (!d) return [];
      const s = (seed ^ a.salt) | 0;
      return [{ data: d, rot: a.rotatable, salt: a.salt, own: orientation(s), nbx: orientation(s), nby: orientation(s) }];
    }),
  );
}

/**
 * Squares (x, y in the given square range) whose pixels are not all covered by a loaded texture: an untextured
 * terrain, a texture still loading, or a terrain edge (blended with what is underneath). Only these need the Classic
 * terrain painted underneath. Returns a row-major array over x0..x1 x y0..y1 (exclusive).
 */
export function classicSquares(plan: TexturePlan, prepared: PreparedMap, tiles: LoadedTiles, sx0: number, sy0: number, sx1: number, sy1: number): Uint8Array {
  const { ff, fw, cells } = plan;
  const { edge } = prepared;
  const cols = sx1 - sx0;
  const out = new Uint8Array(cols * Math.max(0, sy1 - sy0));
  for (let sy = sy0; sy < sy1; sy++)
    for (let sx = sx0; sx < sx1; sx++) {
      let need = 0;
      for (let fy = sy * ff; fy < (sy + 1) * ff && !need; fy++)
        for (let fx = sx * ff; fx < (sx + 1) * ff; fx++) {
          const i = fy * fw + fx;
          if (edge[i] || tiles[cells[i]!]!.length === 0) { need = 1; break; }
        }
      out[(sy - sy0) * cols + (sx - sx0)] = need;
    }
  return out;
}

/**
 * Composites the textures over the pixels of one rectangle (`data`: RGBA of x0..x0+rw, y0..y0+rh, read back from the
 * canvas after the Classic terrain was painted where `classicSquares` asked for it). Returns false when nothing was
 * drawn (no loaded texture).
 */
export function compositeTextures(
  data: Uint8ClampedArray,
  x0: number,
  y0: number,
  rw: number,
  rh: number,
  prepared: PreparedMap,
  plan: TexturePlan,
  tiles: LoadedTiles,
  cell: number,
): boolean {
  const C = cell;
  const T = Math.max(1, Math.round(TEXTURE_SQUARES * C));
  if (!tiles.some((t) => t.length > 0)) return false;

  const { fine, edge, crisp, seed } = prepared;
  const { ff, fw, fh, cells } = plan;
  const FC = C / ff;
  const amp = C * 0.38, fq = 1 / (C * 1.1);
  const feather = FEATHER * C;
  const B = Math.max(1, T * TILE_BLEND);
  const mixF = 1 / (MIX_SQUARES * C), macroF = 1 / (MACRO_SQUARES * C);
  const sourceAt = (gx: number, gy: number) => cells[clamp(Math.floor(gy / FC), 0, fh - 1) * fw + clamp(Math.floor(gx / FC), 0, fw - 1)]!;
  const terrainAt = (gx: number, gy: number) => fine[clamp(Math.floor(gy / FC), 0, fh - 1)]![clamp(Math.floor(gx / FC), 0, fw - 1)]!;
  const rgb = [0, 0, 0];

  /** Adds w x the colour of `tile` at pixel (px, py) to rgb. */
  const texel = (tile: OrientedTile, px: number, py: number, w: number) => {
    const tx = Math.floor(px / T), ty = Math.floor(py / T);
    const lx = px - tx * T, ly = py - ty * T;
    const d = tile.data;
    if (!tile.rot) {
      const i = (ly * T + lx) * 4;
      rgb[0] += d[i]! * w; rgb[1] += d[i + 1]! * w; rgb[2] += d[i + 2]! * w;
      return;
    }
    const own = tile.own(tx, ty);
    let wx = 0, nx = tx, wy = 0, ny = ty;
    if (lx < B) { wx = 0.5 * (1 - smooth(lx / B)); nx = tx - 1; }
    else if (lx > T - 1 - B) { wx = 0.5 * (1 - smooth((T - 1 - lx) / B)); nx = tx + 1; }
    if (ly < B) { wy = 0.5 * (1 - smooth(ly / B)); ny = ty - 1; }
    else if (ly > T - 1 - B) { wy = 0.5 * (1 - smooth((T - 1 - ly) / B)); ny = ty + 1; }
    const wo = 1 - wx - wy;
    let i = orient(own, lx, ly, T);
    rgb[0] += d[i]! * w * wo; rgb[1] += d[i + 1]! * w * wo; rgb[2] += d[i + 2]! * w * wo;
    if (wx > 0) {
      i = orient(tile.nbx(nx, ty), lx, ly, T);
      rgb[0] += d[i]! * w * wx; rgb[1] += d[i + 1]! * w * wx; rgb[2] += d[i + 2]! * w * wx;
    }
    if (wy > 0) {
      i = orient(tile.nby(tx, ny), lx, ly, T);
      rgb[0] += d[i]! * w * wy; rgb[1] += d[i + 1]! * w * wy; rgb[2] += d[i + 2]! * w * wy;
    }
  };

  // Low-frequency noise (brightness, variant mix) on a world-aligned grid every NOISE_STEP pixels, interpolated per
  // pixel: smooth like per-pixel noise at a fraction of the cost, and the same for any rectangle.
  const maxK = tiles.reduce((m, t) => Math.max(m, t.length), 0);
  const channels = 1 + (maxK > 1 ? maxK : 0);
  const G = NOISE_STEP;
  const gx0 = Math.floor(x0 / G), gy0 = Math.floor(y0 / G);
  const gcols = Math.floor((x0 + rw - 1) / G) - gx0 + 2, grows = Math.floor((y0 + rh - 1) / G) - gy0 + 2;
  const grid = new Float32Array(gcols * grows * channels);
  for (let gy = 0; gy < grows; gy++)
    for (let gx = 0; gx < gcols; gx++) {
      const wx = (gx0 + gx) * G, wy = (gy0 + gy) * G;
      const at = (gy * gcols + gx) * channels;
      grid[at] = vnoise(wx * macroF, wy * macroF, seed + 59);
      for (let k = 1; k < channels; k++) grid[at + k] = vnoise(wx * mixF, wy * mixF, seed + 101 + (k - 1) * 13);
    }
  const nv = new Float64Array(channels);
  const noiseAt = (px: number, py: number) => {
    const gx = Math.floor(px / G) - gx0, gy = Math.floor(py / G) - gy0;
    const u = (px - (gx0 + gx) * G) / G, v = (py - (gy0 + gy) * G) / G;
    const a = (gy * gcols + gx) * channels, b = a + channels, c = a + gcols * channels, d = c + channels;
    for (let k = 0; k < channels; k++) {
      const top = grid[a + k]! + (grid[b + k]! - grid[a + k]!) * u;
      nv[k] = top + (grid[c + k]! + (grid[d + k]! - grid[c + k]!) * u - top) * v;
    }
  };

  /** Adds w x the colour of a source at pixel (px, py) to rgb (several textures mixed by noise; nv is current). */
  const sample = (list: readonly OrientedTile[], px: number, py: number, w: number) => {
    if (list.length === 1) return texel(list[0]!, px, py, w);
    let b1 = -1, b2 = -1, i1 = 0, i2 = 0;
    for (let k = 0; k < list.length; k++) {
      const n = nv[1 + k]!;
      if (n > b1) { b2 = b1; i2 = i1; b1 = n; i1 = k; } else if (n > b2) { b2 = n; i2 = k; }
    }
    const a = 0.5 + 0.5 * clamp((b1 - b2) / MIX_SOFT, 0, 1);
    texel(list[i1]!, px, py, w * a);
    if (a < 1) texel(list[i2]!, px, py, w * (1 - a));
  };

  // Feather taps: a 3 x 3 grid FEATHER apart, shifted per pixel by a little noise so the blend has no stair steps.
  const taps: readonly (readonly [number, number])[] = [-1, 0, 1].flatMap((dy) => [-1, 0, 1].map((dx) => [dx * feather, dy * feather] as const));
  const tapSource = new Int32Array(taps.length);
  const tapCount = new Float64Array(plan.sources.length);
  let drew = false;
  for (let py = y0; py < y0 + rh; py++)
    for (let px = x0; px < x0 + rw; px++) {
      const fx = Math.min(fw - 1, Math.floor(px / FC)), fy = Math.min(fh - 1, Math.floor(py / FC));
      const o = ((py - y0) * rw + (px - x0)) * 4;
      rgb[0] = 0; rgb[1] = 0; rgb[2] = 0;
      if (!edge[fy * fw + fx]) {
        const list = tiles[cells[fy * fw + fx]!]!;
        if (list.length === 0) continue;
        noiseAt(px, py);
        sample(list, px, py, 1 + (nv[0]! - 0.5) * 2 * MACRO_AMP);
      } else {
        // Noisy displacement as the Classic painter does it (none on crisp terrains), then the feather. A pixel
        // whose own source is Classic blends the textures around it into its Classic colour; a textured pixel blends
        // only the textures around it (so no band of the Classic floor shows along an untextured wall).
        const t0 = fine[fy]![fx]!;
        let ox = (fbm(px * fq, py * fq, seed) - 0.5) * 2 * amp, oy = (fbm(px * fq + 31, py * fq + 17, seed) - 0.5) * 2 * amp;
        if (crisp.has(t0) || crisp.has(terrainAt(px + ox, py + oy))) { ox = 0; oy = 0; }
        const jx = (hash(px, py, seed + 3) - 0.5) * feather, jy = (hash(py, px, seed + 5) - 0.5) * feather;
        let textured = 0;
        for (let k = 0; k < taps.length; k++) {
          const src = sourceAt(px + ox + jx + taps[k]![0], py + oy + jy + taps[k]![1]);
          tapSource[k] = tiles[src]!.length === 0 ? 0 : src;
          if (tapSource[k]) textured++;
        }
        if (textured === 0) continue;
        const centre = tapSource[4]!;
        const total = centre === 0 ? taps.length : textured;
        tapCount.fill(0);
        for (let k = 0; k < taps.length; k++) tapCount[tapSource[k]!]! += 1;
        noiseAt(px, py);
        const macro = 1 + (nv[0]! - 0.5) * 2 * MACRO_AMP;
        if (centre === 0) {
          const w = tapCount[0]! / total;
          rgb[0] += data[o]! * w; rgb[1] += data[o + 1]! * w; rgb[2] += data[o + 2]! * w;
        }
        // A textured pixel along a wall gets the Classic painter's dark rim (7 and 14 px), so walls keep their depth.
        let shade = 1;
        if (centre !== 0 && !WALLISH.has(terrainAt(px + ox, py + oy))) {
          const near = (k: number) =>
            WALLISH.has(terrainAt(px + ox + k, py + oy)) ||
            WALLISH.has(terrainAt(px + ox - k, py + oy)) ||
            WALLISH.has(terrainAt(px + ox, py + oy + k)) ||
            WALLISH.has(terrainAt(px + ox, py + oy - k));
          shade = near(7) ? WALL_RIM[0] : near(14) ? WALL_RIM[1] : 1;
        }
        for (let src = 1; src < tapCount.length; src++) if (tapCount[src]! > 0) sample(tiles[src]!, px, py, (tapCount[src]! / total) * macro * shade);
      }
      data[o] = clamp(rgb[0]!, 0, 255); data[o + 1] = clamp(rgb[1]!, 0, 255); data[o + 2] = clamp(rgb[2]!, 0, 255); data[o + 3] = 255;
      drew = true;
    }
  return drew;
}
