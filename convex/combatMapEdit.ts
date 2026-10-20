import { v } from "convex/values";

import {
  isEmptyTile,
  isSwitchableLight,
  movePoint,
  objectRadius,
  objectRotation,
  paintTile,
  PLACEABLE_KINDS,
  PLACEABLE_OBJECTS,
  placePoint,
  squaresByTile,
  strokeLayers,
} from "../src/components/combat-map/editor/edit-model";
import { CELL_UNPAINTED } from "../src/components/combat-map/map-view/cells";
import { appError } from "../src/lib/errors/app-error";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { CELL_TILE_ROWS, MAX_MAP_H, MAX_MAP_W, assertCanAddObjects, loadCombatMap, loadCombatObject } from "./lib/combatMaps";
import { gmMutation } from "./lib/functions";
import { combatTerrainValidator, sightModeValidator } from "./lib/validators/combatMaps";

/**
 * Editing a combat map by hand (D9 C5, plan `.omc/plans/d9-combat-map.yaml`): painting terrain and sight blockers
 * into `combatMapCells` (R2: generated layouts can be edited by hand; R7: the GM paints what blocks sight over an
 * uploaded image), and placing, moving, resizing, turning and removing objects with their sight setting (R7).
 * Every function is GM-only (gm wrappers: a player gets FORBIDDEN, an outsider NOT_FOUND). Each call is one intent:
 * a stroke's squares, or one object's id and one field. The layout reads stay C3's (`combatMaps.get` / `live`).
 *
 * The rules shared with the client's optimistic updates (snapping, radius bounds, the cell encoding) live in
 * `src/components/combat-map/editor/edit-model.ts`.
 */

/** Squares one stroke may touch: every square of the largest map. */
const MAX_STROKE_SQUARES = MAX_MAP_W * MAX_MAP_H;
/** Tiles of one layer on the tallest map. */
const MAX_LAYER_TILES = Math.ceil(MAX_MAP_H / CELL_TILE_ROWS);

const placeableKindValidator = v.union(...PLACEABLE_KINDS.map((kind) => v.literal(kind)));
const paintValueValidator = v.union(combatTerrainValidator, v.literal("block"), v.literal("erase"));
const paintLayerValidator = v.union(v.literal("terrain"), v.literal("block"));

const finite = (n: number) => Number.isFinite(n);

/** Writes one stroke's code into one layer's touched tiles; a tile left empty is deleted. */
async function writeLayer(
  ctx: MutationCtx,
  mapId: Id<"combatMaps">,
  w: number,
  layer: "terrain" | "block",
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

// ---------------------------------------------------------------- painting

/**
 * GM: one brush stroke. `squares` are the touched squares as `y * w + x` of the map's current size; `paint` is a
 * terrain (hand-painted terrain layer), "block" (painted sight blockers, R7) or "erase" (clears both). Only the
 * tiles the stroke touches are written, so a stroke is one small write however long the GM drags.
 */
export const paintCells = gmMutation({
  args: { mapId: v.string(), squares: v.array(v.number()), paint: paintValueValidator },
  returns: v.null(),
  handler: async (ctx, { mapId, squares, paint }) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    const size = map.w * map.h;
    if (squares.length > MAX_STROKE_SQUARES || squares.some((s) => !Number.isInteger(s) || s < 0 || s >= size)) {
      throw appError("INVALID", "A stroke touches squares inside the map only.");
    }
    if (squares.length === 0) return null;
    const byTile = squaresByTile([...new Set(squares)], map.w);
    for (const { layer, code } of strokeLayers(paint)) await writeLayer(ctx, map._id, map.w, layer, code, byTile);
    return null;
  },
});

/** GM: clears a whole painted layer (the board's "Undo all painting" for terrain; every sight blocker for block). */
export const clearPaint = gmMutation({
  args: { mapId: v.string(), layer: paintLayerValidator },
  returns: v.null(),
  handler: async (ctx, { mapId, layer }) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    const rows = await ctx.db
      .query("combatMapCells")
      .withIndex("by_map_layer_tile", (q) => q.eq("mapId", map._id).eq("layer", layer))
      .take(MAX_LAYER_TILES * 2);
    for (const row of rows) await ctx.db.delete("combatMapCells", row._id);
    return null;
  },
});

// ---------------------------------------------------------------- objects

/** GM: places an object of the board's kinds at a point (snapped to half squares), at its default size. */
export const addObject = gmMutation({
  args: { mapId: v.string(), kind: placeableKindValidator, x: v.number(), y: v.number() },
  returns: v.object({ objectId: v.id("combatMapObjects") }),
  handler: async (ctx, { mapId, kind, x, y }) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    if (!finite(x) || !finite(y)) throw appError("INVALID", "An object needs a position on the map.");
    await assertCanAddObjects(ctx, map._id);
    const at = placePoint(x, y, map.w, map.h);
    const objectId = await ctx.db.insert("combatMapObjects", { mapId: map._id, kind, x: at.x, y: at.y, r: PLACEABLE_OBJECTS[kind].r, rot: 0 });
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

/** GM: what an object does to sight (R7): blocks sight, cover only, no effect, or back to its kind's default. */
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
 * only: campfire and wall torch, R9). Each field is optional; the board sends one per click.
 */
export const updateObject = gmMutation({
  args: { objectId: v.string(), r: v.optional(v.number()), rot: v.optional(v.number()), lit: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { objectId, r, rot, lit }) => {
    const { object } = await loadCombatObject(ctx, ctx.campaign._id, objectId);
    if ((r !== undefined && !finite(r)) || (rot !== undefined && !finite(rot))) throw appError("INVALID", "Size and turn are numbers.");
    if (lit !== undefined && !isSwitchableLight(object.kind)) throw appError("INVALID", "Only campfires and wall torches can be lit.");
    await ctx.db.patch("combatMapObjects", object._id, {
      ...(r === undefined ? {} : { r: objectRadius(r) }),
      ...(rot === undefined ? {} : { rot: objectRotation(rot) }),
      ...(lit === undefined ? {} : { lit }),
    });
    return null;
  },
});
