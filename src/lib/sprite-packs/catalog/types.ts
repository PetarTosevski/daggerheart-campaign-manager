/**
 * Built-in sprite catalog types and the helpers each per-folder catalog file
 * uses (plan sprite-packs, tracer P1). Pure TypeScript, relative imports only.
 *
 * An entry is either an object sprite (props / large sheets) or a terrain
 * texture (terrain sheet). Every entry carries the traits the vision engine
 * and the painter need, so traits never depend on the generated manifest.
 */

import type { ObjectKind, ObjectVariant, Terrain } from "../../domain/combat-map/spec";
import type { SightMode } from "../../domain/combat-map/sight";

/** Sheets per folder, in the order the prompts doc lists them. */
export const SHEETS = ["props", "large", "terrain"] as const;
export type Sheet = (typeof SHEETS)[number];

/** Items per sheet (props 4 x 4, large 3 x 3, terrain 2 x 2). */
export const SHEET_COUNTS: Readonly<Record<Sheet, number>> = { props: 16, large: 9, terrain: 4 };

/**
 * Light a sprite gives (Q1 = b). "torch" and "campfire" are R9's map-light
 * reaches; "faintglow" is the new faint-glow reach (clear 1, dim 3) that P3
 * defines in src/lib/domain/combat-map/light.ts.
 */
export const SPRITE_LIGHTS = ["none", "faintglow", "torch", "campfire"] as const;
export type SpriteLight = (typeof SPRITE_LIGHTS)[number];

/** Shadow height (D5): flat = no shadow. */
export const SPRITE_HEIGHTS = ["flat", "low", "tall"] as const;
export type SpriteHeight = (typeof SPRITE_HEIGHTS)[number];

/** What blocks sight: a circle (scaled by blockRadiusFactor) or a w x h rectangle. */
export const SPRITE_FOOTPRINTS = ["circle", "rect"] as const;
export type SpriteFootprint = (typeof SPRITE_FOOTPRINTS)[number];

export type SpriteCategory = "object" | "texture";

/** Squares per side one terrain swatch covers when tiled (D4). */
export const TEXTURE_SQUARES = 4;

/** Smallest and largest sprite side in squares. */
export const SPRITE_SIZE_MIN = 1;
export const SPRITE_SIZE_MAX = 4;

/** The Classic look of a sprite (D1, D2): one of the 22 kinds, optionally a variant. */
export type ClassicFallback = {
  readonly kind: ObjectKind;
  readonly variant?: ObjectVariant;
};

type EntryBase = {
  /** Stable key `<folder>/<slug of name>` (D8). */
  readonly key: string;
  /** The item's name exactly as the prompts doc writes it. */
  readonly name: string;
  /** The sheet layout: a primary sheet, or the layout of the extra sheet the item is on. */
  readonly sheet: Sheet;
  /**
   * Set only for an item drawn on an extra sheet: that sheet's id without the
   * folder (`large-2` for `town-street-and-market/large-2.jpg`). Such items are
   * new catalog items with their own keys and traits (not variants); they come
   * after the primary sheet's items in their sheet's list.
   */
  readonly extraSheet?: string;
  /** 0-based position on its sheet (the extra sheet, if any) in reading order (the cutter labels by it). */
  readonly index: number;
  /** Size in squares (D4). */
  readonly w: number;
  readonly h: number;
  readonly sight: SightMode;
  readonly light: SpriteLight;
  readonly height: SpriteHeight;
  readonly footprint: SpriteFootprint;
};

export type ObjectEntry = EntryBase & {
  readonly category: "object";
  readonly classic: ClassicFallback;
  /**
   * Whether the mapping tables may use this sprite to stand in for its
   * Classic kind on objects without a sprite ref (D1). Default true; false
   * for sprites that only roughly resemble their Classic kind.
   */
  readonly standIn: boolean;
};

export type TextureEntry = EntryBase & {
  readonly category: "texture";
  /** The Classic terrain class this texture paints (D6); vision reads it. */
  readonly terrain: Terrain;
  /** Seeded rotation / flip per tile is allowed (not planks, tiles, paths). */
  readonly rotatable: boolean;
};

export type CatalogEntry = ObjectEntry | TextureEntry;

/**
 * One folder's three sheets, each in grid order. An extra sheet's items are
 * appended to the list of the sheet whose layout it uses (`large-2` -> large),
 * so the mapping tables and lookups see them like any other item.
 */
export type FolderCatalog = {
  readonly folder: string;
  readonly props: readonly ObjectEntry[];
  readonly large: readonly ObjectEntry[];
  readonly terrain: readonly TextureEntry[];
};

// ---------------------------------------------------------------- builders

/** Appended to a texture key whose slug equals an object's in the same folder. */
export const TEXTURE_KEY_SUFFIX = "-terrain";

/** Id of an extra sheet: `<props|large|terrain>-<suffix>` (the file name without extension). */
export const EXTRA_SHEET_ID = /^(props|large|terrain)-[a-z0-9-]+$/;

/** The id of the sheet an entry is drawn on: `props`, `large`, `terrain` or an extra sheet's id. */
export function entrySheetId(entry: Pick<EntryBase, "sheet" | "extraSheet">): string {
  return entry.extraSheet ?? entry.sheet;
}

/** The entries of a folder sheet list that are drawn on the given sheet id. */
export function entriesOnSheet<E extends CatalogEntry>(entries: readonly E[], sheetId: string): E[] {
  return entries.filter((e) => entrySheetId(e) === sheetId);
}

/** `bird's nest (on the ground)` -> `birds-nest-on-the-ground` (D8). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type ObjectOptions = {
  readonly variant?: ObjectVariant;
  readonly light?: SpriteLight;
  readonly footprint?: SpriteFootprint;
  readonly w?: number;
  readonly h?: number;
  readonly standIn?: boolean;
};

/** An object spec before the folder assigns key, sheet and index. */
export type ObjectSpec = Omit<ObjectEntry, "key" | "sheet" | "index" | "w" | "h"> & {
  readonly w?: number;
  readonly h?: number;
};

export type TextureSpec = Pick<TextureEntry, "name" | "terrain" | "rotatable">;

/** An object sprite: name, sight (D3), shadow height (D5), Classic kind (D2). */
export function obj(
  name: string,
  sight: SightMode,
  height: SpriteHeight,
  kind: ObjectKind,
  opts: ObjectOptions = {},
): ObjectSpec {
  return {
    category: "object",
    name,
    sight,
    height,
    light: opts.light ?? "none",
    footprint: opts.footprint ?? "circle",
    classic: opts.variant ? { kind, variant: opts.variant } : { kind },
    standIn: opts.standIn ?? true,
    ...(opts.w !== undefined ? { w: opts.w } : {}),
    ...(opts.h !== undefined ? { h: opts.h } : {}),
  };
}

/** A long large object: 2 x 1 squares, rectangular footprint (D4). */
export function long(
  name: string,
  sight: SightMode,
  height: SpriteHeight,
  kind: ObjectKind,
  opts: ObjectOptions = {},
): ObjectSpec {
  return obj(name, sight, height, kind, { footprint: "rect", ...opts, w: 2, h: 1 });
}

/** A terrain texture: name, Classic terrain class, rotatable (D6). */
export function tex(name: string, terrain: Terrain, rotatable: boolean): TextureSpec {
  return { name, terrain, rotatable };
}

/** Items of extra sheets, by sheet id: object specs on props / large layouts, textures on terrain layouts. */
export type ExtraSheets = {
  readonly [id: `props-${string}` | `large-${string}`]: readonly ObjectSpec[];
} & {
  readonly [id: `terrain-${string}`]: readonly TextureSpec[];
};

/**
 * Builds one folder's catalog: assigns key, sheet, grid index and the default
 * size per sheet (props 1 x 1, large 2 x 2, textures TEXTURE_SQUARES). Items of
 * extra sheets (`extras`, keyed by sheet id) become new entries appended to
 * their layout's list, indexed by their position on the extra sheet. Throws on
 * a bad extra-sheet id or a duplicate key.
 */
export function defineFolder(
  folder: string,
  sheets: {
    readonly props: readonly ObjectSpec[];
    readonly large: readonly ObjectSpec[];
    readonly terrain: readonly TextureSpec[];
    readonly extras?: ExtraSheets;
  },
): FolderCatalog {
  const objects = (sheet: "props" | "large", specs: readonly ObjectSpec[], extraSheet?: string): ObjectEntry[] => {
    const size = sheet === "props" ? 1 : 2;
    return specs.map((s, index) => ({
      ...s,
      key: `${folder}/${slugify(s.name)}`,
      sheet,
      ...(extraSheet ? { extraSheet } : {}),
      index,
      w: s.w ?? size,
      h: s.h ?? size,
    }));
  };
  const extras = Object.entries(sheets.extras ?? {}) as Array<[string, readonly (ObjectSpec | TextureSpec)[]]>;
  for (const [id] of extras) if (!EXTRA_SHEET_ID.test(id)) throw new Error(`${folder}: bad extra sheet id "${id}"`);
  const extrasOf = (sheet: Sheet) => extras.filter(([id]) => id.startsWith(`${sheet}-`));
  const objectList = (sheet: "props" | "large", specs: readonly ObjectSpec[]) => [
    ...objects(sheet, specs),
    ...extrasOf(sheet).flatMap(([id, list]) => objects(sheet, list as readonly ObjectSpec[], id)),
  ];
  const props = objectList("props", sheets.props);
  const large = objectList("large", sheets.large);
  const objectKeys = new Set([...props, ...large].map((e) => e.key));
  // A texture named like an object of the same folder (volcanic "cracked basalt")
  // gets the TEXTURE_KEY_SUFFIX so keys stay unique.
  const textureKey = (name: string) => {
    const key = `${folder}/${slugify(name)}`;
    return objectKeys.has(key) ? `${key}${TEXTURE_KEY_SUFFIX}` : key;
  };
  const textures = (specs: readonly TextureSpec[], extraSheet?: string): TextureEntry[] =>
    specs.map((t, index) => ({
      ...t,
      category: "texture",
      key: textureKey(t.name),
      sheet: "terrain",
      ...(extraSheet ? { extraSheet } : {}),
      index,
      w: TEXTURE_SQUARES,
      h: TEXTURE_SQUARES,
      sight: "none",
      light: "none",
      height: "flat",
      footprint: "rect",
    }));
  const terrain = [
    ...textures(sheets.terrain),
    ...extrasOf("terrain").flatMap(([id, list]) => textures(list as readonly TextureSpec[], id)),
  ];
  const seen = new Set<string>();
  for (const e of [...props, ...large, ...terrain]) {
    if (seen.has(e.key)) throw new Error(`${folder}: duplicate key ${e.key}`);
    seen.add(e.key);
  }
  return { folder, props, large, terrain };
}
