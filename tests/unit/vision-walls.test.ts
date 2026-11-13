import { describe, expect, it } from "vitest";

import { createView, los, pointLevel, prepareMap, tokenVisibility, visibleSquares, type VisionToken } from "../../src/lib/domain/combat-map/vision";
import type { WallRun } from "../../src/lib/domain/combat-map/walls";

// Plan map-editor, tracer ME1: drawn walls in the vision engine (prepareMap / los).

const run = (kind: WallRun["kind"], points: number[][], extra: Partial<WallRun> = {}): WallRun => ({ kind, points, ...extra });
const DAY = "High Sun";
const ME = "c1";
const viewer: VisionToken = { x: 2, y: 5, size: 1, face: 0, side: "pc", characterId: ME };
const enemyAt = (x: number, y: number): VisionToken => ({ x, y, size: 1, side: "enemy" });

describe("prepareMap with walls", () => {
  it("without walls (absent, empty, only open doors) the prepared map is the same as before", () => {
    const base = { w: 12, h: 10, base: "grass" };
    const before = prepareMap(base);
    expect(before.walls).toBeUndefined();
    expect(prepareMap({ ...base, walls: [] })).toEqual(before);
    expect(prepareMap({ ...base, walls: [run("door", [[6, 0], [6, 10]], { open: true })] })).toEqual(before);
  });

  it("walls do not mark blocked samples: they are thin lines", () => {
    const map = prepareMap({ w: 12, h: 10, walls: [run("wall", [[6, 0], [6, 10]])] });
    expect(map.blocked.every((v) => v === 0)).toBe(true);
    expect(map.walls?.count).toBe(1);
  });
});

describe("los and the viewer's view", () => {
  const across = (wall: WallRun) => prepareMap({ w: 12, h: 10, base: "grass", walls: [wall] });

  it("a wall blocks sight; a token behind it is hidden and one in front is seen", () => {
    const map = across(run("wall", [[6, 0], [6, 10]]));
    expect(los(map, 2.5, 5.5, 9.5, 5.5)).toBe(false);
    expect(los(map, 2.5, 5.5, 5.75, 5.5)).toBe(true);
    const view = createView(map, { token: viewer, characterId: ME, instinct: 8 }, { phase: DAY });
    expect(tokenVisibility(view, enemyAt(9, 5))).toBe("hidden");
    expect(tokenVisibility(view, enemyAt(5, 5))).toBe("clear");
    expect(pointLevel(view, 6.25, 5.5)).toBe(0);
    expect(pointLevel(view, 5.75, 5.5)).toBe(2);
  });

  it("a window, a low wall and an open door let sight through; a closed door and a hidden secret door do not", () => {
    const line = [[6, 0], [6, 10]];
    expect(los(across(run("window", line)), 2.5, 5.5, 9.5, 5.5)).toBe(true);
    expect(los(across(run("low", line)), 2.5, 5.5, 9.5, 5.5)).toBe(true);
    expect(los(across(run("door", line, { open: true })), 2.5, 5.5, 9.5, 5.5)).toBe(true);
    expect(los(across(run("door", line)), 2.5, 5.5, 9.5, 5.5)).toBe(false);
    expect(los(across(run("secret", line)), 2.5, 5.5, 9.5, 5.5)).toBe(false);
    expect(los(across(run("secret", line, { revealed: true, open: true })), 2.5, 5.5, 9.5, 5.5)).toBe(true);
  });

  it("a one-way wall: seen through from its open side only", () => {
    // Drawn northwards (-y): its left on screen is west, where the viewer stands.
    const map = across(run("oneway", [[6, 10], [6, 0]]));
    expect(los(map, 2.5, 5.5, 9.5, 5.5)).toBe(true);
    expect(los(map, 9.5, 5.5, 2.5, 5.5)).toBe(false);
    const view = createView(map, { token: viewer, characterId: ME, instinct: 8 }, { phase: DAY });
    expect(tokenVisibility(view, enemyAt(9, 5))).toBe("clear");
  });

  it("the fog behind a wall stays dark at night too; walls work on uploaded image maps", () => {
    const map = prepareMap({ w: 12, h: 10, image: true, walls: [run("wall", [[6, 0], [6, 10]])] });
    const lit: VisionToken = { ...viewer, light: "torch" };
    const view = createView(map, { token: lit, characterId: ME, instinct: 8 }, { phase: "Deep Night", tokens: [lit] });
    const grid = visibleSquares(view);
    const at = (x: number, y: number) => grid.levels[Math.floor(y * grid.scale) * grid.sw + Math.floor(x * grid.scale)];
    expect(at(4.25, 5.25)).toBeGreaterThan(0);
    expect(at(6.25, 5.25)).toBe(0);
  });
});
