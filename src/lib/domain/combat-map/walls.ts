/**
 * Drawn walls (plan map-editor, tracer ME1): pure geometry shared by the server, the website and the phone.
 *
 * A wall run is a polyline of one of six kinds, drawn freeform at any angle. What each kind does (user decisions
 * 2026-11-13, `wallEffect`):
 *   wall    blocks sight and movement.
 *   door    closed (open absent or false) blocks both; open blocks neither.
 *   window  blocks movement, not sight.
 *   secret  a wall until revealed; once revealed it is a door (open or closed).
 *   low     sight passes, but a line across it gives cover (disadvantage on attacks, CB p.104, the "cover" sight mode);
 *           a step across it is difficult terrain (D2/D5, as movement.ts prices difficult terrain).
 *   oneway  sight and targeting pass only from its open side; blocks movement both ways.
 *
 * Coordinates are in squares, the same frame as map areas and objects: square (x, y) covers [x, x + 1) x [y, y + 1),
 * its centre is (x + 0.5, y + 0.5), integer points are square corners, y grows downwards. A run's `points` are
 * [x, y] pairs; consecutive points form its segments.
 *
 * One-way side: walking the run from its first point to its last, the open side is on the left as drawn on screen
 * (y down: a run drawn eastwards has its open side to the north) unless `side` is "right". A viewer on the open side
 * sees (and targets) through; a viewer on the other side is blocked.
 *
 * Crossing rule (one rule for sight lines and steps). A line from P to Q crosses a segment when
 *   - P and Q, each nudged by the same tiny fixed offset NUDGE (a hair right and below), lie strictly on opposite sides
 *     of the segment's line and the nudged line meets the segment (its ends included), or
 *   - an end of the segment lies on the open line between P and Q (a graze: no slipping past the end of a wall or
 *     through the point where two walls meet, as the movement path takes both squares at an exact corner, D4).
 * The nudge only matters when P or Q lies exactly on a wall (a square centre on a diagonal wall drawn corner to
 * corner): such a point counts as lying a hair right and below the wall, the same for every step, so a token can
 * never cross a wall in two steps through a square whose centre it touches.
 *
 * Speed: `prepareWalls` buckets every segment into the squares it touches (CSR arrays), and a query only tests the
 * segments in the squares its own line touches.
 */

import type { SightMode } from "./sight";

export const WALL_KINDS = ["wall", "door", "window", "secret", "low", "oneway"] as const;
export type WallKind = (typeof WALL_KINDS)[number];

/** A one-way wall's open side, relative to the run's drawing direction (absent = "left"). */
export type WallSide = "left" | "right";

/** A wall run as stored (ME4's combatMapWalls row) or drawn. */
export type WallRun = {
  readonly kind: WallKind | (string & {});
  /** [x, y] points in squares, at least two. */
  readonly points: readonly (readonly number[])[];
  /** Doors and revealed secret doors: true = open. Absent = closed. */
  readonly open?: boolean | null;
  /** Secret doors: true = the GM revealed it (it is a door now). Absent = a wall. */
  readonly revealed?: boolean | null;
  /** One-way walls: the open side (absent = "left"). */
  readonly side?: WallSide | null;
};

/** What a wall does to a line of sight across it: as an object's sight mode, or one-way. */
export type WallSight = SightMode | "oneway";
/** What a wall does to a step across it (movement.ts `MoveEffect`). */
export type WallMove = "open" | "difficult" | "block";

/** The run's effect now (kinds above). An unknown kind does nothing. */
export function wallEffect(run: Pick<WallRun, "kind" | "open" | "revealed">): { sight: WallSight; move: WallMove } {
  switch (run.kind) {
    case "wall":
      return { sight: "block", move: "block" };
    case "secret":
      return run.revealed === true ? doorEffect(run.open) : { sight: "block", move: "block" };
    case "door":
      return doorEffect(run.open);
    case "window":
      return { sight: "none", move: "block" };
    case "low":
      return { sight: "cover", move: "difficult" };
    case "oneway":
      return { sight: "oneway", move: "block" };
    default:
      return { sight: "none", move: "open" };
  }
}

function doorEffect(open: boolean | null | undefined): { sight: WallSight; move: WallMove } {
  return open === true ? { sight: "none", move: "open" } : { sight: "block", move: "block" };
}

// ---------------------------------------------------------------- the index

/** Per-segment sight codes. */
const SIGHT_NONE = 0;
const SIGHT_COVER = 1;
const SIGHT_BLOCK = 2;
/** One-way, open on the segment's left (negative orientation) / right. */
const SIGHT_OPEN_LEFT = 3;
const SIGHT_OPEN_RIGHT = 4;
/** Per-segment move codes. */
const MOVE_OPEN = 0;
const MOVE_DIFFICULT = 1;
const MOVE_BLOCK = 2;

/** Walls ready for queries: every segment with an effect, bucketed per square. Build once per map. */
export type PreparedWalls = {
  /** The map's size in squares (the buckets' grid). */
  readonly w: number;
  readonly h: number;
  /** Segment count. */
  readonly count: number;
  /** ax, ay, bx, by per segment. */
  readonly seg: Float64Array;
  readonly sight: Uint8Array;
  readonly move: Uint8Array;
  /** Square i holds segments items[start[i] .. start[i + 1]). Index y * w + x. */
  readonly start: Int32Array;
  readonly items: Int32Array;
  /** Scratch for one query (each segment tested once): mark[i] === stamp[0] when tested. */
  readonly mark: Uint32Array;
  readonly stamp: Uint32Array;
};

/** Slack when deciding which squares a line touches, so a line on a square edge lands in both squares. */
const PAD = 1e-6;
/** Orientation tolerance: a value within it counts as zero (on the line). */
const EPS = 1e-9;
/** The fixed nudge for the side test (irrational ratio, so it never runs along a drawn wall). */
const NUDGE_X = 7.548776662e-7;
const NUDGE_Y = 5.698402910e-7;

/**
 * Calls `visit(i)` for every square (index y * w + x, inside the w x h map) that the segment a-b touches, with PAD of
 * slack, row by row. Squares outside the map are skipped.
 */
function forEachSquare(ax: number, ay: number, bx: number, by: number, w: number, h: number, visit: (i: number) => void): void {
  const y0 = Math.max(0, Math.floor(Math.min(ay, by) - PAD));
  const y1 = Math.min(h - 1, Math.floor(Math.max(ay, by) + PAD));
  const dy = by - ay;
  for (let y = y0; y <= y1; y++) {
    let xa: number;
    let xb: number;
    if (Math.abs(dy) < EPS) {
      xa = Math.min(ax, bx);
      xb = Math.max(ax, bx);
    } else {
      const t0 = Math.max(0, Math.min(1, (y - PAD - ay) / dy));
      const t1 = Math.max(0, Math.min(1, (y + 1 + PAD - ay) / dy));
      const x0 = ax + (bx - ax) * t0;
      const x1 = ax + (bx - ax) * t1;
      xa = Math.min(x0, x1);
      xb = Math.max(x0, x1);
    }
    const x0 = Math.max(0, Math.floor(xa - PAD));
    const x1 = Math.min(w - 1, Math.floor(xb + PAD));
    for (let x = x0; x <= x1; x++) visit(y * w + x);
  }
}

const finitePoint = (p: readonly number[] | undefined): p is readonly [number, number] =>
  p !== undefined && Number.isFinite(p[0]) && Number.isFinite(p[1]);

/**
 * Index the runs for a w x h map. Runs with fewer than two valid points, zero-length segments and runs with no effect
 * (an open door, an unknown kind) are dropped. Null when nothing is left: such a map behaves exactly as with no walls.
 */
export function prepareWalls(runs: readonly WallRun[] | null | undefined, w: number, h: number): PreparedWalls | null {
  const mw = Math.max(1, Math.trunc(w));
  const mh = Math.max(1, Math.trunc(h));
  const coords: number[] = [];
  const sights: number[] = [];
  const moves: number[] = [];
  for (const run of runs ?? []) {
    if (!run || !Array.isArray(run.points)) continue;
    const effect = wallEffect(run);
    const sight =
      effect.sight === "block"
        ? SIGHT_BLOCK
        : effect.sight === "cover"
          ? SIGHT_COVER
          : effect.sight === "oneway"
            ? run.side === "right"
              ? SIGHT_OPEN_RIGHT
              : SIGHT_OPEN_LEFT
            : SIGHT_NONE;
    const move = effect.move === "block" ? MOVE_BLOCK : effect.move === "difficult" ? MOVE_DIFFICULT : MOVE_OPEN;
    if (sight === SIGHT_NONE && move === MOVE_OPEN) continue;
    let prev: readonly [number, number] | null = null;
    for (const p of run.points) {
      if (!finitePoint(p)) continue;
      if (prev && (prev[0] !== p[0] || prev[1] !== p[1])) {
        coords.push(prev[0], prev[1], p[0], p[1]);
        sights.push(sight);
        moves.push(move);
      }
      prev = [p[0], p[1]];
    }
  }
  const count = sights.length;
  if (count === 0) return null;
  const seg = Float64Array.from(coords);
  // Two passes: count per square, then fill (CSR).
  const start = new Int32Array(mw * mh + 1);
  for (let s = 0; s < count; s++) {
    forEachSquare(seg[s * 4], seg[s * 4 + 1], seg[s * 4 + 2], seg[s * 4 + 3], mw, mh, (i) => {
      start[i + 1]++;
    });
  }
  for (let i = 0; i < mw * mh; i++) start[i + 1] += start[i];
  const items = new Int32Array(start[mw * mh]);
  const fill = start.slice(0, mw * mh);
  for (let s = 0; s < count; s++) {
    forEachSquare(seg[s * 4], seg[s * 4 + 1], seg[s * 4 + 2], seg[s * 4 + 3], mw, mh, (i) => {
      items[fill[i]++] = s;
    });
  }
  return {
    w: mw,
    h: mh,
    count,
    seg,
    sight: Uint8Array.from(sights),
    move: Uint8Array.from(moves),
    start,
    items,
    mark: new Uint32Array(count),
    stamp: new Uint32Array(1),
  };
}

// ---------------------------------------------------------------- crossing

/**
 * The crossing rule (module comment): 0 = the line P-Q does not cross segment s; otherwise the side P lies on, nudged:
 * -1 = left of the segment (negative orientation), 1 = right.
 */
function crossing(walls: PreparedWalls, s: number, px: number, py: number, qx: number, qy: number): -1 | 0 | 1 {
  const seg = walls.seg;
  const ax = seg[s * 4];
  const ay = seg[s * 4 + 1];
  const bx = seg[s * 4 + 2];
  const by = seg[s * 4 + 3];
  const ex = bx - ax;
  const ey = by - ay;
  const npx = px + NUDGE_X;
  const npy = py + NUDGE_Y;
  const oP = ex * (npy - ay) - ey * (npx - ax);
  const sideP: -1 | 1 = oP < 0 ? -1 : 1;
  const fx = qx - px;
  const fy = qy - py;
  const len2 = fx * fx + fy * fy;
  // A graze: an end of the segment on the open line P-Q.
  if (len2 > 0 && (onOpenLine(ax, ay, px, py, fx, fy, len2) || onOpenLine(bx, by, px, py, fx, fy, len2))) return sideP;
  const oQ = ex * (qy + NUDGE_Y - ay) - ey * (qx + NUDGE_X - ax);
  if ((oP < 0) === (oQ < 0) || oP === 0 || oQ === 0) return 0;
  // The nudged line P'-Q' against the segment's ends (ends included).
  const oA = fx * (ay - npy) - fy * (ax - npx);
  const oB = fx * (by - npy) - fy * (bx - npx);
  if ((oA > 0 && oB > 0) || (oA < 0 && oB < 0)) return 0;
  return sideP;
}

/** Whether point V lies on the line from P along F (length squared len2), strictly between its ends. */
function onOpenLine(vx: number, vy: number, px: number, py: number, fx: number, fy: number, len2: number): boolean {
  if (Math.abs(fx * (vy - py) - fy * (vx - px)) > EPS * Math.sqrt(len2)) return false;
  const t = (vx - px) * fx + (vy - py) * fy;
  return t > EPS * len2 && t < len2 * (1 - EPS);
}

/** Starts a query: a fresh stamp, so each segment is tested once. */
function nextStamp(walls: PreparedWalls): number {
  let stamp = walls.stamp[0] + 1;
  if (stamp > 0xfffffff0) {
    walls.mark.fill(0);
    stamp = 1;
  }
  walls.stamp[0] = stamp;
  return stamp;
}

/** Calls `test(s)` for each segment near the line P-Q, once each, until it returns true. */
function someNear(walls: PreparedWalls, px: number, py: number, qx: number, qy: number, test: (s: number) => boolean): boolean {
  const stamp = nextStamp(walls);
  const { start, items, mark } = walls;
  let found = false;
  forEachSquare(px, py, qx, qy, walls.w, walls.h, (i) => {
    if (found) return;
    for (let k = start[i]; k < start[i + 1]; k++) {
      const s = items[k];
      if (mark[s] === stamp) continue;
      mark[s] = stamp;
      if (test(s)) {
        found = true;
        return;
      }
    }
  });
  return found;
}

export type WallSightTrace = "clear" | "cover" | "block";

/**
 * What the walls do to a line of sight from (ax, ay) to (bx, by), in squares: "block" when it crosses a wall, a closed
 * door, an unrevealed secret door or a one-way wall from its closed side; else "cover" when it crosses a low wall;
 * else "clear". Windows and open doors do nothing.
 */
export function traceSight(walls: PreparedWalls, ax: number, ay: number, bx: number, by: number): WallSightTrace {
  let cover = false;
  const blocked = someNear(walls, ax, ay, bx, by, (s) => {
    const code = walls.sight[s];
    if (code === SIGHT_NONE) return false;
    const side = crossing(walls, s, ax, ay, bx, by);
    if (side === 0) return false;
    if (code === SIGHT_BLOCK) return true;
    if (code === SIGHT_COVER) {
      cover = true;
      return false;
    }
    // One-way: blocked unless the viewer stands on the open side.
    return code === SIGHT_OPEN_LEFT ? side !== -1 : side !== 1;
  });
  return blocked ? "block" : cover ? "cover" : "clear";
}

/**
 * What the walls do to a step whose centre moves from (ax, ay) to (bx, by), in squares: "block" when it crosses a
 * wall, window, closed or secret door or one-way wall; else "difficult" when it crosses a low wall; else "open".
 */
export function traceStep(walls: PreparedWalls, ax: number, ay: number, bx: number, by: number): WallMove {
  let difficult = false;
  const blocked = someNear(walls, ax, ay, bx, by, (s) => {
    const code = walls.move[s];
    if (code === MOVE_OPEN || crossing(walls, s, ax, ay, bx, by) === 0) return false;
    if (code === MOVE_BLOCK) return true;
    difficult = true;
    return false;
  });
  return blocked ? "block" : difficult ? "difficult" : "open";
}
