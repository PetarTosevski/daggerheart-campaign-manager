import { v, type VFloat64 } from "convex/values";

import { LEGACY_TRAIL_MODES, SPEED_TERRAINS, TRAVEL_METHODS, TRAVEL_PACES, type SpeedTerrain, type TravelMethod } from "../../../src/lib/domain/travel/index";
import { HORIZON_TRAVEL_MODES } from "../../../src/lib/world/map-state";
import { frameIdValidator } from "./campaigns";

// Convex validators for the World map (CD19). Ranges and lengths are checked
// by the zod schemas in src/lib/world/map-state.ts; these give the shapes.

const literals = <T extends string>(values: readonly T[]) => v.union(...values.map((value) => v.literal(value)));

const point = v.object({ x: v.number(), y: v.number() });

/** `setOptions`' trail pace: a travel method; a pre-PD1 flat pace from an older client is still accepted and read as a method. */
export const trailOptionValidator = literals([...TRAVEL_METHODS, ...LEGACY_TRAIL_MODES]);

/** A marker's stored fields (`mapTokens`), without its campaign and id. */
export const mapTokenFields = {
  type: v.string(),
  x: v.number(),
  y: v.number(),
  name: v.string(),
  notes: v.string(),
  hidden: v.boolean(),
  location: v.boolean(),
};

export const mapTokenValidator = v.object({ id: v.number(), ...mapTokenFields });

/** A hex's stored fields (`mapHexes`), without its campaign. */
export const crawlHexFields = {
  q: v.number(),
  r: v.number(),
  explored: v.boolean(),
  terrain: v.optional(v.number()),
  habitat: v.optional(v.string()),
  region: v.optional(v.string()),
  poi: v.optional(v.object({ text: v.string(), hidden: v.boolean() })),
};

const speedTable = v.object(Object.fromEntries(SPEED_TERRAINS.map((t) => [t, v.number()])) as Record<SpeedTerrain, VFloat64<number>>);

/**
 * GM overrides of the travel speeds (`travelRulesSchema` checks the ranges).
 * `trail` (the pre-PD1 trail table) is still accepted from older clients and
 * ignored; reads never return it. Narrow it away with the stored rows.
 */
export const travelRulesValidator = v.object({
  speeds: v.object(Object.fromEntries(TRAVEL_METHODS.map((m) => [m, speedTable])) as Record<TravelMethod, typeof speedTable>),
  trail: v.optional(v.object({ foot: speedTable, mount: speedTable })),
  slow: v.number(),
  fast: v.number(),
});

export const hexGridValidator = v.object({ originX: v.number(), originY: v.number(), size: v.number(), orientation: v.union(v.literal("flat"), v.literal("pointy")) });

const hexCrawlValidator = v.object({
  grid: hexGridValidator,
  hexes: v.array(v.object(crawlHexFields)),
  party: v.union(v.null(), v.object({ q: v.number(), r: v.number() })),
  day: v.number(),
  travelMode: literals(HORIZON_TRAVEL_MODES),
  lastMove: v.optional(
    v.object({ q: v.number(), r: v.number(), days: v.number(), dice: v.array(v.number()), encounter: v.boolean(), weatherRoll: v.optional(v.number()) }),
  ),
});

const sharedState = {
  tokens: v.array(mapTokenValidator),
  nextId: v.number(),
  party: v.object({ x: v.number(), y: v.number(), trail: v.array(point) }),
  terrain: v.string(),
  scaleKm: v.number(),
  options: v.object({
    method: literals(TRAVEL_METHODS),
    pace: literals(TRAVEL_PACES),
    hours: v.number(),
    units: v.union(v.literal("km"), v.literal("mi")),
    // Reads turn a legacy flat pace into a method (`trailMethod`), so views only carry methods.
    trail: literals(TRAVEL_METHODS),
    rules: v.optional(travelRulesValidator),
  }),
  customTypes: v.array(v.object({ id: v.string(), label: v.string(), icon: v.string(), color: v.string() })),
  typeLabels: v.record(v.string(), v.string()),
  hexCrawl: v.optional(hexCrawlValidator),
};

/** `MapState`: the GM's map. */
export const mapStateValidator = v.object({
  ...sharedState,
  customMap: v.optional(v.object({ storageId: v.string(), width: v.number(), height: v.number() })),
});

/** `PlayerMapState`: what `playerMapView` leaves (no storage id). */
export const playerMapStateValidator = v.object({
  ...sharedState,
  customMap: v.optional(v.object({ width: v.number(), height: v.number() })),
});

/** What `maps.get` returns. */
export const mapViewValidator = v.object({
  role: v.union(v.literal("gm"), v.literal("player")),
  frameId: frameIdValidator,
  state: v.union(mapStateValidator, playerMapStateValidator),
  mapUrl: v.union(v.string(), v.null()),
});

/** One row of `maps.locations`. */
export const mapLocationValidator = v.object({
  id: v.number(),
  name: v.string(),
  typeLabel: v.string(),
  colour: v.string(),
  path: v.string(),
  hidden: v.boolean(),
  partyHere: v.boolean(),
});

export const moveResultValidator = v.object({ days: v.number(), weatherRoll: v.optional(v.number()), dice: v.array(v.number()), encounter: v.boolean(), day: v.number() });

export const attachResultValidator = v.union(v.object({ ok: v.literal(true) }), v.object({ ok: v.literal(false), message: v.string() }));
