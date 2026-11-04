/**
 * The hand-curated built-in catalog (tracer P1): every folder's sheets in the
 * prompts doc's grid order, and key lookups. The generated manifest (P4) adds
 * files and pixel sizes; traits come only from here.
 */

import type { FolderId } from "../settings";
import { CASTLE_INTERIOR } from "./castle-interior";
import { CAVE } from "./cave";
import { COAST_AND_BEACH } from "./coast-and-beach";
import { COMMON } from "./common";
import { CRYPT_AND_GRAVEYARD } from "./crypt-and-graveyard";
import { DESERT } from "./desert";
import { DUNGEON } from "./dungeon";
import { FOREST } from "./forest";
import { GRASSLAND_AND_ROAD } from "./grassland-and-road";
import { MOUNTAIN_AND_CLIFFS } from "./mountain-and-cliffs";
import { MUSHROOM_CAVERN } from "./mushroom-cavern";
import { RUINS } from "./ruins";
import { SEWERS } from "./sewers";
import { SHIP_DECK } from "./ship-deck";
import { SNOW_AND_TUNDRA } from "./snow-and-tundra";
import { SWAMP } from "./swamp";
import { TAVERN } from "./tavern";
import { TEMPLE } from "./temple";
import { TOWN_STREET_AND_MARKET } from "./town-street-and-market";
import type { CatalogEntry, FolderCatalog } from "./types";
import { VOLCANIC } from "./volcanic";

export * from "./types";

/** Each folder's builder, common first, then the settings in the prompts doc's order. */
const FOLDERS: Readonly<Record<FolderId, () => FolderCatalog>> = {
  common: COMMON,
  forest: FOREST,
  "grassland-and-road": GRASSLAND_AND_ROAD,
  "mountain-and-cliffs": MOUNTAIN_AND_CLIFFS,
  cave: CAVE,
  dungeon: DUNGEON,
  "crypt-and-graveyard": CRYPT_AND_GRAVEYARD,
  "castle-interior": CASTLE_INTERIOR,
  tavern: TAVERN,
  "town-street-and-market": TOWN_STREET_AND_MARKET,
  temple: TEMPLE,
  swamp: SWAMP,
  "snow-and-tundra": SNOW_AND_TUNDRA,
  desert: DESERT,
  "coast-and-beach": COAST_AND_BEACH,
  "ship-deck": SHIP_DECK,
  sewers: SEWERS,
  ruins: RUINS,
  "mushroom-cavern": MUSHROOM_CAVERN,
  volcanic: VOLCANIC,
};

const built: Partial<Record<FolderId, FolderCatalog>> = {};

/**
 * Every built-in folder, common first, then the settings in the prompts doc's order. Each folder is built on its first
 * read (dcm-uh6r: modules that only reach the sprite code, such as the Convex vision queries, never build the catalog).
 */
export const CATALOG: Readonly<Record<FolderId, FolderCatalog>> = Object.defineProperties(
  {} as Record<FolderId, FolderCatalog>,
  Object.fromEntries(
    (Object.entries(FOLDERS) as [FolderId, () => FolderCatalog][]).map(([id, build]) => [id, { enumerable: true, get: () => (built[id] ??= build()) }]),
  ),
);

/** A folder's entries: props, then large, then terrain, each in grid order. */
export function folderEntries(folder: FolderCatalog): readonly CatalogEntry[] {
  return [...folder.props, ...folder.large, ...folder.terrain];
}

let entries: readonly CatalogEntry[] | undefined;

/** Every built-in entry in catalog order (built on the first call, dcm-uh6r). */
export function catalogEntries(): readonly CatalogEntry[] {
  return (entries ??= Object.values(CATALOG).flatMap(folderEntries));
}

let byKey: ReadonlyMap<string, CatalogEntry> | undefined;

/** The catalog entry for a built-in key (D8), or null for an unknown key. */
export function catalogEntry(key: string): CatalogEntry | null {
  byKey ??= new Map(catalogEntries().map((e) => [e.key, e]));
  return byKey.get(key) ?? null;
}

/** The folder part of a built-in key (`forest/oak-tree` -> `forest`). */
export function folderOfKey(key: string): string {
  const slash = key.indexOf("/");
  return slash < 0 ? "" : key.slice(0, slash);
}
