/**
 * The Sprites-style pickers of the editor (sprite packs P9): which object sprites and terrain textures the GM can
 * place or paint on a map, in order: the map's setting, then common, then the campaign's uploaded sprites. Built
 * from the catalog itself (every folder's props, large and terrain lists, extra sheets included), so a sprite the
 * catalog gains shows up here without editor changes. Pure: no React, no Convex client.
 */

import type { ObjectKind, Terrain } from "../../../lib/domain/combat-map/spec";
import { BUILTIN_LOOKUP, builtinSpriteUrl } from "../../../lib/sprite-packs/builtin/index";
import { CATALOG, folderEntries, type CatalogEntry, type SpriteFootprint, type SpriteHeight, type SpriteLight } from "../../../lib/sprite-packs/catalog/index";
import { COMMON_FOLDER, isSettingId } from "../../../lib/sprite-packs/settings";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { SpriteRef } from "../../../../convex/lib/validators/combatMaps";
import type { SightMode } from "../../../lib/domain/combat-map/sight";
import type { SpriteRef as LibSpriteRef } from "../../../lib/sprite-packs/traits";
import { builtinPlacement, uploadedPlacement, type SpritePlacement } from "./edit-model";

/** Where a picker item comes from (its group heading). */
export type PaletteGroup = "setting" | "common" | "uploaded";

type ItemBase = {
  readonly ref: SpriteRef;
  /** Stable key for lists and tests: the built-in key, or `uploaded:<id>`. */
  readonly key: string;
  /** Display name. */
  readonly name: string;
  readonly group: PaletteGroup;
  /** Thumbnail URL, or null while the sprite has no file. */
  readonly thumb: string | null;
  readonly w: number;
  readonly h: number;
  readonly sight: SightMode;
  readonly light: SpriteLight;
};

export type ObjectItem = ItemBase & { readonly category: "object"; readonly placement: SpritePlacement };
export type TextureItem = ItemBase & { readonly category: "texture"; readonly terrain: Terrain };

/** An uploaded sprite as the GM's `combatMapStyle.spriteSources` lists it. */
export type UploadedRow = {
  readonly _id: Id<"spritePackSprites">;
  readonly name: string;
  readonly category: "object" | "texture";
  readonly w: number;
  readonly h: number;
  readonly sight: SightMode;
  readonly light: SpriteLight;
  readonly height: SpriteHeight;
  readonly footprint: SpriteFootprint;
  readonly classicKind: ObjectKind;
  readonly classicVariant?: string;
  readonly terrain?: Terrain;
  readonly url: string | null;
};

export type SpritePalette = { readonly objects: readonly ObjectItem[]; readonly textures: readonly TextureItem[] };

/** `oak tree` -> `Oak tree` (catalog names are lower case, as the prompts doc writes them). */
export function displayName(name: string): string {
  return name.length === 0 ? name : name[0]!.toUpperCase() + name.slice(1);
}

function builtinItem(entry: CatalogEntry, group: PaletteGroup): ObjectItem | TextureItem | null {
  const art = BUILTIN_LOOKUP.get(entry.key)?.art ?? null;
  const base = {
    ref: { builtin: entry.key },
    key: entry.key,
    name: displayName(entry.name),
    group,
    thumb: art ? builtinSpriteUrl(art) : null,
    w: entry.w,
    h: entry.h,
    sight: entry.sight,
    light: entry.light,
  };
  if (entry.category === "texture") return { ...base, category: "texture", terrain: entry.terrain };
  const placement = builtinPlacement(entry.key);
  return placement ? { ...base, category: "object", placement } : null;
}

function uploadedItem(row: UploadedRow): ObjectItem | TextureItem | null {
  const base = {
    ref: { uploaded: row._id },
    key: `uploaded:${row._id}`,
    name: row.name,
    group: "uploaded" as const,
    thumb: row.url,
    w: row.w,
    h: row.h,
    sight: row.sight,
    light: row.light,
  };
  if (row.category === "texture") return row.terrain === undefined ? null : { ...base, category: "texture", terrain: row.terrain };
  return { ...base, category: "object", placement: uploadedPlacement(row) };
}

/**
 * The pickers for a map drawn in built-in setting `folder` ("" or an unknown id = common only, e.g. a GM pack
 * setting) with the uploaded sprites `uploaded` (the setting's packs and every uploaded ref on the map).
 */
export function spritePalette(folder: string, uploaded: readonly UploadedRow[]): SpritePalette {
  const objects: ObjectItem[] = [];
  const textures: TextureItem[] = [];
  const push = (item: ObjectItem | TextureItem | null) => {
    if (item === null) return;
    if (item.category === "object") objects.push(item);
    else textures.push(item);
  };
  if (isSettingId(folder)) for (const entry of folderEntries(CATALOG[folder])) push(builtinItem(entry, "setting"));
  for (const entry of folderEntries(CATALOG[COMMON_FOLDER])) push(builtinItem(entry, "common"));
  for (const row of uploaded) push(uploadedItem(row));
  return { objects, textures };
}

/** Items whose name contains every word of `query` (case-insensitive); all items for an empty query. */
export function searchPalette<T extends { readonly name: string }>(items: readonly T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter((item) => {
    const name = item.name.toLowerCase();
    return words.every((word) => name.includes(word));
  });
}

/** The display name of a sprite ref: the catalog name or the uploaded row's label; null when it does not resolve. */
export function spriteName(ref: LibSpriteRef, uploaded: ReadonlyMap<string, UploadedRow>): string | null {
  if ("builtin" in ref) {
    const found = BUILTIN_LOOKUP.get(ref.builtin);
    return found ? displayName(found.entry.name) : null;
  }
  return uploaded.get(ref.uploaded)?.name ?? null;
}

export const GROUP_LABEL: Readonly<Record<PaletteGroup, string>> = {
  setting: "This setting",
  common: "Common",
  uploaded: "Your sprites",
};
