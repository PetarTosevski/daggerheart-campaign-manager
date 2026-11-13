import { describe, expect, it } from "vitest";

import { buildMovementGrid } from "../../src/lib/domain/combat-map/movement";
import { createView, prepareMap, visibleSquares } from "../../src/lib/domain/combat-map/vision";
import { WALL_KINDS, type WallRun } from "../../src/lib/domain/combat-map/walls";

// Plan map-editor, tracer ME1 acceptance: a 64 x 64 map with 400 wall runs (64 points each) prepares in under 30 ms.

const SIZE = 64;

/** A small seeded generator (mulberry32), so the scene is the same every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 400 runs of 64 points: random walks of 0.5 to 2 squares per segment, kept inside the map, every kind mixed. */
function busyWalls(): WallRun[] {
  const random = rng(64);
  const runs: WallRun[] = [];
  for (let r = 0; r < 400; r++) {
    let x = random() * SIZE;
    let y = random() * SIZE;
    const points: number[][] = [[x, y]];
    for (let k = 1; k < 64; k++) {
      const angle = random() * Math.PI * 2;
      const len = 0.5 + random() * 1.5;
      x = Math.max(0, Math.min(SIZE, x + Math.cos(angle) * len));
      y = Math.max(0, Math.min(SIZE, y + Math.sin(angle) * len));
      points.push([x, y]);
    }
    runs.push({ kind: WALL_KINDS[r % WALL_KINDS.length], points, open: r % 12 === 1 ? true : null });
  }
  return runs;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

describe("walls benchmark (ME1)", () => {
  const walls = busyWalls();
  const input = { w: SIZE, h: SIZE, base: "grass", walls };

  it("a 64 x 64 map with 400 runs of 64 points prepares in under 30 ms", () => {
    prepareMap(input); // warm up the JIT
    const times: number[] = [];
    for (let i = 0; i < 7; i++) {
      const t0 = performance.now();
      const map = prepareMap(input);
      times.push(performance.now() - t0);
      expect(map.walls?.count).toBeGreaterThan(20000);
    }
    const ms = median(times);
    console.info(`[ME1 bench] prepareMap 64x64, 400 runs x 64 points: median ${ms.toFixed(2)} ms`);
    expect(ms).toBeLessThan(30);
  });

  it("the same walls: the movement grid and one viewer's full view stay quick", () => {
    buildMovementGrid(input);
    const t0 = performance.now();
    buildMovementGrid(input);
    const gridMs = performance.now() - t0;
    const map = prepareMap(input);
    const t1 = performance.now();
    const view = createView(map, { token: { x: 32, y: 32, size: 1, face: 0, side: "pc", characterId: "c1" }, characterId: "c1", instinct: 8 }, { phase: "High Sun" });
    visibleSquares(view);
    const viewMs = performance.now() - t1;
    console.info(`[ME1 bench] buildMovementGrid ${gridMs.toFixed(2)} ms; one viewer's visibleSquares ${viewMs.toFixed(2)} ms`);
    expect(gridMs).toBeLessThan(200);
    expect(viewMs).toBeLessThan(500);
  });
});
