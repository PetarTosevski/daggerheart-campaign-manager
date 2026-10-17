import { ConvexError, v } from "convex/values";

import { encounterRoll, travelDays } from "../src/lib/domain/frames/horizon";
import { hexToPixel, isAdjacent, type Hex } from "../src/lib/world/hex";
import {
  HORIZON_FRAME,
  initialHexCrawl,
  mapImageSize,
  playerMapView,
  travelRulesSchema,
  type CrawlHex,
  type HexCrawl,
  type MapState,
  type MapToken,
} from "../src/lib/world/map-state";
import { suggestedTerrain } from "../src/lib/world/terrain";
import { isBuiltinType, tokenType, tokenTypes } from "../src/lib/world/token-types";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { loadCampaign, loadGmCampaign, type Role } from "./lib/access";
import { requireUser } from "./lib/auth";
import { rollDie } from "./lib/dice";
import { deleteOwnMapUpload, mapUploadUrl, readMap, writeMap } from "./lib/maps";
import { campaignScope, withIdempotency } from "./lib/operations";

export type MapView = { role: Role; frameId: Doc<"campaigns">["frameId"]; state: MapState; mapUrl: string | null };
export type MoveResult = { days: number; weatherRoll?: number; dice: number[]; encounter: boolean; day: number };

export type AttachResult = { ok: true } | { ok: false; message: string };

/** Largest uploaded map image. */
export const MAX_MAP_BYTES = 8 * 1024 * 1024;

const pct = v.number();
const point = v.object({ x: pct, y: pct });

function invalid(message: string): never {
  throw new ConvexError({ code: "INVALID", message });
}

async function gmMap(ctx: MutationCtx, campaignId: Id<"campaigns">) {
  const user = await requireUser(ctx);
  const campaign = await loadGmCampaign(ctx, user, campaignId);
  const state = await readMap(ctx, campaign);
  return { user, campaign, state };
}

function idempotent<T>(ctx: MutationCtx, user: Doc<"users">, campaignId: Id<"campaigns">, key: string, kind: string, request: unknown, run: () => Promise<T>) {
  return withIdempotency(ctx, { scopeKey: campaignScope(campaignId), key, kind, request, createdBy: user._id, campaignId }, run);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function findToken(state: MapState, id: number): MapToken {
  const token = state.tokens.find((t) => t.id === id);
  if (!token) invalid("That marker is no longer on the map.");
  return token;
}

/** The map: the GM gets everything; players get `playerMapView` (no hidden markers, notes or unexplored hexes). */
export const get = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }): Promise<MapView> => {
    const user = await requireUser(ctx);
    const { campaign, role } = await loadCampaign(ctx, user, campaignId);
    const state = await readMap(ctx, campaign);
    const mapUrl = state.customMap ? await mapUploadUrl(ctx, campaign._id, state.customMap.storageId) : null;
    return { role, frameId: campaign.frameId, state: role === "gm" ? state : playerMapView(state), mapUrl };
  },
});

export type MapLocation = { id: number; name: string; typeLabel: string; colour: string; path: string; hidden: boolean; partyHere: boolean };

/** Markers ticked "Location" for the dashboard's Locations panel (players never get hidden ones). */
export const locations = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }): Promise<MapLocation[]> => {
    const user = await requireUser(ctx);
    const { campaign, role } = await loadCampaign(ctx, user, campaignId);
    const full = await readMap(ctx, campaign);
    const state = role === "gm" ? full : playerMapView(full);
    const types = tokenTypes(state);
    return state.tokens
      .filter((t) => t.location)
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

/** Places a marker; it is named after its type. */
export const addToken = mutation({
  args: { campaignId: v.id("campaigns"), type: v.string(), x: pct, y: pct, idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, type, x, y, idempotencyKey }): Promise<{ id: number }> => {
    const { user, state } = await gmMap(ctx, campaignId);
    return idempotent(ctx, user, campaignId, idempotencyKey, "map_add_token", { type, x, y }, async () => {
      if (!isBuiltinType(type) && !state.customTypes.some((c) => c.id === type)) invalid("Unknown marker type.");
      const id = state.nextId;
      const label = tokenType(tokenTypes(state), type).label;
      const token: MapToken = { id, type, x: round2(x), y: round2(y), name: label, notes: "", hidden: false, location: false };
      await writeMap(ctx, campaignId, { ...state, nextId: id + 1, tokens: [...state.tokens, token] });
      return { id };
    });
  },
});

/** Edits a marker (sets fields, so a retry is harmless). */
export const updateToken = mutation({
  args: {
    campaignId: v.id("campaigns"),
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
  handler: async (ctx, { campaignId, id, patch }) => {
    const { state } = await gmMap(ctx, campaignId);
    const token = findToken(state, id);
    if (patch.type !== undefined && !isBuiltinType(patch.type) && !state.customTypes.some((c) => c.id === patch.type)) invalid("Unknown marker type.");
    const next: MapToken = {
      ...token,
      ...patch,
      ...(patch.x !== undefined ? { x: round2(patch.x) } : {}),
      ...(patch.y !== undefined ? { y: round2(patch.y) } : {}),
    };
    await writeMap(ctx, campaignId, { ...state, tokens: state.tokens.map((t) => (t.id === id ? next : t)) });
  },
});

/** Removes a marker (already gone is fine). */
export const removeToken = mutation({
  args: { campaignId: v.id("campaigns"), id: v.number() },
  handler: async (ctx, { campaignId, id }) => {
    const { state } = await gmMap(ctx, campaignId);
    if (!state.tokens.some((t) => t.id === id)) return;
    await writeMap(ctx, campaignId, { ...state, tokens: state.tokens.filter((t) => t.id !== id) });
  },
});

/**
 * Moves the party marker. Its old position, then any `via` points of a
 * measured route, join the trail, which keeps the last 12 positions.
 */
export const moveParty = mutation({
  args: { campaignId: v.id("campaigns"), x: pct, y: pct, via: v.optional(v.array(point)), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, x, y, via = [], idempotencyKey }) => {
    const { user, state } = await gmMap(ctx, campaignId);
    if (via.length > 24) invalid("Too many route points.");
    return idempotent(ctx, user, campaignId, idempotencyKey, "map_move_party", { x, y, via }, async () => {
      const { party } = state;
      const trail = [...party.trail, { x: party.x, y: party.y }, ...via.map((p) => ({ x: round2(p.x), y: round2(p.y) }))].slice(-12);
      await writeMap(ctx, campaignId, { ...state, party: { x: round2(x), y: round2(y), trail } });
      return null;
    });
  },
});

export const clearTrail = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const { state } = await gmMap(ctx, campaignId);
    await writeMap(ctx, campaignId, { ...state, party: { ...state.party, trail: [] } });
  },
});

/** Replaces the painted terrain grid (`reset` restores the suggested grid). */
export const setTerrain = mutation({
  args: { campaignId: v.id("campaigns"), terrain: v.optional(v.string()), reset: v.optional(v.boolean()) },
  handler: async (ctx, { campaignId, terrain, reset }) => {
    const { campaign, state } = await gmMap(ctx, campaignId);
    const next = reset ? suggestedTerrain(campaign.frameId) : terrain;
    if (next === undefined) invalid("No terrain given.");
    await writeMap(ctx, campaignId, { ...state, terrain: next });
  },
});

/** Map width in km and the travel options (house rule). */
export const setOptions = mutation({
  args: {
    campaignId: v.id("campaigns"),
    scaleKm: v.optional(v.number()),
    method: v.optional(v.union(v.literal("foot"), v.literal("mount"), v.literal("wagon"), v.literal("boat"), v.literal("fly"))),
    pace: v.optional(v.union(v.literal("slow"), v.literal("normal"), v.literal("fast"))),
    hours: v.optional(v.number()),
    units: v.optional(v.union(v.literal("km"), v.literal("mi"))),
    trail: v.optional(v.union(v.literal("foot"), v.literal("mount"), v.literal("20"), v.literal("40"), v.literal("60"), v.literal("80"))),
  },
  handler: async (ctx, { campaignId, scaleKm, ...options }) => {
    const { state } = await gmMap(ctx, campaignId);
    const clean = Object.fromEntries(Object.entries(options).filter(([, value]) => value !== undefined));
    await writeMap(ctx, campaignId, { ...state, scaleKm: scaleKm ?? state.scaleKm, options: { ...state.options, ...clean } });
  },
});

/** The campaign's travel speeds (house rule); null restores the board's defaults. */
export const setTravelRules = mutation({
  args: { campaignId: v.id("campaigns"), rules: v.union(v.null(), v.any()) },
  handler: async (ctx, { campaignId, rules }) => {
    const { state } = await gmMap(ctx, campaignId);
    const options = { ...state.options };
    if (rules === null) delete options.rules;
    else {
      const parsed = travelRulesSchema.safeParse(rules);
      if (!parsed.success) invalid("Speeds must be 1–1000 km per day; pace factors 0.1–5.");
      options.rules = parsed.data;
    }
    await writeMap(ctx, campaignId, { ...state, options });
  },
});

/** Adds a custom marker type to the palette. */
export const addCustomType = mutation({
  args: { campaignId: v.id("campaigns"), label: v.string(), icon: v.string(), color: v.string(), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, label, icon, color, idempotencyKey }): Promise<{ id: string }> => {
    const { user, state } = await gmMap(ctx, campaignId);
    return idempotent(ctx, user, campaignId, idempotencyKey, "map_add_type", { label, icon, color }, async () => {
      const name = label.trim();
      if (!name) invalid("Name the marker.");
      if (!isBuiltinType(icon)) invalid("Unknown icon.");
      if (!/^#[0-9a-f]{6}$/i.test(color)) invalid("Pick a colour.");
      let n = state.customTypes.length + 1;
      while (state.customTypes.some((c) => c.id === `c${n}`)) n++;
      const id = `c${n}`;
      await writeMap(ctx, campaignId, { ...state, customTypes: [...state.customTypes, { id, label: name, icon, color }] });
      return { id };
    });
  },
});

/** Renames a palette type; an empty label restores the default. */
export const renameType = mutation({
  args: { campaignId: v.id("campaigns"), typeId: v.string(), label: v.string() },
  handler: async (ctx, { campaignId, typeId, label }) => {
    const { state } = await gmMap(ctx, campaignId);
    if (!isBuiltinType(typeId) && !state.customTypes.some((c) => c.id === typeId)) invalid("Unknown marker type.");
    const typeLabels = { ...state.typeLabels };
    if (label.trim()) typeLabels[typeId] = label.trim();
    else delete typeLabels[typeId];
    await writeMap(ctx, campaignId, { ...state, typeLabels });
  },
});

// ---- Uploaded map image (custom campaigns, or replacing a published map)

/** An upload URL for a map image. GM only. */
export const mapImageUploadUrl = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireUser(ctx);
    await loadGmCampaign(ctx, user, campaignId);
    return ctx.storage.generateUploadUrl();
  },
});

/**
 * Uses a just-uploaded file as the campaign's map. The file must be an image
 * of at most 8 MB that no campaign has claimed; the previous upload is deleted.
 * `width` and `height` are the image's pixel size (its aspect ratio).
 */
export const attachMapImage = mutation({
  args: { campaignId: v.id("campaigns"), storageId: v.id("_storage"), width: v.number(), height: v.number(), scaleKm: v.optional(v.number()) },
  handler: async (ctx, { campaignId, storageId, width, height, scaleKm }): Promise<AttachResult> => {
    const { user, state } = await gmMap(ctx, campaignId);
    const meta = await ctx.db.system.get(storageId);
    const claimed = await ctx.db
      .query("mapUploads")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .unique();
    if (meta === null || claimed !== null) throw new ConvexError("NOT_FOUND");
    // A rejected file is deleted and reported without throwing, so the delete isn't rolled back.
    if (!meta.contentType?.startsWith("image/") || meta.size > MAX_MAP_BYTES) {
      await ctx.storage.delete(storageId);
      return { ok: false, message: "Maps must be images of at most 8 MB." };
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 20000 || height > 20000) {
      await ctx.storage.delete(storageId);
      return { ok: false, message: "Couldn't read the image size." };
    }
    await ctx.db.insert("mapUploads", { storageId, campaignId, uploadedBy: user._id, createdAt: Date.now() });
    if (state.customMap) await deleteOwnMapUpload(ctx, campaignId, state.customMap.storageId);
    await writeMap(ctx, campaignId, { ...state, scaleKm: scaleKm ?? state.scaleKm, customMap: { storageId, width, height } });
    return { ok: true };
  },
});

/** Removes the uploaded map (a published frame goes back to its own art). */
export const removeMapImage = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const { state } = await gmMap(ctx, campaignId);
    if (!state.customMap) return;
    await deleteOwnMapUpload(ctx, campaignId, state.customMap.storageId);
    const next = { ...state };
    delete next.customMap;
    await writeMap(ctx, campaignId, next);
  },
});

// ---- Journey to Horizon hex crawl (HF pp.171–177)

async function gmCrawl(ctx: MutationCtx, campaignId: Id<"campaigns">) {
  const loaded = await gmMap(ctx, campaignId);
  if (loaded.campaign.frameId !== HORIZON_FRAME) throw new ConvexError("MECHANIC_DISABLED");
  return { ...loaded, crawl: loaded.state.hexCrawl ?? initialHexCrawl() };
}

const hexArgs = { q: v.number(), r: v.number() };

function checkHex(h: Hex) {
  if (!Number.isInteger(h.q) || !Number.isInteger(h.r) || Math.abs(h.q) > 1000 || Math.abs(h.r) > 1000) invalid("That hex is off the map.");
}

function withHex(crawl: HexCrawl, h: Hex, patch: Partial<CrawlHex>): CrawlHex[] {
  const found = crawl.hexes.find((x) => x.q === h.q && x.r === h.r);
  const next: CrawlHex = { ...(found ?? { q: h.q, r: h.r, explored: false }), ...patch };
  return found ? crawl.hexes.map((x) => (x === found ? next : x)) : [...crawl.hexes, next];
}

/** The party marker at a hex's centre, in map percent. */
function partyAt(frameId: string, state: MapState, crawl: HexCrawl, h: Hex): { x: number; y: number } {
  const size = mapImageSize(frameId, state);
  const c = hexToPixel(h, crawl.grid);
  const clamp = (n: number) => round2(Math.max(0, Math.min(100, n)));
  return { x: clamp((c.x / size.width) * 100), y: clamp((c.y / size.height) * 100) };
}

/** Calibrates the hex grid over the map image (origin and size in image pixels). */
export const setHexGrid = mutation({
  args: {
    campaignId: v.id("campaigns"),
    grid: v.object({ originX: v.number(), originY: v.number(), size: v.number(), orientation: v.union(v.literal("flat"), v.literal("pointy")) }),
  },
  handler: async (ctx, { campaignId, grid }) => {
    const { state, crawl } = await gmCrawl(ctx, campaignId);
    await writeMap(ctx, campaignId, { ...state, hexCrawl: { ...crawl, grid } });
  },
});

/** Sets a hex's terrain, habitat, region, point of interest or explored flag (null clears a field). */
export const updateHex = mutation({
  args: {
    campaignId: v.id("campaigns"),
    ...hexArgs,
    patch: v.object({
      explored: v.optional(v.boolean()),
      terrain: v.optional(v.union(v.null(), v.number())),
      habitat: v.optional(v.union(v.null(), v.string())),
      region: v.optional(v.union(v.null(), v.string())),
      poi: v.optional(v.union(v.null(), v.object({ text: v.string(), hidden: v.boolean() }))),
    }),
  },
  handler: async (ctx, { campaignId, q, r, patch }) => {
    checkHex({ q, r });
    const { state, crawl } = await gmCrawl(ctx, campaignId);
    const found = crawl.hexes.find((x) => x.q === q && x.r === r);
    const next: CrawlHex = { ...(found ?? { q, r, explored: false }) };
    if (patch.explored !== undefined) next.explored = patch.explored;
    for (const field of ["terrain", "habitat", "region", "poi"] as const) {
      const value = patch[field];
      if (value === undefined) continue;
      const blank = value === null || (typeof value === "string" && !value.trim()) || (typeof value === "object" && !value.text.trim());
      if (blank) delete next[field];
      else if (field === "poi") next.poi = { text: (value as { text: string }).text.trim(), hidden: (value as { hidden: boolean }).hidden };
      else if (field === "terrain") next.terrain = value as number;
      else next[field] = (value as string).trim();
    }
    const hexes = found ? crawl.hexes.map((x) => (x === found ? next : x)) : [...crawl.hexes, next];
    await writeMap(ctx, campaignId, { ...state, hexCrawl: { ...crawl, hexes } });
  },
});

/** Puts the party on a hex without travelling (setup or correction): no days pass. */
export const placePartyHex = mutation({
  args: { campaignId: v.id("campaigns"), ...hexArgs },
  handler: async (ctx, { campaignId, q, r }) => {
    checkHex({ q, r });
    const { campaign, state, crawl } = await gmCrawl(ctx, campaignId);
    const h = { q, r };
    const next: HexCrawl = { ...crawl, party: h, hexes: withHex(crawl, h, { explored: true }) };
    const pos = partyAt(campaign.frameId, state, next, h);
    await writeMap(ctx, campaignId, { ...state, party: { ...state.party, ...pos }, hexCrawl: next });
  },
});

/**
 * Travels to an adjacent hex (HF pp.171, 176–177): days by terrain rating and
 * travel mode, then the day counter advances, the hex is explored and the
 * encounter roll is made (terrain-rating dice; any 1 activates an encounter).
 */
export const moveToHex = mutation({
  args: {
    campaignId: v.id("campaigns"),
    ...hexArgs,
    terrain: v.number(),
    travelMode: v.union(v.literal("land"), v.literal("riverDown"), v.literal("riverUp"), v.literal("ocean")),
    encounterDie: v.optional(v.union(v.literal(4), v.literal(6), v.literal(8))),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { campaignId, q, r, terrain, travelMode, encounterDie = 6, idempotencyKey }): Promise<MoveResult> => {
    checkHex({ q, r });
    const { user, campaign, state, crawl } = await gmCrawl(ctx, campaignId);
    return idempotent(ctx, user, campaignId, idempotencyKey, "map_move_hex", { q, r, terrain, travelMode, encounterDie }, async () => {
      const h = { q, r };
      if (!crawl.party) invalid("Place the party on a hex first.");
      if (!isAdjacent(crawl.party, h)) invalid("The party can only move to an adjacent hex.");
      if (!Number.isInteger(terrain) || terrain < 1 || terrain > 4) invalid("Terrain rating must be 1–4.");
      const travel = travelDays(terrain, travelMode, rollDie);
      const roll = encounterRoll(terrain, rollDie, encounterDie);
      const day = crawl.day + travel.days;
      if (day > 100000) invalid("The day counter is full.");
      const next: HexCrawl = {
        ...crawl,
        party: h,
        day,
        travelMode,
        hexes: withHex(crawl, h, { explored: true, terrain }),
        lastMove: { q, r, days: travel.days, dice: roll.dice, encounter: roll.encounter, ...(travel.weatherRoll ? { weatherRoll: travel.weatherRoll } : {}) },
      };
      const pos = partyAt(campaign.frameId, state, next, h);
      const trail = [...state.party.trail, { x: state.party.x, y: state.party.y }].slice(-12);
      await writeMap(ctx, campaignId, { ...state, party: { ...pos, trail }, hexCrawl: next });
      return { days: travel.days, ...(travel.weatherRoll ? { weatherRoll: travel.weatherRoll } : {}), dice: roll.dice, encounter: roll.encounter, day };
    });
  },
});

/** Corrects the crawl's day counter. */
export const setCrawlDay = mutation({
  args: { campaignId: v.id("campaigns"), day: v.number() },
  handler: async (ctx, { campaignId, day }) => {
    const { state, crawl } = await gmCrawl(ctx, campaignId);
    if (!Number.isInteger(day) || day < 1) invalid("Day must be a whole number from 1.");
    await writeMap(ctx, campaignId, { ...state, hexCrawl: { ...crawl, day } });
  },
});
