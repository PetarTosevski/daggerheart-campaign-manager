// The party's walk along a drawn route (plan world-journey MJ1, dcm-zod8.2). Pure and framework-free: bundled into
// Convex (convex/mapJourney.ts) and used by every screen that animates the party token.
//
// A trip is a route (points) with the cumulative travel days at each point (`cum`), walked at a real-time speed
// (JOURNEY_MS_PER_DAY). Progress is measured in travel days; a campaign day passes each time progress crosses a whole
// day (D2: floor, the leftover of the last day is not carried over).

import {
  DEFAULT_TRAVEL_RULES,
  distanceKm,
  paceFactor,
  terrainSpeed,
  canCross,
  maxSwimKm,
  type MapScale,
  type Point,
  type RouteOptions,
  type TerrainLookup,
  type TravelRules,
} from "./index";

/** Real time per travel day (user answer 2026-11-07 Q2: Slow / Normal / Fast = 6 s / 3 s / 1 s). */
export const JOURNEY_MS_PER_DAY = { slow: 6000, normal: 3000, fast: 1000 } as const;
export type JourneySpeed = keyof typeof JOURNEY_MS_PER_DAY;
export const JOURNEY_SPEEDS: readonly JourneySpeed[] = ["slow", "normal", "fast"];
export const JOURNEY_SPEED_LABELS: Record<JourneySpeed, string> = { slow: "Slow", normal: "Normal", fast: "Fast" };

/** The most points a drawn route may send (the board's freehand cap). */
export const MAX_ROUTE_POINTS = 400;
/** The most points a stored trip keeps after terrain-change points are added; above it the drawn points are kept. */
export const MAX_JOURNEY_POINTS = 1200;

/** Float slack when comparing progress with a whole day. */
const EPS = 1e-9;

export type RouteTimeline = {
  /** The route's points: the drawn ones plus a point wherever the terrain (and so the speed) changes, when that fits. */
  points: Point[];
  /** Cumulative travel days at each point (cum[0] = 0). */
  cum: number[];
  totalDays: number;
  blocked: boolean;
};

const KNOWN = new Set(["r", "w", "p", "m", "d", "k", "h", ".", "#"]);

/**
 * The route's travel days point by point. It walks the route exactly as `analyseRoute` does (steps of ~0.4% of the
 * map, each at its midpoint terrain's speed, a swim longer than a day blocks), so `totalDays` equals
 * `analyseRoute(...).days`. Between two returned points the speed is constant, so a position can be interpolated.
 */
export function routeTimeline(
  points: Point[],
  scale: MapScale,
  terrainAt: TerrainLookup,
  opts: Pick<RouteOptions, "method" | "pace">,
  rules: TravelRules = DEFAULT_TRAVEL_RULES,
): RouteTimeline {
  if (points.length === 0) return { points: [], cum: [], totalDays: 0, blocked: false };
  const dense: Point[] = [points[0]];
  const denseCum: number[] = [0];
  const sparseCum: number[] = [0];
  const maxSwim = maxSwimKm(rules, opts.method, opts.pace);
  const k = paceFactor(opts.pace, rules);
  let days = 0;
  let blocked = false;
  let waterRun = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = distanceKm(a, b, scale);
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.4));
    let prev: string | null = null;
    for (let s = 0; s < n; s++) {
      const tm = (s + 0.5) / n;
      const ter = terrainAt({ x: a.x + (b.x - a.x) * tm, y: a.y + (b.y - a.y) * tm });
      const tk = KNOWN.has(ter) ? ter : "w";
      if (prev !== null && tk !== prev && dense.length <= MAX_JOURNEY_POINTS) {
        const t0 = s / n;
        dense.push({ x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 });
        denseCum.push(days);
      }
      prev = tk;
      const d = seg / n;
      waterRun = tk === "." ? waterRun + d : 0;
      if (!canCross(rules, opts.method, tk)) blocked = true;
      else if (tk === "." && waterRun > maxSwim + 1e-9) blocked = true;
      // terrainSpeed is the table speed times the pace factor, as analyseRoute's `speed * k`.
      else days += d / (terrainSpeed(rules, opts.method, "normal", tk) * k);
    }
    dense.push(b);
    denseCum.push(days);
    sparseCum.push(days);
  }
  if (dense.length > MAX_JOURNEY_POINTS) return { points: [...points], cum: sparseCum, totalDays: days, blocked };
  return { points: dense, cum: denseCum, totalDays: days, blocked };
}

export type JourneyClock = {
  speed: JourneySpeed;
  status: "moving" | "paused";
  /** Progress (travel days) when the trip last started, resumed or changed speed. */
  baseDays: number;
  /** When (ms) it last started moving. */
  startedAt: number;
  totalDays: number;
};

/** Travel days walked at `nowMs`: from `baseDays` at `startedAt` while moving, clamped to the route; frozen while paused. */
export function progressAt(journey: JourneyClock, nowMs: number): number {
  if (journey.status !== "moving") return Math.min(journey.totalDays, journey.baseDays);
  const elapsed = Math.max(0, nowMs - journey.startedAt) / JOURNEY_MS_PER_DAY[journey.speed];
  return Math.min(journey.totalDays, journey.baseDays + elapsed);
}

/** The point `progress` travel days along the route (the start before it, the end after it). */
export function pointAt(points: Point[], cum: number[], progress: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (progress <= 0) return points[0];
  for (let i = 1; i < points.length; i++) {
    if (cum[i] >= progress) {
      const span = cum[i] - cum[i - 1];
      if (span <= 0) return points[i];
      const t = (progress - cum[i - 1]) / span;
      const a = points[i - 1];
      const b = points[i];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
  }
  return points[points.length - 1];
}

/** The part of the route still to walk: the current point, then every later point. */
export function remainingPath(points: Point[], cum: number[], progress: number): Point[] {
  return [pointAt(points, cum, progress), ...points.filter((_, i) => cum[i] > progress)];
}

/** The part walked between two progresses: the point at `from`, the points in between, the point at `to`. */
export function walkedPath(points: Point[], cum: number[], from: number, to: number): Point[] {
  return [pointAt(points, cum, from), ...points.filter((_, i) => cum[i] > from && cum[i] < to), pointAt(points, cum, to)];
}

/** At most `max` points of a path, evenly picked, keeping its first and last. */
export function samplePath(path: Point[], max: number): Point[] {
  if (path.length <= max) return path;
  const out: Point[] = [];
  for (let i = 0; i < max; i++) out.push(path[Math.round((i * (path.length - 1)) / (max - 1))]);
  return out;
}

/** Whole campaign days still to pass at `progress` when `daysPassed` have passed (D2: only whole days). */
export function daysDue(progress: number, daysPassed: number): number {
  return Math.max(0, Math.floor(progress + EPS) - daysPassed);
}

/**
 * When (ms) a moving trip next needs the server: the next whole-day boundary, or the arrival when no boundary is left
 * before the end. Rounded up, so the progress there has reached the boundary.
 */
export function nextBoundaryMs(journey: JourneyClock, nowMs: number): number {
  const progress = progressAt(journey, nowMs);
  const next = Math.floor(progress + EPS) + 1;
  const target = next < journey.totalDays - EPS ? next : journey.totalDays;
  return Math.ceil(journey.startedAt + (target - journey.baseDays) * JOURNEY_MS_PER_DAY[journey.speed]);
}

/** Whether the trip has reached its end at `progress`. */
export function arrived(progress: number, totalDays: number): boolean {
  return progress >= totalDays - EPS;
}
