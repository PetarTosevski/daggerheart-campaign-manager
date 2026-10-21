/**
 * Editing a combat map by hand (D9 C5): the pure rules the editor UI and `convex/combatMapEdit.ts` share, so a
 * stroke the client applies optimistically and the stroke the server stores can never differ. No React, no Convex.
 *
 * Painted cells use the encoding of `../map-view/cells.ts` (C0/C3): tiles of CELL_TILE_ROWS rows, one character
 * per square. A stroke rewrites only the tiles it touches; a tile left fully unpainted is deleted.
 */

import { TEXTURE_CODES, type SpriteRef as ConvexSpriteRef } from "../../../../convex/lib/validators/combatMaps";
import { givesLight, type LightSubject } from "../../../lib/domain/combat-map/light";
import type { ObjectKind, Terrain } from "../../../lib/domain/combat-map/spec";
import { catalogEntry } from "../../../lib/sprite-packs/catalog/index";
import type { SpriteRef } from "../../../lib/sprite-packs/traits";
import { BLOCK_CODE, CELL_TILE_ROWS, CELL_UNPAINTED, codeOfTerrain, tileOf, type CellLayer, type CellTile } from "../map-view/cells";

// ---------------------------------------------------------------- the board's palettes

/** Terrains in the board's paint palette order (PAINT_TERRAINS) with its swatch colours (TER_SWATCH). */
export const PAINT_TERRAINS: readonly { terrain: Terrain; swatch: string }[] = [
  { terrain: "grass", swatch: "#7a9a3a" },
  { terrain: "dirt", swatch: "#8f7552" },
  { terrain: "path", swatch: "#a08460" },
  { terrain: "sand", swatch: "#d8c290" },
  { terrain: "snow", swatch: "#e6ebf0" },
  { terrain: "swamp", swatch: "#56623c" },
  { terrain: "water", swatch: "#4a96be" },
  { terrain: "deep", swatch: "#22508c" },
  { terrain: "stone", swatch: "#948f86" },
  { terrain: "cave", swatch: "#a89c88" },
  { terrain: "wood", swatch: "#966c42" },
  { terrain: "wall", swatch: "#28241f" },
  { terrain: "void", swatch: "#0e0e10" },
  { terrain: "lava", swatch: "#e05c1e" },
];

/** Objects the GM can place by hand (the board's OBJ_KINDS): label and default radius in squares (OBJ_R). */
export const PLACEABLE_OBJECTS = {
  tree: { label: "Tree", r: 1.6 },
  bush: { label: "Bush", r: 0.9 },
  deadtree: { label: "Dead tree", r: 1.6 },
  rock: { label: "Rock", r: 0.8 },
  boulder: { label: "Boulder", r: 1.1 },
  tent: { label: "Tent", r: 2 },
  campfire: { label: "Campfire", r: 1 },
  walltorch: { label: "Wall torch", r: 0.6 },
  log: { label: "Log", r: 1 },
  crate: { label: "Crate", r: 0.8 },
  barrel: { label: "Barrel", r: 0.8 },
  chest: { label: "Chest", r: 0.8 },
  table: { label: "Table", r: 1 },
  pillar: { label: "Pillar", r: 0.9 },
  statue: { label: "Statue", r: 1.2 },
  rubble: { label: "Rubble", r: 1 },
  crystal: { label: "Crystal", r: 0.6 },
  bones: { label: "Bones", r: 0.8 },
  /** Map-movement M2: a door, placed closed (no `open` field); the door switch opens it. */
  door: { label: "Door", r: 0.5 },
} as const satisfies Partial<Record<ObjectKind, { label: string; r: number }>>;
export type PlaceableKind = keyof typeof PLACEABLE_OBJECTS;
export const PLACEABLE_KINDS = Object.keys(PLACEABLE_OBJECTS) as PlaceableKind[];

/** Labels of the kinds Claude's layouts add that cannot be placed by hand. */
const OTHER_LABELS: Partial<Record<ObjectKind, string>> = { mast: "Mast", hull: "Ship hull", mushroom: "Mushrooms", torch: "Brazier" };

export function objectLabel(kind: string): string {
  return (PLACEABLE_OBJECTS as Record<string, { label: string }>)[kind]?.label ?? OTHER_LABELS[kind as ObjectKind] ?? kind;
}

// ---------------------------------------------------------------- objects

/** Object radius bounds in squares (the board's 0.3..4) and the size step of Smaller / Bigger. */
export const OBJECT_R_MIN = 0.3;
export const OBJECT_R_MAX = 4;
export const OBJECT_R_STEP = 0.2;
/** Rotate left / right: 15 degrees (the board's PI / 12). */
export const OBJECT_ROT_STEP = Math.PI / 12;

export const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** Where a click places an object: half squares, inside the map (the board's `_placeObj`). */
export function placePoint(x: number, y: number, w: number, h: number): { x: number; y: number } {
  return { x: clamp(Math.round(x * 2) / 2, 0, w), y: clamp(Math.round(y * 2) / 2, 0, h) };
}

/** Where a drag drops an object: quarter squares, inside the map (the board's `_moveObj`). */
export function movePoint(x: number, y: number, w: number, h: number): { x: number; y: number } {
  return { x: clamp(Math.round(x * 4) / 4, 0, w), y: clamp(Math.round(y * 4) / 4, 0, h) };
}

/** A radius rounded to 0.01 inside the bounds. */
export const objectRadius = (r: number): number => clamp(Math.round(r * 100) / 100, OBJECT_R_MIN, OBJECT_R_MAX);

/** An angle in radians folded into [0, 2π), rounded to 0.0001. */
export function objectRotation(rot: number): number {
  const full = Math.PI * 2;
  return Math.round((((rot % full) + full) % full) * 10000) / 10000;
}

/**
 * Whether an object can be switched on and off (R9): a Classic light kind (campfire, wall torch), or a sprite whose
 * light trait is not none (sprite packs Q1, ORCHESTRATOR NOTE: `givesLight`; a sprite with light "none" on a
 * Classic light kind is not switchable).
 */
export const isSwitchableLight = (kind: string, traits?: LightSubject["traits"]): boolean => givesLight({ kind, traits: traits ?? null });

type Hittable = { readonly _id: string; readonly kind: string; readonly x: number; readonly y: number; readonly r: number };

/** The object under a point (squares), nearest first; a ship hull is never picked (the board's `_objAt`). */
export function objectAt<T extends Hittable>(objects: readonly T[], x: number, y: number): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const o of objects) {
    if (o.kind === "hull") continue;
    const d = Math.hypot(o.x - x, o.y - y);
    if (d < Math.max(0.6, o.r * 0.8) && d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

// ---------------------------------------------------------------- brush and cells

/** Brush sizes in squares per side (the board's 1 / 2 / 3). */
export const BRUSHES = [1, 2, 3] as const;
export type Brush = (typeof BRUSHES)[number];

/** A square's index in a stroke: y * w + x. */
export const squareIndex = (x: number, y: number, w: number): number => y * w + x;

/** The squares a brush covers around a point (squares), inside the map (the board's `cellsAround`). */
export function brushSquares(x: number, y: number, brush: number, w: number, h: number): number[] {
  const out: number[] = [];
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const lo = -Math.floor((brush - 1) / 2);
  for (let dy = 0; dy < brush; dy++) {
    for (let dx = 0; dx < brush; dx++) {
      const sx = cx + lo + dx;
      const sy = cy + lo + dy;
      if (sx >= 0 && sy >= 0 && sx < w && sy < h) out.push(squareIndex(sx, sy, w));
    }
  }
  return out;
}

/** What a stroke paints: a terrain, a sight blocker, or erasing one of the two (Erase terrain / Clear sight). */
export type PaintValue = Terrain | "block" | "eraseTerrain" | "eraseBlock";

/** A layer a stroke may write: the D9 painted layers and the sprite-packs texture layer (P9). */
export type StrokeLayer = Exclude<CellLayer, "fog"> | "texture";

/**
 * The layers a stroke writes, each with the code it puts in every touched square. Painting or erasing terrain also
 * clears the hand-painted texture there (sprite packs P9), so the texture layer never contradicts the terrain the
 * vision engine and Classic read; on a map without textures that clear writes nothing.
 */
export function strokeLayers(paint: PaintValue): { layer: StrokeLayer; code: string }[] {
  if (paint === "block") return [{ layer: "block", code: BLOCK_CODE }];
  if (paint === "eraseTerrain") return [{ layer: "terrain", code: CELL_UNPAINTED }, { layer: "texture", code: CELL_UNPAINTED }];
  if (paint === "eraseBlock") return [{ layer: "block", code: CELL_UNPAINTED }];
  return [{ layer: "terrain", code: codeOfTerrain(paint) }, { layer: "texture", code: CELL_UNPAINTED }];
}

/** The squares of a stroke grouped by tile, as positions inside each tile's string. */
export function squaresByTile(squares: readonly number[], w: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const s of squares) {
    const x = s % w;
    const y = Math.floor(s / w);
    const tile = tileOf(y);
    const list = out.get(tile) ?? [];
    list.push((y - tile * CELL_TILE_ROWS) * w + x);
    out.set(tile, list);
  }
  return out;
}

/**
 * A tile's string after writing `code` at `positions`. A tile stored for another width (an image map whose grid
 * changed size) cannot be read square by square any more, so it starts over empty.
 */
export function paintTile(cells: string | null, w: number, positions: readonly number[], code: string): string {
  const size = CELL_TILE_ROWS * w;
  const chars = (cells !== null && cells.length === size ? cells : CELL_UNPAINTED.repeat(size)).split("");
  for (const p of positions) if (p >= 0 && p < size) chars[p] = code;
  return chars.join("");
}

/** Whether a tile holds no painted square (it is then deleted rather than stored). */
export const isEmptyTile = (cells: string): boolean => /^\.*$/.test(cells);

/**
 * A map's painted tiles after one stroke (the client's optimistic copy of what `paintCells` stores): touched
 * tiles rewritten, emptied ones dropped, every other tile unchanged.
 */
export function paintLayoutCells<T extends CellTile>(tiles: readonly T[], w: number, squares: readonly number[], paint: PaintValue): CellTile[] {
  const byTile = squaresByTile(squares, w);
  let out: CellTile[] = [...tiles];
  for (const { layer, code } of strokeLayers(paint)) {
    // The texture layer travels apart (`textureCells`); `paintLayoutTextures` updates it.
    if (layer === "texture") continue;
    for (const [tile, positions] of byTile) {
      const i = out.findIndex((t) => t.layer === layer && t.tile === tile);
      const before = i >= 0 ? out[i]!.cells : null;
      if (before === null && code === CELL_UNPAINTED) continue;
      const after = paintTile(before, w, positions, code);
      if (isEmptyTile(after)) out = out.filter((_, j) => j !== i);
      else if (i >= 0) out = out.map((t, j) => (j === i ? { layer, tile, cells: after } : t));
      else out.push({ layer, tile, cells: after });
    }
  }
  return out;
}

// ---------------------------------------------------------------- Sprites style (sprite packs P9)

/** A texture stroke (Sprites style): paints `texture` on the texture layer and its terrain class on the terrain layer. */
export type TexturePaint = { readonly layer: "texture"; readonly texture: ConvexSpriteRef };

/** Whether two sprite refs name the same sprite. */
export function sameRef(a: SpriteRef, b: SpriteRef): boolean {
  return "builtin" in a ? "builtin" in b && a.builtin === b.builtin : "uploaded" in b && a.uploaded === b.uploaded;
}

/** A sprite's default radius (D4: r = max(w, h) / 2), inside the editor's bounds. */
export const spriteRadius = (w: number, h: number): number => objectRadius(Math.max(w, h) / 2);

/** What placing an object sprite stores besides its ref: its Classic look (D1, D2) and its default radius (D4). */
export type SpritePlacement = { kind: ObjectKind; variant?: string; r: number };

/** The placement of a built-in object sprite, or null when the key is not an object in the catalog. */
export function builtinPlacement(key: string): SpritePlacement | null {
  const entry = catalogEntry(key);
  if (entry === null || entry.category !== "object") return null;
  return { kind: entry.classic.kind, ...(entry.classic.variant === undefined ? {} : { variant: entry.classic.variant }), r: spriteRadius(entry.w, entry.h) };
}

/** The placement of an uploaded object sprite from its row (`classicKind` / `classicVariant`, w x h squares). */
export function uploadedPlacement(row: { classicKind: ObjectKind; classicVariant?: string; w: number; h: number }): SpritePlacement {
  return { kind: row.classicKind, ...(row.classicVariant === undefined ? {} : { variant: row.classicVariant }), r: spriteRadius(row.w, row.h) };
}

/** The terrain class a built-in texture paints, or null when the key is not a texture in the catalog. */
export function builtinTextureTerrain(key: string): Terrain | null {
  const entry = catalogEntry(key);
  return entry !== null && entry.category === "texture" ? entry.terrain : null;
}

/** Texture codes present in a map's texture tiles. */
export function usedTextureCodes(tiles: readonly { readonly cells: string }[]): Set<string> {
  const out = new Set<string>();
  for (const { cells } of tiles) for (const ch of cells) if (ch !== CELL_UNPAINTED) out.add(ch);
  return out;
}

/**
 * Where a texture goes in the map's palette (at most TEXTURE_CODES.length = MAX_TEXTURE_PALETTE entries): its
 * existing slot, else a new one at the end, else the first slot no painted square uses any more (its old texture is
 * gone from the map). Null when every slot is in use (SPRITE_PALETTE_FULL).
 */
export function paletteSlot<R extends SpriteRef>(
  palette: readonly R[],
  ref: R,
  used: ReadonlySet<string>,
): { palette: R[]; index: number; changed: boolean } | null {
  const found = palette.findIndex((p) => sameRef(p, ref));
  if (found >= 0) return { palette: [...palette], index: found, changed: false };
  if (palette.length < TEXTURE_CODES.length) return { palette: [...palette, ref], index: palette.length, changed: true };
  const free = palette.findIndex((_, i) => !used.has(TEXTURE_CODES[i]!));
  if (free < 0) return null;
  return { palette: palette.map((p, i) => (i === free ? ref : p)), index: free, changed: true };
}

/** The texture layer's code for palette slot `index`. */
export const textureCode = (index: number): string => TEXTURE_CODES[index]!;

/**
 * A map's texture tiles after writing `code` at `squares` (the client's optimistic copy of what `paintCells` stores
 * on the texture layer): touched tiles rewritten, emptied ones dropped.
 */
export function paintLayoutTextures<T extends { tile: number; cells: string }>(
  tiles: readonly T[],
  w: number,
  squares: readonly number[],
  code: string,
): { tile: number; cells: string }[] {
  let out: { tile: number; cells: string }[] = tiles.map(({ tile, cells }) => ({ tile, cells }));
  for (const [tile, positions] of squaresByTile(squares, w)) {
    const i = out.findIndex((t) => t.tile === tile);
    const before = i >= 0 ? out[i]!.cells : null;
    if (before === null && code === CELL_UNPAINTED) continue;
    const after = paintTile(before, w, positions, code);
    if (isEmptyTile(after)) out = out.filter((_, j) => j !== i);
    else if (i >= 0) out = out.map((t, j) => (j === i ? { tile, cells: after } : t));
    else out.push({ tile, cells: after });
  }
  return out;
}
