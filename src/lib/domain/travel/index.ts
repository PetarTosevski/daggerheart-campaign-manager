// Overland travel on the World map: the user's HOUSE RULE speeds and the
// board's route formulas, ported exactly from World.dc.html (D6). Pure and
// framework-free: bundled into Convex.

/** A map point in percent of the map's width (x) and height (y), 0–100. */
export type Point = { x: number; y: number };

/** Terrain codes of the 128 × 98 grid: r Road, w Wilds, m Marsh, d Deep wilds, h Mountains, . Water, # Impassable. */
export type TerrainCode = "r" | "w" | "m" | "d" | "h" | "." | "#";
/** Terrain that has a travel speed (impassable never does). */
export type SpeedTerrain = "road" | "wilds" | "marsh" | "deep" | "mountains" | "water";
export type SpeedTable = Record<SpeedTerrain, number>;

export const TRAVEL_METHODS = ["foot", "mount", "wagon", "boat", "fly"] as const;
export type TravelMethod = (typeof TRAVEL_METHODS)[number];
export const TRAVEL_PACES = ["slow", "normal", "fast"] as const;
export type TravelPace = (typeof TRAVEL_PACES)[number];
/** The header's pace for the party trail and token distances: by terrain, or a flat km/day. */
export const TRAIL_MODES = ["foot", "mount", "20", "40", "60", "80"] as const;
export type TrailMode = (typeof TRAIL_MODES)[number];

export const SPEED_TERRAINS: readonly SpeedTerrain[] = ["road", "wilds", "deep", "marsh", "mountains", "water"];
export const SPEED_TERRAIN_CODE: Record<SpeedTerrain, TerrainCode> = { road: "r", wilds: "w", marsh: "m", deep: "d", mountains: "h", water: "." };
const CODE_TERRAIN: Partial<Record<string, SpeedTerrain>> = { r: "road", w: "wilds", m: "marsh", d: "deep", h: "mountains", ".": "water" };

export type TravelRules = {
  /** km per day by method and terrain, for the Measure tool (the board's MSPD). */
  speeds: Record<TravelMethod, SpeedTable>;
  /** km per day on foot or mounted, for the party trail and token distances (the board's PMAP). */
  trail: Record<"foot" | "mount", SpeedTable>;
  /** Pace multipliers: Cautious and Forced march. */
  slow: number;
  fast: number;
};

/** The board's numbers (house rule, GM-editable per campaign). */
export const DEFAULT_TRAVEL_RULES: TravelRules = {
  speeds: {
    foot: { road: 60, wilds: 40, marsh: 15, deep: 20, mountains: 10, water: 8 },
    mount: { road: 80, wilds: 60, marsh: 18, deep: 30, mountains: 15, water: 8 },
    wagon: { road: 50, wilds: 30, marsh: 6, deep: 12, mountains: 5, water: 5 },
    boat: { road: 30, wilds: 25, marsh: 40, deep: 15, mountains: 8, water: 100 },
    fly: { road: 120, wilds: 120, marsh: 120, deep: 120, mountains: 120, water: 120 },
  },
  trail: {
    foot: { road: 60, wilds: 40, marsh: 15, deep: 20, mountains: 10, water: 20 },
    mount: { road: 80, wilds: 60, marsh: 18, deep: 30, mountains: 15, water: 20 },
  },
  slow: 0.75,
  fast: 1.33,
};

export const KM_PER_MILE_FACTOR = 0.621371;

export const METHOD_LABELS: Record<TravelMethod, string> = {
  foot: "On foot",
  mount: "Mounted",
  wagon: "Wagon / cart",
  boat: "Boat",
  fly: "Flying",
};

export const TRAIL_MODE_LABELS: Record<TrailMode, string> = {
  foot: "On foot · by terrain",
  mount: "Mounted · by terrain",
  "20": "Hard going · 20 km/day",
  "40": "Wilds on foot · 40 km/day",
  "60": "Road on foot · 60 km/day",
  "80": "Mounted · 80 km/day",
};

/** The map's size in km: `widthKm` across, height by the image's aspect ratio. */
export type MapScale = { widthKm: number; heightKm: number };

export function mapScale(widthKm: number, imageWidth: number, imageHeight: number): MapScale {
  return { widthKm, heightKm: (widthKm * imageHeight) / imageWidth };
}

/** Straight-line km between two map points (the board's `miles`). */
export function distanceKm(a: Point, b: Point, scale: MapScale): number {
  return Math.hypot(((a.x - b.x) / 100) * scale.widthKm, ((a.y - b.y) / 100) * scale.heightKm);
}

export type TerrainLookup = (p: Point) => string;

function speedOf(table: SpeedTable, code: string): number | undefined {
  const key = CODE_TERRAIN[code];
  return key ? table[key] : undefined;
}

export type LegResult = { km: number; days: number; water: boolean; blocked: boolean };

/**
 * One leg for the party trail and token distances (the board's `route`):
 * sampled every ~2 km at the step midpoints; impassable steps add no time but
 * mark the leg blocked; water marks it as crossing water.
 */
export function trailLeg(a: Point, b: Point, scale: MapScale, terrainAt: TerrainLookup, mode: TrailMode, rules: TravelRules = DEFAULT_TRAVEL_RULES): LegResult {
  const km = distanceKm(a, b, scale);
  const steps = Math.max(1, Math.ceil(km / 2));
  const fixed = Number(mode) || 0;
  let days = 0;
  let water = false;
  let blocked = false;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const code = terrainAt({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    if (code === ".") water = true;
    if (code === "#") {
      blocked = true;
      continue;
    }
    const table = mode === "mount" ? rules.trail.mount : rules.trail.foot;
    days += km / steps / (fixed || speedOf(table, code) || 40);
  }
  return { km, days, water, blocked };
}

/** A path's legs summed (the board's "Party has travelled"). */
export function trailTotal(points: Point[], scale: MapScale, terrainAt: TerrainLookup, mode: TrailMode, rules?: TravelRules): LegResult | null {
  if (points.length < 2) return null;
  const total: LegResult = { km: 0, days: 0, water: false, blocked: false };
  for (let i = 1; i < points.length; i++) {
    const leg = trailLeg(points[i - 1], points[i], scale, terrainAt, mode, rules);
    total.km += leg.km;
    total.days += leg.days;
    total.water ||= leg.water;
  }
  return total;
}

/** "~120 km · ~3.0 days · crosses water" (the board's `fmtR`; an 8-hour day below one day), in the map's units. */
export function formatLeg(r: LegResult, units: "km" | "mi" = "km"): string {
  const d = r.days;
  const time = d < 1 ? `~${Math.max(1, Math.round(d * 8))} hrs` : `~${d < 3 ? d.toFixed(1) : Math.round(d)} days`;
  const distance = Math.round(r.km * (units === "mi" ? KM_PER_MILE_FACTOR : 1));
  return `~${distance} ${units} · ${time}${r.water ? " · crosses water" : ""}${r.blocked ? " · blocked by impassable terrain" : ""}`;
}

export type RouteOptions = { method: TravelMethod; pace: TravelPace; hours: number; units: "km" | "mi" };
export type RouteRun = { terrain: TerrainCode; points: Point[] };
export type RouteAnalysis = { runs: RouteRun[]; per: Record<TerrainCode, number>; km: number; days: number; blocked: boolean };

export function paceFactor(pace: TravelPace, rules: TravelRules = DEFAULT_TRAVEL_RULES): number {
  return pace === "slow" ? rules.slow : pace === "fast" ? rules.fast : 1;
}

/**
 * The Measure tool (the board's `analyse`): each leg is cut into steps of
 * ~0.4% of the map, each step takes the terrain at its midpoint; impassable
 * steps count distance but no time. Unknown terrain counts as Wilds.
 */
export function analyseRoute(points: Point[], scale: MapScale, terrainAt: TerrainLookup, opts: Pick<RouteOptions, "method" | "pace">, rules: TravelRules = DEFAULT_TRAVEL_RULES): RouteAnalysis {
  const runs: RouteRun[] = [];
  const per: Record<TerrainCode, number> = { r: 0, w: 0, m: 0, d: 0, h: 0, ".": 0, "#": 0 };
  const spd = rules.speeds[opts.method] ?? rules.speeds.foot;
  const k = paceFactor(opts.pace, rules);
  let km = 0;
  let days = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = distanceKm(a, b, scale);
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.4));
    for (let s = 0; s < n; s++) {
      const t0 = s / n;
      const t1 = (s + 1) / n;
      const tm = (s + 0.5) / n;
      const p0 = { x: a.x + (b.x - a.x) * t0, y: a.y + (b.y - a.y) * t0 };
      const p1 = { x: a.x + (b.x - a.x) * t1, y: a.y + (b.y - a.y) * t1 };
      const ter = terrainAt({ x: a.x + (b.x - a.x) * tm, y: a.y + (b.y - a.y) * tm });
      const tk = (ter in per ? ter : "w") as TerrainCode;
      const d = seg / n;
      km += d;
      per[tk] += d;
      if (tk !== "#") days += d / ((speedOf(spd, tk) || 30) * k);
      const last = runs[runs.length - 1];
      if (last && last.terrain === tk) last.points.push(p1);
      else runs.push({ terrain: tk, points: [p0, p1] });
    }
  }
  return { runs, per, km, days, blocked: per["#"] > 0 };
}

/** Clamps travel hours per day to 1–16 (default 8). */
export function travelHours(hours: number): number {
  return Math.max(1, Math.min(16, Number(hours) || 8));
}

/** "40 min", "2.5 hrs", "3 days 4 h" (the board's `mFmtT`). */
export function formatTravelTime(days: number, hoursPerDay: number): string {
  const perDay = travelHours(hoursPerDay);
  const hrs = days * perDay;
  if (hrs < 1) return `${Math.max(1, Math.round(hrs * 60))} min`;
  if (days < 1) return `${hrs < 3 ? hrs.toFixed(1) : Math.round(hrs)} hrs`;
  const d = Math.floor(days);
  const h = Math.round((days - d) * perDay);
  return `${d}${d === 1 ? " day" : " days"}${h ? ` ${h} h` : ""}`;
}

/** "7.5 km", "62 mi" (the board's `mFmtD`). */
export function formatDistance(km: number, units: "km" | "mi"): string {
  const v = km * (units === "mi" ? KM_PER_MILE_FACTOR : 1);
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units}`;
}

/** The overland/water warning under the route summary. */
export function routeWarning(r: RouteAnalysis, method: TravelMethod): string {
  if (method === "boat") return r.per.r + r.per.w + r.per.m + r.per.d + r.per.h > 0.05 ? "Part of this route is overland, so the boat has to be carried (slow)." : "";
  if (method === "fly") return "";
  return r.per["."] > 0.05 ? "This route crosses water: swimming or fording is very slow. Consider a boat." : "";
}

/** The map's scale bar: the round step nearest an eighth of the width. */
export function scaleBar(widthKm: number): { percent: number; label: string } {
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].reduce((b, v) => (Math.abs(v - widthKm / 8) < Math.abs(b - widthKm / 8) ? v : b), 50);
  return { percent: (step / widthKm) * 100, label: `${step} km` };
}
