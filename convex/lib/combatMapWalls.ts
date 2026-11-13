import { v, type Infer } from "convex/values";

import { tokenDistance, type Footprint } from "../../src/lib/domain/combat-actions/distance";
import { MELEE_SQUARES } from "../../src/lib/domain/combat-map/reach";
import { WALL_KINDS, type WallRun } from "../../src/lib/domain/combat-map/walls";
import { appError } from "../../src/lib/errors/app-error";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { pointValidator } from "./validators/combatMaps";

/**
 * Drawn walls on the server (plan map-editor, tracer ME4): the `combatMapWalls` row shape, its caps, the loaders that
 * keep a wall inside the caller's campaign, the shapes sent to the GM and to players, and the geometry a wall door
 * needs for the toggleDoor reach rule. The wall geometry itself (what each kind does to sight and movement, crossing
 * tests) is ME1's `src/lib/domain/combat-map/walls.ts`; see docs/tasks/TASK-ME1.md and TASK-ME4.md.
 *
 * Each run is one row (rule 6, CD8), reached through `mapId` (`by_map`). This module imports nothing from
 * ./combatMaps, so ./combatMaps can call `deleteMapWalls` from its child-row delete without an import cycle.
 */

// ---------------------------------------------------------------- caps

/** Wall runs per map (plan map-editor orchestrator default). */
export const MAX_WALL_RUNS = 400;
/** Points per run (the same as an area's, plan map-editor). */
export const MAX_WALL_POINTS = 64;

// ---------------------------------------------------------------- validators

export const wallKindValidator = v.union(...WALL_KINDS.map((kind) => v.literal(kind)));
/** A one-way wall's open side, as drawn (walls.ts `WallSide`). Absent = "left"; only "right" is stored. */
export const wallSideValidator = v.union(v.literal("left"), v.literal("right"));
/** How a wall is drawn (ME6 renders them). Absent = the renderer's default. */
export const WALL_STYLES = ["stone", "wood", "cave", "hedge"] as const;
export const wallStyleValidator = v.union(...WALL_STYLES.map((style) => v.literal(style)));
export type WallStyle = Infer<typeof wallStyleValidator>;

/** A `combatMapWalls` row's stored fields. */
export const combatWallFields = {
  mapId: v.id("combatMaps"),
  kind: wallKindValidator,
  /** [x, y] points in squares (integer = a square corner), at least two, at most MAX_WALL_POINTS. */
  points: v.array(pointValidator),
  /** Doors and secret doors: true = open. Absent = closed. A secret door's `open` counts only once it is revealed. */
  open: v.optional(v.boolean()),
  /** Secret doors: true = the GM revealed it (a door now). Absent = a wall, and sent to players as `kind: "wall"`. */
  revealed: v.optional(v.boolean()),
  /** One-way walls: "right" when the open side is on the right as drawn. Absent = the left (walls.ts). */
  side: v.optional(wallSideValidator),
  style: v.optional(wallStyleValidator),
};

/**
 * A wall run as a read sends it. The GM gets every field as stored. A player gets an unrevealed secret door as
 * `kind: "wall"` with no `open` or `revealed` (`playerWall`), so nothing in the shape tells it apart from a wall.
 */
export const wallViewValidator = v.object({
  _id: v.id("combatMapWalls"),
  kind: wallKindValidator,
  points: v.array(pointValidator),
  open: v.optional(v.boolean()),
  revealed: v.optional(v.boolean()),
  side: v.optional(wallSideValidator),
  style: v.optional(wallStyleValidator),
});
export type WallView = Infer<typeof wallViewValidator>;

// ---------------------------------------------------------------- shapes

/** The row as the GM reads it. */
export function gmWall(row: Doc<"combatMapWalls">): WallView {
  return {
    _id: row._id,
    kind: row.kind,
    points: row.points,
    ...(row.open === undefined ? {} : { open: row.open }),
    ...(row.revealed === undefined ? {} : { revealed: row.revealed }),
    ...(row.side === undefined ? {} : { side: row.side }),
    ...(row.style === undefined ? {} : { style: row.style }),
  };
}

/** The row as a player reads it: an unrevealed secret door is a plain wall (same id, points and style). */
export function playerWall(row: Doc<"combatMapWalls">): WallView {
  if (row.kind === "secret" && row.revealed !== true) {
    return { _id: row._id, kind: "wall", points: row.points, ...(row.style === undefined ? {} : { style: row.style }) };
  }
  return gmWall(row);
}

/** The rows as the geometry reads them (walls.ts `WallRun`). */
export function wallRunsOf(rows: readonly Doc<"combatMapWalls">[]): WallRun[] {
  return rows.map((row) => ({ kind: row.kind, points: row.points, open: row.open ?? null, revealed: row.revealed ?? null, side: row.side ?? null }));
}

/** Whether the run opens and closes now: a door, or a secret door the GM has revealed. */
export function isWallDoor(row: Pick<Doc<"combatMapWalls">, "kind" | "revealed">): boolean {
  return row.kind === "door" || (row.kind === "secret" && row.revealed === true);
}

// ---------------------------------------------------------------- loaders

/** A map's wall runs, oldest first (at most MAX_WALL_RUNS, so provably small). */
export async function wallsOnMap(ctx: QueryCtx, mapId: Id<"combatMaps">): Promise<Doc<"combatMapWalls">[]> {
  return ctx.db
    .query("combatMapWalls")
    .withIndex("by_map", (q) => q.eq("mapId", mapId))
    .take(MAX_WALL_RUNS);
}

/** The wall and its map when the id is a wall on one of this campaign's maps, else COMBAT_WALL_NOT_FOUND. */
export async function loadWall(
  ctx: QueryCtx,
  campaignId: Id<"campaigns">,
  wallId: string,
): Promise<{ wall: Doc<"combatMapWalls">; map: Doc<"combatMaps"> }> {
  const id = ctx.db.normalizeId("combatMapWalls", wallId);
  const wall = id === null ? null : await ctx.db.get("combatMapWalls", id);
  const map = wall === null ? null : await ctx.db.get("combatMaps", wall.mapId);
  if (wall === null || map === null || map.campaignId !== campaignId) throw appError("COMBAT_WALL_NOT_FOUND");
  return { wall, map };
}

/** Refuses (COMBAT_WALL_LIMIT) `adding` more runs when the map would hold more than MAX_WALL_RUNS. */
export async function assertCanAddWalls(ctx: QueryCtx, mapId: Id<"combatMaps">, adding = 1): Promise<void> {
  if ((await wallsOnMap(ctx, mapId)).length + adding > MAX_WALL_RUNS) throw appError("COMBAT_WALL_LIMIT");
}

// ---------------------------------------------------------------- points

/** One point, clamped onto the map ([0, w] x [0, h]: a wall may run along the map's edge). INVALID when not finite. */
export function wallPoint(x: number, y: number, w: number, h: number): [number, number] {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw appError("INVALID", "A wall's points need positions on the map.");
  return [Math.min(w, Math.max(0, x)), Math.min(h, Math.max(0, y))];
}

/**
 * A run's points, each clamped onto the map. INVALID for fewer than two or more than MAX_WALL_POINTS points, a point
 * that is not an [x, y] pair of finite numbers, or a run whose points all coincide (it would have no segment).
 */
export function wallPoints(points: readonly (readonly number[])[], w: number, h: number): [number, number][] {
  if (points.length < 2 || points.length > MAX_WALL_POINTS) throw appError("INVALID", `A wall has 2 to ${MAX_WALL_POINTS} points.`);
  const out = points.map((p) => {
    if (p.length !== 2) throw appError("INVALID", "A wall's points are [x, y] pairs.");
    return wallPoint(p[0]!, p[1]!, w, h);
  });
  if (out.every(([x, y]) => x === out[0]![0] && y === out[0]![1])) throw appError("INVALID", "A wall needs two different points.");
  return out;
}

// ---------------------------------------------------------------- a wall door's footprint (toggleDoor's reach rule)

/** How far a point on the run is nudged both ways, so a run along a square edge touches the squares on both sides. */
const EDGE = 1e-6;

/** Calls `add(cx, cy)` for every cell of a grid with `scale` cells per square that the run passes through or borders. */
function cellsAlong(points: readonly (readonly number[])[], scale: number, add: (cx: number, cy: number) => void): void {
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, ay] = points[i] as [number, number];
    const [bx, by] = points[i + 1] as [number, number];
    // Four probes per cell along the segment, never on its ends (a run ending on a square corner does not reach into
    // the squares beyond that corner): no cell the segment crosses for more than a sliver is missed.
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * scale * 4));
    for (let k = 0; k < steps; k++) {
      const x = ax + ((bx - ax) * (k + 0.5)) / steps;
      const y = ay + ((by - ay) * (k + 0.5)) / steps;
      for (const dx of [-EDGE, EDGE]) for (const dy of [-EDGE, EDGE]) add(Math.floor((x + dx) * scale), Math.floor((y + dy) * scale));
    }
  }
}

/**
 * The squares a wall door touches (its footprint for reach.ts's Melee rule): every square the run passes through, and
 * both squares along a run lying on a square edge. Squares outside the w x h map are left out.
 */
export function wallSquares(points: readonly (readonly number[])[], w: number, h: number): { x: number; y: number }[] {
  const keys = new Set<number>();
  cellsAlong(points, 1, (x, y) => {
    if (x >= 0 && y >= 0 && x < w && y < h) keys.add(y * w + x);
  });
  return [...keys].map((k) => ({ x: k % w, y: Math.floor(k / w) }));
}

/** The vision samples (index `sy * sw + sx`) a wall door touches, both sides of it: its "seen" footprint (D8). */
export function wallSamples(points: readonly (readonly number[])[], sw: number, sh: number, samplesPerSquare: number): number[] {
  const keys = new Set<number>();
  cellsAlong(points, samplesPerSquare, (sx, sy) => {
    if (sx >= 0 && sy >= 0 && sx < sw && sy < sh) keys.add(sy * sw + sx);
  });
  return [...keys];
}

/**
 * Whether the token stands within Melee (1 square, CB p.103) of one of the squares (plan d12-bugs B4, the reach.ts
 * rule over a wall door's squares). Defined Ranges off (rule switches ODR): always.
 */
export function inMeleeOfSquares(token: Footprint, squares: readonly { x: number; y: number }[], definedRanges = true): boolean {
  if (!definedRanges) return true;
  return squares.some((sq) => tokenDistance(token, sq) <= MELEE_SQUARES);
}

// ---------------------------------------------------------------- deleting

/**
 * Deletes up to `max` of a map's wall runs and returns how many it deleted (fewer than `max`: none are left). Called by
 * the map's child-row delete (convex/lib/combatMaps.ts `deleteMapChildren`), so a map delete and a campaign purge take
 * a map's walls with it in the same batches.
 */
export async function deleteMapWalls(ctx: MutationCtx, mapId: Id<"combatMaps">, max: number): Promise<number> {
  if (max <= 0) return 0;
  const rows = await ctx.db
    .query("combatMapWalls")
    .withIndex("by_map", (q) => q.eq("mapId", mapId))
    .take(max);
  for (const row of rows) await ctx.db.delete("combatMapWalls", row._id);
  return rows.length;
}
