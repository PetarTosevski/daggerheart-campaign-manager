import { describe, expect, it } from "vitest";

import { analyseRoute, DEFAULT_TRAVEL_RULES, mapScale, type Point } from "@/lib/domain/travel";
import {
  JOURNEY_MS_PER_DAY,
  MAX_JOURNEY_POINTS,
  arrived,
  daysDue,
  nextBoundaryMs,
  pointAt,
  progressAt,
  remainingPath,
  routeTimeline,
  samplePath,
  walkedPath,
  type JourneyClock,
} from "@/lib/domain/travel/journey";

const scale = mapScale(680, 1000, 800);
const wilds = () => "w";
/** Left half Road, right half Marsh. */
const split = (p: Point) => (p.x < 50 ? "r" : "m");
const opts = { method: "foot", pace: "normal" } as const;

describe("routeTimeline", () => {
  it("agrees with analyseRoute's travel days for the same route", () => {
    const routes: Point[][] = [
      [
        { x: 10, y: 50 },
        { x: 30, y: 50 },
      ],
      [
        { x: 5, y: 5 },
        { x: 45, y: 30 },
        { x: 70, y: 60 },
        { x: 90, y: 20 },
      ],
      Array.from({ length: 200 }, (_, i) => ({ x: 10 + i * 0.4, y: 50 + Math.sin(i / 10) * 10 })),
    ];
    for (const route of routes) {
      for (const terrain of [wilds, split]) {
        for (const o of [opts, { method: "mount", pace: "fast" } as const, { method: "wagon", pace: "slow" } as const]) {
          const expected = analyseRoute(route, scale, terrain, o, DEFAULT_TRAVEL_RULES);
          const timeline = routeTimeline(route, scale, terrain, o, DEFAULT_TRAVEL_RULES);
          expect(timeline.totalDays).toBeCloseTo(expected.days, 9);
          expect(timeline.blocked).toBe(expected.blocked);
          expect(timeline.cum[timeline.cum.length - 1]).toBe(timeline.totalDays);
        }
      }
    }
  });

  it("gives cumulative days per point and adds a point where the terrain changes", () => {
    // 20% of 680 km over Wilds at 40 km/day: 3.4 days, 1.7 to the middle point.
    const t = routeTimeline(
      [
        { x: 10, y: 50 },
        { x: 20, y: 50 },
        { x: 30, y: 50 },
      ],
      scale,
      wilds,
      opts,
    );
    expect(t.points).toHaveLength(3);
    expect(t.cum[0]).toBe(0);
    expect(t.cum[1]).toBeCloseTo(1.7, 9);
    expect(t.totalDays).toBeCloseTo(3.4, 9);

    // Road (60 km/day) then Marsh (15 km/day): one extra point at x = 50, where the speed changes.
    const s = routeTimeline(
      [
        { x: 40, y: 50 },
        { x: 60, y: 50 },
      ],
      scale,
      split,
      opts,
    );
    expect(s.points).toHaveLength(3);
    expect(s.points[1].x).toBeCloseTo(50, 9);
    expect(s.cum[1]).toBeCloseTo(68 / 60, 9);
    expect(s.totalDays).toBeCloseTo(68 / 60 + 68 / 15, 9);
  });

  it("marks a route over impassable terrain blocked", () => {
    const t = routeTimeline(
      [
        { x: 10, y: 50 },
        { x: 30, y: 50 },
      ],
      scale,
      (p) => (p.x > 19 && p.x < 21 ? "#" : "w"),
      opts,
    );
    expect(t.blocked).toBe(true);
  });

  it("keeps the drawn points when the terrain changes too often to add points", () => {
    const route = Array.from({ length: 400 }, (_, i) => ({ x: i * 0.25, y: 50 }));
    const t = routeTimeline(route, scale, (p) => (Math.floor(p.x * 20) % 2 ? "r" : "w"), opts);
    expect(t.points.length).toBeLessThanOrEqual(MAX_JOURNEY_POINTS);
    expect(t.points).toEqual(route);
    expect(t.cum).toHaveLength(400);
  });
});

const points = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
];
const cum = [0, 2, 3];

describe("position along the route", () => {
  it("interpolates by travel days", () => {
    expect(pointAt(points, cum, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAt(points, cum, 1)).toEqual({ x: 5, y: 0 });
    expect(pointAt(points, cum, 2.5)).toEqual({ x: 10, y: 5 });
    expect(pointAt(points, cum, 9)).toEqual({ x: 10, y: 10 });
  });

  it("gives the remaining path from the current point and the walked stretch", () => {
    expect(remainingPath(points, cum, 1)).toEqual([
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    expect(remainingPath(points, cum, 2.5)).toEqual([
      { x: 10, y: 5 },
      { x: 10, y: 10 },
    ]);
    expect(walkedPath(points, cum, 1, 2.5)).toEqual([
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
  });

  it("samples a path keeping its ends", () => {
    const path = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 }));
    const s = samplePath(path, 5);
    expect(s).toHaveLength(5);
    expect(s[0]).toEqual(path[0]);
    expect(s[4]).toEqual(path[49]);
  });
});

describe("the trip's clock", () => {
  const moving: JourneyClock = { speed: "normal", status: "moving", baseDays: 0.5, startedAt: 1000, totalDays: 3.4 };

  it("speeds are 6 / 3 / 1 s of real time per travel day", () => {
    expect(JOURNEY_MS_PER_DAY).toEqual({ slow: 6000, normal: 3000, fast: 1000 });
  });

  it("walks from baseDays at the speed, clamped to the route; a paused trip stays put", () => {
    expect(progressAt(moving, 1000)).toBe(0.5);
    expect(progressAt(moving, 4000)).toBeCloseTo(1.5, 9);
    expect(progressAt(moving, 500)).toBe(0.5);
    expect(progressAt(moving, 1_000_000)).toBe(3.4);
    expect(progressAt({ ...moving, status: "paused" }, 1_000_000)).toBe(0.5);
  });

  it("passes only whole days (the leftover of the last day is not carried)", () => {
    expect(daysDue(0.99, 0)).toBe(0);
    expect(daysDue(1, 0)).toBe(1);
    expect(daysDue(2.999999999999, 0)).toBe(3);
    expect(daysDue(3.4, 2)).toBe(1);
    expect(daysDue(1.5, 2)).toBe(0);
  });

  it("schedules at the next whole-day boundary, then at the arrival", () => {
    // From 0.5 days: day 1 is 0.5 days (1500 ms) away.
    expect(nextBoundaryMs(moving, 1000)).toBe(2500);
    expect(nextBoundaryMs(moving, 2500)).toBe(5500);
    // After day 3, the arrival at 3.4.
    expect(nextBoundaryMs(moving, 8500)).toBe(Math.ceil(1000 + 2.9 * 3000));
    expect(arrived(3.4, 3.4)).toBe(true);
    expect(arrived(3.3, 3.4)).toBe(false);
  });
});
