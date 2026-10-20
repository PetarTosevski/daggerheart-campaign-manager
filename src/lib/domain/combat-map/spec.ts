/**
 * Map layout spec: the zod schema for a clean layout and `clean()`, the port of
 * the board's CMAP.clean that turns untrusted JSON (Claude's reply, the
 * keyword fallback) into a valid spec, dropping junk and keeping valid parts.
 */

import { z } from "zod";

/** Terrains the painter knows (the board's TER table, in its order). */
export const TERRAINS = [
  "grass",
  "dirt",
  "path",
  "sand",
  "water",
  "deep",
  "swamp",
  "stone",
  "cave",
  "wall",
  "wood",
  "snow",
  "lava",
  "void",
] as const;
export type Terrain = (typeof TERRAINS)[number];

/** Terrains that block sight (the board's WALLISH). */
export const SIGHT_BLOCKING_TERRAINS: ReadonlySet<Terrain> = new Set<Terrain>(["wall", "void"]);

/** Object kinds (the board's CMAP.KINDS, incl. walltorch and hull). */
export const OBJECT_KINDS = [
  "tree",
  "bush",
  "deadtree",
  "rock",
  "boulder",
  "tent",
  "campfire",
  "log",
  "crate",
  "barrel",
  "chest",
  "table",
  "pillar",
  "statue",
  "rubble",
  "mast",
  "mushroom",
  "torch",
  "walltorch",
  "crystal",
  "bones",
  "hull",
] as const;
export type ObjectKind = (typeof OBJECT_KINDS)[number];

export const AREA_SHAPES = ["rect", "ellipse", "poly", "path", "border"] as const;
export type AreaShape = (typeof AREA_SHAPES)[number];

/** Tree and bush colour variants named in the board's layout prompt. */
export const OBJECT_VARIANTS = ["green", "dark", "olive", "autumn", "pine", "pink"] as const;
export type ObjectVariant = (typeof OBJECT_VARIANTS)[number];

export const MAP_W_MIN = 12;
export const MAP_W_MAX = 44;
export const MAP_H_MIN = 10;
export const MAP_H_MAX = 32;
export const MAX_AREAS = 60;
export const MAX_OBJECTS = 300;
export const MAX_POINTS = 40;
export const MAX_TITLE = 80;
export const OBJECT_R_MIN = 0.3;
export const OBJECT_R_MAX = 4;
/** Coordinates may sit a little outside the map (paths start at -1). */
export const COORD_MARGIN = 4;

const finite = z.number().finite();
const point = z.tuple([finite, finite]);

export const areaSchema = z.object({
  terrain: z.enum(TERRAINS),
  shape: z.enum(AREA_SHAPES),
  x: finite,
  y: finite,
  w: finite,
  h: finite,
  rx: finite,
  ry: finite,
  width: finite,
  points: z.array(point).max(MAX_POINTS),
});
export type MapArea = z.infer<typeof areaSchema>;

export const mapObjectSchema = z.object({
  kind: z.enum(OBJECT_KINDS),
  x: finite,
  y: finite,
  r: finite.min(OBJECT_R_MIN).max(OBJECT_R_MAX),
  rot: finite,
  len: finite,
  span: finite,
  variant: z.enum(OBJECT_VARIANTS).optional(),
  points: z.array(point).max(MAX_POINTS),
  sight: z.enum(["block", "cover", "none"]).optional(),
  /** Lights only: false = switched off; unset = lit. */
  lit: z.literal(false).optional(),
});
export type MapObject = z.infer<typeof mapObjectSchema>;

export const mapSpecSchema = z.object({
  w: z.number().int().min(MAP_W_MIN).max(MAP_W_MAX),
  h: z.number().int().min(MAP_H_MIN).max(MAP_H_MAX),
  seed: z.number().int(),
  base: z.enum(TERRAINS),
  plankV: z.boolean(),
  title: z.string().max(MAX_TITLE),
  areas: z.array(areaSchema).max(MAX_AREAS),
  objects: z.array(mapObjectSchema).max(MAX_OBJECTS),
});
export type MapSpec = z.infer<typeof mapSpecSchema>;

const TERRAIN_SET: ReadonlySet<string> = new Set(TERRAINS);
const KIND_SET: ReadonlySet<string> = new Set(OBJECT_KINDS);
const SHAPE_SET: ReadonlySet<string> = new Set(AREA_SHAPES);
const VARIANT_SET: ReadonlySet<string> = new Set(OBJECT_VARIANTS);

export function isTerrain(value: unknown): value is Terrain {
  return typeof value === "string" && TERRAIN_SET.has(value);
}

export function isObjectKind(value: unknown): value is ObjectKind {
  return typeof value === "string" && KIND_SET.has(value);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A finite number from a number or numeric string, else the default. */
function num(value: unknown, fallback: number): number {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Port of the board's CMAP.clean: coerce an untrusted layout into a valid
 * MapSpec. Returns null for a non-object. Unknown terrains, shapes and object
 * kinds are dropped, numbers are coerced and clamped, lists are capped
 * (60 areas, 300 objects, 40 points), w is clamped to 12..44 and h to 10..32.
 * The result always passes `mapSpecSchema`.
 */
export function clean(raw: unknown, seed?: number): MapSpec | null {
  if (!isRecord(raw)) return null;
  const w = clamp(Math.trunc(num(raw.w, 30)) || 30, MAP_W_MIN, MAP_W_MAX);
  const h = clamp(Math.trunc(num(raw.h, 20)) || 20, MAP_H_MIN, MAP_H_MAX);
  const cx = (v: unknown, d: number) => clamp(num(v, d), -COORD_MARGIN, w + COORD_MARGIN);
  const cy = (v: unknown, d: number) => clamp(num(v, d), -COORD_MARGIN, h + COORD_MARGIN);
  const size = (v: unknown, d: number) => clamp(num(v, d), 0, Math.max(w, h) + COORD_MARGIN);
  const points = (value: unknown): [number, number][] =>
    Array.isArray(value)
      ? value
          .filter((p): p is unknown[] => Array.isArray(p) && p.length >= 2)
          .slice(0, MAX_POINTS)
          .map((p) => [cx(p[0], 0), cy(p[1], 0)])
      : [];

  const areas: MapArea[] = [];
  for (const a of Array.isArray(raw.areas) ? raw.areas.slice(0, MAX_AREAS * 2) : []) {
    if (areas.length >= MAX_AREAS) break;
    if (!isRecord(a) || !isTerrain(a.terrain) || typeof a.shape !== "string" || !SHAPE_SET.has(a.shape)) continue;
    const pts = points(a.points);
    const shape = a.shape as AreaShape;
    if (shape === "poly" && pts.length < 3) continue;
    if (shape === "path" && pts.length < 2) continue;
    areas.push({
      terrain: a.terrain,
      shape,
      x: cx(a.x, 0),
      y: cy(a.y, 0),
      w: size(a.w, 1),
      h: size(a.h, 1),
      rx: size(a.rx, 1),
      ry: size(a.ry, 1),
      width: size(a.width, 2),
      points: pts,
    });
  }

  const objects: MapObject[] = [];
  for (const o of Array.isArray(raw.objects) ? raw.objects.slice(0, MAX_OBJECTS * 2) : []) {
    if (objects.length >= MAX_OBJECTS) break;
    if (!isRecord(o) || !isObjectKind(o.kind)) continue;
    const object: MapObject = {
      kind: o.kind,
      x: cx(o.x, 0),
      y: cy(o.y, 0),
      r: clamp(num(o.r, 1), OBJECT_R_MIN, OBJECT_R_MAX),
      rot: num(o.rot, 0),
      len: clamp(num(o.len, 2.5), 0.5, 12),
      span: clamp(num(o.span, 4), 1, 12),
      points: points(o.points),
    };
    if (typeof o.variant === "string" && VARIANT_SET.has(o.variant)) object.variant = o.variant as ObjectVariant;
    if (o.sight === "block" || o.sight === "cover" || o.sight === "none") object.sight = o.sight;
    if (o.lit === false) object.lit = false;
    objects.push(object);
  }

  const spec: MapSpec = {
    w,
    h,
    seed: Math.trunc(num(seed, 0)) || 7,
    base: isTerrain(raw.base) ? raw.base : "grass",
    plankV: raw.plankV === true,
    title: typeof raw.title === "string" || typeof raw.title === "number" ? String(raw.title).slice(0, MAX_TITLE) : "",
    areas,
    objects,
  };
  return spec;
}
