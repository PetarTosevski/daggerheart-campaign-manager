import { describe, expect, it } from "vitest";

import {
  DEFAULT_TRAVEL_RULES,
  LEGACY_TRAIL_MODES,
  TRAVEL_METHODS,
  analyseRoute,
  distanceKm,
  formatDistance,
  formatLeg,
  formatTravelTime,
  mapScale,
  routeWarning,
  scaleBar,
  canCross,
  maxSwimKm,
  terrainSpeed,
  trailLeg,
  trailMethod,
  trailTotal,
  type Point,
  type SpeedTable,
} from "@/lib/domain/travel";

const all = (code: string) => () => code;
// Witherwild: 400 km across a 1553 × 1193 image.
const ww = mapScale(400, 1553, 1193);

describe("travel distances (house rule)", () => {
  it("scales width by km and height by the image's aspect ratio", () => {
    expect(ww.heightKm).toBeCloseTo((400 * 1193) / 1553, 6);
    expect(distanceKm({ x: 0, y: 0 }, { x: 100, y: 0 }, ww)).toBeCloseTo(400, 6);
    expect(distanceKm({ x: 0, y: 0 }, { x: 0, y: 100 }, ww)).toBeCloseTo(ww.heightKm, 6);
    expect(distanceKm({ x: 10, y: 10 }, { x: 13, y: 14 }, mapScale(100, 1, 1))).toBeCloseTo(5, 6);
  });

  it("uses the board's speeds", () => {
    // Water 8: the party swims it on foot, only a stretch it can cross in a day (user 2026-10-19).
    expect(DEFAULT_TRAVEL_RULES.speeds.foot).toEqual({ road: 60, wilds: 40, plains: 50, marsh: 15, deep: 20, hills: 20, mountains: 10, water: 8 });
    expect(DEFAULT_TRAVEL_RULES.speeds.wagon.water).toBe(0);
    expect(DEFAULT_TRAVEL_RULES.speeds.boat.water).toBe(100);
    expect([DEFAULT_TRAVEL_RULES.slow, DEFAULT_TRAVEL_RULES.fast]).toEqual([0.75, 1.33]);
  });

  it("gives km/day per terrain for a method and pace; unpainted or unknown ground is Wilds", () => {
    expect(terrainSpeed(DEFAULT_TRAVEL_RULES, "boat", "normal", ".")).toBe(100);
    expect(terrainSpeed(DEFAULT_TRAVEL_RULES, "wagon", "normal", "m")).toBe(6);
    expect(terrainSpeed(DEFAULT_TRAVEL_RULES, "foot", "slow", "w")).toBeCloseTo(30, 6);
    expect(terrainSpeed(DEFAULT_TRAVEL_RULES, "mount", "fast", "r")).toBeCloseTo(80 * 1.33, 6);
    expect(terrainSpeed(DEFAULT_TRAVEL_RULES, "foot", "normal", "")).toBe(40);
    expect(terrainSpeed(DEFAULT_TRAVEL_RULES, "mount", "normal", "?")).toBe(60);
  });

  it("reads a pre-PD1 flat pace as a travel method", () => {
    expect(LEGACY_TRAIL_MODES.map(trailMethod)).toEqual(["foot", "foot", "foot", "mount"]);
    expect(TRAVEL_METHODS.map(trailMethod)).toEqual([...TRAVEL_METHODS]);
  });
});

describe("trail legs (party trail and token distances)", () => {
  const a: Point = { x: 0, y: 0 };
  const b: Point = { x: 30, y: 0 }; // 120 km

  it("divides km by the travel method's terrain speed", () => {
    expect(trailLeg(a, b, ww, all("w"), "foot").days).toBeCloseTo(3, 6);
    expect(trailLeg(a, b, ww, all("r"), "foot").days).toBeCloseTo(2, 6);
    expect(trailLeg(a, b, ww, all("w"), "mount").days).toBeCloseTo(2, 6);
    expect(trailLeg(a, b, ww, all("r"), "wagon").days).toBeCloseTo(120 / 50, 6);
    expect(trailLeg(a, b, ww, all("."), "boat").days).toBeCloseTo(1.2, 6);
    expect(trailLeg(a, b, ww, all("h"), "fly").days).toBeCloseTo(1, 6);
  });

  it("applies the pace and counts unpainted ground as Wilds", () => {
    expect(trailLeg(a, b, ww, all("w"), "foot", DEFAULT_TRAVEL_RULES, "slow").days).toBeCloseTo(4, 6);
    expect(trailLeg(a, b, ww, all("w"), "foot", DEFAULT_TRAVEL_RULES, "fast").days).toBeCloseTo(3 / 1.33, 6);
    expect(trailLeg(a, b, ww, all(""), "foot").days).toBeCloseTo(3, 6);
  });

  it("swims water that can be crossed in one day; wider water blocks; wagons can't cross; boats and flying aren't limited", () => {
    // `a`→`b` is 30 km of one terrain at this scale.
    expect(maxSwimKm(DEFAULT_TRAVEL_RULES, "foot", "normal")).toBe(8);
    expect(maxSwimKm(DEFAULT_TRAVEL_RULES, "boat", "normal")).toBe(Infinity);
    const wide = trailLeg(a, b, ww, all("."), "foot");
    expect(wide).toMatchObject({ water: true, blocked: true, wideWater: true });
    // A narrow river (about 6 km of water) in the middle of the wilds is swum at 8 km/day.
    const river = trailLeg(a, b, ww, (p) => (p.x >= 14 && p.x < 16 ? "." : "w"), "foot");
    expect(river).toMatchObject({ water: true, blocked: false, wideWater: false });
    expect(canCross(DEFAULT_TRAVEL_RULES, "wagon", ".")).toBe(false);
    expect(trailLeg(a, b, ww, all("."), "wagon")).toMatchObject({ blocked: true });
    const boat = trailLeg(a, b, ww, all("."), "boat");
    expect(boat).toMatchObject({ water: true, blocked: false });
    expect(canCross(DEFAULT_TRAVEL_RULES, "fly", ".")).toBe(true);
    // A swim carries across trail points: two 5 km water legs in a row are one 10 km swim (too wide).
    const halfway = { x: a.x + (b.x - a.x) / 6, y: a.y + (b.y - a.y) / 6 };
    const twoLegs = trailTotal([a, halfway, { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 }], ww, all("."), "foot");
    expect(twoLegs?.wideWater).toBe(true);
    // Impassable adds no time but blocks.
    const half = trailLeg(a, b, ww, (p) => (p.x < 15 ? "#" : "w"), "foot");
    expect(half.blocked).toBe(true);
    expect(half.days).toBeCloseTo(1.5, 6);
  });

  it("honours GM speeds", () => {
    const rules = { ...DEFAULT_TRAVEL_RULES, speeds: { ...DEFAULT_TRAVEL_RULES.speeds, foot: { ...DEFAULT_TRAVEL_RULES.speeds.foot, wilds: 60 } } };
    expect(trailLeg(a, b, ww, all("w"), "foot", rules).days).toBeCloseTo(2, 6);
  });

  it("sums a trail and formats it like the board", () => {
    expect(trailTotal([a], ww, all("w"), "foot")).toBeNull();
    const t = trailTotal([a, b, { x: 30, y: 0 }], ww, all("w"), "foot")!;
    expect(t.km).toBeCloseTo(120, 6);
    expect(formatLeg({ ...t, days: 4 })).toBe("~120 km · ~4 days");
    expect(formatLeg({ km: 50, days: 1.25, water: true, blocked: false })).toBe("~50 km · ~1.3 days · crosses water");
    expect(formatLeg({ km: 5, days: 0.1, water: false, blocked: true })).toBe("~5 km · ~1 hrs · blocked: can't cross some of this terrain");
    expect(formatLeg({ ...t, days: 4 }, "mi")).toBe("~75 mi · ~4 days");
  });
});

describe("the Measure tool", () => {
  it("splits a route into terrain runs and times it by method and pace", () => {
    const pts: Point[] = [{ x: 0, y: 0 }, { x: 20, y: 0 }]; // 80 km
    const terrain = (p: Point) => (p.x < 10 ? "r" : "w");
    const r = analyseRoute(pts, ww, terrain, { method: "foot", pace: "normal" });
    expect(r.km).toBeCloseTo(80, 6);
    expect(r.per.r).toBeCloseTo(40, 6);
    expect(r.per.w).toBeCloseTo(40, 6);
    expect(r.days).toBeCloseTo(40 / 60 + 40 / 40, 6);
    expect(r.runs.map((x) => x.terrain)).toEqual(["r", "w"]);
    expect(r.blocked).toBe(false);
    const slow = analyseRoute(pts, ww, terrain, { method: "foot", pace: "slow" });
    expect(slow.days).toBeCloseTo(r.days / 0.75, 6);
    const fast = analyseRoute(pts, ww, terrain, { method: "foot", pace: "fast" });
    expect(fast.days).toBeCloseTo(r.days / 1.33, 6);
  });

  it("counts impassable distance without time", () => {
    const r = analyseRoute([{ x: 0, y: 0 }, { x: 10, y: 0 }], ww, all("#"), { method: "foot", pace: "normal" });
    expect(r).toMatchObject({ blocked: true, days: 0 });
    expect(r.per["#"]).toBeCloseTo(40, 6);
  });

  it("warns about water on foot and land by boat", () => {
    const water = analyseRoute([{ x: 0, y: 0 }, { x: 10, y: 0 }], ww, all("."), { method: "foot", pace: "normal" });
    expect(routeWarning(water, "foot")).toMatch(/crosses water/);
    expect(routeWarning(water, "boat")).toBe("");
    const land = analyseRoute([{ x: 0, y: 0 }, { x: 10, y: 0 }], ww, all("w"), { method: "boat", pace: "normal" });
    expect(routeWarning(land, "boat")).toMatch(/overland/);
    expect(routeWarning(water, "fly")).toBe("");
  });

  it("formats time with the travel hours per day", () => {
    expect(formatTravelTime(0.05, 8)).toBe("24 min");
    expect(formatTravelTime(0.25, 8)).toBe("2.0 hrs");
    expect(formatTravelTime(0.5, 8)).toBe("4 hrs");
    expect(formatTravelTime(1, 8)).toBe("1 day");
    expect(formatTravelTime(2.5, 8)).toBe("2 days 4 h");
    expect(formatTravelTime(2.5, 99)).toBe("2 days 8 h");
  });

  it("formats distance in km or miles", () => {
    expect(formatDistance(7.5, "km")).toBe("7.5 km");
    expect(formatDistance(100, "km")).toBe("100 km");
    expect(formatDistance(100, "mi")).toBe("62 mi");
  });

  it("picks the scale bar step nearest an eighth of the width", () => {
    expect(scaleBar(400)).toEqual({ percent: 12.5, label: "50 km" });
    expect(scaleBar(12).label).toBe("1 km");
    expect(scaleBar(2650).label).toBe("200 km");
  });
});

describe("Plains", () => {
  it("defaults per method, and a stored table without plains reads the same", () => {
    expect(TRAVEL_METHODS.map((m) => DEFAULT_TRAVEL_RULES.speeds[m].plains)).toEqual([50, 70, 40, 25, 120]);
    for (const m of TRAVEL_METHODS) {
      const table: SpeedTable = { ...DEFAULT_TRAVEL_RULES.speeds[m] };
      delete table.plains;
      const stored = { ...DEFAULT_TRAVEL_RULES, speeds: { ...DEFAULT_TRAVEL_RULES.speeds, [m]: table } };
      expect(terrainSpeed(stored, m, "normal", "p")).toBe(DEFAULT_TRAVEL_RULES.speeds[m].plains);
    }
  });

  it("is counted by Measure", () => {
    const r = analyseRoute([{ x: 0, y: 0 }, { x: 50, y: 0 }], mapScale(100, 100, 100), () => "p", { method: "foot", pace: "normal" });
    expect(r.per.p).toBeCloseTo(50, 5);
    expect(r.days).toBeCloseTo(1, 5);
  });
});

describe("Hills", () => {
  it("defaults to the Deep wilds speed for every method", () => {
    for (const m of TRAVEL_METHODS) expect(DEFAULT_TRAVEL_RULES.speeds[m].hills).toBe(DEFAULT_TRAVEL_RULES.speeds[m].deep);
    expect(DEFAULT_TRAVEL_RULES.speeds.foot.hills).toBe(20);
  });

  it("reads a stored table without hills as its deep value, and uses its own value when set", () => {
    const footNoHills: SpeedTable = { ...DEFAULT_TRAVEL_RULES.speeds.foot };
    delete footNoHills.hills;
    delete footNoHills.plains;
    const stored = { ...DEFAULT_TRAVEL_RULES, speeds: { ...DEFAULT_TRAVEL_RULES.speeds, foot: { ...footNoHills, deep: 25 } } };
    expect(terrainSpeed(stored, "foot", "normal", "k")).toBe(25);
    const own = { ...stored, speeds: { ...stored.speeds, foot: { ...stored.speeds.foot, hills: 7 } } };
    expect(terrainSpeed(own, "foot", "normal", "k")).toBe(7);
  });

  it("is counted by Measure and the trail", () => {
    const scale = mapScale(100, 100, 100);
    const pts = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
    ];
    const hills = () => "k";
    const r = analyseRoute(pts, scale, hills, { method: "foot", pace: "normal" });
    expect(r.per.k).toBeCloseTo(50, 5);
    expect(r.days).toBeCloseTo(50 / 20, 5);
    expect(trailTotal(pts, scale, hills, "foot")?.days).toBeCloseTo(50 / 20, 5);
  });
});
