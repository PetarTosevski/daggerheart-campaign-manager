import { appError } from "../../src/lib/errors/app-error";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { MAX_CHARACTERS_PER_CAMPAIGN } from "./characterSheet";
import { COMBAT_TERRAINS, type CombatTerrain } from "./validators/combatMaps";

/**
 * Shared helpers of the D9 combat map functions (C3–C7): caps the validators cannot express, the grid bounds,
 * the painted-cell encoding, loaders that keep every row inside the caller's campaign, and the child-row delete
 * used by C3's map delete and by the campaign purge. Callers are campaign/GM wrappers, so authorization is done;
 * these only scope and bound. Codes come from `src/lib/errors/combatMap.ts`.
 */

// ---------------------------------------------------------------- caps and bounds

/** Maps per campaign (`by_campaign_updated` `.take(MAX_COMBAT_MAPS)` checks it). */
export const MAX_COMBAT_MAPS = 30;
/** Tokens per map. */
export const MAX_COMBAT_TOKENS = 80;
/** Objects per map (also the layout's cap, board `CMAP.clean`). */
export const MAX_COMBAT_OBJECTS = 300;
/** Terrain areas per layout (board `CMAP.clean`). */
export const MAX_COMBAT_AREAS = 60;
/** Points per area, path or hull (board `CMAP.clean`). */
export const MAX_AREA_POINTS = 40;
/** Characters a token can be revealed to (R10): every character a campaign can hold. */
export const MAX_COMBAT_REVEALS = MAX_CHARACTERS_PER_CAMPAIGN;

/** Grid bounds in squares (board `CMAP.clean`, R1). */
export const MIN_MAP_W = 12;
export const MAX_MAP_W = 44;
export const MIN_MAP_H = 10;
export const MAX_MAP_H = 32;

/** The board's size presets (C3 create blank, C4 generate). */
export const MAP_SIZES = {
  small: { label: "Small", w: 22, h: 15 },
  medium: { label: "Medium", w: 30, h: 20 },
  large: { label: "Large", w: 40, h: 27 },
} as const;
export type MapSize = keyof typeof MAP_SIZES;

/** Token sizes in squares per side. */
export const MIN_TOKEN_SIZE = 1;
export const MAX_TOKEN_SIZE = 3;

export const MAX_MAP_NAME = 80;
/** The GM's scene description (C4). */
export const MAX_MAP_PROMPT = 1000;
export const MAX_TOKEN_NAME = 60;

/** An uploaded map image (C3): the same limit as the World map's image. */
export const MAX_COMBAT_IMAGE_BYTES = 8 * 1024 * 1024;

/** Version of a `combatMaps` row's shape (CD3). Readers dispatch on it; bump only with a migration (CD4). */
export const COMBAT_MAP_SCHEMA_VERSION = 1;

/** Refuses (COMBAT_MAP_SIZE) a map size outside the grid bounds or not a whole number of squares. */
export function assertMapSize(w: number, h: number): void {
  const ok = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  if (!ok(w, MIN_MAP_W, MAX_MAP_W) || !ok(h, MIN_MAP_H, MAX_MAP_H)) throw appError("COMBAT_MAP_SIZE");
}

// ---------------------------------------------------------------- painted cells

/** Map rows per `combatMapCells` tile: a brush stroke rewrites one or two small rows, never the whole layer. */
export const CELL_TILE_ROWS = 8;

/**
 * One character per square in a `combatMapCells.cells` string, by layer:
 * - terrain: `CELL_UNPAINTED` or `TERRAIN_CODES[i]` for `COMBAT_TERRAINS[i]`;
 * - block: `CELL_UNPAINTED` or `BLOCK_CODE` (blocks sight);
 * - fog: `CELL_UNPAINTED`, `FOG_REVEAL` or `FOG_HIDE` (the GM's marks, R12).
 */
export const CELL_UNPAINTED = ".";
export const TERRAIN_CODES = "abcdefghijklmn";
export const BLOCK_CODE = "#";
export const FOG_REVEAL = "r";
export const FOG_HIDE = "h";

/** The terrain a code stands for, or null for an unpainted (or unknown) code. */
export function terrainOfCode(code: string): CombatTerrain | null {
  const i = TERRAIN_CODES.indexOf(code);
  return i >= 0 && code.length === 1 ? (COMBAT_TERRAINS[i] ?? null) : null;
}

/** The code of a terrain. */
export function codeOfTerrain(terrain: CombatTerrain): string {
  return TERRAIN_CODES[COMBAT_TERRAINS.indexOf(terrain)]!;
}

/** An empty tile for a map `w` squares wide. */
export function emptyTile(w: number): string {
  return CELL_UNPAINTED.repeat(CELL_TILE_ROWS * w);
}

// ---------------------------------------------------------------- loaders

/** The map when the id is one of this campaign's maps, else COMBAT_MAP_NOT_FOUND (bad id, other campaign, deleted). */
export async function loadCombatMap(ctx: QueryCtx, campaignId: Id<"campaigns">, mapId: string): Promise<Doc<"combatMaps">> {
  const id = ctx.db.normalizeId("combatMaps", mapId);
  const map = id === null ? null : await ctx.db.get("combatMaps", id);
  if (map === null || map.campaignId !== campaignId) throw appError("COMBAT_MAP_NOT_FOUND");
  return map;
}

/** The campaign's live map (the one players see, R2), or null. */
export async function liveCombatMap(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"combatMaps"> | null> {
  return ctx.db
    .query("combatMaps")
    .withIndex("by_campaign_live", (q) => q.eq("campaignId", campaignId).eq("live", true))
    .first();
}

/** The token when the id is a token of this campaign, else COMBAT_TOKEN_NOT_FOUND. */
export async function loadCombatToken(ctx: QueryCtx, campaignId: Id<"campaigns">, tokenId: string): Promise<Doc<"combatTokens">> {
  const id = ctx.db.normalizeId("combatTokens", tokenId);
  const token = id === null ? null : await ctx.db.get("combatTokens", id);
  if (token === null || token.campaignId !== campaignId) throw appError("COMBAT_TOKEN_NOT_FOUND");
  return token;
}

/** The object and its map when the id is an object on one of this campaign's maps, else COMBAT_OBJECT_NOT_FOUND. */
export async function loadCombatObject(
  ctx: QueryCtx,
  campaignId: Id<"campaigns">,
  objectId: string,
): Promise<{ object: Doc<"combatMapObjects">; map: Doc<"combatMaps"> }> {
  const id = ctx.db.normalizeId("combatMapObjects", objectId);
  const object = id === null ? null : await ctx.db.get("combatMapObjects", id);
  const map = object === null ? null : await ctx.db.get("combatMaps", object.mapId);
  if (object === null || map === null || map.campaignId !== campaignId) throw appError("COMBAT_OBJECT_NOT_FOUND");
  return { object, map };
}

/** A map's tokens (at most MAX_COMBAT_TOKENS, so provably small). */
export async function tokensOnMap(ctx: QueryCtx, mapId: Id<"combatMaps">): Promise<Doc<"combatTokens">[]> {
  return ctx.db
    .query("combatTokens")
    .withIndex("by_map", (q) => q.eq("mapId", mapId))
    .take(MAX_COMBAT_TOKENS);
}

/** A map's objects (at most MAX_COMBAT_OBJECTS). */
export async function objectsOnMap(ctx: QueryCtx, mapId: Id<"combatMaps">): Promise<Doc<"combatMapObjects">[]> {
  return ctx.db
    .query("combatMapObjects")
    .withIndex("by_map", (q) => q.eq("mapId", mapId))
    .take(MAX_COMBAT_OBJECTS);
}

// ---------------------------------------------------------------- caps

/** Refuses (COMBAT_MAP_LIMIT) a new map when the campaign already has MAX_COMBAT_MAPS. */
export async function assertCanAddMap(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<void> {
  const maps = await ctx.db
    .query("combatMaps")
    .withIndex("by_campaign_updated", (q) => q.eq("campaignId", campaignId))
    .take(MAX_COMBAT_MAPS);
  if (maps.length >= MAX_COMBAT_MAPS) throw appError("COMBAT_MAP_LIMIT");
}

/** Refuses (COMBAT_TOKEN_LIMIT) `adding` more tokens when the map would hold more than MAX_COMBAT_TOKENS. */
export async function assertCanAddTokens(ctx: QueryCtx, mapId: Id<"combatMaps">, adding = 1): Promise<void> {
  if ((await tokensOnMap(ctx, mapId)).length + adding > MAX_COMBAT_TOKENS) throw appError("COMBAT_TOKEN_LIMIT");
}

/** Refuses (COMBAT_OBJECT_LIMIT) `adding` more objects when the map would hold more than MAX_COMBAT_OBJECTS. */
export async function assertCanAddObjects(ctx: QueryCtx, mapId: Id<"combatMaps">, adding = 1): Promise<void> {
  if ((await objectsOnMap(ctx, mapId)).length + adding > MAX_COMBAT_OBJECTS) throw appError("COMBAT_OBJECT_LIMIT");
}

/** Refuses (COMBAT_AREA_LIMIT) a layout with more than MAX_COMBAT_AREAS areas. */
export function assertAreaCount(count: number): void {
  if (count > MAX_COMBAT_AREAS) throw appError("COMBAT_AREA_LIMIT");
}

// ---------------------------------------------------------------- deleting

/**
 * Deletes up to `max` of a map's child rows (objects, painted cells, tokens, explored areas) and returns how many
 * it deleted; fewer than `max` means none are left. The map row and its image file are the caller's: C3's delete
 * removes them once this returns less than `max`, and the campaign purge deletes them with the campaign's files.
 */
export async function deleteMapChildren(ctx: MutationCtx, mapId: Id<"combatMaps">, max: number): Promise<number> {
  let deleted = 0;
  const objects = await ctx.db.query("combatMapObjects").withIndex("by_map", (q) => q.eq("mapId", mapId)).take(max);
  for (const row of objects) await ctx.db.delete("combatMapObjects", row._id);
  deleted += objects.length;
  if (deleted >= max) return deleted;
  const cells = await ctx.db
    .query("combatMapCells")
    .withIndex("by_map_layer_tile", (q) => q.eq("mapId", mapId))
    .take(max - deleted);
  for (const row of cells) await ctx.db.delete("combatMapCells", row._id);
  deleted += cells.length;
  if (deleted >= max) return deleted;
  const tokens = await ctx.db.query("combatTokens").withIndex("by_map", (q) => q.eq("mapId", mapId)).take(max - deleted);
  for (const row of tokens) await ctx.db.delete("combatTokens", row._id);
  deleted += tokens.length;
  if (deleted >= max) return deleted;
  const explored = await ctx.db
    .query("combatExplored")
    .withIndex("by_map_character", (q) => q.eq("mapId", mapId))
    .take(max - deleted);
  for (const row of explored) await ctx.db.delete("combatExplored", row._id);
  return deleted + explored.length;
}
