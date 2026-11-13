import { describe, expect, it } from "vitest";

import { lineOfSight } from "../../src/lib/domain/combat-actions/sight";
import { prepareMap } from "../../src/lib/domain/combat-map/vision";
import type { WallRun } from "../../src/lib/domain/combat-map/walls";

// Plan map-editor, tracer ME1: drawn walls in attack sight and cover (CB p.104: "attack rolls against you are made with
// disadvantage" behind cover; "You usually can't be targeted if you're entirely behind a substantial structure like a
// wall").

const run = (kind: WallRun["kind"], points: number[][], extra: Partial<WallRun> = {}): WallRun => ({ kind, points, ...extra });
const mapWith = (...walls: WallRun[]) => prepareMap({ w: 20, h: 12, base: "grass", walls });
const attacker = { x: 2, y: 5 };
const target = { x: 9, y: 5 };
const line = [[6, 0], [6, 12]];

describe("lineOfSight with drawn walls (ME1)", () => {
  it("a wall, a closed door and a hidden secret door leave no line of sight", () => {
    expect(lineOfSight(mapWith(run("wall", line)), attacker, target)).toEqual({ lineOfSight: false, cover: false });
    expect(lineOfSight(mapWith(run("door", line)), attacker, target)).toEqual({ lineOfSight: false, cover: false });
    expect(lineOfSight(mapWith(run("secret", line)), attacker, target)).toEqual({ lineOfSight: false, cover: false });
  });

  it("a window and an open door leave a clear line, no cover", () => {
    expect(lineOfSight(mapWith(run("window", line)), attacker, target)).toEqual({ lineOfSight: true, cover: false });
    expect(lineOfSight(mapWith(run("door", line, { open: true })), attacker, target)).toEqual({ lineOfSight: true, cover: false });
  });

  it("a target behind a low wall is in cover (disadvantage), from either side", () => {
    expect(lineOfSight(mapWith(run("low", line)), attacker, target)).toEqual({ lineOfSight: true, cover: true });
    expect(lineOfSight(mapWith(run("low", line)), target, attacker)).toEqual({ lineOfSight: true, cover: true });
  });

  it("a low wall that only hides part of the target gives no cover (some line passes clear)", () => {
    // Ends at y 5.5: the lower half of the target's square is seen past its end.
    expect(lineOfSight(mapWith(run("low", [[6, 0], [6, 5.5]])), attacker, target)).toEqual({ lineOfSight: true, cover: false });
  });

  it("a one-way wall: the attacker on its open side targets through it, the target cannot target back", () => {
    // Drawn southwards: its left on screen is east, so the open side is east (+x).
    const map = mapWith(run("oneway", line, { side: "right" }));
    expect(lineOfSight(map, attacker, target)).toEqual({ lineOfSight: true, cover: false });
    expect(lineOfSight(map, target, attacker)).toEqual({ lineOfSight: false, cover: false });
  });

  it("a wall beside the line does nothing", () => {
    expect(lineOfSight(mapWith(run("wall", [[4, 0], [4, 4]])), attacker, target)).toEqual({ lineOfSight: true, cover: false });
  });
});
