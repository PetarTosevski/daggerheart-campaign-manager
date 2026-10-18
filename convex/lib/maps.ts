import type { z } from "zod";

import { appError } from "../../src/lib/errors/app-error";
import { hexKey, neighbours, type Hex } from "../../src/lib/world/hex";
import {
  MAP_SCALARS_VERSION,
  MAX_HEXES,
  MAX_TOKENS,
  TERRAIN_TILES,
  assembleTerrain,
  crawlHexSchema,
  initialMapState,
  joinMapState,
  mapScalarsSchema,
  mapStateSchema,
  mapTokenSchema,
  playerCanSeeToken,
  playerMapView,
  splitMapState,
  terrainTile,
  type CrawlHex,
  type MapScalars,
  type MapState,
  type MapToken,
  type PlayerMapState,
} from "../../src/lib/world/map-state";
import { suggestedTerrain } from "../../src/lib/world/terrain";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { parseOrCorrupt } from "./blobs";

// The World map is stored as rows (CD8, CD10): `maps` holds the scalars,
// `mapTokens` one row per marker, `mapHexes` one row per hex, `mapTerrain`
// the painted grid in tiles. Edits write only the rows they touch.
// A map still in version 1 (one `MapState` document) reads as before and is
// split into rows by its first edit or by `migrations/maps:splitMaps`.

type Stored = { version: 1; state: MapState } | { version: 2; scalars: MapScalars };

/** A `maps` row's `data` by version (CD3): no `schemaVersion` is version 1. Throws MAP_CORRUPT. */
export function storedMap(raw: unknown): Stored {
  const version = typeof raw === "object" && raw !== null ? (raw as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (version === undefined) {
    const { scalars, tokens, hexes, terrain } = splitMapState(parseOrCorrupt(mapStateSchema, raw, "MAP_CORRUPT"));
    // Round-tripped so it reads exactly as its rows will after the split (markers by id, hexes by q and r).
    return { version: 1, state: joinMapState(scalars, tokens, hexes, terrain) };
  }
  if (version === MAP_SCALARS_VERSION) return { version: 2, scalars: parseOrCorrupt(mapScalarsSchema, raw, "MAP_CORRUPT") };
  throw appError("MAP_CORRUPT");
}

function mapRow(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  return ctx.db
    .query("maps")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .unique();
}

export function toToken(row: Doc<"mapTokens">): MapToken {
  return { id: row.tokenId, type: row.type, x: row.x, y: row.y, name: row.name, notes: row.notes, hidden: row.hidden, location: row.location };
}

export function toHex(row: Doc<"mapHexes">): CrawlHex {
  return {
    q: row.q,
    r: row.r,
    explored: row.explored,
    ...(row.terrain !== undefined ? { terrain: row.terrain } : {}),
    ...(row.habitat !== undefined ? { habitat: row.habitat } : {}),
    ...(row.region !== undefined ? { region: row.region } : {}),
    ...(row.poi !== undefined ? { poi: row.poi } : {}),
  };
}

// Markers and hexes are capped (MAX_TOKENS, hexCount ≤ MAX_HEXES), so these ranges are bounded.
async function tokenRows(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  return ctx.db
    .query("mapTokens")
    .withIndex("by_campaign_token", (q) => q.eq("campaignId", campaignId))
    .take(MAX_TOKENS);
}

async function hexRows(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  return ctx.db
    .query("mapHexes")
    .withIndex("by_campaign_q_r", (q) => q.eq("campaignId", campaignId))
    .take(MAX_HEXES);
}

async function terrainRows(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  return ctx.db
    .query("mapTerrain")
    .withIndex("by_campaign_tile", (q) => q.eq("campaignId", campaignId))
    .take(TERRAIN_TILES);
}

export async function hexRow(ctx: QueryCtx, campaignId: Id<"campaigns">, h: Hex) {
  return ctx.db
    .query("mapHexes")
    .withIndex("by_campaign_q_r", (q) => q.eq("campaignId", campaignId).eq("q", h.q).eq("r", h.r))
    .unique();
}

export async function tokenRow(ctx: QueryCtx, campaignId: Id<"campaigns">, tokenId: number) {
  return ctx.db
    .query("mapTokens")
    .withIndex("by_campaign_token", (q) => q.eq("campaignId", campaignId).eq("tokenId", tokenId))
    .unique();
}

/** The initial scalars of a map never saved (its markers may already be rows: adding one writes no `maps` row). */
function initialScalars(frameId: string): MapScalars {
  return splitMapState(initialMapState(frameId)).scalars;
}

/** The map's stored version; a map with no `maps` row is version 2 with the initial scalars. */
async function storedFor(ctx: QueryCtx, campaign: Doc<"campaigns">): Promise<{ row: Doc<"maps"> | null; stored: Stored }> {
  const row = await mapRow(ctx, campaign._id);
  return { row, stored: row ? storedMap(row.data) : { version: 2, scalars: initialScalars(campaign.frameId) } };
}

/** The campaign's whole map: the GM's view. Throws MAP_CORRUPT on bad data. */
export async function readMap(ctx: QueryCtx, campaign: Doc<"campaigns">): Promise<MapState> {
  const { stored } = await storedFor(ctx, campaign);
  if (stored.version === 1) return stored.state;
  const [tokens, hexes, tiles] = await Promise.all([
    tokenRows(ctx, campaign._id),
    stored.scalars.hexCrawl ? hexRows(ctx, campaign._id) : [],
    terrainRows(ctx, campaign._id),
  ]);
  return joinMapState(stored.scalars, tokens.map(toToken), hexes.map(toHex), assembleTerrain(suggestedTerrain(campaign.frameId), tiles));
}

/**
 * The players' map (`playerMapView`, filtered here on the server), and the
 * uploaded map's storage id for its URL (never sent to players). Of the hex
 * crawl it reads only explored hexes and the party's neighbourhood.
 */
export async function readPlayerMap(ctx: QueryCtx, campaign: Doc<"campaigns">): Promise<{ state: PlayerMapState; storageId: string | undefined }> {
  const { stored } = await storedFor(ctx, campaign);
  if (stored.version === 1) return { state: playerMapView(stored.state), storageId: stored.state.customMap?.storageId };
  const { scalars } = stored;
  const [tokens, hexes, tiles] = await Promise.all([
    tokenRows(ctx, campaign._id),
    scalars.hexCrawl ? visibleHexRows(ctx, campaign._id, scalars.hexCrawl.party) : [],
    terrainRows(ctx, campaign._id),
  ]);
  const full = joinMapState(scalars, tokens.map(toToken), hexes.map(toHex), assembleTerrain(suggestedTerrain(campaign.frameId), tiles));
  return { state: playerMapView(full), storageId: scalars.customMap?.storageId };
}

function exploredHexRows(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  return ctx.db
    .query("mapHexes")
    .withIndex("by_campaign_explored", (q) => q.eq("campaignId", campaignId).eq("explored", true))
    .take(MAX_HEXES);
}

/**
 * Whether players may see each marker (`playerCanSeeToken`), for player views
 * that list markers without the map (codex pins, Locations). Of the hex crawl
 * it reads only the explored hexes. Throws MAP_CORRUPT.
 */
export async function playerTokenFilter(ctx: QueryCtx, campaign: Doc<"campaigns">): Promise<(token: MapToken) => boolean> {
  const { stored } = await storedFor(ctx, campaign);
  if (stored.version === 1) {
    const { hexCrawl } = stored.state;
    return playerCanSeeToken(stored.state, hexCrawl, hexCrawl?.hexes.filter((h) => h.explored) ?? []);
  }
  const { hexCrawl } = stored.scalars;
  return playerCanSeeToken(stored.scalars, hexCrawl, hexCrawl ? await exploredHexRows(ctx, campaign._id) : []);
}

/** Explored hexes plus the party's hex and its neighbours: every hex `playerMapView` can keep. */
async function visibleHexRows(ctx: QueryCtx, campaignId: Id<"campaigns">, party: Hex | null): Promise<Doc<"mapHexes">[]> {
  const explored = await exploredHexRows(ctx, campaignId);
  const rows = new Map(explored.map((row) => [hexKey(row), row]));
  if (party) {
    for (const h of [party, ...neighbours(party)]) {
      if (rows.has(hexKey(h))) continue;
      const row = await hexRow(ctx, campaignId, h);
      if (row) rows.set(hexKey(h), row);
    }
  }
  return [...rows.values()];
}

/** The map's markers with the scalars that describe them (the dashboard's Locations panel). */
export async function readMapTokens(ctx: QueryCtx, campaign: Doc<"campaigns">): Promise<{ state: Pick<MapState, "party" | "customTypes" | "typeLabels">; tokens: MapToken[] }> {
  const { stored } = await storedFor(ctx, campaign);
  if (stored.version === 1) return { state: stored.state, tokens: stored.state.tokens };
  return { state: stored.scalars, tokens: (await tokenRows(ctx, campaign._id)).map(toToken) };
}

/** The campaign's map markers (codex pins), by id. Throws MAP_CORRUPT. */
export async function listMapTokens(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<MapToken[]> {
  const row = await mapRow(ctx, campaignId);
  const stored = row ? storedMap(row.data) : null;
  if (stored?.version === 1) return stored.state.tokens;
  return (await tokenRows(ctx, campaignId)).map(toToken);
}

// ---- Writes

/** `value` checked against `schema`, or INVALID with the first problem. */
export function valid<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw appError("INVALID", parsed.error.issues[0]?.message);
  return parsed.data;
}

/** The map's scalars ready to edit: `rowId` is null until the map is first saved. */
export type WritableMap = { rowId: Id<"maps"> | null; scalars: MapScalars };

/** The map's scalars for an edit; a version 1 map is split into rows first. */
export async function writableMap(ctx: MutationCtx, campaign: Doc<"campaigns">): Promise<WritableMap> {
  const row = await mapRow(ctx, campaign._id);
  if (!row) return { rowId: null, scalars: initialScalars(campaign.frameId) };
  const stored = storedMap(row.data);
  if (stored.version === 2) return { rowId: row._id, scalars: stored.scalars };
  return { rowId: row._id, scalars: await splitIntoRows(ctx, row, campaign.frameId, stored.state) };
}

/** Stores the map's scalars (one row). */
export async function saveScalars(ctx: MutationCtx, campaignId: Id<"campaigns">, map: WritableMap, scalars: MapScalars): Promise<void> {
  const data = valid(mapScalarsSchema, scalars);
  if (map.rowId) await ctx.db.patch("maps", map.rowId, { data, updatedAt: Date.now() });
  else await ctx.db.insert("maps", { campaignId, data, updatedAt: Date.now() });
}

/** Inserts or replaces one marker row. */
export async function writeToken(ctx: MutationCtx, campaignId: Id<"campaigns">, existing: Id<"mapTokens"> | null, token: MapToken): Promise<void> {
  const { id, ...fields } = valid(mapTokenSchema, token);
  const row = { campaignId, tokenId: id, ...fields };
  if (existing) await ctx.db.replace("mapTokens", existing, row);
  else await ctx.db.insert("mapTokens", row);
}

/** Inserts or replaces one hex row (a cleared field is removed). */
export async function writeHex(ctx: MutationCtx, campaignId: Id<"campaigns">, existing: Id<"mapHexes"> | null, hex: CrawlHex): Promise<void> {
  const row = { campaignId, ...valid(crawlHexSchema, hex) };
  if (existing) await ctx.db.replace("mapHexes", existing, row);
  else await ctx.db.insert("mapHexes", row);
}

/** The highest marker id in use, or 0. */
export async function lastTokenId(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<number> {
  const last = await ctx.db
    .query("mapTokens")
    .withIndex("by_campaign_token", (q) => q.eq("campaignId", campaignId))
    .order("desc")
    .first();
  return last?.tokenId ?? 0;
}

export async function tokenCount(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<number> {
  return (await tokenRows(ctx, campaignId)).length;
}

/** The current cells of the given terrain tiles (a missing tile is the frame's suggested terrain). */
export async function readTiles(ctx: QueryCtx, campaign: Doc<"campaigns">, tiles: readonly number[]): Promise<Map<number, string>> {
  const base = suggestedTerrain(campaign.frameId);
  const out = new Map<number, string>();
  for (const tile of tiles) {
    const row = await tileRow(ctx, campaign._id, tile);
    out.set(tile, row?.cells ?? terrainTile(base, tile));
  }
  return out;
}

function tileRow(ctx: QueryCtx, campaignId: Id<"campaigns">, tile: number) {
  return ctx.db
    .query("mapTerrain")
    .withIndex("by_campaign_tile", (q) => q.eq("campaignId", campaignId).eq("tile", tile))
    .unique();
}

/**
 * Stores terrain tiles (tile → its full cells). Only tiles whose cells change
 * are written; a tile that matches the suggested terrain is not stored.
 */
export async function writeTiles(ctx: MutationCtx, campaign: Doc<"campaigns">, tiles: ReadonlyMap<number, string>): Promise<void> {
  const base = suggestedTerrain(campaign.frameId);
  for (const [tile, cells] of tiles) {
    const row = await tileRow(ctx, campaign._id, tile);
    if (row) {
      if (row.cells !== cells) await ctx.db.patch("mapTerrain", row._id, { cells });
    } else if (cells !== terrainTile(base, tile)) {
      await ctx.db.insert("mapTerrain", { campaignId: campaign._id, tile, cells });
    }
  }
}

/**
 * Splits a version 1 map into rows and stores its scalars as version 2.
 * Idempotent: rows a previous split left for the campaign are replaced.
 * `frameId` null (campaign gone) stores every terrain tile.
 */
async function splitIntoRows(ctx: MutationCtx, row: Doc<"maps">, frameId: string | null, state: MapState): Promise<MapScalars> {
  const campaignId = row.campaignId;
  for (const old of await tokenRows(ctx, campaignId)) await ctx.db.delete("mapTokens", old._id);
  for (const old of await hexRows(ctx, campaignId)) await ctx.db.delete("mapHexes", old._id);
  for (const old of await terrainRows(ctx, campaignId)) await ctx.db.delete("mapTerrain", old._id);
  const { scalars, tokens, hexes, terrain } = splitMapState(state);
  for (const token of tokens) await writeToken(ctx, campaignId, null, token);
  for (const hex of hexes) await writeHex(ctx, campaignId, null, hex);
  const base = frameId === null ? null : suggestedTerrain(frameId);
  for (let tile = 0; tile < TERRAIN_TILES; tile++) {
    const cells = terrainTile(terrain, tile);
    if (base === null || cells !== terrainTile(base, tile)) await ctx.db.insert("mapTerrain", { campaignId, tile, cells });
  }
  await saveScalars(ctx, campaignId, { rowId: row._id, scalars }, scalars);
  return scalars;
}

/** The migration step: splits one `maps` row if it is still version 1. Returns whether it did. */
export async function splitMapRow(ctx: MutationCtx, row: Doc<"maps">): Promise<boolean> {
  const stored = storedMap(row.data);
  if (stored.version === 2) return false;
  const campaign = await ctx.db.get("campaigns", row.campaignId);
  await splitIntoRows(ctx, row, campaign?.frameId ?? null, stored.state);
  return true;
}
