/**
 * Sprite layouts from Claude (plan sprite-packs, tracer P7). A Sprites map is laid out from a palette: the chosen
 * setting's built-in sprites and textures, common's, and the GM's uploaded sprites that belong to the setting (Q3).
 * `spritePrompt` tells Claude the palette; `cleanSpriteLayout` turns its reply into a storable layout the way C1's
 * `clean()` does (unknown sprites dropped, caps, numbers clamped) and gives every object its Classic kind from the
 * catalog or the uploaded row (D1), so Classic still draws the map.
 *
 * Framework-free with relative imports (CH6): Convex runs it, tests import it. Uploaded ids stay a type parameter
 * (`U`) so the server keeps its `Id<"spritePackSprites">` type without a cast.
 */

import { clean, isObjectKind, isTerrain, MAX_AREAS, MAX_OBJECTS, OBJECT_R_MAX, OBJECT_R_MIN, OBJECT_VARIANTS } from "../domain/combat-map/spec";
import type { AreaShape, ObjectKind, ObjectVariant, Terrain } from "../domain/combat-map/spec";
import type { SightMode } from "../domain/combat-map/sight";
import { CATALOG, slugify, type ObjectEntry, type TextureEntry } from "./catalog";
import { COMMON_FOLDER, isSettingId } from "./settings";

/** A sprite ref with the server's uploaded-id type (`{builtin: key}` or `{uploaded: id}`, convex spriteRefValidator). */
export type PaletteRef<U extends string = string> = { builtin: string } | { uploaded: U };

/** One sprite Claude may place: the token it writes, what it stores, and what the prompt and the cleaner need. */
export type PaletteEntry<U extends string = string> = {
  /** What Claude writes: a built-in key (`tavern/keg`) or `custom/<slug>` for an uploaded sprite. */
  readonly token: string;
  readonly ref: PaletteRef<U>;
  readonly name: string;
  readonly category: "object" | "texture";
  /** Size in squares. */
  readonly w: number;
  readonly h: number;
  readonly sight: SightMode;
  /** Objects: the Classic look (D1, D2). Textures: the kind is unused. */
  readonly classicKind: ObjectKind;
  readonly classicVariant?: ObjectVariant;
  /** Textures: the terrain class they paint (vision reads it). */
  readonly terrain?: Terrain;
  /** True for the setting's own sprites (built-in folder or uploaded), false for common's. */
  readonly own: boolean;
};

export type SpritePalette<U extends string = string> = {
  readonly entries: readonly PaletteEntry<U>[];
  readonly byToken: ReadonlyMap<string, PaletteEntry<U>>;
};

/** The fields of an uploaded `spritePackSprites` row the palette reads. */
export type UploadedPaletteRow<U extends string = string> = {
  readonly _id: U;
  readonly name: string;
  readonly category: "object" | "texture";
  readonly w: number;
  readonly h: number;
  readonly sight: SightMode;
  readonly classicKind: string;
  readonly classicVariant?: string;
  readonly terrain?: string;
};

const VARIANTS: ReadonlySet<string> = new Set(OBJECT_VARIANTS);

function objectEntry<U extends string>(e: ObjectEntry, own: boolean): PaletteEntry<U> {
  return {
    token: e.key,
    ref: { builtin: e.key },
    name: e.name,
    category: "object",
    w: e.w,
    h: e.h,
    sight: e.sight,
    classicKind: e.classic.kind,
    ...(e.classic.variant ? { classicVariant: e.classic.variant } : {}),
    own,
  };
}

function textureEntry<U extends string>(e: TextureEntry, own: boolean): PaletteEntry<U> {
  return { token: e.key, ref: { builtin: e.key }, name: e.name, category: "texture", w: e.w, h: e.h, sight: "none", classicKind: "rubble", terrain: e.terrain, own };
}

/**
 * The palette of a setting: `folder` (a built-in setting id, or null for a GM pack that is a setting of its own),
 * always common's built-ins (D7), and `uploaded` (the setting's pack sprites). Uploaded rows with a Classic kind or
 * terrain the app does not know are skipped. Tokens are unique: an uploaded slug that repeats gets `-2`, `-3`...
 */
export function buildPalette<U extends string>(folder: string | null, uploaded: readonly UploadedPaletteRow<U>[] = []): SpritePalette<U> {
  const entries: PaletteEntry<U>[] = [];
  const folders = folder !== null && isSettingId(folder) ? [folder, COMMON_FOLDER] : [COMMON_FOLDER];
  for (const id of folders) {
    const own = id !== COMMON_FOLDER;
    const cat = CATALOG[id as keyof typeof CATALOG];
    for (const e of [...cat.props, ...cat.large]) entries.push(objectEntry<U>(e, own));
    for (const e of cat.terrain) entries.push(textureEntry<U>(e, own));
  }
  const taken = new Set(entries.map((e) => e.token));
  for (const row of uploaded) {
    if (!isObjectKind(row.classicKind)) continue;
    if (row.category === "texture" && !isTerrain(row.terrain)) continue;
    const base = `custom/${slugify(row.name) || "sprite"}`;
    let token = base;
    for (let n = 2; taken.has(token); n++) token = `${base}-${n}`;
    taken.add(token);
    entries.push({
      token,
      ref: { uploaded: row._id },
      name: row.name,
      category: row.category,
      w: row.w,
      h: row.h,
      sight: row.category === "texture" ? "none" : row.sight,
      classicKind: row.classicKind,
      ...(row.classicVariant !== undefined && VARIANTS.has(row.classicVariant) ? { classicVariant: row.classicVariant as ObjectVariant } : {}),
      ...(row.category === "texture" && isTerrain(row.terrain) ? { terrain: row.terrain } : {}),
      own: true,
    });
  }
  return { entries, byToken: new Map(entries.map((e) => [e.token, e])) };
}

// ---------------------------------------------------------------- prompt

const PROMPT_TERRAINS = "grass,dirt,path,sand,water,deep,swamp,stone,cave,wall,wood,snow,lava,void";

function objectLine(e: PaletteEntry): string {
  return `${e.token} (${e.name}; ${e.w}x${e.h}; ${e.sight === "block" ? "blocks sight" : e.sight === "cover" ? "cover" : "flat"})`;
}

function textureLine(e: PaletteEntry): string {
  return `${e.token} (${e.name}; paints ${e.terrain ?? "stone"})`;
}

/**
 * The layout prompt of a Sprites map: the grid, the reply shape, the setting's and common's objects with size and
 * sight, the textures with their terrain class, and the GM's uploaded sprites (Q3). The setting decides the frame,
 * floors and vegetation, so a tavern comes out as a tavern and not as a forest clearing.
 */
export function spritePrompt(desc: string, w: number, h: number, settingLabel: string, palette: SpritePalette, variation?: number): string {
  const textures = palette.entries.filter((e) => e.category === "texture");
  const list = (entries: readonly PaletteEntry[], line: (e: PaletteEntry) => string) => entries.map(line).join("; ");
  const own = (want: boolean, cat: "object" | "texture") => palette.entries.filter((e) => e.category === cat && e.own === want);
  return (
    `You design top-down tabletop battle maps drawn with painted sprites (square grid, each cell is one 5-foot square). The SETTING is "${settingLabel}". Turn the GM's scene into a layout for a renderer.\n` +
    `GRID: ${w} columns x ${h} rows. Coordinates are in cells: x from 0 (left) to ${w}, y from 0 (top) to ${h}. Fractions are fine.\n` +
    `Reply with ONLY one JSON object: {"title": short scene name, "w": ${w}, "h": ${h}, "base": terrain filling the whole map, "plankV": true if wooden planks should run vertically, "areas": [...], "objects": [...]}\n` +
    `TERRAINS: ${PROMPT_TERRAINS}. ("wall" = solid rock or building walls, impassable; "cave" = cave floor; "stone" = flagstone floor; "wood" = planks; "deep" = deep water; "void" = black nothing).\n` +
    'AREAS are painted in order, later on top. Shapes: {"terrain","texture","shape":"rect","x","y","w","h"} | {"terrain","texture","shape":"ellipse","x","y","rx","ry"} (x,y = centre) | {"terrain","texture","shape":"poly","points":[[x,y],...]} | {"terrain","texture","shape":"path","points":[[x,y],...],"width"} for rivers, roads, corridors | {"terrain","texture","shape":"border","width"} for a frame around the edge. "texture" is optional: one of the TEXTURES below; it must paint the area\'s terrain.\n' +
    `OBJECTS: {"sprite","x","y","rot","scale"}: sprite = one of the SPRITES below, written exactly; x,y = centre in cells; rot = radians; scale = 0.5-2 (1 = the listed size in cells).\n` +
    `SPRITES of the setting: ${list(own(true, "object"), objectLine)}.\n` +
    `SPRITES for any setting: ${list(own(false, "object"), objectLine)}.\n` +
    `TEXTURES: ${list(textures, textureLine)}.\n` +
    `COMPOSITION: make it look like a real painted battle map of a ${settingLabel} that matches the SCENE. Use the setting's sprites first, the any-setting ones to fill in. Frame it with edges that fit the setting (walls for interiors and buildings, cliffs for mountains, trees only where the setting or SCENE has vegetation) and keep an open, readable fighting space with cover in the middle. Straight edges for architecture, organic shapes outdoors. 25-90 objects, nothing overlapping awkwardly; large sprites against walls or edges. Never use anything the SCENE rules out. Interiors: base "wall", rooms as rect areas with a floor texture, doors as gaps.\n` +
    `SCENE: ${desc}` +
    (variation === undefined ? "" : `\n(Variation #${variation}: make a different layout from before.)`)
  );
}

// ---------------------------------------------------------------- cleaning

/** A cleaned sprite object as the server stores it: the Classic look (D1) plus the sprite ref. */
export type SpriteLayoutObject<U extends string = string> = {
  kind: ObjectKind;
  x: number;
  y: number;
  r: number;
  rot: number;
  variant?: ObjectVariant;
  len?: number;
  span?: number;
  sprite: PaletteRef<U>;
};

/** A cleaned area: C1's area plus an optional texture ref (Classic ignores it, D1). */
/** A layout area as the server stores it (C1 area fields; optional as in convex combatAreaValidator). */
export type LayoutArea = {
  terrain: Terrain;
  shape: AreaShape;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rx?: number;
  ry?: number;
  width?: number;
  points?: number[][];
};

export type SpriteLayoutArea<U extends string = string> = LayoutArea & { texture?: PaletteRef<U> };

export type SpriteLayout<U extends string = string> = {
  w: number;
  h: number;
  base: Terrain;
  plankV: boolean;
  title: string;
  areas: SpriteLayoutArea<U>[];
  objects: (SpriteLayoutObject<U> | ClassicLayoutObject)[];
};

/** An object without a sprite (the keyword layout's objects the setting has no stand-in for). */
export type ClassicLayoutObject = {
  kind: ObjectKind;
  x: number;
  y: number;
  r: number;
  rot: number;
  variant?: string;
  len?: number;
  span?: number;
  sight?: SightMode;
  lit?: boolean;
  points?: number[][];
};

/** Fewer areas plus objects than this is an unusable reply (the board's rule, as convex/combatMapGenerate.ts). */
export const MIN_SPRITE_PARTS = 3;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Claude's sprite reply as a storable layout of exactly `w` x `h` squares, or null when it is not an object or has
 * fewer than MIN_SPRITE_PARTS usable areas plus objects. Objects whose sprite is not in the palette (or is a texture)
 * are dropped; `scale` sets the radius (r = scale x max(w, h) / 2, D4); every number goes through C1's `clean()`.
 * An area's `texture` is kept only when it is a palette texture; the area then takes the texture's terrain class, so
 * vision and Classic agree with what is drawn.
 */
export function cleanSpriteLayout<U extends string>(raw: unknown, palette: SpritePalette<U>, w: number, h: number, seed: number): SpriteLayout<U> | null {
  if (!isRecord(raw)) return null;
  const head = clean({ ...raw, w, h, areas: [], objects: [] }, seed);
  if (head === null) return null;

  const areas: SpriteLayoutArea<U>[] = [];
  for (const a of Array.isArray(raw.areas) ? raw.areas.slice(0, MAX_AREAS * 2) : []) {
    if (areas.length >= MAX_AREAS || !isRecord(a)) continue;
    const texture = typeof a.texture === "string" ? palette.byToken.get(a.texture) : undefined;
    const tex = texture?.category === "texture" ? texture : undefined;
    const terrain = tex?.terrain ?? a.terrain;
    const area = clean({ w, h, areas: [{ ...a, terrain }], objects: [] }, seed)?.areas[0];
    if (area === undefined) continue;
    areas.push(tex ? { ...area, texture: tex.ref } : area);
  }

  const objects: SpriteLayoutObject<U>[] = [];
  for (const o of Array.isArray(raw.objects) ? raw.objects.slice(0, MAX_OBJECTS * 2) : []) {
    if (objects.length >= MAX_OBJECTS || !isRecord(o) || typeof o.sprite !== "string") continue;
    const entry = palette.byToken.get(o.sprite);
    if (entry === undefined || entry.category !== "object") continue;
    const scale = clamp(num(o.scale, 1), 0.5, 2);
    const r = clamp((scale * Math.max(entry.w, entry.h)) / 2, OBJECT_R_MIN, OBJECT_R_MAX);
    const cleaned = clean({ w, h, areas: [], objects: [{ kind: entry.classicKind, x: o.x, y: o.y, r, rot: o.rot }] }, seed)?.objects[0];
    if (cleaned === undefined) continue;
    objects.push({
      kind: cleaned.kind,
      x: cleaned.x,
      y: cleaned.y,
      r: cleaned.r,
      rot: Number.isFinite(cleaned.rot) ? cleaned.rot : 0,
      ...(entry.classicVariant ? { variant: entry.classicVariant } : {}),
      sprite: entry.ref,
    });
  }

  if (areas.length + objects.length < MIN_SPRITE_PARTS) return null;
  return { w: head.w, h: head.h, base: head.base, plankV: head.plankV, title: head.title.trim(), areas, objects };
}
