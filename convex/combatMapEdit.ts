import { v } from "convex/values";

import {
  builtinPlacement,
  builtinTextureTerrain,
  isEmptyTile,
  isSwitchableLight,
  movePoint,
  objectRadius,
  objectRotation,
  paintTile,
  paletteSlot,
  PLACEABLE_KINDS,
  PLACEABLE_OBJECTS,
  placePoint,
  squaresByTile,
  strokeLayers,
  textureCode,
  uploadedPlacement,
  usedTextureCodes,
  type SpritePlacement,
  type StrokeLayer,
} from "../src/components/combat-map/editor/edit-model";
import { CELL_UNPAINTED, codeOfTerrain } from "../src/components/combat-map/map-view/cells";
import type { Terrain } from "../src/lib/domain/combat-map/spec";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { CELL_TILE_ROWS, MAX_MAP_H, MAX_MAP_W, assertCanAddObjects, loadCombatMap, loadCombatObject } from "./lib/combatMaps";
import { gmMutation } from "./lib/functions";
import { loadObjectTraits } from "./lib/spriteSources";
import { combatTerrainValidator, sightModeValidator, spriteRefValidator, type SpriteRef } from "./lib/validators/combatMaps";

/**
 * Editing a combat map by hand (D9 C5, plan `.omc/plans/d9-combat-map.yaml`): painting terrain and sight blockers
 * into `combatMapCells` (R2: generated layouts can be edited by hand; R7: the GM paints what blocks sight over an
 * uploaded image), and placing, moving, resizing, turning and removing objects with their sight setting (R7).
 * Every function is GM-only (gm wrappers: a player gets FORBIDDEN, an outsider NOT_FOUND). Each call is one intent:
 * a stroke's squares, or one object's id and one field. The layout reads stay C3's (`combatMaps.get` / `live`).
 *
 * The rules shared with the client's optimistic updates (snapping, radius bounds, the cell encoding) live in
 * `src/components/combat-map/editor/edit-model.ts`.
 *
 * Sprites style (plan `.omc/plans/sprite-packs.yaml`, tracer P9): `addObject` also places a sprite (a built-in key
 * or an uploaded sprite of this campaign; its Classic kind comes from the catalog or the uploaded row, D1, D2), and
 * `paintCells` also paints a texture: the texture joins the map's `texturePalette` and the stroke writes the
 * texture layer plus the texture's terrain class on the terrain layer, so vision and Classic stay right. Painting
 * or erasing terrain clears the texture under the brush; "Undo all painting" clears both layers.
 */

/** Squares one stroke may touch: every square of the largest map. */
const MAX_STROKE_SQUARES = MAX_MAP_W * MAX_MAP_H;
/** Tiles of one layer on the tallest map. */
const MAX_LAYER_TILES = Math.ceil(MAX_MAP_H / CELL_TILE_ROWS);

const placeableKindValidator = v.union(...PLACEABLE_KINDS.map((kind) => v.literal(kind)));
const paintValueValidator = v.union(combatTerrainValidator, v.literal("block"), v.literal("eraseTerrain"), v.literal("eraseBlock"));
const paintLayerValidator = v.union(v.literal("terrain"), v.literal("block"));
/** A texture stroke (Sprites style, P9): the texture layer with a texture ref. */
const texturePaintValidator = v.object({ layer: v.literal("texture"), texture: spriteRefValidator });

const finite = (n: number) => Number.isFinite(n);

/** Writes one stroke's code into one layer's touched tiles; a tile left empty is deleted. */
async function writeLayer(
  ctx: MutationCtx,
  mapId: Id<"combatMaps">,
  w: number,
  layer: StrokeLayer,
  code: string,
  byTile: Map<number, number[]>,
): Promise<void> {
  for (const [tile, positions] of byTile) {
    const row = await ctx.db
      .query("combatMapCells")
      .withIndex("by_map_layer_tile", (q) => q.eq("mapId", mapId).eq("layer", layer).eq("tile", tile))
      .first();
    if (row === null && code === CELL_UNPAINTED) continue;
    const cells = paintTile(row?.cells ?? null, w, positions, code);
    if (row !== null && cells === row.cells) continue;
    if (isEmptyTile(cells)) {
      if (row !== null) await ctx.db.delete("combatMapCells", row._id);
    } else if (row === null) {
      await ctx.db.insert("combatMapCells", { mapId, layer, tile, cells });
    } else {
      await ctx.db.patch("combatMapCells", row._id, { cells });
    }
  }
}

/** Every tile of one layer of a map. */
function layerTiles(ctx: MutationCtx, mapId: Id<"combatMaps">, layer: StrokeLayer) {
  return ctx.db
    .query("combatMapCells")
    .withIndex("by_map_layer_tile", (q) => q.eq("mapId", mapId).eq("layer", layer))
    .take(MAX_LAYER_TILES * 2);
}

/** An uploaded sprite of this campaign (SPRITE_NOT_FOUND for a deleted or another campaign's sprite). */
async function loadUploaded(ctx: MutationCtx, campaignId: Id<"campaigns">, id: Id<"spritePackSprites">): Promise<Doc<"spritePackSprites">> {
  const row = await ctx.db.get("spritePackSprites", id);
  if (row === null || row.campaignId !== campaignId) throw appError("SPRITE_NOT_FOUND");
  return row;
}

/** The terrain class a texture ref paints (SPRITE_UNKNOWN / SPRITE_NOT_FOUND; INVALID when the sprite is not a texture). */
async function textureTerrain(ctx: MutationCtx, campaignId: Id<"campaigns">, ref: SpriteRef): Promise<Terrain> {
  if ("builtin" in ref) {
    const terrain = builtinTextureTerrain(ref.builtin);
    if (terrain === null) throw appError("SPRITE_UNKNOWN");
    return terrain;
  }
  const row = await loadUploaded(ctx, campaignId, ref.uploaded);
  if (row.category !== "texture" || row.terrain === undefined) throw appError("INVALID", "That sprite is an object, not a terrain texture.");
  return row.terrain;
}

/** What placing an object sprite stores (SPRITE_UNKNOWN / SPRITE_NOT_FOUND; INVALID when the sprite is a texture). */
async function spritePlacement(ctx: MutationCtx, campaignId: Id<"campaigns">, ref: SpriteRef): Promise<SpritePlacement> {
  if ("builtin" in ref) {
    const placement = builtinPlacement(ref.builtin);
    if (placement === null) throw appError("SPRITE_UNKNOWN");
    return placement;
  }
  const row = await loadUploaded(ctx, campaignId, ref.uploaded);
  if (row.category !== "object") throw appError("INVALID", "That sprite is a terrain texture, not an object.");
  return uploadedPlacement(row);
}

// ---------------------------------------------------------------- painting

/**
 * GM: one brush stroke. `squares` are the touched squares as `y * w + x` of the map's current size; `paint` is a
 * terrain (hand-painted terrain layer), "block" (painted sight blockers, R7), "eraseTerrain" (clears painted terrain) or "eraseBlock" (clears sight
 * blockers; user 2026-10-20: two separate tools), or `{layer: "texture", texture}` (Sprites style, P9). Only the
 * tiles the stroke touches are written, so a stroke is one small write however long the GM drags.
 *
 * A texture: the map must be in the Sprites style (INVALID on a Classic map, G14), a built-in key must be a catalog texture (SPRITE_UNKNOWN), an uploaded one this campaign's texture
 * (SPRITE_NOT_FOUND / INVALID). It takes its slot in `texturePalette` (added when absent; a slot no square uses any
 * more is reused; SPRITE_PALETTE_FULL when all MAX_TEXTURE_PALETTE are in use), then the stroke writes the texture
 * layer and the texture's terrain class on the terrain layer in this one mutation.
 */
export const paintCells = gmMutation({
  args: { mapId: v.string(), squares: v.array(v.number()), paint: v.union(paintValueValidator, texturePaintValidator) },
  returns: v.null(),
  handler: async (ctx, { mapId, squares, paint }) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    const size = map.w * map.h;
    if (squares.length > MAX_STROKE_SQUARES || squares.some((s) => !Number.isInteger(s) || s < 0 || s >= size)) {
      throw appError("INVALID", "A stroke touches squares inside the map only.");
    }
    if (typeof paint !== "string") {
      if ((map.style ?? "classic") !== "sprites") throw appError("INVALID", "Textures are painted on Sprites-style maps only.");
      const terrain = await textureTerrain(ctx, ctx.campaign._id, paint.texture);
      if (squares.length === 0) return null;
      const slot = paletteSlot(map.texturePalette ?? [], paint.texture, usedTextureCodes(await layerTiles(ctx, map._id, "texture")));
      if (slot === null) throw appError("SPRITE_PALETTE_FULL");
      if (slot.changed) await ctx.db.patch("combatMaps", map._id, { texturePalette: slot.palette });
      const byTile = squaresByTile([...new Set(squares)], map.w);
      await writeLayer(ctx, map._id, map.w, "texture", textureCode(slot.index), byTile);
      await writeLayer(ctx, map._id, map.w, "terrain", codeOfTerrain(terrain), byTile);
      return null;
    }
    if (squares.length === 0) return null;
    const byTile = squaresByTile([...new Set(squares)], map.w);
    for (const { layer, code } of strokeLayers(paint)) await writeLayer(ctx, map._id, map.w, layer, code, byTile);
    return null;
  },
});

/**
 * GM: clears a whole painted layer (the board's "Undo all painting" for terrain; every sight blocker for block).
 * Undoing the terrain also clears the hand-painted textures and frees the texture palette (P9).
 */
export const clearPaint = gmMutation({
  args: { mapId: v.string(), layer: paintLayerValidator },
  returns: v.null(),
  handler: async (ctx, { mapId, layer }) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    for (const row of await layerTiles(ctx, map._id, layer)) await ctx.db.delete("combatMapCells", row._id);
    if (layer === "terrain") {
      for (const row of await layerTiles(ctx, map._id, "texture")) await ctx.db.delete("combatMapCells", row._id);
      if (map.texturePalette !== undefined) await ctx.db.patch("combatMaps", map._id, { texturePalette: undefined });
    }
    return null;
  },
});

// ---------------------------------------------------------------- objects

/**
 * GM: places an object at a point (snapped to half squares), at its default size: one of the board's kinds, or a
 * sprite (Sprites style, P9). A sprite's Classic kind and variant come from the catalog (a built-in key, else
 * SPRITE_UNKNOWN) or from the uploaded row (this campaign's, else SPRITE_NOT_FOUND), its radius is max(w, h) / 2
 * (D4). Exactly one of `kind` and `sprite` is required: both is INVALID.
 */
export const addObject = gmMutation({
  args: { mapId: v.string(), kind: v.optional(placeableKindValidator), sprite: v.optional(spriteRefValidator), x: v.number(), y: v.number() },
  returns: v.object({ objectId: v.id("combatMapObjects") }),
  handler: async (ctx, { mapId, kind, sprite, x, y }) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    if (!finite(x) || !finite(y)) throw appError("INVALID", "An object needs a position on the map.");
    if (kind !== undefined && sprite !== undefined) throw appError("INVALID", "Pick an object or a sprite, not both.");
    let placement: SpritePlacement;
    if (sprite !== undefined) placement = await spritePlacement(ctx, ctx.campaign._id, sprite);
    else if (kind !== undefined) placement = { kind, r: PLACEABLE_OBJECTS[kind].r };
    else throw appError("INVALID", "Pick an object or a sprite to place.");
    await assertCanAddObjects(ctx, map._id);
    const at = placePoint(x, y, map.w, map.h);
    const objectId = await ctx.db.insert("combatMapObjects", {
      mapId: map._id,
      kind: placement.kind,
      ...(placement.variant === undefined ? {} : { variant: placement.variant }),
      x: at.x,
      y: at.y,
      r: placement.r,
      rot: 0,
      ...(sprite === undefined ? {} : { sprite }),
    });
    return { objectId };
  },
});

/** GM: moves an object (snapped to quarter squares, kept on the map). */
export const moveObject = gmMutation({
  args: { objectId: v.string(), x: v.number(), y: v.number() },
  returns: v.null(),
  handler: async (ctx, { objectId, x, y }) => {
    const { object, map } = await loadCombatObject(ctx, ctx.campaign._id, objectId);
    if (!finite(x) || !finite(y)) throw appError("INVALID", "An object needs a position on the map.");
    await ctx.db.patch("combatMapObjects", object._id, movePoint(x, y, map.w, map.h));
    return null;
  },
});

/** GM: removes an object. */
export const removeObject = gmMutation({
  args: { objectId: v.string() },
  returns: v.null(),
  handler: async (ctx, { objectId }) => {
    const { object } = await loadCombatObject(ctx, ctx.campaign._id, objectId);
    await ctx.db.delete("combatMapObjects", object._id);
    return null;
  },
});

/**
 * GM: what an object does to sight (R7): blocks sight, cover only, no effect, or back to the default (D3: a
 * sprite's manifest sight, else its kind's).
 */
export const setObjectSight = gmMutation({
  args: { objectId: v.string(), sight: v.union(sightModeValidator, v.literal("default")) },
  returns: v.null(),
  handler: async (ctx, { objectId, sight }) => {
    const { object } = await loadCombatObject(ctx, ctx.campaign._id, objectId);
    await ctx.db.patch("combatMapObjects", object._id, { sight: sight === "default" ? undefined : sight });
    return null;
  },
});

/**
 * GM: one object's size (`r`, squares, kept within 0.3..4), turn (`rot`, radians) or light switch (`lit`, lights
 * only: campfire and wall torch, R9, or a sprite whose light trait is not none, Q1). Each field is optional; the
 * board sends one per click.
 */
export const updateObject = gmMutation({
  args: { objectId: v.string(), r: v.optional(v.number()), rot: v.optional(v.number()), lit: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { objectId, r, rot, lit }) => {
    const { object } = await loadCombatObject(ctx, ctx.campaign._id, objectId);
    if ((r !== undefined && !finite(r)) || (rot !== undefined && !finite(rot))) throw appError("INVALID", "Size and turn are numbers.");
    if (lit !== undefined && !isSwitchableLight(object.kind, await loadObjectTraits(ctx, ctx.campaign._id, object))) {
      throw appError("INVALID", "Only lights (campfires, torches, glowing things) can be lit.");
    }
    await ctx.db.patch("combatMapObjects", object._id, {
      ...(r === undefined ? {} : { r: objectRadius(r) }),
      ...(rot === undefined ? {} : { rot: objectRotation(rot) }),
      ...(lit === undefined ? {} : { lit }),
    });
    return null;
  },
});
