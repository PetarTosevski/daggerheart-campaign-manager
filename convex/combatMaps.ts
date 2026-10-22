import { v, type Infer } from "convex/values";

import { imageMapSize, MIN_GRID_CELL } from "../src/components/combat-map/map-view/grid";
import { appError } from "../src/lib/errors/app-error";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import {
  CELL_TILE_ROWS,
  COMBAT_MAP_SCHEMA_VERSION,
  MAP_SIZES,
  MAX_COMBAT_IMAGE_BYTES,
  MAX_COMBAT_MAPS,
  MAX_MAP_H,
  MAX_MAP_NAME,
  assertCanAddMap,
  deleteMapChildren,
  liveCombatMap,
  loadCombatMap,
  objectsOnMap,
  tokensOnMap,
} from "./lib/combatMaps";
import { claimFile, deleteOwnFile, isAllowedImage, isClaimed } from "./lib/files";
import { keywordSetting } from "./lib/spriteSources";
import { campaignQuery, gmMutation, gmQuery, keyedGmMutation } from "./lib/functions";
import {
  CELL_LAYERS,
  combatAreaValidator,
  combatGridValidator,
  combatMapSourceValidator,
  combatObjectKindValidator,
  combatTerrainValidator,
  mapStyleValidator,
  pointValidator,
  settingRefValidator,
  sightModeValidator,
  spriteRefValidator,
  type CombatGrid,
} from "./lib/validators/combatMaps";
import { defaultMapStyleOf } from "./settings";

/**
 * Combat maps (D9 C3, plan `.omc/plans/d9-combat-map.yaml`): the GM's maps of a campaign (list, create blank,
 * rename, duplicate, delete, set live; R2), an uploaded map image with its square grid (R1), and the layout reads:
 * the GM's `get` for any map, everyone's `live` for the map the players see (Q1: the whole layout; tokens are not
 * part of it, C6/C7 read them). Every write is GM-only (gm wrappers: a player gets FORBIDDEN, an outsider
 * NOT_FOUND); the only player read is `live`.
 */

// ---------------------------------------------------------------- limits

/** Painted-cell tiles a map can hold: every layer, every tile of the tallest map. */
const MAX_CELL_TILES = CELL_LAYERS.length * Math.ceil(MAX_MAP_H / CELL_TILE_ROWS);
/** Explored rows per map: one per character (at most the campaign's characters). */
const MAX_EXPLORED_ROWS = 200;
/**
 * Child rows a map delete removes in its own transaction. The largest map has 300 objects, 12 tiles, 80 tokens
 * and one explored row per character, so this covers it in one go; anything left is deleted by a scheduled
 * continuation (`deleteChildren`) in batches of the same size.
 */
const DELETE_BUDGET = 1000;
/** An uploaded image's pixel size as reported by the browser (the World map's bound). */
const MAX_IMAGE_SIDE = 20000;
/** Square size the first grid gets at least (the board's `Math.max(16, ...)`). */
const MIN_FIRST_CELL = 16;

// ---------------------------------------------------------------- validators

const sizeValidator = v.union(v.literal("small"), v.literal("medium"), v.literal("large"));

const objectViewValidator = v.object({
  _id: v.id("combatMapObjects"),
  kind: combatObjectKindValidator,
  x: v.number(),
  y: v.number(),
  r: v.number(),
  rot: v.number(),
  variant: v.optional(v.string()),
  len: v.optional(v.number()),
  span: v.optional(v.number()),
  points: v.optional(v.array(pointValidator)),
  sight: v.optional(sightModeValidator),
  lit: v.optional(v.boolean()),
  /** Doors only (map-movement M2): true = open; absent = closed (every row written before M2 reads as closed). */
  open: v.optional(v.boolean()),
  /** Sprite packs: the object's sprite (absent = mapped from `kind` in the Sprites style, D1). */
  sprite: v.optional(spriteRefValidator),
});

/**
 * The D9 layers' tiles (terrain, block, fog), as every Classic reader decodes them (map-view/cells.ts). The
 * sprite-packs "texture" layer goes out separately in `textureCells`, so a reader of `cells` never meets it.
 */
const cellViewValidator = v.object({
  layer: v.union(v.literal("terrain"), v.literal("block"), v.literal("fog")),
  tile: v.number(),
  cells: v.string(),
});
/** Tiles of the "texture" layer (sprite packs P9): `TEXTURE_CODES[i]` = the map's `texturePalette[i]`, "." none. */
const textureCellViewValidator = v.object({ tile: v.number(), cells: v.string() });

const imageViewValidator = v.object({
  /** null while the image is unreachable (deleted blob); the map then shows its grid only. */
  url: v.union(v.string(), v.null()),
  grid: combatGridValidator,
});

/**
 * A map's whole layout: what the painter draws (areas, objects, painted cells) or the uploaded image and its grid.
 * Players get it for the live map (Q1); `prompt` (the GM's scene description) only goes to the GM.
 */
export const combatMapLayoutValidator = v.object({
  _id: v.id("combatMaps"),
  name: v.string(),
  live: v.boolean(),
  source: combatMapSourceValidator,
  w: v.number(),
  h: v.number(),
  base: combatTerrainValidator,
  plankV: v.optional(v.boolean()),
  areas: v.array(combatAreaValidator),
  seed: v.number(),
  updatedAt: v.number(),
  image: v.union(imageViewValidator, v.null()),
  objects: v.array(objectViewValidator),
  cells: v.array(cellViewValidator),
  /** Sprite packs: the "texture" layer's tiles; absent when the map has none. */
  textureCells: v.optional(v.array(textureCellViewValidator)),
  prompt: v.optional(v.string()),
  /** Sprite packs: absent = "classic" (Q4, E3). */
  style: v.optional(mapStyleValidator),
  /** Sprite packs: the resolved setting (D7); absent = resolve at paint time with the keyword picker. */
  setting: v.optional(settingRefValidator),
  /** Sprite packs, GM only (like `prompt`): whether the GM picked the setting (D7). */
  settingPicked: v.optional(v.boolean()),
  /** Sprite packs: what the "texture" cell layer's codes paint (TEXTURE_CODES[i] = texturePalette[i]). */
  texturePalette: v.optional(v.array(spriteRefValidator)),
});
export type CombatMapLayout = Infer<typeof combatMapLayoutValidator>;

/** One row of the GM's maps list: enough for the list, the live badge and a terrain thumbnail. */
const mapListRowValidator = v.object({
  _id: v.id("combatMaps"),
  _creationTime: v.number(),
  name: v.string(),
  live: v.boolean(),
  source: combatMapSourceValidator,
  w: v.number(),
  h: v.number(),
  base: combatTerrainValidator,
  plankV: v.optional(v.boolean()),
  areas: v.array(combatAreaValidator),
  seed: v.number(),
  imageUrl: v.union(v.string(), v.null()),
  updatedAt: v.number(),
  /** Sprite packs: the thumbnail draws the map's style (absent = "classic") in its setting. */
  style: v.optional(mapStyleValidator),
  setting: v.optional(settingRefValidator),
});
export type CombatMapListRow = Infer<typeof mapListRowValidator>;

/** An upload is refused by returning, not throwing (CF16): a throw would roll back the delete of the rejected file. */
const attachResultValidator = v.union(
  v.object({ ok: v.literal(true), mapId: v.id("combatMaps") }),
  v.object({ ok: v.literal(false), code: v.literal("INVALID"), message: v.string() }),
);

// ---------------------------------------------------------------- helpers

const now = () => Date.now();

/** A trimmed map name of 1..MAX_MAP_NAME characters, else INVALID. */
function mapName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_MAP_NAME) throw appError("INVALID", `A map name is 1 to ${MAX_MAP_NAME} characters.`);
  return trimmed;
}

/** The map's image `files` row when it belongs to this map (kind "combatMap", refId = map id; CF17), else null. */
async function imageFile(ctx: QueryCtx, map: Doc<"combatMaps">): Promise<Doc<"files"> | null> {
  if (!map.image) return null;
  const row = await ctx.db.get("files", map.image.fileId);
  return row !== null && row.kind === "combatMap" && row.refId === map._id && row.campaignId === map.campaignId ? row : null;
}

async function imageUrl(ctx: QueryCtx, map: Doc<"combatMaps">): Promise<string | null> {
  const row = await imageFile(ctx, map);
  return row === null ? null : ctx.storage.getUrl(row.storageId).catch(() => null);
}

/** The map's layout (see `combatMapLayoutValidator`); `gm` adds the scene prompt. */
async function layoutOf(ctx: QueryCtx, map: Doc<"combatMaps">, gm: boolean): Promise<CombatMapLayout> {
  const objects = await objectsOnMap(ctx, map._id);
  const cells = await ctx.db
    .query("combatMapCells")
    .withIndex("by_map_layer_tile", (q) => q.eq("mapId", map._id))
    .take(MAX_CELL_TILES);
  const textureCells = cells.flatMap(({ layer, tile, cells: text }) => (layer === "texture" ? [{ tile, cells: text }] : []));
  return {
    _id: map._id,
    name: map.name,
    live: map.live,
    source: map.source,
    w: map.w,
    h: map.h,
    base: map.base,
    ...(map.plankV === undefined ? {} : { plankV: map.plankV }),
    areas: map.areas,
    seed: map.seed,
    updatedAt: map.updatedAt,
    image: map.image ? { url: await imageUrl(ctx, map), grid: map.image.grid } : null,
    objects: objects.map(({ _id, kind, x, y, r, rot, variant, len, span, points, sight, lit, open, sprite }) => ({
      _id,
      kind,
      x,
      y,
      r,
      rot,
      ...(variant === undefined ? {} : { variant }),
      ...(len === undefined ? {} : { len }),
      ...(span === undefined ? {} : { span }),
      ...(points === undefined ? {} : { points }),
      ...(sight === undefined ? {} : { sight }),
      ...(lit === undefined ? {} : { lit }),
      ...(open === true ? { open } : {}),
      ...(sprite === undefined ? {} : { sprite }),
    })),
    cells: cells.flatMap(({ layer, tile, cells: text }) => (layer === "texture" ? [] : [{ layer, tile, cells: text }])),
    ...(textureCells.length === 0 ? {} : { textureCells }),
    ...(gm && map.prompt !== undefined ? { prompt: map.prompt } : {}),
    ...(map.style === undefined ? {} : { style: map.style }),
    ...(map.setting === undefined ? {} : { setting: map.setting }),
    ...(gm && map.settingPicked !== undefined ? { settingPicked: map.settingPicked } : {}),
    ...(map.texturePalette === undefined ? {} : { texturePalette: map.texturePalette }),
  };
}

/** The campaign's maps (at most MAX_COMBAT_MAPS). */
async function mapsOf(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"combatMaps">[]> {
  return ctx.db
    .query("combatMaps")
    .withIndex("by_campaign_updated", (q) => q.eq("campaignId", campaignId))
    .take(MAX_COMBAT_MAPS);
}

/** Makes `mapId` the campaign's only live map (R2). */
async function makeLive(ctx: MutationCtx, campaignId: Id<"campaigns">, mapId: Id<"combatMaps">): Promise<void> {
  const live = await ctx.db
    .query("combatMaps")
    .withIndex("by_campaign_live", (q) => q.eq("campaignId", campaignId).eq("live", true))
    .take(MAX_COMBAT_MAPS);
  for (const row of live) if (row._id !== mapId) await ctx.db.patch("combatMaps", row._id, { live: false });
  await ctx.db.patch("combatMaps", mapId, { live: true });
}

function validImageSize(width: number, height: number): boolean {
  const ok = (n: number) => Number.isInteger(n) && n >= 1 && n <= MAX_IMAGE_SIDE;
  return ok(width) && ok(height);
}

/** Moves tokens that a smaller map left outside back onto its edge (a token keeps its size). */
async function clampTokens(ctx: MutationCtx, mapId: Id<"combatMaps">, w: number, h: number): Promise<void> {
  for (const token of await tokensOnMap(ctx, mapId)) {
    const x = Math.max(0, Math.min(w - token.size, token.x));
    const y = Math.max(0, Math.min(h - token.size, token.y));
    if (x !== token.x || y !== token.y) await ctx.db.patch("combatTokens", token._id, { x, y });
  }
}

/** Deletes a map's objects, painted cells and explored areas (an image replaces the layout); tokens stay. */
async function clearLayoutRows(ctx: MutationCtx, mapId: Id<"combatMaps">): Promise<void> {
  for (const row of await objectsOnMap(ctx, mapId)) await ctx.db.delete("combatMapObjects", row._id);
  const cells = await ctx.db.query("combatMapCells").withIndex("by_map_layer_tile", (q) => q.eq("mapId", mapId)).take(MAX_CELL_TILES);
  for (const row of cells) await ctx.db.delete("combatMapCells", row._id);
  const explored = await ctx.db
    .query("combatExplored")
    .withIndex("by_map_character", (q) => q.eq("mapId", mapId))
    .take(MAX_EXPLORED_ROWS);
  for (const row of explored) await ctx.db.delete("combatExplored", row._id);
}

/** Deletes the map's image file (row and blob) when it has one. */
async function deleteImage(ctx: MutationCtx, map: Doc<"combatMaps">): Promise<void> {
  const row = await imageFile(ctx, map);
  if (row !== null) await deleteOwnFile(ctx, "combatMap", map._id, row.storageId);
}

/** The name "Map N" for the campaign's next map (the board's default). */
function nextMapName(count: number): string {
  return `Map ${count + 1}`;
}

// ---------------------------------------------------------------- queries

/** GM: the campaign's maps, oldest first (the board's order), with a thumbnail source. */
export const list = gmQuery({
  args: {},
  returns: v.array(mapListRowValidator),
  handler: async (ctx): Promise<CombatMapListRow[]> => {
    const maps = await mapsOf(ctx, ctx.campaign._id);
    maps.sort((a, b) => a._creationTime - b._creationTime);
    // Every map's image file and URL in one batch (PF10), not one awaited lookup per map.
    const urls = await Promise.all(maps.map((map) => imageUrl(ctx, map)));
    return maps.map(
      (map, i): CombatMapListRow => ({
        _id: map._id,
        _creationTime: map._creationTime,
        name: map.name,
        live: map.live,
        source: map.source,
        w: map.w,
        h: map.h,
        base: map.base,
        ...(map.plankV === undefined ? {} : { plankV: map.plankV }),
        areas: map.areas,
        seed: map.seed,
        imageUrl: urls[i] ?? null,
        updatedAt: map.updatedAt,
        ...(map.style === undefined ? {} : { style: map.style }),
        ...(map.setting === undefined ? {} : { setting: map.setting }),
      }),
    );
  },
});

/** GM: one map's whole layout, or null when the id is not one of this campaign's maps (deleted meanwhile). */
export const get = gmQuery({
  args: { mapId: v.string() },
  returns: v.union(combatMapLayoutValidator, v.null()),
  handler: async (ctx, { mapId }) => {
    const id = ctx.db.normalizeId("combatMaps", mapId);
    const map = id === null ? null : await ctx.db.get("combatMaps", id);
    if (map === null || map.campaignId !== ctx.campaign._id) return null;
    return layoutOf(ctx, map, true);
  },
});

/** Everyone in the campaign: the live map's layout (Q1), or null when the GM has not shown a map yet. */
export const live = campaignQuery({
  need: "view",
  args: {},
  returns: v.union(combatMapLayoutValidator, v.null()),
  handler: async (ctx) => {
    const map = await liveCombatMap(ctx, ctx.campaign._id);
    return map === null ? null : layoutOf(ctx, map, false);
  },
});

/** GM: how many tokens a map holds (the header line). Its own query, so a token move re-runs only this. */
export const tokenCount = gmQuery({
  args: { mapId: v.string() },
  returns: v.number(),
  handler: async (ctx, { mapId }) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    return (await tokensOnMap(ctx, map._id)).length;
  },
});

// ---------------------------------------------------------------- maps

/**
 * GM: a blank map of the board's Small / Medium / Large size; the campaign's first map is live at once (R2). It is
 * drawn in the GM's default map style (dcm-bxp.89, the Settings slider; Classic unless they picked Sprites). A Sprites
 * map also stores the keyword-picked setting, as a first `setStyle` switch to Sprites does (D7).
 */
export const create = keyedGmMutation({
  args: { size: sizeValidator, name: v.optional(v.string()) },
  returns: v.object({ mapId: v.id("combatMaps") }),
  handler: async (ctx, { size, name }) =>
    ctx.once("combat_map_create", { size, name: name ?? null }, async () => {
      const campaignId = ctx.campaign._id;
      await assertCanAddMap(ctx, campaignId);
      const count = (await mapsOf(ctx, campaignId)).length;
      const hasLive = (await liveCombatMap(ctx, campaignId)) !== null;
      const { w, h } = MAP_SIZES[size];
      const title = name === undefined ? nextMapName(count) : mapName(name);
      // Classic stays an absent `style` (E3: maps without one are Classic), so a Classic default writes nothing new.
      const sprites =
        (await defaultMapStyleOf(ctx, ctx.user)) === "sprites"
          ? { style: "sprites" as const, setting: keywordSetting({ name: title }), settingPicked: false }
          : {};
      const mapId = await ctx.db.insert("combatMaps", {
        campaignId,
        name: title,
        live: !hasLive,
        source: "blank",
        w,
        h,
        base: "grass",
        areas: [],
        seed: 1,
        ...sprites,
        schemaVersion: COMBAT_MAP_SCHEMA_VERSION,
        updatedAt: now(),
      });
      return { mapId };
    }),
});

/** GM: renames a map. */
export const rename = gmMutation({
  args: { mapId: v.string(), name: v.string() },
  returns: v.null(),
  handler: async (ctx, { mapId, name }) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    await ctx.db.patch("combatMaps", map._id, { name: mapName(name), updatedAt: now() });
    return null;
  },
});

/** GM: makes a map the one the players see; the previous live map stops being live (exactly one, R2). */
export const setLive = gmMutation({
  args: { mapId: v.string() },
  returns: v.null(),
  handler: async (ctx, { mapId }) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    await makeLive(ctx, ctx.campaign._id, map._id);
    return null;
  },
});

/**
 * GM: a copy of a map: its layout, objects and painted cells (tokens, explored areas and the live mark are not
 * copied). An uploaded image is copied into its own file by a scheduled action, so each map owns its file.
 * Every stored field is spread, so the sprite-pack fields go along (sprite packs E8): style, setting,
 * settingPicked, texturePalette, area textures, object sprites and the "texture" cell layer.
 */
export const duplicate = keyedGmMutation({
  args: { mapId: v.string() },
  returns: v.object({ mapId: v.id("combatMaps") }),
  handler: async (ctx, { mapId }) =>
    ctx.once("combat_map_duplicate", { mapId }, async () => {
      const campaignId = ctx.campaign._id;
      const map = await loadCombatMap(ctx, campaignId, mapId);
      await assertCanAddMap(ctx, campaignId);
      const { _id, _creationTime, image, ...fields } = map;
      void _id;
      void _creationTime;
      const copyId = await ctx.db.insert("combatMaps", {
        ...fields,
        name: `${map.name} (copy)`.slice(0, MAX_MAP_NAME),
        live: false,
        updatedAt: now(),
      });
      for (const object of await objectsOnMap(ctx, map._id)) {
        const { _id: objectId, _creationTime: objectTime, mapId: from, ...rest } = object;
        void objectId;
        void objectTime;
        void from;
        await ctx.db.insert("combatMapObjects", { ...rest, mapId: copyId });
      }
      const cells = await ctx.db.query("combatMapCells").withIndex("by_map_layer_tile", (q) => q.eq("mapId", map._id)).take(MAX_CELL_TILES);
      for (const row of cells) await ctx.db.insert("combatMapCells", { mapId: copyId, layer: row.layer, tile: row.tile, cells: row.cells });
      const file = await imageFile(ctx, map);
      if (image && file !== null) {
        await ctx.scheduler.runAfter(0, internal.combatMaps.copyImage, {
          storageId: file.storageId,
          mapId: copyId,
          uploadedBy: ctx.user._id,
          grid: image.grid,
        });
      }
      return { mapId: copyId };
    }),
});

/**
 * GM: deletes a map with its objects, painted cells, tokens, explored areas and image file. When the live map
 * goes, the oldest remaining map becomes live (the board's rule). Child rows beyond one transaction's budget are
 * deleted by a scheduled continuation.
 */
export const remove = gmMutation({
  args: { mapId: v.string() },
  returns: v.null(),
  handler: async (ctx, { mapId }) => {
    const campaignId = ctx.campaign._id;
    const map = await loadCombatMap(ctx, campaignId, mapId);
    await deleteImage(ctx, map);
    await ctx.db.delete("combatMaps", map._id);
    if ((await deleteMapChildren(ctx, map._id, DELETE_BUDGET)) >= DELETE_BUDGET) {
      await ctx.scheduler.runAfter(0, internal.combatMaps.deleteChildren, { mapId: map._id });
    }
    if (map.live) {
      const rest = await mapsOf(ctx, campaignId);
      rest.sort((a, b) => a._creationTime - b._creationTime);
      const next = rest[0];
      if (next !== undefined) await makeLive(ctx, campaignId, next._id);
    }
    return null;
  },
});

/** Continues a map delete: removes another batch of its child rows and reschedules itself until none are left. */
export const deleteChildren = internalMutation({
  args: { mapId: v.id("combatMaps") },
  returns: v.null(),
  handler: async (ctx, { mapId }) => {
    if ((await deleteMapChildren(ctx, mapId, DELETE_BUDGET)) >= DELETE_BUDGET) {
      await ctx.scheduler.runAfter(0, internal.combatMaps.deleteChildren, { mapId });
    }
    return null;
  },
});

// ---------------------------------------------------------------- uploaded image (R1)

/** GM: an upload URL for a map image. Rate-limited (uploadUrl). */
export const imageUploadUrl = gmMutation({
  rateLimit: "uploadUrl",
  args: {},
  returns: v.string(),
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

/**
 * GM: uses a just-uploaded image as a map. With `mapId` the image replaces that map's layout (its objects,
 * painted cells and explored areas go; tokens stay, moved inside the new size); without it a new map is made
 * (named `name`). The file must be an unclaimed PNG, JPEG, WebP or GIF of at most 8 MB; otherwise it is deleted
 * and the result is `{ ok: false }` (CF16). `width` and `height` are the image's pixel size; the first grid
 * fits `size`'s width in squares across the image (the board's rule).
 */
export const attachImage = gmMutation({
  args: {
    mapId: v.optional(v.string()),
    storageId: v.id("_storage"),
    width: v.number(),
    height: v.number(),
    name: v.optional(v.string()),
    size: v.optional(sizeValidator),
  },
  returns: attachResultValidator,
  handler: async (ctx, { mapId, storageId, width, height, name, size }): Promise<Infer<typeof attachResultValidator>> => {
    const campaignId = ctx.campaign._id;
    // The target is checked first, so a refusal below never leaves a file for a map the caller cannot use.
    const target = mapId === undefined ? null : await loadCombatMap(ctx, campaignId, mapId);
    const meta = await ctx.db.system.get(storageId);
    // Only an unclaimed file may be attached, so the rejections below only ever delete unclaimed files.
    if (meta === null || (await isClaimed(ctx, storageId))) throw appError("NOT_FOUND");
    if (!isAllowedImage(meta, MAX_COMBAT_IMAGE_BYTES)) {
      await ctx.storage.delete(storageId);
      return { ok: false, code: "INVALID", message: "Map images must be PNG, JPEG, WebP or GIF files of at most 8 MB." };
    }
    if (!validImageSize(width, height)) {
      await ctx.storage.delete(storageId);
      return { ok: false, code: "INVALID", message: "Couldn’t read the image size." };
    }
    const across = MAP_SIZES[size ?? "medium"].w;
    const grid: CombatGrid = { cell: Math.max(MIN_FIRST_CELL, Math.round(width / across)), offsetX: 0, offsetY: 0 };
    const { w, h } = imageMapSize({ width, height }, grid);
    if (target === null) await assertCanAddMap(ctx, campaignId);
    const hasLive = target === null ? (await liveCombatMap(ctx, campaignId)) !== null : true;
    const count = target === null ? (await mapsOf(ctx, campaignId)).length : 0;
    const id =
      target?._id ??
      (await ctx.db.insert("combatMaps", {
        campaignId,
        name: name === undefined || name.trim() === "" ? nextMapName(count) : name.trim().slice(0, MAX_MAP_NAME),
        live: !hasLive,
        source: "image",
        w,
        h,
        base: "stone",
        areas: [],
        seed: 1,
        schemaVersion: COMBAT_MAP_SCHEMA_VERSION,
        updatedAt: now(),
      }));
    await claimFile(ctx, { storageId, campaignId, uploadedBy: ctx.user._id, kind: "combatMap", refId: id });
    const file = await ctx.db
      .query("files")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first();
    if (file === null) throw new Error("The claimed file row is missing.");
    if (target !== null) {
      await deleteImage(ctx, target);
      await clearLayoutRows(ctx, target._id);
      await clampTokens(ctx, target._id, w, h);
    }
    await ctx.db.patch("combatMaps", id, { source: "image", w, h, areas: [], image: { fileId: file._id, grid }, updatedAt: now() });
    return { ok: true, mapId: id };
  },
});

/**
 * GM: the square grid over an uploaded image (R1): square size and offset in image pixels. The map's size in
 * squares follows (whole squares from the offset on, within 12..44 x 10..32); tokens outside it move onto its edge.
 * `imageWidth` / `imageHeight` are the image's pixel size, as for `attachImage`.
 */
export const setGrid = gmMutation({
  args: { mapId: v.string(), grid: combatGridValidator, imageWidth: v.number(), imageHeight: v.number() },
  returns: v.null(),
  handler: async (ctx, { mapId, grid, imageWidth, imageHeight }) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    if (!map.image) throw appError("INVALID", "Only a map made from an image has a grid to line up.");
    const whole = (n: number) => Number.isInteger(n);
    if (
      !validImageSize(imageWidth, imageHeight) ||
      !whole(grid.cell) ||
      grid.cell < MIN_GRID_CELL ||
      grid.cell > Math.max(imageWidth, imageHeight) ||
      !whole(grid.offsetX) ||
      !whole(grid.offsetY) ||
      Math.abs(grid.offsetX) > imageWidth ||
      Math.abs(grid.offsetY) > imageHeight
    ) {
      throw appError("COMBAT_MAP_SIZE", "That grid doesn’t fit the image.");
    }
    const { w, h } = imageMapSize({ width: imageWidth, height: imageHeight }, grid);
    await ctx.db.patch("combatMaps", map._id, { w, h, image: { ...map.image, grid }, updatedAt: now() });
    if (w < map.w || h < map.h) await clampTokens(ctx, map._id, w, h);
    return null;
  },
});

/** Copies a duplicated map's image into its own file (one `files` row per blob, CF17), then attaches it. */
export const copyImage = internalAction({
  args: { storageId: v.id("_storage"), mapId: v.id("combatMaps"), uploadedBy: v.id("users"), grid: combatGridValidator },
  returns: v.null(),
  handler: async (ctx, { storageId, mapId, uploadedBy, grid }) => {
    const blob = await ctx.storage.get(storageId);
    if (blob === null) return null;
    const copy = await ctx.storage.store(blob);
    await ctx.runMutation(internal.combatMaps.attachCopiedImage, { mapId, storageId: copy, uploadedBy, grid });
    return null;
  },
});

/** Claims a copied image for its map, or deletes the copy when the map is gone meanwhile. */
export const attachCopiedImage = internalMutation({
  args: { mapId: v.id("combatMaps"), storageId: v.id("_storage"), uploadedBy: v.id("users"), grid: combatGridValidator },
  returns: v.null(),
  handler: async (ctx, { mapId, storageId, uploadedBy, grid }) => {
    const map = await ctx.db.get("combatMaps", mapId);
    if (map === null || map.image) {
      await ctx.storage.delete(storageId);
      return null;
    }
    await claimFile(ctx, { storageId, campaignId: map.campaignId, uploadedBy, kind: "combatMap", refId: mapId });
    const file = await ctx.db
      .query("files")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first();
    if (file === null) throw new Error("The claimed file row is missing.");
    await ctx.db.patch("combatMaps", mapId, { image: { fileId: file._id, grid } });
    return null;
  },
});
