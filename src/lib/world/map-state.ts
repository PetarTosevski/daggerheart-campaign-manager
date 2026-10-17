// World map state shared by the World board (D6) and Characters & Locations
// pins (D7). Ported from reference/designs/project/World.dc.html. Pure module:
// bundled into Convex.

import { z } from "zod";

import { DEFAULT_TRAVEL_RULES, SPEED_TERRAINS, TRAIL_MODES, TRAVEL_METHODS, TRAVEL_PACES, type SpeedTerrain } from "../domain/travel/index";
import type { PublishedFrameId } from "../frames/index";
import { MAX_HEX_SIZE, MIN_HEX_SIZE, visibleHexKeys, hexKey } from "./hex";
import { BLANK_TERRAIN, TERRAIN_COLUMNS, TERRAIN_ROWS, WITHERWILD_TERRAIN } from "./terrain";

export { TERRAIN_CODES, TERRAIN_COLUMNS, TERRAIN_ROWS } from "./terrain";

export const BUILTIN_TOKEN_TYPES = [
  "village",
  "city",
  "cave",
  "ruins",
  "temple",
  "dungeon",
  "ambush",
  "monster",
  "camp",
  "quest",
  "treasure",
  "landmark",
] as const;

/** Map art and width in km per published frame (the board's MAPS table). */
export const WORLD_MAPS: Record<PublishedFrameId, { asset: string; width: number; height: number; scaleKm: number }> = {
  witherwild: { asset: "30e1f9055a3fb07f7b9757744ff252b7", width: 1553, height: 1193, scaleKm: 400 },
  "five-banners-burning": { asset: "0324f5cce8dd7ddafaab98afb1e52c35", width: 3169, height: 2418, scaleKm: 900 },
  "beast-feast": { asset: "2b3cd581f42bb8f5d57baaad854f8fce", width: 2418, height: 3169, scaleKm: 300 },
  "age-of-umbra": { asset: "37022de6c1f227e428f30404da54273d", width: 3169, height: 2418, scaleKm: 600 },
  motherboard: { asset: "cededc1a7d491b939156e45165bff355", width: 3169, height: 2418, scaleKm: 400 },
  "colossus-of-the-drylands": { asset: "9b5f07cc6f1d2e9889c4121f2f3f03a5", width: 3169, height: 2418, scaleKm: 500 },
  "castle-high": { asset: "0b1a7dc08df5c136255e0f50a5101e7f", width: 3157, height: 2404, scaleKm: 12 },
  "reign-of-the-weredragon": { asset: "88ea2d92a5d4d6e732ffe14114d5ab2d", width: 2404, height: 3157, scaleKm: 800 },
  "dark-heart-of-andaluria": { asset: "05b31ac534fcba6a871f8dc1b9128e34", width: 3157, height: 2404, scaleKm: 400 },
  "journey-to-horizon": { asset: "b39beec08ef477314e2eb8bc801bcb56", width: 3400, height: 2228, scaleKm: 2650 },
};

const pct = z.number().min(0).max(100);

export const mapTokenSchema = z.object({
  id: z.number().int().min(1),
  type: z.string().min(1).max(40),
  x: pct,
  y: pct,
  name: z.string().max(80),
  notes: z.string().max(2000),
  /** Never sent to players (server-filtered). */
  hidden: z.boolean(),
  /** Listed on the dashboard's Locations panel. */
  location: z.boolean(),
});

const speed = z.number().min(1).max(1000);
const speedTable = z.object(Object.fromEntries(SPEED_TERRAINS.map((t) => [t, speed])) as Record<SpeedTerrain, typeof speed>);

/** GM overrides of the house-rule travel speeds (`DEFAULT_TRAVEL_RULES`). */
export const travelRulesSchema = z.object({
  speeds: z.object(Object.fromEntries(TRAVEL_METHODS.map((m) => [m, speedTable])) as Record<(typeof TRAVEL_METHODS)[number], typeof speedTable>),
  trail: z.object({ foot: speedTable, mount: speedTable }),
  slow: z.number().min(0.1).max(5),
  fast: z.number().min(0.1).max(5),
});

/** Most markers on one map. */
export const MAX_TOKENS = 500;
/** Most hexes one hex crawl stores. */
export const MAX_HEXES = 4000;

const hexCoord = z.number().int().min(-1000).max(1000);
export const HORIZON_TERRAIN = [1, 2, 3, 4] as const;
export const HORIZON_TRAVEL_MODES = ["land", "riverDown", "riverUp", "ocean"] as const;

export const crawlHexSchema = z.object({
  q: hexCoord,
  r: hexCoord,
  explored: z.boolean(),
  /** Terrain rating 1–4 (Optimal … Extreme). */
  terrain: z.number().int().min(1).max(4).optional(),
  habitat: z.string().max(60).optional(),
  region: z.string().max(60).optional(),
  /** Point of interest; a hidden one never reaches players. */
  poi: z.object({ text: z.string().min(1).max(200), hidden: z.boolean() }).optional(),
});

/** Journey to Horizon hex crawl (HF pp.171–177): replaces paces and painted terrain in that frame. */
export const hexCrawlSchema = z.object({
  grid: z.object({
    originX: z.number().min(-100000).max(100000),
    originY: z.number().min(-100000).max(100000),
    size: z.number().min(MIN_HEX_SIZE).max(MAX_HEX_SIZE),
    orientation: z.enum(["flat", "pointy"]),
  }),
  hexes: z.array(crawlHexSchema).max(MAX_HEXES),
  party: z.object({ q: hexCoord, r: hexCoord }).nullable(),
  /** The crawl's own day counter (Witherwild time stays Witherwild-only). */
  day: z.number().int().min(1).max(100000),
  travelMode: z.enum(HORIZON_TRAVEL_MODES),
  /** The last move's rolls: GM only. */
  lastMove: z
    .object({
      q: hexCoord,
      r: hexCoord,
      days: z.number().int().min(1).max(10),
      dice: z.array(z.number().int().min(1).max(8)).max(4),
      encounter: z.boolean(),
      weatherRoll: z.number().int().min(1).max(4).optional(),
    })
    .optional(),
});

export const mapStateSchema = z.object({
  tokens: z.array(mapTokenSchema).max(MAX_TOKENS),
  nextId: z.number().int().min(1),
  party: z.object({ x: pct, y: pct, trail: z.array(z.object({ x: pct, y: pct })).max(12) }),
  /** TERRAIN_COLUMNS × TERRAIN_ROWS characters from TERRAIN_CODES. */
  terrain: z.string().length(TERRAIN_COLUMNS * TERRAIN_ROWS).regex(/^[rwdmh.#]*$/),
  scaleKm: z.number().min(1).max(100000),
  options: z.object({
    method: z.enum(TRAVEL_METHODS),
    pace: z.enum(TRAVEL_PACES),
    hours: z.number().int().min(1).max(16),
    units: z.enum(["km", "mi"]),
    /** Header pace for the party trail and token distances. */
    trail: z.enum(TRAIL_MODES).default("foot"),
    /** GM overrides of the house-rule speeds; unset uses `DEFAULT_TRAVEL_RULES`. */
    rules: travelRulesSchema.optional(),
  }),
  customTypes: z.array(z.object({ id: z.string().min(1).max(40), label: z.string().max(40), icon: z.string().max(40), color: z.string().max(20) })).max(40),
  typeLabels: z.record(z.string(), z.string().max(40)),
  /** Custom campaigns (and optionally others): an uploaded map image. */
  customMap: z.object({ storageId: z.string().min(1), width: z.number().int().min(1).max(20000), height: z.number().int().min(1).max(20000) }).optional(),
  /** Journey to Horizon only. */
  hexCrawl: hexCrawlSchema.optional(),
});

/**
 * Version 2 of the `maps` row's `data` (convex/tables/maps.ts): the map's
 * scalars only. Markers, hexes and terrain tiles live in their own tables
 * (`mapTokens`, `mapHexes`, `mapTerrain`); `hexCount` caps the crawl's hexes.
 * Version 1 (no `schemaVersion`) is a whole `MapState`.
 */
export const MAP_SCALARS_VERSION = 2;
export const mapScalarsSchema = mapStateSchema.omit({ tokens: true, terrain: true, hexCrawl: true }).extend({
  schemaVersion: z.literal(MAP_SCALARS_VERSION),
  hexCrawl: hexCrawlSchema
    .omit({ hexes: true })
    .extend({ hexCount: z.number().int().min(0).max(MAX_HEXES) })
    .optional(),
});

export type MapToken = z.infer<typeof mapTokenSchema>;
export type MapScalars = z.infer<typeof mapScalarsSchema>;
export type MapState = z.infer<typeof mapStateSchema>;
export type TravelRulesState = z.infer<typeof travelRulesSchema>;
export type HexCrawl = z.infer<typeof hexCrawlSchema>;
export type CrawlHex = z.infer<typeof crawlHexSchema>;

/** Largest stored map in UTF-8 bytes of JSON, safely under Convex's 1 MiB document limit. */
export const MAX_MAP_JSON_BYTES = 900_000;

/** What players receive: the uploaded map without its storage id (its URL is sent separately). */
export type PlayerMapState = Omit<MapState, "customMap"> & { customMap?: { width: number; height: number } };

/** The validated state ready to store, or why it can't be stored (invalid, or too large). */
export function checkMapState(state: MapState): { ok: true; data: MapState } | { ok: false; message: string } {
  const parsed = mapStateSchema.safeParse(state);
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid map." };
  if (new TextEncoder().encode(JSON.stringify(parsed.data)).length > MAX_MAP_JSON_BYTES) {
    return { ok: false, message: "The map is too large. Shorten some notes or remove markers." };
  }
  return { ok: true, data: parsed.data };
}

export const HORIZON_FRAME = "journey-to-horizon";

/** Default calibration: flat hexes of ~24 miles across the Horizon map, to be adjusted by the GM. */
export function initialHexCrawl(): HexCrawl {
  return { grid: { originX: 0, originY: 0, size: 33, orientation: "flat" }, hexes: [], party: null, day: 1, travelMode: "land" };
}

/** Image size and width in km the map is drawn with: an uploaded map, or the frame's published art. */
export function mapImageSize(frameId: string, state: Pick<PlayerMapState, "customMap">): { width: number; height: number } {
  if (state.customMap) return { width: state.customMap.width, height: state.customMap.height };
  const map = (WORLD_MAPS as Record<string, { width: number; height: number }>)[frameId];
  return map ? { width: map.width, height: map.height } : { width: 1600, height: 1200 };
}

/** The campaign's travel rules: GM overrides, or the house-rule defaults. */
export function travelRules(state: Pick<MapState, "options">) {
  return state.options.rules ?? DEFAULT_TRAVEL_RULES;
}

export function initialMapState(frameId: string, terrain?: string): MapState {
  const map = (WORLD_MAPS as Record<string, { scaleKm: number }>)[frameId];
  return {
    tokens: [],
    nextId: 1,
    party: { x: 44, y: 52, trail: [] },
    terrain: terrain ?? (frameId === "witherwild" ? WITHERWILD_TERRAIN : BLANK_TERRAIN),
    scaleKm: map?.scaleKm ?? 400,
    options: { method: "foot", pace: "normal", hours: 8, units: "km", trail: "foot" },
    customTypes: [],
    typeLabels: {},
    ...(frameId === HORIZON_FRAME ? { hexCrawl: initialHexCrawl() } : {}),
  };
}

// ---- Rows: the map split into scalars, markers, hexes and terrain tiles

/** Terrain rows per stored tile: the grid is kept as TERRAIN_TILES `mapTerrain` rows. */
export const TERRAIN_TILE_ROWS = 14;
export const TERRAIN_TILES = Math.ceil(TERRAIN_ROWS / TERRAIN_TILE_ROWS);
export const TERRAIN_TILE_CELLS = TERRAIN_TILE_ROWS * TERRAIN_COLUMNS;

/** The tile holding terrain cell `index` (row-major). */
export function terrainTileOf(index: number): number {
  return Math.floor(index / TERRAIN_TILE_CELLS);
}

/** Tile `tile`'s cells of a whole terrain grid. */
export function terrainTile(grid: string, tile: number): string {
  return grid.slice(tile * TERRAIN_TILE_CELLS, (tile + 1) * TERRAIN_TILE_CELLS);
}

/** A whole grid from `base` with the stored tiles laid over it (a missing tile keeps `base`). */
export function assembleTerrain(base: string, tiles: readonly { tile: number; cells: string }[]): string {
  const parts = Array.from({ length: TERRAIN_TILES }, (_, tile) => terrainTile(base, tile));
  for (const { tile, cells } of tiles) if (tile >= 0 && tile < TERRAIN_TILES) parts[tile] = cells;
  return parts.join("");
}

const byId = (a: MapToken, b: MapToken) => a.id - b.id;
const byHex = (a: CrawlHex, b: CrawlHex) => a.q - b.q || a.r - b.r;

/** A whole map split into what each table stores (the version 1 → 2 migration). Duplicate hexes keep the first. */
export function splitMapState(state: MapState): { scalars: MapScalars; tokens: MapToken[]; hexes: CrawlHex[]; terrain: string } {
  const { tokens, terrain, hexCrawl, ...rest } = state;
  const unique = new Map<string, CrawlHex>();
  for (const h of hexCrawl?.hexes ?? []) if (!unique.has(hexKey(h))) unique.set(hexKey(h), h);
  const hexes = [...unique.values()].sort(byHex);
  const scalars: MapScalars = { ...rest, schemaVersion: MAP_SCALARS_VERSION };
  if (hexCrawl) {
    const { grid, party, day, travelMode, lastMove } = hexCrawl;
    scalars.hexCrawl = { grid, party, day, travelMode, ...(lastMove ? { lastMove } : {}), hexCount: hexes.length };
  }
  return { scalars, tokens: [...tokens].sort(byId), hexes, terrain };
}

/**
 * The whole map from its rows: markers by id, hexes by (q, r). `nextId` is
 * past every marker, so a removed marker's id is never handed out again.
 */
export function joinMapState(scalars: MapScalars, tokens: readonly MapToken[], hexes: readonly CrawlHex[], terrain: string): MapState {
  const { party, scaleKm, options, customTypes, typeLabels, customMap, hexCrawl } = scalars;
  const sorted = [...tokens].sort(byId);
  const nextId = Math.max(scalars.nextId, (sorted.at(-1)?.id ?? 0) + 1);
  const state: MapState = { tokens: sorted, nextId, party, terrain, scaleKm, options, customTypes, typeLabels, ...(customMap ? { customMap } : {}) };
  if (hexCrawl) {
    const { grid, party, day, travelMode, lastMove } = hexCrawl;
    state.hexCrawl = { grid, party, day, travelMode, ...(lastMove ? { lastMove } : {}), hexes: [...hexes].sort(byHex) };
  }
  return state;
}

/**
 * What players may see: hidden tokens removed, token notes (GM notes) blanked,
 * only the marker types (and renamed labels) visible markers use, no upload
 * storage id or marker counter, and of the hex crawl only explored hexes, the
 * party's hex and its neighbours, without hidden points of interest or the
 * GM's last rolls.
 */
export function playerMapView(state: MapState): PlayerMapState {
  const tokens = state.tokens.filter((t) => !t.hidden).map((t) => ({ ...t, notes: "" }));
  const used = new Set(tokens.map((t) => t.type));
  const { customMap, ...rest } = state;
  const view: PlayerMapState = {
    ...rest,
    tokens,
    nextId: 1,
    customTypes: state.customTypes.filter((c) => used.has(c.id)),
    typeLabels: Object.fromEntries(Object.entries(state.typeLabels).filter(([id]) => used.has(id))),
    ...(customMap ? { customMap: { width: customMap.width, height: customMap.height } } : {}),
  };
  if (state.hexCrawl) {
    const crawl = state.hexCrawl;
    const visible = visibleHexKeys(
      crawl.hexes.filter((h) => h.explored),
      crawl.party,
    );
    view.hexCrawl = {
      grid: crawl.grid,
      party: crawl.party,
      day: crawl.day,
      travelMode: crawl.travelMode,
      hexes: crawl.hexes
        .filter((h) => visible.has(hexKey(h)))
        .map(({ poi, ...h }) => (poi && !poi.hidden ? { ...h, poi } : h)),
    };
  }
  return view;
}
