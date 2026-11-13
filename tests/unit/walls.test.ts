import { describe, expect, it } from "vitest";

import { buildMovementGrid, wallStep, type MovementGrid, type Square } from "../../src/lib/domain/combat-map/movement";
import { WALL_KINDS, prepareWalls, traceSight, traceStep, wallEffect, type PreparedWalls, type WallRun } from "../../src/lib/domain/combat-map/walls";

// Plan map-editor, tracer ME1: drawn wall geometry (src/lib/domain/combat-map/walls.ts). Square (x, y) covers
// [x, x + 1) x [y, y + 1); integer points are square corners; y grows downwards.

const run = (kind: WallRun["kind"], points: number[][], extra: Partial<WallRun> = {}): WallRun => ({ kind, points, ...extra });

function walls(runs: WallRun[], w = 20, h = 20): PreparedWalls {
  const prepared = prepareWalls(runs, w, h);
  if (!prepared) throw new Error("no walls");
  return prepared;
}

/** The wall effect of a step between the centres of two squares. */
const step = (pw: PreparedWalls, a: Square, b: Square) => traceStep(pw, a.x + 0.5, a.y + 0.5, b.x + 0.5, b.y + 0.5);

describe("wallEffect: the six kinds (user decisions 2026-11-13)", () => {
  it("wall blocks both; window blocks movement only; low is cover and difficult; one-way blocks movement", () => {
    expect(wallEffect({ kind: "wall" })).toEqual({ sight: "block", move: "block" });
    expect(wallEffect({ kind: "window" })).toEqual({ sight: "none", move: "block" });
    expect(wallEffect({ kind: "low" })).toEqual({ sight: "cover", move: "difficult" });
    expect(wallEffect({ kind: "oneway" })).toEqual({ sight: "oneway", move: "block" });
  });

  it("a door blocks both while closed (open absent too) and neither when open", () => {
    expect(wallEffect({ kind: "door" })).toEqual({ sight: "block", move: "block" });
    expect(wallEffect({ kind: "door", open: false })).toEqual({ sight: "block", move: "block" });
    expect(wallEffect({ kind: "door", open: true })).toEqual({ sight: "none", move: "open" });
  });

  it("a secret door is a wall until revealed, open or not; revealed, it is a door", () => {
    expect(wallEffect({ kind: "secret" })).toEqual({ sight: "block", move: "block" });
    expect(wallEffect({ kind: "secret", open: true })).toEqual({ sight: "block", move: "block" });
    expect(wallEffect({ kind: "secret", revealed: true })).toEqual({ sight: "block", move: "block" });
    expect(wallEffect({ kind: "secret", revealed: true, open: true })).toEqual({ sight: "none", move: "open" });
  });

  it("an unknown kind does nothing; every listed kind is handled", () => {
    expect(wallEffect({ kind: "hedge" })).toEqual({ sight: "none", move: "open" });
    for (const kind of WALL_KINDS) expect(wallEffect({ kind, open: false })).not.toEqual({ sight: "none", move: "open" });
  });
});

describe("prepareWalls", () => {
  it("is null without runs, with only open doors, or with only degenerate runs", () => {
    expect(prepareWalls(undefined, 10, 10)).toBeNull();
    expect(prepareWalls([], 10, 10)).toBeNull();
    expect(prepareWalls([run("door", [[0, 5], [10, 5]], { open: true })], 10, 10)).toBeNull();
    expect(prepareWalls([run("wall", [[3, 3]]), run("wall", [[3, 3], [3, 3]]), run("wall", [[Number.NaN, 1], [2, 2]])], 10, 10)).toBeNull();
  });

  it("drops invalid points and zero-length segments, keeps the rest", () => {
    const pw = walls([run("wall", [[0, 5], [0, 5], [Number.NaN, 0], [4, 5], [8, 5]])], 10, 10);
    expect(pw.count).toBe(2);
  });

  it("buckets a segment on a square edge into the squares on both sides", () => {
    const pw = walls([run("wall", [[3, 5], [4, 5]])], 10, 10);
    const holds = (x: number, y: number) => {
      const i = y * 10 + x;
      return pw.start[i + 1] - pw.start[i] > 0;
    };
    expect(holds(3, 4)).toBe(true);
    expect(holds(3, 5)).toBe(true);
    expect(holds(5, 5)).toBe(false);
  });

  it("segments outside the map are kept but never touch a square", () => {
    const pw = walls([run("wall", [[-5, -5], [-1, -3]])], 10, 10);
    expect(pw.items.length).toBe(0);
    expect(traceSight(pw, 0.5, 0.5, 9.5, 9.5)).toBe("clear");
  });
});

describe("traceSight", () => {
  const across = (kind: WallRun["kind"], extra: Partial<WallRun> = {}) => walls([run(kind, [[5, 0], [5, 10]], extra)]);

  it("a wall, a closed door and a hidden secret door block a line across them; a window and an open door do not", () => {
    expect(traceSight(across("wall"), 2.5, 4.5, 8.5, 4.5)).toBe("block");
    expect(traceSight(across("door"), 2.5, 4.5, 8.5, 4.5)).toBe("block");
    expect(traceSight(across("secret", { open: true }), 2.5, 4.5, 8.5, 4.5)).toBe("block");
    expect(traceSight(across("window"), 2.5, 4.5, 8.5, 4.5)).toBe("clear");
    expect(prepareWalls([run("door", [[5, 0], [5, 10]], { open: true })], 20, 20)).toBeNull();
    expect(prepareWalls([run("secret", [[5, 0], [5, 10]], { revealed: true, open: true })], 20, 20)).toBeNull();
    expect(traceSight(across("secret", { revealed: true }), 2.5, 4.5, 8.5, 4.5)).toBe("block");
  });

  it("a low wall gives cover, a wall beyond it still blocks", () => {
    expect(traceSight(across("low"), 2.5, 4.5, 8.5, 4.5)).toBe("cover");
    const both = walls([run("low", [[5, 0], [5, 10]]), run("wall", [[7, 0], [7, 10]])]);
    expect(traceSight(both, 2.5, 4.5, 8.5, 4.5)).toBe("block");
    expect(traceSight(both, 2.5, 4.5, 6.5, 4.5)).toBe("cover");
  });

  it("a line that stops short of a wall, or passes beyond its end, is clear", () => {
    expect(traceSight(across("wall"), 2.5, 4.5, 4.75, 4.5)).toBe("clear");
    expect(traceSight(across("wall"), 2.5, 12.5, 8.5, 12.5)).toBe("clear");
  });

  it("one-way: open on the left of the drawing direction (y down), or on the right with side 'right'", () => {
    // Drawn southwards (+y): its left on screen is east (+x).
    const south = across("oneway");
    expect(traceSight(south, 8.5, 4.5, 2.5, 4.5)).toBe("clear");
    expect(traceSight(south, 2.5, 4.5, 8.5, 4.5)).toBe("block");
    const right = across("oneway", { side: "right" });
    expect(traceSight(right, 2.5, 4.5, 8.5, 4.5)).toBe("clear");
    expect(traceSight(right, 8.5, 4.5, 2.5, 4.5)).toBe("block");
    // Drawn eastwards: its left is north (smaller y).
    const east = walls([run("oneway", [[0, 5], [10, 5]])]);
    expect(traceSight(east, 4.5, 2.5, 4.5, 8.5)).toBe("clear");
    expect(traceSight(east, 4.5, 8.5, 4.5, 2.5)).toBe("block");
  });

  it("a line through the point where two walls meet, or grazing a wall's end, is blocked", () => {
    const corner = walls([run("wall", [[0, 5], [5, 5]]), run("wall", [[5, 5], [5, 10]])]);
    expect(traceSight(corner, 6.5, 3.5, 3.5, 6.5)).toBe("block");
    const end = walls([run("wall", [[0, 5], [5, 5]])]);
    expect(traceSight(end, 3, 3, 7, 7)).toBe("block");
    expect(traceSight(end, 3.1, 3, 7.1, 7)).toBe("clear");
  });
});

describe("traceStep: steps between square centres", () => {
  it("a wall on a square edge blocks the straight step across it, not the steps beside it", () => {
    const pw = walls([run("wall", [[3, 5], [6, 5]])]);
    expect(step(pw, { x: 4, y: 4 }, { x: 4, y: 5 })).toBe("block");
    expect(step(pw, { x: 4, y: 5 }, { x: 4, y: 4 })).toBe("block");
    expect(step(pw, { x: 4, y: 4 }, { x: 5, y: 4 })).toBe("open");
    expect(step(pw, { x: 7, y: 4 }, { x: 7, y: 5 })).toBe("open");
  });

  it("a run ending exactly on a square corner blocks the diagonal step past that corner (no corner cutting)", () => {
    const pw = walls([run("wall", [[3, 5], [6, 5]])]);
    expect(step(pw, { x: 5, y: 4 }, { x: 6, y: 5 })).toBe("block");
    expect(step(pw, { x: 6, y: 4 }, { x: 5, y: 5 })).toBe("block");
    expect(step(pw, { x: 6, y: 4 }, { x: 6, y: 5 })).toBe("open");
    expect(step(pw, { x: 6, y: 4 }, { x: 7, y: 5 })).toBe("open");
  });

  it("a run ending on an edge midpoint blocks the straight step through that midpoint, not the next one", () => {
    const pw = walls([run("wall", [[5, 0], [5, 4.5]])]);
    expect(step(pw, { x: 4, y: 3 }, { x: 5, y: 3 })).toBe("block");
    expect(step(pw, { x: 4, y: 4 }, { x: 5, y: 4 })).toBe("block");
    expect(step(pw, { x: 4, y: 5 }, { x: 5, y: 5 })).toBe("open");
  });

  it("a diagonal step cannot slip through the point where two walls meet", () => {
    // Two runs meet at the corner (5, 5): one along the top of row 5, one down the left of column 5.
    const pw = walls([run("wall", [[0, 5], [5, 5]]), run("wall", [[5, 5], [5, 10]])]);
    expect(step(pw, { x: 5, y: 4 }, { x: 4, y: 5 })).toBe("block");
    expect(step(pw, { x: 4, y: 5 }, { x: 5, y: 4 })).toBe("block");
    // One run turning at the corner, too.
    const bent = walls([run("wall", [[0, 5], [5, 5], [5, 10]])]);
    expect(step(bent, { x: 5, y: 4 }, { x: 4, y: 5 })).toBe("block");
    // A straight wall split into two runs at a corner.
    const split = walls([run("wall", [[0, 5], [5, 5]]), run("wall", [[5, 5], [10, 5]])]);
    expect(step(split, { x: 4, y: 4 }, { x: 5, y: 5 })).toBe("block");
  });

  it("a window blocks a step, a low wall makes it difficult, an open door lets it through", () => {
    const line = [[0, 5], [10, 5]];
    const across = (pw: PreparedWalls | null) => (pw ? step(pw, { x: 4, y: 4 }, { x: 4, y: 5 }) : "open");
    expect(across(prepareWalls([run("window", line)], 20, 20))).toBe("block");
    expect(across(prepareWalls([run("low", line)], 20, 20))).toBe("difficult");
    expect(across(prepareWalls([run("door", line, { open: true })], 20, 20))).toBe("open");
    expect(across(prepareWalls([run("door", line)], 20, 20))).toBe("block");
    expect(across(prepareWalls([run("oneway", line)], 20, 20))).toBe("block");
    expect(step(walls([run("oneway", line)]), { x: 4, y: 5 }, { x: 4, y: 4 })).toBe("block");
    expect(across(prepareWalls([run("low", line), run("wall", [[4, 0], [4, 10]])], 20, 20))).toBe("difficult");
  });
});

// ---------------------------------------------------------------- no way through, whatever the geometry

/** Squares reachable from `start` by single steps (8 neighbours) that drawn walls do not block. */
function reachable(grid: MovementGrid, start: Square): Set<string> {
  const seen = new Set<string>([`${start.x},${start.y}`]);
  const queue: Square[] = [start];
  while (queue.length > 0) {
    const a = queue.pop()!;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const b = { x: a.x + dx, y: a.y + dy };
        if ((dx === 0 && dy === 0) || b.x < 0 || b.y < 0 || b.x >= grid.w || b.y >= grid.h) continue;
        const key = `${b.x},${b.y}`;
        if (seen.has(key) || wallStep(grid, a, b) === "block") continue;
        seen.add(key);
        queue.push(b);
      }
    }
  }
  return seen;
}

function inPolygon(px: number, py: number, pts: readonly number[][]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToPolygon(px: number, py: number, pts: readonly number[][]): number {
  let best = Infinity;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[j];
    const [bx, by] = pts[i];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(px - ax - t * dx, py - ay - t * dy));
  }
  return best;
}

/** A small seeded generator (mulberry32), so failures reproduce. */
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

describe("no way through a closed wall", () => {
  it("a diagonal wall corner to corner splits the map, though it runs through square centres", () => {
    const grid = buildMovementGrid({ w: 10, h: 10, walls: [run("wall", [[0, 0], [10, 10]])] });
    const from = reachable(grid, { x: 9, y: 0 });
    for (const key of from) {
      const [x, y] = key.split(",").map(Number);
      expect(y > x, key).toBe(false);
    }
    // Squares on the wall line belong to one side; the other side reaches none of them but its own.
    expect(from.has("0,9")).toBe(false);
  });

  it("a room of four runs meeting at its corners keeps a token in", () => {
    const sides = [
      [[2, 2], [7, 2]],
      [[7, 2], [7, 7]],
      [[7, 7], [2, 7]],
      [[2, 7], [2, 2]],
    ];
    const grid = buildMovementGrid({ w: 10, h: 10, walls: sides.map((p) => run("wall", p)) });
    const inside = reachable(grid, { x: 4, y: 4 });
    expect(inside.size).toBe(25);
    // With an open door in the room's south side, the token gets out.
    const withDoor = buildMovementGrid({
      w: 10,
      h: 10,
      walls: [...sides.slice(0, 2).map((p) => run("wall", p)), run("wall", [[7, 7], [5, 7]]), run("door", [[5, 7], [4, 7]], { open: true }), run("wall", [[4, 7], [2, 7]]), run("wall", sides[3])],
    });
    expect(reachable(withDoor, { x: 4, y: 4 }).has("0,0")).toBe(true);
  });

  it("random closed polygons (freeform and snapped to corners and edge midpoints): no square outside is reached from inside", () => {
    const random = rng(1113);
    for (let n = 0; n < 60; n++) {
      const snap = n % 3;
      const cx = 10 + random() * 4;
      const cy = 10 + random() * 4;
      const count = 3 + Math.floor(random() * 9);
      const pts: number[][] = [];
      for (let k = 0; k < count; k++) {
        const angle = ((k + random() * 0.8) / count) * Math.PI * 2;
        const r = 3 + random() * 6;
        let x = cx + Math.cos(angle) * r;
        let y = cy + Math.sin(angle) * r;
        if (snap === 1) [x, y] = [Math.round(x), Math.round(y)];
        if (snap === 2) [x, y] = [Math.round(x * 2) / 2, Math.round(y * 2) / 2];
        pts.push([x, y]);
      }
      // As one closed run, and as one run per side (runs meeting at every vertex).
      const asOne = [run("wall", [...pts, pts[0]])];
      const perSide = pts.map((p, i) => run("wall", [p, pts[(i + 1) % pts.length]]));
      for (const runs of [asOne, perSide]) {
        const grid = buildMovementGrid({ w: 24, h: 24, walls: runs });
        const start = { x: Math.floor(cx), y: Math.floor(cy) };
        if (!inPolygon(start.x + 0.5, start.y + 0.5, pts)) continue;
        for (const key of reachable(grid, start)) {
          const [x, y] = key.split(",").map(Number);
          const outside = !inPolygon(x + 0.5, y + 0.5, pts) && distanceToPolygon(x + 0.5, y + 0.5, pts) > 1e-5;
          expect(outside, `polygon ${n} ${JSON.stringify(pts)} reached ${key}`).toBe(false);
        }
      }
    }
  });
});
