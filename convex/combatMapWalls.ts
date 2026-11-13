import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import {
  assertCanAddWalls,
  gmWall,
  loadWall,
  playerWall,
  wallKindValidator,
  wallPoint,
  wallPoints,
  wallsOnMap,
  wallSideValidator,
  wallStyleValidator,
  wallViewValidator,
} from "./lib/combatMapWalls";
import { liveCombatMap, loadCombatMap } from "./lib/combatMaps";
import { campaignQuery, gmMutation } from "./lib/functions";
import { atLeast, type Permission } from "./lib/permissions";
import { pointValidator } from "./lib/validators/combatMaps";

/**
 * Drawn walls (plan map-editor, tracer ME4; geometry ME1, docs/tasks/TASK-ME1.md): freeform wall runs of six kinds
 * (wall, door, window, secret door, low wall, one-way), one `combatMapWalls` row per run, at most MAX_WALL_RUNS per map
 * and MAX_WALL_POINTS points per run.
 *
 * - `list` (every member): a map's runs. The GM any map's (default: the live one), with every field; a player only the
 *   live map's, with every unrevealed secret door sent as a plain wall (`playerWall`).
 * - `add`, `update`, `moveVertex`, `split`, `remove` (GM): one intent each, so the editor's undo can invert it.
 * - `setRevealed` (GM): reveals a secret door (a door from then on, closed) or hides it again.
 * Doors in walls open and close through `combatVision.toggleDoor` (the GM, or a player from Melee, D7/D8).
 * Movement (convex/lib/combatMovement.ts), vision and attack sight (convex/lib/combatVision.ts `loadScene`) read the
 * runs; a map delete and a campaign purge delete them (`deleteMapChildren`).
 */

type CampaignCtx = QueryCtx & { campaign: Doc<"campaigns">; permission: Permission };

const pointArgsValidator = v.object({ x: v.number(), y: v.number() });

/** The map a read is about: the GM any of the campaign's maps (default: the live one); a player only the live map. */
async function targetMap(ctx: CampaignCtx, mapId: string | undefined): Promise<Doc<"combatMaps"> | null> {
  const gm = atLeast(ctx.permission, "owner");
  if (gm && mapId !== undefined) return loadCombatMap(ctx, ctx.campaign._id, mapId);
  const live = await liveCombatMap(ctx, ctx.campaign._id);
  if (!gm && mapId !== undefined && (live === null || live._id !== mapId)) throw appError("COMBAT_MAP_NOT_FOUND");
  return live;
}

/**
 * A map's wall runs, oldest first (null without a map). The GM gets them as stored; a player gets an unrevealed
 * secret door as `kind: "wall"` without `open` or `revealed`, so the shape never tells it apart from a wall.
 */
export const list = campaignQuery({
  need: "view",
  args: { mapId: v.optional(v.string()) },
  returns: v.union(v.null(), v.object({ mapId: v.id("combatMaps"), walls: v.array(wallViewValidator) })),
  handler: async (ctx, { mapId }) => {
    const map = await targetMap(ctx, mapId);
    if (map === null) return null;
    const shape = atLeast(ctx.permission, "owner") ? gmWall : playerWall;
    return { mapId: map._id, walls: (await wallsOnMap(ctx, map._id)).map(shape) };
  },
});

/**
 * GM: draws a wall run. `points` are clamped onto the map; 2 to MAX_WALL_POINTS of them (INVALID otherwise).
 * `side` matters for one-way walls only, `open` for doors and secret doors, `revealed` for secret doors (so the
 * editor's undo of a delete restores the run in one call). COMBAT_WALL_LIMIT past MAX_WALL_RUNS.
 */
export const add = gmMutation({
  args: {
    mapId: v.string(),
    kind: wallKindValidator,
    points: v.array(pointValidator),
    style: v.optional(wallStyleValidator),
    side: v.optional(wallSideValidator),
    open: v.optional(v.boolean()),
    revealed: v.optional(v.boolean()),
  },
  returns: v.object({ wallId: v.id("combatMapWalls") }),
  handler: async (ctx, { mapId, kind, points, style, side, open, revealed }) => {
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    const clean = wallPoints(points, map.w, map.h);
    await assertCanAddWalls(ctx, map._id);
    const wallId = await ctx.db.insert("combatMapWalls", {
      mapId: map._id,
      kind,
      points: clean,
      ...defined({ ...kindFields(kind, { side, open, revealed }), style }),
    });
    return { wallId };
  },
});

/** The object without its undefined fields (an insert stores only what is set). */
function defined<T extends Record<string, unknown>>(fields: T): Partial<T> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as Partial<T>;
}

/** The kind-specific fields a run of `kind` keeps (closed, hidden and the left side are stored as absent). */
function kindFields(
  kind: Doc<"combatMapWalls">["kind"],
  { side, open, revealed }: { side?: "left" | "right" | undefined; open?: boolean | undefined; revealed?: boolean | undefined },
): Pick<Doc<"combatMapWalls">, "side" | "open" | "revealed"> {
  return {
    side: kind === "oneway" && side === "right" ? "right" : undefined,
    open: (kind === "door" || kind === "secret") && open === true ? true : undefined,
    revealed: kind === "secret" && revealed === true ? true : undefined,
  };
}

/**
 * GM: changes a run's kind, style (null: the default) or one-way side. A new kind keeps only what it uses: a door
 * that becomes a wall forgets it was open, a secret door that becomes a door is closed, `side` stays only on one-way.
 */
export const update = gmMutation({
  args: {
    wallId: v.string(),
    kind: v.optional(wallKindValidator),
    style: v.optional(v.union(wallStyleValidator, v.null())),
    side: v.optional(wallSideValidator),
  },
  returns: v.null(),
  handler: async (ctx, { wallId, kind, style, side }) => {
    const { wall } = await loadWall(ctx, ctx.campaign._id, wallId);
    if (kind === undefined && style === undefined && side === undefined) throw appError("INVALID", "Nothing to change.");
    const next = kind ?? wall.kind;
    const keep = next === wall.kind ? { open: wall.open, revealed: wall.revealed } : {};
    await ctx.db.patch("combatMapWalls", wall._id, {
      kind: next,
      ...kindFields(next, { side: side ?? wall.side, ...keep }),
      ...(style === undefined ? {} : { style: style ?? undefined }),
    });
    return null;
  },
});

/** GM: moves one point of a run (clamped onto the map). INVALID for an index that is not one of its points. */
export const moveVertex = gmMutation({
  args: { wallId: v.string(), index: v.number(), x: v.number(), y: v.number() },
  returns: v.null(),
  handler: async (ctx, { wallId, index, x, y }) => {
    const { wall, map } = await loadWall(ctx, ctx.campaign._id, wallId);
    if (!Number.isInteger(index) || index < 0 || index >= wall.points.length) throw appError("INVALID", "That point isn't on the wall.");
    const points = wall.points.map((p, i) => (i === index ? wallPoint(x, y, map.w, map.h) : p));
    await ctx.db.patch("combatMapWalls", wall._id, { points: wallPoints(points, map.w, map.h) });
    return null;
  },
});

/**
 * GM: splits a run in two. Without `at`, at its point `index` (not the first or last). With `at`, a new point is put
 * between points `index` and `index + 1` (clamped onto the map) and the run splits there: the editor inserts a door
 * into a wall by splitting twice and changing the middle run's kind. The first part keeps the run's id; the second is a
 * new run with the same kind, style, side, open and revealed. COMBAT_WALL_LIMIT past MAX_WALL_RUNS.
 */
export const split = gmMutation({
  args: { wallId: v.string(), index: v.number(), at: v.optional(pointArgsValidator) },
  returns: v.object({ first: v.id("combatMapWalls"), second: v.id("combatMapWalls") }),
  handler: async (ctx, { wallId, index, at }) => {
    const { wall, map } = await loadWall(ctx, ctx.campaign._id, wallId);
    const n = wall.points.length;
    let first: number[][];
    let second: number[][];
    if (at === undefined) {
      if (!Number.isInteger(index) || index < 1 || index > n - 2) throw appError("INVALID", "Split a wall at one of its inner points.");
      first = wall.points.slice(0, index + 1);
      second = wall.points.slice(index);
    } else {
      if (!Number.isInteger(index) || index < 0 || index > n - 2) throw appError("INVALID", "That segment isn't on the wall.");
      const p = wallPoint(at.x, at.y, map.w, map.h);
      first = [...wall.points.slice(0, index + 1), p];
      second = [p, ...wall.points.slice(index + 1)];
    }
    // Each part needs a segment of its own (INVALID when the split point coincides with the run's end).
    const a = wallPoints(first, map.w, map.h);
    const b = wallPoints(second, map.w, map.h);
    await assertCanAddWalls(ctx, map._id);
    await ctx.db.patch("combatMapWalls", wall._id, { points: a });
    const secondId: Id<"combatMapWalls"> = await ctx.db.insert("combatMapWalls", {
      mapId: wall.mapId,
      kind: wall.kind,
      points: b,
      ...defined({ open: wall.open, revealed: wall.revealed, side: wall.side, style: wall.style }),
    });
    return { first: wall._id, second: secondId };
  },
});

/** GM: deletes a run. */
export const remove = gmMutation({
  args: { wallId: v.string() },
  returns: v.null(),
  handler: async (ctx, { wallId }) => {
    const { wall } = await loadWall(ctx, ctx.campaign._id, wallId);
    await ctx.db.delete("combatMapWalls", wall._id);
    return null;
  },
});

/**
 * GM: reveals a secret door (`revealed` true: a door from then on, closed until someone opens it) or hides it again
 * (a wall to players; its open state is forgotten, so it is closed when revealed next). INVALID for any other kind.
 */
export const setRevealed = gmMutation({
  args: { wallId: v.string(), revealed: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { wallId, revealed }) => {
    const { wall } = await loadWall(ctx, ctx.campaign._id, wallId);
    if (wall.kind !== "secret") throw appError("INVALID", "Only secret doors are revealed.");
    if ((wall.revealed === true) === revealed) return null;
    await ctx.db.patch("combatMapWalls", wall._id, { revealed: revealed ? true : undefined, open: undefined });
    return null;
  },
});
