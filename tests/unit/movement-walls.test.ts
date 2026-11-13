import { describe, expect, it } from "vitest";

import { buildMovementGrid, checkMove, crossedDifficult, pathBlocked, pathSteps, wallStep } from "../../src/lib/domain/combat-map/movement";
import type { WallRun } from "../../src/lib/domain/combat-map/walls";

// Plan map-editor, tracer ME1: drawn walls in the movement grid. A step between squares is blocked (or difficult)
// when the line between their centres crosses the wall; a move walks its supercover path step by step.

const W = 20;
const H = 12;
const run = (kind: WallRun["kind"], points: number[][], extra: Partial<WallRun> = {}): WallRun => ({ kind, points, ...extra });
/** A vertical run down the left edge of column 10, with an opening (rows 5 and 6) filled by `gap`. */
const wallWithGap = (gap: WallRun | null): WallRun[] => [run("wall", [[10, 0], [10, 5]]), ...(gap ? [gap] : []), run("wall", [[10, 7], [10, 12]])];
const grid = (walls: WallRun[]) => buildMovementGrid({ w: W, h: H, base: "grass", walls });

describe("the grid with walls (ME1)", () => {
  it("without walls (absent, empty or only open doors) the grid has no wall steps and is the same as before", () => {
    const before = buildMovementGrid({ w: W, h: H, base: "grass" });
    expect(before.wallSteps).toBeUndefined();
    expect(buildMovementGrid({ w: W, h: H, base: "grass", walls: [] })).toEqual(before);
    expect(buildMovementGrid({ w: W, h: H, base: "grass", walls: [run("door", [[10, 0], [10, 12]], { open: true })] })).toEqual(before);
  });

  it("walls never mark squares: they live on the steps between them", () => {
    const g = grid(wallWithGap(null));
    expect(g.blocked.every((v) => v === 0)).toBe(true);
    expect(g.difficult.every((v) => v === 0)).toBe(true);
    expect(wallStep(g, { x: 9, y: 2 }, { x: 10, y: 2 })).toBe("block");
    expect(wallStep(g, { x: 10, y: 2 }, { x: 9, y: 2 })).toBe("block");
    expect(wallStep(g, { x: 9, y: 2 }, { x: 9, y: 3 })).toBe("open");
    expect(wallStep(g, { x: 9, y: 2 }, { x: 11, y: 2 })).toBe("open"); // not a neighbour
  });

  it("a wall blocks a move across it; a move that stays on one side or goes through the opening does not", () => {
    const g = grid(wallWithGap(null));
    expect(checkMove(g, { x: 8, y: 2 }, { x: 12, y: 2 }, 1)).toEqual({ blocked: true, difficult: false });
    expect(checkMove(g, { x: 8, y: 2 }, { x: 9, y: 9 }, 1)).toEqual({ blocked: false, difficult: false });
    expect(checkMove(g, { x: 8, y: 5 }, { x: 12, y: 6 }, 1)).toEqual({ blocked: false, difficult: false });
    expect(pathBlocked(g, { x: 8, y: 2 }, { x: 12, y: 2 }, 1)).toBe(true);
  });

  it("a closed door, a hidden secret door, a window and a one-way wall in the opening block; an open door and a revealed open secret door do not", () => {
    const across = (gap: WallRun) => checkMove(grid(wallWithGap(gap)), { x: 8, y: 5 }, { x: 12, y: 5 }, 1).blocked;
    const opening = [[10, 5], [10, 7]];
    expect(across(run("door", opening))).toBe(true);
    expect(across(run("door", opening, { open: true }))).toBe(false);
    expect(across(run("secret", opening, { open: true }))).toBe(true);
    expect(across(run("secret", opening, { revealed: true }))).toBe(true);
    expect(across(run("secret", opening, { revealed: true, open: true }))).toBe(false);
    expect(across(run("window", opening))).toBe(true);
    expect(across(run("oneway", opening))).toBe(true);
    expect(checkMove(grid(wallWithGap(run("oneway", opening))), { x: 12, y: 5 }, { x: 8, y: 5 }, 1).blocked).toBe(true);
  });

  it("a low wall makes the move difficult (D5), never blocked", () => {
    const g = grid(wallWithGap(run("low", [[10, 5], [10, 7]])));
    expect(checkMove(g, { x: 8, y: 5 }, { x: 12, y: 5 }, 1)).toEqual({ blocked: false, difficult: true });
    expect(crossedDifficult(g, { x: 8, y: 5 }, { x: 12, y: 5 }, 1)).toBe(true);
    expect(crossedDifficult(g, { x: 8, y: 5 }, { x: 9, y: 5 }, 1)).toBe(false);
  });

  it("a blocked move still reports a low wall it crosses (the GM's move warns of both)", () => {
    const g = grid([run("low", [[5, 0], [5, 12]]), run("wall", [[10, 0], [10, 12]])]);
    expect(checkMove(g, { x: 2, y: 3 }, { x: 14, y: 3 }, 1)).toEqual({ blocked: true, difficult: true });
  });

  it("a diagonal move through the corner of the opening cannot cut past the wall's end", () => {
    const g = grid(wallWithGap(null));
    // (9, 4) -> (10, 5): the centres' line passes exactly through (10, 5), the end of the upper wall.
    expect(checkMove(g, { x: 9, y: 4 }, { x: 10, y: 5 }, 1).blocked).toBe(true);
    expect(checkMove(g, { x: 9, y: 5 }, { x: 10, y: 5 }, 1).blocked).toBe(false);
  });

  it("a large token is blocked when any square of its footprint steps across the wall", () => {
    const g = grid(wallWithGap(null));
    // Size 2 at rows 5-6 fits the opening; at rows 4-5 its top square hits the wall.
    expect(checkMove(g, { x: 7, y: 5 }, { x: 11, y: 5 }, 2).blocked).toBe(false);
    expect(checkMove(g, { x: 7, y: 4 }, { x: 11, y: 4 }, 2).blocked).toBe(true);
  });

  it("painted terrain and objects still count alongside walls", () => {
    const g = buildMovementGrid({ w: W, h: H, base: "grass", paint: { "3,3": "water" }, block: ["4,8"], walls: wallWithGap(null) });
    expect(checkMove(g, { x: 1, y: 3 }, { x: 5, y: 3 }, 1)).toEqual({ blocked: false, difficult: true });
    expect(checkMove(g, { x: 4, y: 6 }, { x: 4, y: 9 }, 1).blocked).toBe(true);
  });

  it("walls work on uploaded image maps too", () => {
    const g = buildMovementGrid({ w: W, h: H, image: true, walls: wallWithGap(null) });
    expect(checkMove(g, { x: 8, y: 2 }, { x: 12, y: 2 }, 1).blocked).toBe(true);
  });
});

describe("pathSteps", () => {
  it("walks the supercover line one neighbour at a time; an exact corner is one diagonal step", () => {
    expect(pathSteps({ x: 0, y: 0 }, { x: 3, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
    expect(pathSteps({ x: 0, y: 0 }, { x: 2, y: 2 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
    expect(pathSteps({ x: 0, y: 0 }, { x: 3, y: -1 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: -1 },
      { x: 3, y: -1 },
    ]);
    expect(pathSteps({ x: 4, y: 4 }, { x: 4, y: 4 })).toEqual([{ x: 4, y: 4 }]);
  });
});
