// Live map areas (plan lanes, tracer E4; sheet-drawer Q14, SD-A's area runtime): the pure geometry the server reads to
// place an area, work out its members from token positions, and see what a move does to it (enter, pass through, cross a
// wall, leave). Pure: bundled into Convex (convex/combatAreas.ts) and usable by the map UI.
//
// CB p.103 Defined Ranges: Melee 1 square, Very Close 3, Close 6, Far 12, Very Far 13+. A creature is inside a circle
// area when its footprint is within the area's radius of the centre's footprint (the same Chebyshev distance range
// checks use, `tokenDistance`). A wall is a segment between two squares' centres; a move crosses it when the straight
// line from the token's old centre to its new one cuts the segment (Wall of Flame, CB p.332: "anything that subsequently
// passes through the wall").
//
// ```ts
// inArea({ x: 2, y: 0 }, circle({ x: 0, y: 0 }, "veryClose"));            // true (2 squares <= 3)
// moveEvents({ x: 9, y: 0 }, { x: 2, y: 0 }, [circle({ x: 0, y: 0 }, "veryClose")]); // [{ index: 0, kind: "enter" }]
// moveEvents({ x: 0, y: 2 }, { x: 4, y: 2 }, [wall([2, 0], [2, 5])]);       // [{ index: 0, kind: "cross" }]
// ```

import { tokenDistance, type Footprint } from "../combat-actions/distance";
import { RANGE_SQUARES } from "../combat-map/ranges";
import type { AreaSpec, Duration, Range } from "../card-effects/types";

/** Squares in a Defined Range; Very Far reaches the whole map. */
export function rangeSquares(range: Range): number {
  return range === "veryFar" ? Infinity : RANGE_SQUARES[range];
}

/** A point in squares: `[x, y]`, a square's top-left (a wall's ends are square centres: `x + 0.5`). */
export type Point = readonly [number, number];

/** An area's shape on the map, its centre already resolved to a footprint (the centre token's, or the picked square). */
export type AreaShapeOnMap = { shape: "circle"; centre: Footprint; radius: Range } | { shape: "wall"; a: Point; b: Point };

export const circle = (centre: Footprint, radius: Range): AreaShapeOnMap => ({ shape: "circle", centre, radius });
export const wall = (a: Point, b: Point): AreaShapeOnMap => ({ shape: "wall", a, b });

const sizeOf = (t: Footprint) => Math.max(1, Math.min(3, Math.trunc(t.size ?? 1) || 1));

/** The centre of a footprint, in squares. */
export function centreOf(t: Footprint): Point {
  const s = sizeOf(t);
  return [t.x + s / 2, t.y + s / 2];
}

/** Whether a token's footprint stands inside the area. A wall has no inside. */
export function inArea(token: Footprint, area: AreaShapeOnMap): boolean {
  if (area.shape === "wall") return false;
  return tokenDistance(area.centre, token) <= rangeSquares(area.radius);
}

const cross = (o: Point, p: Point, q: Point) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);

/** Whether segments p1-p2 and q1-q2 cut each other (touching at an end counts). */
export function segmentsCross(p1: Point, p2: Point, q1: Point, q2: Point): boolean {
  const d1 = cross(q1, q2, p1);
  const d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1);
  const d4 = cross(p1, p2, q2);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (a: Point, b: Point, c: Point) => Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) && Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
  return (d1 === 0 && on(q1, q2, p1)) || (d2 === 0 && on(q1, q2, p2)) || (d3 === 0 && on(p1, p2, q1)) || (d4 === 0 && on(p1, p2, q2));
}

/** A wall's ends as points through square centres (`[x, y]` squares → `[x + 0.5, y + 0.5]`). */
const wallEnds = (area: Extract<AreaShapeOnMap, { shape: "wall" }>): [Point, Point] => [
  [area.a[0] + 0.5, area.a[1] + 0.5],
  [area.b[0] + 0.5, area.b[1] + 0.5],
];

/** Whether the straight path between two footprints passes over the circle (sampled every half square). */
function pathTouches(before: Footprint, after: Footprint, area: Extract<AreaShapeOnMap, { shape: "circle" }>): boolean {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(after.x - before.x), Math.abs(after.y - before.y)) * 2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const at = { x: Math.round(before.x + (after.x - before.x) * t), y: Math.round(before.y + (after.y - before.y) * t), size: before.size ?? 1 };
    if (inArea(at, area)) return true;
  }
  return false;
}

/**
 * What one move does to an area: `enter` (outside before, inside after: Rune Circle, CB p.332 "who enter Melee range"),
 * `through` (outside before and after, but the straight path crossed it: Acid Bath, CB p.210 "who move through it"),
 * `leave` (inside before, outside after: Circle of Power's "you exit the circle", HF p.16), `cross` (the path cut a wall).
 */
export type MoveEventKind = "enter" | "through" | "leave" | "cross";
export type MoveEvent = { index: number; kind: MoveEventKind };

/** The events of a move from `before` to `after` for each area, by the area's index in `areas`. */
export function moveEvents(before: Footprint, after: Footprint, areas: readonly AreaShapeOnMap[]): MoveEvent[] {
  const out: MoveEvent[] = [];
  for (const [index, area] of areas.entries()) {
    if (area.shape === "wall") {
      const [a, b] = wallEnds(area);
      if (segmentsCross(centreOf(before), centreOf(after), a, b)) out.push({ index, kind: "cross" });
      continue;
    }
    const was = inArea(before, area);
    const is = inArea(after, area);
    if (!was && is) out.push({ index, kind: "enter" });
    else if (was && !is) out.push({ index, kind: "leave" });
    else if (!was && !is && pathTouches(before, after, area)) out.push({ index, kind: "through" });
  }
  return out;
}

/**
 * Whether a move brings a token within `range` of another that it was outside before (Hold the Line, CB p.342: "If an
 * adversary moves within Very Close range"; the `whenEnemyEntersRange` trigger, dcm-bpr).
 */
export function entersRange(before: Footprint, after: Footprint, other: Footprint, range: Range): boolean {
  const reach = rangeSquares(range);
  return tokenDistance(before, other) > reach && tokenDistance(after, other) <= reach;
}

/** The token sides as the map stores them (`TOKEN_SIDES`). */
export type MapSide = "pc" | "enemy" | "ally" | "neutral";

/** Whether a token on `side` is on the owner's side (a PC's allies are PCs and ally tokens; an enemy's, enemies). */
function friendly(ownerSide: MapSide, side: MapSide): boolean {
  const team = (s: MapSide) => (s === "pc" || s === "ally" ? "party" : s === "enemy" ? "enemy" : "neutral");
  return team(ownerSide) === team(side);
}

/**
 * Whether a token inside the area is one of its members (`AreaSpec.side`): `allies` (the owner's side, not the owner),
 * `selfAndAllies`, `enemies` (the other side; neutral tokens never), `all`; `excludeOwner` leaves the owner out (Acid
 * Bath: "all creatures other than the Burrower", CB p.210).
 */
export function memberSideFits(spec: Pick<AreaSpec, "side" | "excludeOwner">, ownerSide: MapSide, side: MapSide, isOwner: boolean): boolean {
  if (isOwner) return spec.excludeOwner !== true && (spec.side === "selfAndAllies" || spec.side === "all");
  switch (spec.side) {
    case "allies":
    case "selfAndAllies":
      return friendly(ownerSide, side);
    case "enemies":
      return side !== "neutral" && !friendly(ownerSide, side);
    case "all":
      return true;
  }
}

/** A token as membership reads it. */
export type AreaToken = Footprint & { id: string; side: MapSide };

/** The ids of the tokens that are members of the area now (Q14: worked out from token positions at each roll). */
export function areaMembers(spec: Pick<AreaSpec, "side" | "excludeOwner">, area: AreaShapeOnMap, owner: AreaToken | null, tokens: readonly AreaToken[]): string[] {
  const ownerSide: MapSide = owner?.side ?? "pc";
  return tokens.filter((t) => inArea(t, area) && memberSideFits(spec, ownerSide, t.side, owner !== null && t.id === owner.id)).map((t) => t.id);
}

/** Whether a picked square is within the spec's `placeWithin` of the owner (Dark Cloud, CB p.42: "any area within Close range"). */
export function placementHolds(spec: Pick<AreaSpec, "placeWithin">, owner: Footprint, point: Footprint): boolean {
  if (spec.placeWithin === undefined) return true;
  return tokenDistance(owner, point) <= rangeSquares(spec.placeWithin);
}

/**
 * Whether the area blocks the line between an observer and a target (Dark Cloud, CB p.42: "Anyone in this cloud can't see
 * outside of it, and anyone outside of it can't see in"): one stands inside and the other outside. Members have
 * `AreaSpec.perObserver` (Cloaked) toward every observer it blocks ("You're considered Cloaked from any adversary for whom
 * the cloud blocks line of sight").
 */
export function blocksBetween(area: AreaShapeOnMap, observer: Footprint, target: Footprint): boolean {
  if (area.shape === "wall") return false;
  return inArea(observer, area) !== inArea(target, area);
}

/** When a stored area ends by itself (`combatAreas.expires`), from the effect's duration. Other durations end by hand. */
export function areaExpires(duration: Duration): "scene" | "session" | "rest" | "longRest" | "manual" {
  switch (duration) {
    case "scene":
    case "session":
    case "rest":
    case "longRest":
      return duration;
    default:
      return "manual";
  }
}

/**
 * The circle's blocking disc for the vision engine (a Dark Cloud): centre and radius in squares, covering every square
 * a member could stand on (the radius plus the centre footprint's half size).
 */
export function sightDisc(area: Extract<AreaShapeOnMap, { shape: "circle" }>): { x: number; y: number; r: number } {
  const [x, y] = centreOf(area.centre);
  const reach = rangeSquares(area.radius);
  return { x, y, r: (Number.isFinite(reach) ? reach : 999) + sizeOf(area.centre) / 2 };
}
