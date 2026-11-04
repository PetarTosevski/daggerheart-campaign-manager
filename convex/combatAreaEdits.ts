import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { activeAreasOnMap } from "./combatAreas";
import { loadCombatMap } from "./lib/combatMaps";
import { gmMutation } from "./lib/functions";
import { AREA_RADII, type AreaRadius } from "./lib/validators/combatMaps";

/**
 * The GM's hand on live map areas (plan lanes-2 wave 9, tracer AO; dcm-lqnt; user answer 2026-10-31 on Dark Cloud,
 * dcm-bxp.99.19.39: "the GM can draw or adjust the area by hand"). An area a feature drew (convex/combatAreas.ts
 * `placeAreasFromPlan`) or one the GM draws here is one `combatAreas` row; the vision engine, membership at a roll and
 * the move events read it the same way, so a moved or resized Dark Cloud blocks sight where it now is.
 *
 * - `draw`: a circle (a square centre and a Defined Range radius, Close by default) or a wall (two end squares) on one of
 *   the campaign's maps, owned by a PC of the campaign (the row needs a caster: who the area belongs to, whose player may
 *   dismiss it). It lasts until the scene ends or the GM removes it. `featureId` is HAND_FEATURE.
 * - `move`: a circle's centre to a square (a token-centred area stops following its token); a wall is moved so that its
 *   first end lands on the square, or given new ends with `to`.
 * - `resize`: a circle's radius (a Defined Range).
 *
 * Removing uses the existing `combatAreas.remove`. Squares must be on the map (COMBAT_TARGET_INVALID); the GM is not held
 * to a feature's `placeWithin`. At most MAX_LIVE_AREAS live areas per map (COMBAT_AREA_LIMIT).
 */

/** The `featureId` of an area the GM drew by hand (no feature entry: it changes no roll by itself). */
export const HAND_FEATURE = "gm:hand";

/** The most live areas one map may hold when the GM draws another. */
export const MAX_LIVE_AREAS = 60;

const radiusValidator = v.union(...AREA_RADII.map((r) => v.literal(r)));
const squareValidator = v.object({ x: v.number(), y: v.number() });

type Square = { x: number; y: number };

/** A square on the map (whole numbers), else COMBAT_TARGET_INVALID. */
function onMap(map: Doc<"combatMaps">, p: Square): Square {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.y < 0 || p.x >= map.w || p.y >= map.h) throw appError("COMBAT_TARGET_INVALID", "That square is off the map.");
  return { x: Math.trunc(p.x), y: Math.trunc(p.y) };
}

function cleanLabel(label: string): string {
  const text = label.trim().slice(0, 80);
  if (text === "") throw appError("INVALID", "Name the area.");
  return text;
}

/** One of this campaign's live areas, else NOT_FOUND. */
async function liveArea(ctx: QueryCtx, campaignId: Id<"campaigns">, areaId: string): Promise<Doc<"combatAreas">> {
  const id = ctx.db.normalizeId("combatAreas", areaId);
  const area = id === null ? null : await ctx.db.get("combatAreas", id);
  if (area === null || area.campaignId !== campaignId || area.status !== "active") throw appError("NOT_FOUND");
  return area;
}

/** Draws an area by hand. Returns the new row's id. */
export const draw = gmMutation({
  args: {
    mapId: v.string(),
    /** The PC the area belongs to (its caster). */
    characterId: v.string(),
    label: v.string(),
    shape: v.union(v.literal("circle"), v.literal("wall")),
    /** A circle's centre square, or a wall's first end. */
    at: squareValidator,
    /** A wall's second end (required for a wall). */
    to: v.optional(squareValidator),
    /** A circle's radius; default Close (the user's Dark Cloud default, 2026-10-31). */
    radius: v.optional(radiusValidator),
    blocksSight: v.optional(v.boolean()),
  },
  returns: v.id("combatAreas"),
  handler: async (ctx, args) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, args.mapId);
    const characterId = ctx.db.normalizeId("characters", args.characterId);
    const character = characterId === null ? null : await ctx.db.get("characters", characterId);
    if (character === null || character.campaignId !== ctx.campaign._id) throw appError("NOT_FOUND");
    const label = cleanLabel(args.label);
    const at = onMap(map, args.at);
    let wall: { a: number[]; b: number[] } | undefined;
    if (args.shape === "wall") {
      if (args.to === undefined) throw appError("INVALID", "Pick the two ends of the wall.");
      const to = onMap(map, args.to);
      if (to.x === at.x && to.y === at.y) throw appError("INVALID", "A wall's two ends must be different squares.");
      wall = { a: [at.x, at.y], b: [to.x, to.y] };
    }
    if ((await activeAreasOnMap(ctx, map._id)).length >= MAX_LIVE_AREAS) throw appError("COMBAT_AREA_LIMIT", `This map already has ${MAX_LIVE_AREAS} live areas. Remove one first.`);
    const radius: AreaRadius = args.radius ?? "close";
    return ctx.db.insert("combatAreas", {
      campaignId: ctx.campaign._id,
      mapId: map._id,
      featureId: HAND_FEATURE,
      characterId: character._id,
      label,
      shape: args.shape,
      centre: { kind: "square", x: at.x, y: at.y },
      ...(wall ? { wall } : {}),
      radius,
      blocksSight: args.blocksSight === true,
      expires: "scene",
      status: "active",
      createdAt: Date.now(),
    });
  },
});

/** Moves a live area: a circle's centre onto `at`; a wall so its first end is on `at`, or onto the ends `at` and `to`. */
export const move = gmMutation({
  args: { areaId: v.string(), at: squareValidator, to: v.optional(squareValidator) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const area = await liveArea(ctx, ctx.campaign._id, args.areaId);
    const map = await loadCombatMap(ctx, ctx.campaign._id, area.mapId);
    const at = onMap(map, args.at);
    if (area.shape === "circle") {
      if (args.to !== undefined) throw appError("INVALID", "Only a wall has two ends.");
      await ctx.db.patch("combatAreas", area._id, { centre: { kind: "square", x: at.x, y: at.y } });
      return null;
    }
    const a = area.wall?.a ?? [at.x, at.y];
    const b = area.wall?.b ?? [at.x, at.y];
    let to: Square;
    if (args.to !== undefined) to = onMap(map, args.to);
    else {
      // Keep the wall's length and direction; both ends must stay on the map.
      to = onMap(map, { x: at.x + ((b[0] ?? 0) - (a[0] ?? 0)), y: at.y + ((b[1] ?? 0) - (a[1] ?? 0)) });
    }
    if (to.x === at.x && to.y === at.y) throw appError("INVALID", "A wall's two ends must be different squares.");
    await ctx.db.patch("combatAreas", area._id, { wall: { a: [at.x, at.y], b: [to.x, to.y] }, centre: { kind: "square", x: at.x, y: at.y } });
    return null;
  },
});

/** Sets a live circle's radius (a Defined Range). A wall has no radius (INVALID). */
export const resize = gmMutation({
  args: { areaId: v.string(), radius: radiusValidator },
  returns: v.null(),
  handler: async (ctx, args) => {
    const area = await liveArea(ctx, ctx.campaign._id, args.areaId);
    if (area.shape !== "circle") throw appError("INVALID", "A wall has no radius.");
    await ctx.db.patch("combatAreas", area._id, { radius: args.radius });
    return null;
  },
});
