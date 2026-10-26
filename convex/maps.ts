import { v } from "convex/values";

import { applyResourceDelta } from "../src/lib/domain/characters/index";
import { applyCountdownAction } from "../src/lib/domain/countdowns/index";
import { trailMethod } from "../src/lib/domain/travel/index";
import { appError } from "../src/lib/errors/app-error";
import { encounterRoll, travelDays } from "../src/lib/domain/frames/horizon";
import { enduranceOwnerKey } from "../src/lib/domain/rest/frame-hooks/index";
import { resolveOptions } from "../src/lib/frames/options";
import { hexKey, hexToPixel, isAdjacent, type Hex } from "../src/lib/world/hex";
import {
  HORIZON_FRAME,
  MAX_HEXES,
  MAX_TOKENS,
  initialHexCrawl,
  mapImageSize,
  mapScalarsSchema,
  mapStateSchema,
  SANCTUARY_TYPE,
  terrainTile,
  terrainTileOf,
  TERRAIN_TILE_CELLS,
  TERRAIN_TILES,
  tokenHex,
  travelRulesSchema,
  type CrawlHex,
  type MapScalars,
  type MapState,
  type MapToken,
  type PlayerMapState,
} from "../src/lib/world/map-state";
import { TERRAIN_CODES, TERRAIN_COLUMNS, TERRAIN_ROWS, applyTerrainCells, suggestedTerrain } from "../src/lib/world/terrain";
import { isBuiltinType, tokenType, tokenTypes } from "../src/lib/world/token-types";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { logAction, newGroupId } from "./lib/actionLog";
import { readSheet, saveSheet } from "./lib/characterSheet";
import { rollDie } from "./lib/dice";
import { claimFile, deleteOwnFile, isAllowedImage, isClaimed, ownFileUrl } from "./lib/files";
import { userMutation, userQuery } from "./lib/functions";
import {
  hexRow,
  lastTokenId,
  listMapTokens,
  playerTokenFilter,
  readMap,
  readMapTokens,
  readPlayerMap,
  readTiles,
  saveScalars,
  tokenCount,
  tokenRow,
  toHex,
  toToken,
  valid,
  writableMap,
  writeHex,
  writeTiles,
  writeToken,
} from "./lib/maps";
import { campaignScope, runOnce } from "./lib/operations";
import { atLeast, liveCampaign, requirePermission, type Permission, type Role } from "./lib/permissions";
import { recordHistory } from "./tables/history";
import {
  attachResultValidator,
  hexGridValidator,
  mapLocationValidator,
  mapViewValidator,
  moveResultValidator,
  trailOptionValidator,
  travelRulesValidator,
} from "./lib/validators/maps";

export type MapView = { role: Role; frameId: Doc<"campaigns">["frameId"]; state: MapState | PlayerMapState; mapUrl: string | null };
export type MoveResult = { days: number; weatherRoll?: number; dice: number[]; encounter: boolean; day: number };

export type AttachResult = { ok: true } | { ok: false; message: string };

/** Largest uploaded map image. */
export const MAX_MAP_BYTES = 8 * 1024 * 1024;

const pct = v.number();
const point = v.object({ x: pct, y: pct });
const campaignArg = { campaignId: v.id("campaigns") };

function invalid(message: string): never {
  throw appError("INVALID", message);
}

/**
 * The map with at least `need` permission on the map resource (map grants
 * count): NOT_FOUND for outsiders, FORBIDDEN when too weak. Edit and owner
 * get the GM's map; view gets the players' map. These two codes stay string
 * payloads (`requirePermission`) until tests/convex/permissions.test.ts and
 * upload-claims.test.ts read codes with `errorCode`.
 */
async function mapAccess(ctx: QueryCtx, user: Doc<"users">, campaignId: Id<"campaigns">, need: Permission) {
  const campaign = await liveCampaign(ctx, campaignId);
  const permission = await requirePermission(ctx, user, { type: "map", campaign }, need, "edit");
  const role: Role = atLeast(permission, "edit") ? "gm" : "player";
  return { campaign, role };
}

/** The GM's map scalars, ready to edit (a version 1 map is split into rows first). */
async function gmMap(ctx: MutationCtx, user: Doc<"users">, campaignId: Id<"campaigns">) {
  const { campaign } = await mapAccess(ctx, user, campaignId, "edit");
  const map = await writableMap(ctx, campaign);
  return { campaign, map, scalars: map.scalars };
}

function once<T>(ctx: MutationCtx, user: Doc<"users">, campaignId: Id<"campaigns">, key: string, kind: string, request: unknown, run: () => Promise<T>) {
  return runOnce(ctx, { scopeKey: campaignScope(campaignId), key, kind, request, createdBy: user._id, campaignId }, run);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function knownType(scalars: MapScalars, type: string): boolean {
  return isBuiltinType(type) || scalars.customTypes.some((c) => c.id === type);
}

/** The map: the GM gets everything; players get `playerMapView` (no hidden markers, notes, unexplored hexes or hidden POIs). */
export const get = userQuery({
  args: campaignArg,
  returns: mapViewValidator,
  handler: async (ctx, { campaignId }): Promise<MapView> => {
    const { campaign, role } = await mapAccess(ctx, ctx.user, campaignId, "view");
    const { state, storageId } = role === "gm" ? await gmView(ctx, campaign) : await readPlayerMap(ctx, campaign);
    const mapUrl = storageId ? await ownFileUrl(ctx, "map", campaign._id, storageId) : null;
    return { role, frameId: campaign.frameId, state, mapUrl };
  },
});

async function gmView(ctx: QueryCtx, campaign: Doc<"campaigns">) {
  const state = await readMap(ctx, campaign);
  return { state, storageId: state.customMap?.storageId };
}

export type MapLocation = { id: number; name: string; typeLabel: string; colour: string; path: string; hidden: boolean; partyHere: boolean };

/** Markers ticked "Location" for the dashboard's Locations panel (players never get hidden ones). */
export const locations = userQuery({
  args: campaignArg,
  returns: v.array(mapLocationValidator),
  handler: async (ctx, { campaignId }): Promise<MapLocation[]> => {
    const { campaign, role } = await mapAccess(ctx, ctx.user, campaignId, "view");
    const { state, tokens } = await readMapTokens(ctx, campaign);
    const types = tokenTypes(state);
    const canSee = role === "gm" ? () => true : await playerTokenFilter(ctx, campaign);
    return tokens
      .filter((t) => t.location && canSee(t))
      .map((t) => {
        const type = tokenType(types, t.type);
        return {
          id: t.id,
          name: t.name || type.label,
          typeLabel: type.label,
          colour: type.colour,
          path: type.path,
          hidden: t.hidden,
          partyHere: Math.abs(state.party.x - t.x) < 0.6 && Math.abs(state.party.y - t.y) < 0.6,
        };
      });
  },
});

/**
 * Places a marker; it is named after its type. Writes only the marker's row:
 * its id is past both the highest marker and the stored `nextId`.
 */
export const addToken = userMutation({
  args: { ...campaignArg, type: v.string(), x: pct, y: pct, idempotencyKey: v.string() },
  returns: v.object({ id: v.number() }),
  handler: async (ctx, { campaignId, type, x, y, idempotencyKey }) => {
    const { scalars } = await gmMap(ctx, ctx.user, campaignId);
    return once(ctx, ctx.user, campaignId, idempotencyKey, "map_add_token", { type, x, y }, async () => {
      if (!knownType(scalars, type)) invalid("Unknown marker type.");
      if ((await tokenCount(ctx, campaignId)) >= MAX_TOKENS) invalid(`A map holds at most ${MAX_TOKENS} markers.`);
      const id = Math.max(scalars.nextId, (await lastTokenId(ctx, campaignId)) + 1);
      const label = tokenType(tokenTypes(scalars), type).label;
      await writeToken(ctx, campaignId, null, { id, type, x: round2(x), y: round2(y), name: label, notes: "", hidden: false, location: false });
      return { id };
    });
  },
});

/** Edits a marker (sets fields, so a retry is harmless). Writes only the marker's row. */
export const updateToken = userMutation({
  args: {
    ...campaignArg,
    id: v.number(),
    patch: v.object({
      name: v.optional(v.string()),
      notes: v.optional(v.string()),
      type: v.optional(v.string()),
      hidden: v.optional(v.boolean()),
      location: v.optional(v.boolean()),
      x: v.optional(pct),
      y: v.optional(pct),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { campaignId, id, patch }) => {
    const { scalars } = await gmMap(ctx, ctx.user, campaignId);
    const row = await tokenRow(ctx, campaignId, id);
    if (!row) invalid("That marker is no longer on the map.");
    if (patch.type !== undefined && !knownType(scalars, patch.type)) invalid("Unknown marker type.");
    const next: MapToken = {
      ...toToken(row),
      ...patch,
      ...(patch.x !== undefined ? { x: round2(patch.x) } : {}),
      ...(patch.y !== undefined ? { y: round2(patch.y) } : {}),
    };
    await writeToken(ctx, campaignId, row._id, next);
    return null;
  },
});

/** Removes a marker (already gone is fine). Removing the highest one raises `nextId`, so its id is never reused. */
export const removeToken = userMutation({
  args: { ...campaignArg, id: v.number() },
  returns: v.null(),
  handler: async (ctx, { campaignId, id }) => {
    const { map, scalars } = await gmMap(ctx, ctx.user, campaignId);
    const row = await tokenRow(ctx, campaignId, id);
    if (!row) return null;
    await ctx.db.delete("mapTokens", row._id);
    if (scalars.nextId <= id && (await lastTokenId(ctx, campaignId)) < id) await saveScalars(ctx, campaignId, map, { ...scalars, nextId: id + 1 });
    return null;
  },
});

/**
 * Moves the party marker. Its old position, then any `via` points of a
 * measured route, join the trail, which keeps the last 12 positions.
 */
export const moveParty = userMutation({
  args: { ...campaignArg, x: pct, y: pct, via: v.optional(v.array(point)), idempotencyKey: v.string() },
  returns: v.null(),
  handler: async (ctx, { campaignId, x, y, via = [], idempotencyKey }) => {
    const { map, scalars } = await gmMap(ctx, ctx.user, campaignId);
    if (via.length > 24) invalid("Too many route points.");
    return once(ctx, ctx.user, campaignId, idempotencyKey, "map_move_party", { x, y, via }, async () => {
      const { party } = scalars;
      const trail = [...party.trail, { x: party.x, y: party.y }, ...via.map((p) => ({ x: round2(p.x), y: round2(p.y) }))].slice(-12);
      await saveScalars(ctx, campaignId, map, { ...scalars, party: { x: round2(x), y: round2(y), trail } });
      return null;
    });
  },
});

export const clearTrail = userMutation({
  args: campaignArg,
  returns: v.null(),
  handler: async (ctx, { campaignId }) => {
    const { map, scalars } = await gmMap(ctx, ctx.user, campaignId);
    await saveScalars(ctx, campaignId, map, { ...scalars, party: { ...scalars.party, trail: [] } });
    return null;
  },
});

/**
 * Paints terrain cells onto the current grid: cell `indexes[k]` gets the code
 * `codes[k]`. Other cells keep whatever is stored, so two GM tabs painting at
 * once don't overwrite each other (undo sends the cells' previous codes).
 * Reads and writes only the terrain tiles the cells fall in.
 */
export const paintCells = userMutation({
  args: { ...campaignArg, indexes: v.array(v.number()), codes: v.string() },
  returns: v.null(),
  handler: async (ctx, { campaignId, indexes, codes }) => {
    const cells = TERRAIN_COLUMNS * TERRAIN_ROWS;
    if (indexes.length > cells || codes.length !== indexes.length) invalid("Invalid terrain cells.");
    if (indexes.some((i) => !Number.isInteger(i) || i < 0 || i >= cells)) invalid("Invalid terrain cells.");
    if ([...codes].some((c) => !(TERRAIN_CODES as readonly string[]).includes(c))) invalid("Unknown terrain.");
    const { campaign } = await gmMap(ctx, ctx.user, campaignId);
    const byTile = new Map<number, { indexes: number[]; codes: string }>();
    indexes.forEach((index, k) => {
      const tile = terrainTileOf(index);
      const entry = byTile.get(tile) ?? { indexes: [], codes: "" };
      entry.indexes.push(index - tile * TERRAIN_TILE_CELLS);
      entry.codes += codes[k];
      byTile.set(tile, entry);
    });
    const current = await readTiles(ctx, campaign, [...byTile.keys()]);
    const next = new Map([...byTile].map(([tile, paint]) => [tile, applyTerrainCells(current.get(tile) ?? "", paint.indexes, paint.codes)]));
    await writeTiles(ctx, campaign, next);
    return null;
  },
});

/** Replaces the painted terrain grid (`reset` restores the suggested grid). Writes only the tiles that change. */
export const setTerrain = userMutation({
  args: { ...campaignArg, terrain: v.optional(v.string()), reset: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { campaignId, terrain, reset }) => {
    const { campaign } = await gmMap(ctx, ctx.user, campaignId);
    const next = reset ? suggestedTerrain(campaign.frameId) : terrain;
    if (next === undefined) invalid("No terrain given.");
    const grid = valid(mapStateSchema.shape.terrain, next);
    await writeTiles(ctx, campaign, new Map(Array.from({ length: TERRAIN_TILES }, (_, tile) => [tile, terrainTile(grid, tile)])));
    return null;
  },
});

/** Map width in km and the travel options (house rule). */
export const setOptions = userMutation({
  args: {
    ...campaignArg,
    scaleKm: v.optional(v.number()),
    method: v.optional(v.union(v.literal("foot"), v.literal("mount"), v.literal("wagon"), v.literal("boat"), v.literal("fly"))),
    pace: v.optional(v.union(v.literal("slow"), v.literal("normal"), v.literal("fast"))),
    hours: v.optional(v.number()),
    units: v.optional(v.union(v.literal("km"), v.literal("mi"))),
    trail: v.optional(trailOptionValidator),
  },
  returns: v.null(),
  handler: async (ctx, { campaignId, scaleKm, trail, ...options }) => {
    const { map, scalars } = await gmMap(ctx, ctx.user, campaignId);
    const clean = Object.fromEntries(Object.entries({ ...options, trail: trail && trailMethod(trail) }).filter(([, value]) => value !== undefined));
    await saveScalars(ctx, campaignId, map, { ...scalars, scaleKm: scaleKm ?? scalars.scaleKm, options: { ...scalars.options, ...clean } });
    return null;
  },
});

/** The campaign's travel speeds (house rule); null restores the board's defaults. */
export const setTravelRules = userMutation({
  args: { ...campaignArg, rules: v.union(v.null(), travelRulesValidator) },
  returns: v.null(),
  handler: async (ctx, { campaignId, rules }) => {
    const { map, scalars } = await gmMap(ctx, ctx.user, campaignId);
    const options = { ...scalars.options };
    if (rules === null) delete options.rules;
    else {
      const parsed = travelRulesSchema.safeParse(rules);
      if (!parsed.success) invalid("Speeds must be 1–1000 km per day; pace factors 0.1–5.");
      options.rules = parsed.data;
    }
    await saveScalars(ctx, campaignId, map, { ...scalars, options });
    return null;
  },
});

/** Adds a custom marker type to the palette. */
export const addCustomType = userMutation({
  args: { ...campaignArg, label: v.string(), icon: v.string(), color: v.string(), idempotencyKey: v.string() },
  returns: v.object({ id: v.string() }),
  handler: async (ctx, { campaignId, label, icon, color, idempotencyKey }) => {
    const { map, scalars } = await gmMap(ctx, ctx.user, campaignId);
    return once(ctx, ctx.user, campaignId, idempotencyKey, "map_add_type", { label, icon, color }, async () => {
      const name = label.trim();
      if (!name) invalid("Name the marker.");
      if (!isBuiltinType(icon)) invalid("Unknown icon.");
      if (!/^#[0-9a-f]{6}$/i.test(color)) invalid("Pick a colour.");
      let n = scalars.customTypes.length + 1;
      while (scalars.customTypes.some((c) => c.id === `c${n}`)) n++;
      const id = `c${n}`;
      await saveScalars(ctx, campaignId, map, { ...scalars, customTypes: [...scalars.customTypes, { id, label: name, icon, color }] });
      return { id };
    });
  },
});

/** Renames a palette type; an empty label restores the default. */
export const renameType = userMutation({
  args: { ...campaignArg, typeId: v.string(), label: v.string() },
  returns: v.null(),
  handler: async (ctx, { campaignId, typeId, label }) => {
    const { map, scalars } = await gmMap(ctx, ctx.user, campaignId);
    if (!knownType(scalars, typeId)) invalid("Unknown marker type.");
    const typeLabels = { ...scalars.typeLabels };
    if (label.trim()) typeLabels[typeId] = label.trim();
    else delete typeLabels[typeId];
    await saveScalars(ctx, campaignId, map, { ...scalars, typeLabels });
    return null;
  },
});

// ---- Uploaded map image (custom campaigns, or replacing a published map)

/** An upload URL for a map image. GM only; rate-limited. */
export const mapImageUploadUrl = userMutation({
  rateLimit: "uploadUrl",
  args: campaignArg,
  returns: v.string(),
  handler: async (ctx, { campaignId }) => {
    await mapAccess(ctx, ctx.user, campaignId, "edit");
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Uses a just-uploaded file as the campaign's map. The file must be an image
 * (PNG, JPEG, WebP or GIF) of at most 8 MB that no campaign has claimed; the
 * previous upload is deleted.
 * `width` and `height` are the image's pixel size (its aspect ratio).
 */
export const attachMapImage = userMutation({
  args: { ...campaignArg, storageId: v.id("_storage"), width: v.number(), height: v.number(), scaleKm: v.optional(v.number()) },
  returns: attachResultValidator,
  handler: async (ctx, { campaignId, storageId, width, height, scaleKm }): Promise<AttachResult> => {
    const { map, scalars } = await gmMap(ctx, ctx.user, campaignId);
    const meta = await ctx.db.system.get(storageId);
    // Only an unclaimed file may be attached, so the rejections below only ever delete unclaimed files.
    // String payload until upload-claims.test.ts reads codes with `errorCode`.
    if (meta === null || (await isClaimed(ctx, storageId))) throw appError("NOT_FOUND");
    // A rejected file is deleted and reported without throwing, so the delete isn't rolled back.
    if (!isAllowedImage(meta, MAX_MAP_BYTES)) {
      await ctx.storage.delete(storageId);
      return { ok: false, message: "Maps must be PNG, JPEG, WebP or GIF images of at most 8 MB." };
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 20000 || height > 20000) {
      await ctx.storage.delete(storageId);
      return { ok: false, message: "Couldn't read the image size." };
    }
    // Validated before the file is claimed, so a bad map width leaves no orphan file.
    const next = mapScalarsSchema.safeParse({ ...scalars, scaleKm: scaleKm ?? scalars.scaleKm, customMap: { storageId, width, height } });
    if (!next.success) {
      await ctx.storage.delete(storageId);
      return { ok: false, message: next.error.issues[0]?.message ?? "Invalid map." };
    }
    await claimFile(ctx, { storageId, campaignId, uploadedBy: ctx.user._id, kind: "map", refId: campaignId });
    if (scalars.customMap) await deleteOwnFile(ctx, "map", campaignId, scalars.customMap.storageId);
    await saveScalars(ctx, campaignId, map, next.data);
    return { ok: true };
  },
});

/** Removes the uploaded map (a published frame goes back to its own art). */
export const removeMapImage = userMutation({
  args: campaignArg,
  returns: v.null(),
  handler: async (ctx, { campaignId }) => {
    const { map, scalars } = await gmMap(ctx, ctx.user, campaignId);
    if (!scalars.customMap) return null;
    await deleteOwnFile(ctx, "map", campaignId, scalars.customMap.storageId);
    const next = { ...scalars };
    delete next.customMap;
    await saveScalars(ctx, campaignId, map, next);
    return null;
  },
});

// ---- Journey to Horizon hex crawl (HF pp.171–177)

type CrawlScalars = NonNullable<MapScalars["hexCrawl"]>;

async function gmCrawl(ctx: MutationCtx, user: Doc<"users">, campaignId: Id<"campaigns">) {
  const loaded = await gmMap(ctx, user, campaignId);
  if (loaded.campaign.frameId !== HORIZON_FRAME) throw appError("MECHANIC_DISABLED");
  const { hexes, ...initial } = initialHexCrawl();
  const crawl: CrawlScalars = loaded.scalars.hexCrawl ?? { ...initial, hexCount: hexes.length };
  return { ...loaded, crawl };
}

const hexArgs = { q: v.number(), r: v.number() };

function checkHex(h: Hex) {
  if (!Number.isInteger(h.q) || !Number.isInteger(h.r) || Math.abs(h.q) > 1000 || Math.abs(h.r) > 1000) invalid("That hex is off the map.");
}

/**
 * Applies `patch` to the hex at `h` (a missing hex starts unexplored) and
 * writes its row. Returns the crawl with `hexCount` raised for a new hex.
 */
async function patchHex(ctx: MutationCtx, campaignId: Id<"campaigns">, crawl: CrawlScalars, h: Hex, edit: (hex: CrawlHex) => CrawlHex): Promise<CrawlScalars> {
  const row = await hexRow(ctx, campaignId, h);
  if (!row && crawl.hexCount >= MAX_HEXES) invalid(`A hex crawl holds at most ${MAX_HEXES} hexes.`);
  await writeHex(ctx, campaignId, row?._id ?? null, edit(row ? toHex(row) : { q: h.q, r: h.r, explored: false }));
  return row ? crawl : { ...crawl, hexCount: crawl.hexCount + 1 };
}

/** The party marker at a hex's centre, in map percent. */
function partyAt(frameId: string, scalars: MapScalars, crawl: CrawlScalars, h: Hex): { x: number; y: number } {
  const size = mapImageSize(frameId, scalars);
  const c = hexToPixel(h, crawl.grid);
  const clamp = (n: number) => round2(Math.max(0, Math.min(100, n)));
  return { x: clamp((c.x / size.width) * 100), y: clamp((c.y / size.height) * 100) };
}

/** Calibrates the hex grid over the map image (origin and size in image pixels). */
export const setHexGrid = userMutation({
  args: { ...campaignArg, grid: hexGridValidator },
  returns: v.null(),
  handler: async (ctx, { campaignId, grid }) => {
    const { map, scalars, crawl } = await gmCrawl(ctx, ctx.user, campaignId);
    await saveScalars(ctx, campaignId, map, { ...scalars, hexCrawl: { ...crawl, grid } });
    return null;
  },
});

/** Sets a hex's terrain, habitat, region, point of interest or explored flag (null clears a field). Writes the hex's row. */
export const updateHex = userMutation({
  args: {
    ...campaignArg,
    ...hexArgs,
    patch: v.object({
      explored: v.optional(v.boolean()),
      terrain: v.optional(v.union(v.null(), v.number())),
      habitat: v.optional(v.union(v.null(), v.string())),
      region: v.optional(v.union(v.null(), v.string())),
      poi: v.optional(v.union(v.null(), v.object({ text: v.string(), hidden: v.boolean() }))),
    }),
  },
  returns: v.null(),
  handler: async (ctx, { campaignId, q, r, patch }) => {
    checkHex({ q, r });
    const { map, scalars, crawl } = await gmCrawl(ctx, ctx.user, campaignId);
    const next = await patchHex(ctx, campaignId, crawl, { q, r }, (found) => {
      const hex: CrawlHex = { ...found };
      if (patch.explored !== undefined) hex.explored = patch.explored;
      if (patch.terrain !== undefined) {
        if (patch.terrain === null) delete hex.terrain;
        else hex.terrain = patch.terrain;
      }
      for (const field of ["habitat", "region"] as const) {
        const value = patch[field];
        if (value === undefined) continue;
        if (value === null || !value.trim()) delete hex[field];
        else hex[field] = value.trim();
      }
      if (patch.poi !== undefined) {
        if (patch.poi === null || !patch.poi.text.trim()) delete hex.poi;
        else hex.poi = { text: patch.poi.text.trim(), hidden: patch.poi.hidden };
      }
      return hex;
    });
    if (next !== crawl) await saveScalars(ctx, campaignId, map, { ...scalars, hexCrawl: next });
    return null;
  },
});

/** Puts the party on a hex without travelling (setup or correction): no days pass. */
export const placePartyHex = userMutation({
  args: { ...campaignArg, ...hexArgs },
  returns: v.null(),
  handler: async (ctx, { campaignId, q, r }) => {
    checkHex({ q, r });
    const { campaign, map, scalars, crawl } = await gmCrawl(ctx, ctx.user, campaignId);
    const h = { q, r };
    const counted = await patchHex(ctx, campaignId, crawl, h, (hex) => ({ ...hex, explored: true }));
    const next: CrawlScalars = { ...counted, party: h };
    const pos = partyAt(campaign.frameId, scalars, next, h);
    await saveScalars(ctx, campaignId, map, { ...scalars, party: { ...scalars.party, ...pos }, hexCrawl: next });
    return null;
  },
});

/**
 * Optional rule, Endurance Countdowns (HF 176): "When the party enters a
 * wilderness hex, each player rolls their Hope Die. If the result is equal to
 * or lower than the value of their PC's Endurance Countdown, they mark a
 * Stress. Otherwise, they tick down their Endurance Countdown. When a PC's
 * Endurance Countdown triggers, they become Vulnerable until their next rest."
 * With `enduranceCountdowns` on, every active PC with an active countdown
 * (started by a rest, convex/trackers/horizon.ts) rolls a server Hope Die
 * (d12). A hex holding a sanctuary marker is not wilderness (reversible
 * minimum, TASK-D5-TI-b questions). The sheet change is logged (undoable);
 * the tick keeps the countdown's own history.
 */
async function enduranceOnEntry(ctx: MutationCtx, campaign: Doc<"campaigns">, scalars: MapScalars, crawl: CrawlScalars, h: Hex, actorId: Id<"users">): Promise<void> {
  if (!resolveOptions(campaign.frameId, campaign.options).enduranceCountdowns) return;
  const image = mapImageSize(campaign.frameId, scalars);
  const tokens = await listMapTokens(ctx, campaign._id);
  if (tokens.some((t) => t.type === SANCTUARY_TYPE && hexKey(tokenHex(t, image, crawl.grid)) === hexKey(h))) return;
  // One party: a handful of characters.
  const party = await ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
    .collect();
  const groupId = newGroupId();
  for (const pc of party.filter((c) => c.status === "active")) {
    // At most one row per PC.
    const countdown = await ctx.db
      .query("countdowns")
      .withIndex("by_campaign_owner", (q) => q.eq("campaignId", campaign._id).eq("ownerKey", enduranceOwnerKey(pc._id)))
      .first();
    if (countdown === null || countdown.status !== "active") continue;
    const before = readSheet(pc.sheet);
    const hopeDie = rollDie(12);
    let after = before;
    let summary: string;
    if (hopeDie <= countdown.currentValue) {
      after = applyResourceDelta(before, "stress", 1);
      summary = `Endurance (HF 176): Hope Die ${hopeDie}, at or below ${countdown.currentValue}: marks a Stress`;
    } else {
      const next = applyCountdownAction(countdown, "advance");
      await ctx.db.patch("countdowns", countdown._id, {
        currentValue: next.currentValue,
        status: next.status,
        completedAt: next.completedNow ? Date.now() : countdown.completedAt,
      });
      await recordHistory(ctx, actorId, {
        campaignId: campaign._id,
        kind: "countdown",
        action: "advance",
        countdownId: countdown._id,
        before: { currentValue: countdown.currentValue, status: countdown.status },
        after: { currentValue: next.currentValue, status: next.status },
      });
      summary = `Endurance (HF 176): Hope Die ${hopeDie}, above ${countdown.currentValue}: the countdown ticks to ${next.currentValue}`;
      if (next.completedNow) {
        if (!before.conditions.includes("vulnerable")) after = { ...before, conditions: [...before.conditions, "vulnerable"] };
        summary += "; it triggers: Vulnerable until the next rest";
      }
    }
    if (after !== before) await saveSheet(ctx, pc._id, after);
    await logAction(ctx, {
      campaignId: campaign._id,
      characterId: pc._id,
      actorId,
      kind: "roll",
      visibility: "public",
      summary: `${before.name}: ${summary}`,
      groupId,
      ...(after !== before ? { before } : {}),
      undoable: after !== before,
    });
  }
}

/**
 * Travels to an adjacent hex (HF pp.171, 176–177): days by terrain rating and
 * travel mode, then the day counter advances, the hex is explored and the
 * encounter roll is made (terrain-rating dice; any 1 activates an encounter).
 * Entering a wilderness hex runs the Endurance Countdowns (HF 176) when that
 * option is on.
 */
export const moveToHex = userMutation({
  args: {
    ...campaignArg,
    ...hexArgs,
    terrain: v.number(),
    travelMode: v.union(v.literal("land"), v.literal("riverDown"), v.literal("riverUp"), v.literal("ocean")),
    encounterDie: v.optional(v.union(v.literal(4), v.literal(6), v.literal(8))),
    idempotencyKey: v.string(),
  },
  returns: moveResultValidator,
  handler: async (ctx, { campaignId, q, r, terrain, travelMode, encounterDie = 6, idempotencyKey }): Promise<MoveResult> => {
    checkHex({ q, r });
    const { campaign, map, scalars, crawl } = await gmCrawl(ctx, ctx.user, campaignId);
    return once(ctx, ctx.user, campaignId, idempotencyKey, "map_move_hex", { q, r, terrain, travelMode, encounterDie }, async () => {
      const h = { q, r };
      if (!crawl.party) invalid("Place the party on a hex first.");
      if (!isAdjacent(crawl.party, h)) invalid("The party can only move to an adjacent hex.");
      if (!Number.isInteger(terrain) || terrain < 1 || terrain > 4) invalid("Terrain rating must be 1–4.");
      const travel = travelDays(terrain, travelMode, rollDie);
      const roll = encounterRoll(terrain, rollDie, encounterDie);
      const day = crawl.day + travel.days;
      if (day > 100000) invalid("The day counter is full.");
      const counted = await patchHex(ctx, campaignId, crawl, h, (hex) => ({ ...hex, explored: true, terrain }));
      const next: CrawlScalars = {
        ...counted,
        party: h,
        day,
        travelMode,
        lastMove: { q, r, days: travel.days, dice: roll.dice, encounter: roll.encounter, ...(travel.weatherRoll ? { weatherRoll: travel.weatherRoll } : {}) },
      };
      const pos = partyAt(campaign.frameId, scalars, next, h);
      const trail = [...scalars.party.trail, { x: scalars.party.x, y: scalars.party.y }].slice(-12);
      await saveScalars(ctx, campaignId, map, { ...scalars, party: { ...pos, trail }, hexCrawl: next });
      await enduranceOnEntry(ctx, campaign, scalars, next, h, ctx.user._id);
      return { days: travel.days, ...(travel.weatherRoll ? { weatherRoll: travel.weatherRoll } : {}), dice: roll.dice, encounter: roll.encounter, day };
    });
  },
});

/** Corrects the crawl's day counter. */
export const setCrawlDay = userMutation({
  args: { ...campaignArg, day: v.number() },
  returns: v.null(),
  handler: async (ctx, { campaignId, day }) => {
    const { map, scalars, crawl } = await gmCrawl(ctx, ctx.user, campaignId);
    if (!Number.isInteger(day) || day < 1) invalid("Day must be a whole number from 1.");
    await saveScalars(ctx, campaignId, map, { ...scalars, hexCrawl: { ...crawl, day } });
    return null;
  },
});
