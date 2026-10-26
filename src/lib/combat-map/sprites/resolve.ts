// Sprite painter (sprite packs P6): which art an object or a terrain is drawn with on a Sprites map (D1).
//
// An object draws its own sprite ref (a built-in catalog key or an uploaded sprite), else the sprite that stands in for
// its Classic kind in the map's setting (P1's mapping tables, deterministic per object id and seed), else nothing: the
// painter then draws it the Classic way. A terrain square draws its explicit texture (texture cell, area texture), else
// the textures of its Classic terrain class in the setting and in common, else the Classic terrain.
// A broken ref (deleted upload, unknown key, file gone) counts as no ref (D9). Pure: no DOM, no React.

import { OBJECT_KINDS, type ObjectKind, type Terrain } from "../../domain/combat-map/spec";
import { BUILTIN_LOOKUP, builtinSpriteUrl } from "../../sprite-packs/builtin/index";
import type { SpriteFootprint, SpriteHeight, SpriteLight } from "../../sprite-packs/catalog/index";
import { pickSprite, textureCandidates } from "../../sprite-packs/mapping";
import { COMMON_FOLDER } from "../../sprite-packs/settings";
import type { SpriteRef } from "../../sprite-packs/traits";

/** An uploaded sprite as `combatMapStyle.spriteSources` returns it (GM and player rows share these fields). */
export interface UploadedSprite {
  readonly _id: string;
  readonly category: "object" | "texture";
  readonly w: number;
  readonly h: number;
  readonly light: SpriteLight;
  readonly height: SpriteHeight;
  readonly footprint: SpriteFootprint;
  readonly rotatable?: boolean;
  readonly px: { readonly w: number; readonly h: number };
  /** null when the file is gone: the object draws as if it had no sprite. */
  readonly url: string | null;
}

export type UploadedSprites = ReadonlyMap<string, UploadedSprite>;

/** The art an object is drawn with. */
export interface ObjectArt {
  readonly url: string;
  /** Size in squares (D4). */
  readonly w: number;
  readonly h: number;
  /** Pixel size of the file (it fits w x h squares, aspect kept). */
  readonly px: { readonly w: number; readonly h: number };
  readonly height: SpriteHeight;
  readonly light: SpriteLight;
  /** "ref": the object's own sprite, scaled by its `r` (D4); "mapped": stands in for the Classic kind (sized like it). */
  readonly via: "ref" | "mapped";
}

/** One texture a terrain square may draw. */
export interface TextureArt {
  readonly url: string;
  readonly rotatable: boolean;
  /** A number per texture, for seeded per-tile orientation. */
  readonly salt: number;
}

/** FNV-1a 32-bit hash (deterministic across server and browser, like P1's mapping). */
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A stable string for a ref (cache and diff key). */
export const refKey = (ref: SpriteRef): string => ("builtin" in ref ? `b:${ref.builtin}` : `u:${ref.uploaded}`);

/** A built-in object sprite's art; one of its cut variants (D8) is picked per `pickKey`. */
function builtinObjectArt(key: string, pickKey: string, via: ObjectArt["via"]): ObjectArt | null {
  const found = BUILTIN_LOOKUP.get(key);
  if (!found || !found.art || found.entry.category !== "object") return null;
  const files = [found.art, ...found.art.variants];
  const file = files.length === 1 ? found.art : files[hashText(`${pickKey}|${key}`) % files.length]!;
  const { entry } = found;
  return { url: builtinSpriteUrl(file), w: entry.w, h: entry.h, px: file.px, height: entry.height, light: entry.light, via };
}

/** The art of an object's own sprite ref, or null when the ref does not resolve to an object sprite with a file. */
export function refObjectArt(ref: SpriteRef, pickKey: string, uploaded: UploadedSprites): ObjectArt | null {
  if ("builtin" in ref) return builtinObjectArt(ref.builtin, pickKey, "ref");
  const row = uploaded.get(ref.uploaded);
  if (!row || row.category !== "object" || row.url === null) return null;
  return { url: row.url, w: row.w, h: row.h, px: row.px, height: row.height, light: row.light, via: "ref" };
}

/** The object fields resolution reads. */
export interface ResolvableObject {
  readonly id: string;
  readonly kind: string;
  readonly variant?: string | null;
  readonly sprite?: SpriteRef;
}

const OBJECT_KIND_SET: ReadonlySet<string> = new Set(OBJECT_KINDS);

/**
 * What an object is drawn with on a Sprites map (D1): its ref, else the stand-in for its Classic kind in `setting`
 * (else common), else null = the Classic drawing. `setting` is a built-in folder id; "" = common only.
 */
export function objectArt(o: ResolvableObject, setting: string, seed: number, uploaded: UploadedSprites): ObjectArt | null {
  if (o.sprite) {
    const own = refObjectArt(o.sprite, o.id, uploaded);
    if (own) return own;
  }
  if (!OBJECT_KIND_SET.has(o.kind)) return null;
  const key = pickSprite(o.kind as ObjectKind, o.variant ?? undefined, setting || COMMON_FOLDER, o.id, seed);
  return key ? builtinObjectArt(key, o.id, "mapped") : null;
}

/** An explicit texture ref's art, or null (broken, not a texture, no file). */
export function refTextureArt(ref: SpriteRef, uploaded: UploadedSprites): TextureArt | null {
  if ("builtin" in ref) {
    const found = BUILTIN_LOOKUP.get(ref.builtin);
    if (!found || !found.art || found.entry.category !== "texture") return null;
    return { url: builtinSpriteUrl(found.art), rotatable: found.entry.rotatable, salt: hashText(ref.builtin) };
  }
  const row = uploaded.get(ref.uploaded);
  if (!row || row.category !== "texture" || row.url === null) return null;
  return { url: row.url, rotatable: row.rotatable === true, salt: hashText(ref.uploaded) };
}

/**
 * The textures a Classic terrain class mixes on a Sprites map (D6): the setting's and common's, in that order.
 * Empty = paint that terrain the Classic way (wall, void, ... when the packs have none).
 */
export function terrainTextures(terrain: Terrain, setting: string): TextureArt[] {
  const out: TextureArt[] = [];
  const seen = new Set<string>();
  for (const folder of [setting || COMMON_FOLDER, COMMON_FOLDER]) {
    for (const entry of textureCandidates(terrain, folder)) {
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);
      const art = refTextureArt({ builtin: entry.key }, new Map());
      if (art) out.push(art);
    }
  }
  return out;
}
