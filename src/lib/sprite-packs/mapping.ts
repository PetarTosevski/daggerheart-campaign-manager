/**
 * Classic -> sprite mapping tables (D1). On a Sprites map, an object without a
 * sprite ref is drawn with a sprite that stands in for its Classic kind, and
 * an area without a texture ref with a texture of its Classic terrain:
 * the setting's candidates first, else common's, else null (the painter then
 * draws that object or terrain the Classic way).
 *
 * A sprite stands in for a Classic kind only when vision would not notice the
 * swap: same kind, `standIn` not switched off, the kind's R7 sight default
 * and the kind's light (a mapped object has no ref, so vision reads the
 * Classic kind, D3).
 */

import type { ObjectKind, Terrain } from "../domain/combat-map/spec";
import { SIGHT_DEFAULTS } from "../domain/combat-map/sight";
import { MAP_LIGHT_REACH } from "../domain/combat-map/light";
import { CATALOG, TEXTURE_SQUARES, type FolderCatalog, type ObjectEntry, type TextureEntry } from "./catalog";
import { COMMON_FOLDER, type FolderId } from "./settings";

/** The sprite light a Classic kind gives (D2): its R9 map light, else none. */
export function classicLight(kind: string): "none" | "torch" | "campfire" {
  const reach = Object.prototype.hasOwnProperty.call(MAP_LIGHT_REACH, kind) ? MAP_LIGHT_REACH[kind] : undefined;
  const same = (other: readonly [number, number] | undefined) =>
    !!reach && !!other && reach[0] === other[0] && reach[1] === other[1];
  if (same(MAP_LIGHT_REACH.campfire)) return "campfire";
  if (same(MAP_LIGHT_REACH.torch)) return "torch";
  return "none";
}

function standsIn(entry: ObjectEntry): boolean {
  const kind = entry.classic.kind;
  return entry.standIn && entry.sight === SIGHT_DEFAULTS[kind] && entry.light === classicLight(kind);
}

type FolderMapping = {
  readonly kinds: ReadonlyMap<ObjectKind, readonly ObjectEntry[]>;
  readonly terrains: ReadonlyMap<Terrain, readonly TextureEntry[]>;
};

function buildMapping(folder: FolderCatalog): FolderMapping {
  const kinds = new Map<ObjectKind, ObjectEntry[]>();
  for (const entry of [...folder.props, ...folder.large]) {
    if (!standsIn(entry)) continue;
    const list = kinds.get(entry.classic.kind) ?? [];
    list.push(entry);
    kinds.set(entry.classic.kind, list);
  }
  const terrains = new Map<Terrain, TextureEntry[]>();
  for (const entry of folder.terrain) {
    const list = terrains.get(entry.terrain) ?? [];
    list.push(entry);
    terrains.set(entry.terrain, list);
  }
  return { kinds, terrains };
}

const MAPPING: ReadonlyMap<string, FolderMapping> = new Map(
  (Object.keys(CATALOG) as FolderId[]).map((id) => [id, buildMapping(CATALOG[id])]),
);

/**
 * Candidate sprites for a Classic kind in a setting: the setting's (narrowed
 * to the variant when some match it), else common's; empty when neither has one.
 * An unknown setting uses common only.
 */
export function spriteCandidates(kind: ObjectKind, variant: string | undefined, setting: string): readonly ObjectEntry[] {
  for (const folder of [setting, COMMON_FOLDER]) {
    const list = MAPPING.get(folder)?.kinds.get(kind);
    if (!list || list.length === 0) continue;
    if (variant) {
      const same = list.filter((e) => e.classic.variant === variant);
      if (same.length > 0) return same;
    }
    return list;
  }
  return [];
}

/**
 * A terrain's texture pool in a setting: `base`, the primary-sheet textures it
 * always had (the setting's, else common's), and `gained`, the extra-sheet
 * textures that only add variants (the setting's when it has any texture of
 * that terrain, else common's). Extras never displace a primary pool, so a
 * setting that fell back to common's primary textures keeps them.
 */
function texturePool(terrain: Terrain, setting: string): { base: readonly TextureEntry[]; gained: readonly TextureEntry[] } {
  const of = (folder: string) => MAPPING.get(folder)?.terrains.get(terrain) ?? [];
  const own = of(setting);
  const common = of(COMMON_FOLDER);
  const ownBase = own.filter((e) => e.extraSheet === undefined);
  const ownGained = own.filter((e) => e.extraSheet !== undefined);
  const base = ownBase.length > 0 ? ownBase : common.filter((e) => e.extraSheet === undefined);
  const gained = own.length > 0 ? ownGained : common.filter((e) => e.extraSheet !== undefined);
  return { base, gained };
}

/**
 * Candidate textures for a Classic terrain in a setting: the primary ones (the
 * setting's, else common's), then the extra-sheet variants (see texturePool).
 */
export function textureCandidates(terrain: Terrain, setting: string): readonly TextureEntry[] {
  const { base, gained } = texturePool(terrain, setting);
  return [...base, ...gained];
}

/** FNV-1a 32-bit hash; deterministic across server and browser. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The sprite key drawn for a Classic object without a ref; same inputs, same key. */
export function pickSprite(
  kind: ObjectKind,
  variant: string | undefined,
  setting: string,
  objectId: string,
  seed: number,
): string | null {
  const list = spriteCandidates(kind, variant, setting);
  if (list.length === 0) return null;
  return list[hash(`${objectId}|${seed}`) % list.length]?.key ?? null;
}

/**
 * The texture key for a Classic terrain at square (x, y). Squares of one
 * TEXTURE_SQUARES block share a pick; the painter's noise mask (P6) does the
 * fine variant mixing on top.
 *
 * Extra-sheet variants only add choices (TASK-SP-P11Z): the primary pick is
 * the same hash over the primary pool as before any extras existed, and a
 * second hash decides whether the block shows that pick or one of the gained
 * variants. A block that shows a primary texture shows exactly its old one.
 */
export function pickTexture(terrain: Terrain, setting: string, x: number, y: number, seed: number): string | null {
  const { base, gained } = texturePool(terrain, setting);
  const bx = Math.floor(x / TEXTURE_SQUARES);
  const by = Math.floor(y / TEXTURE_SQUARES);
  const block = `${terrain}|${bx}|${by}|${seed}`;
  const primary = base[hash(block) % Math.max(1, base.length)]?.key ?? null;
  if (gained.length === 0) return primary;
  const g = hash(`${block}|gained`) % (base.length + gained.length);
  return g < base.length ? primary : (gained[g - base.length]?.key ?? null);
}
