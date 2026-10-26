import { describe, expect, it } from "vitest";

import { anyInMelee, inMelee, objectSquares } from "@/lib/domain/combat-map/reach";

// Plan d12-bugs, tracer B4: Melee reach to a map object (CB p.103 "Melee: 1 square"), Chebyshev from any square of the
// token to any square of the object's (rotated) footprint.

const door = { kind: "door", x: 8.5, y: 10.5, r: 1 };
const sorted = (squares: { x: number; y: number }[]) => squares.map((s) => `${s.x},${s.y}`).sort();

describe("combat reach: objectSquares", () => {
  it("a hand-placed door covers its own square; a campfire its centre's", () => {
    expect(sorted(objectSquares(door))).toEqual(["8,10"]);
    expect(sorted(objectSquares({ kind: "campfire", x: 3.5, y: 2.5, r: 0.5 }))).toEqual(["3,2"]);
  });

  it("a 3 x 1 rect sprite lies along x unturned and along y turned a quarter", () => {
    const wall = { kind: "crate", x: 10.5, y: 5.5, r: 1.5, traits: { footprint: "rect" as const, w: 3, h: 1 } };
    expect(sorted(objectSquares(wall))).toEqual(["10,5", "11,5", "9,5"]);
    expect(sorted(objectSquares({ ...wall, rot: Math.PI / 2 }))).toEqual(["10,4", "10,5", "10,6"]);
  });
});

describe("combat reach: inMelee", () => {
  it("adjacent counts", () => {
    expect(inMelee({ x: 7, y: 10 }, door)).toBe(true);
    expect(inMelee({ x: 9, y: 10 }, door)).toBe(true);
    expect(inMelee({ x: 8, y: 11 }, door)).toBe(true);
  });

  it("diagonal counts", () => {
    expect(inMelee({ x: 7, y: 9 }, door)).toBe(true);
    expect(inMelee({ x: 9, y: 11 }, door)).toBe(true);
  });

  it("overlapping counts", () => {
    expect(inMelee({ x: 8, y: 10 }, door)).toBe(true);
  });

  it("2 squares away does not", () => {
    expect(inMelee({ x: 6, y: 10 }, door)).toBe(false);
    expect(inMelee({ x: 10, y: 12 }, door)).toBe(false);
    expect(inMelee({ x: 8, y: 8 }, door)).toBe(false);
  });

  it("a 2 x 2 token reaches from its far edge", () => {
    // Squares (5..6, 9..10): its right edge x = 6 is 2 from the door's x = 8; at x = 6 the edge is x = 7, adjacent.
    expect(inMelee({ x: 5, y: 9, size: 2 }, door)).toBe(false);
    expect(inMelee({ x: 6, y: 9, size: 2 }, door)).toBe(true);
    expect(inMelee({ x: 9, y: 11, size: 2 }, door)).toBe(true);
    expect(inMelee({ x: 10, y: 11, size: 2 }, door)).toBe(false);
  });

  it("a rotated multi-square object: reach follows the turned footprint", () => {
    const gate = { kind: "crate", x: 10.5, y: 5.5, r: 1.5, traits: { footprint: "rect" as const, w: 3, h: 1 } };
    const turned = { ...gate, rot: Math.PI / 2 };
    // (10, 3) is 2 above the unturned gate's row but adjacent to the turned gate's top square (10, 4).
    expect(inMelee({ x: 10, y: 3 }, gate)).toBe(false);
    expect(inMelee({ x: 10, y: 3 }, turned)).toBe(true);
    // (8, 5) is adjacent to the unturned gate's left end (9, 5) but 2 from the turned gate's column x = 10.
    expect(inMelee({ x: 8, y: 5 }, gate)).toBe(true);
    expect(inMelee({ x: 8, y: 5 }, turned)).toBe(false);
  });

  it("anyInMelee: one token in reach is enough; none is never in reach", () => {
    expect(anyInMelee([{ x: 0, y: 0 }, { x: 9, y: 9 }], door)).toBe(true);
    expect(anyInMelee([{ x: 0, y: 0 }], door)).toBe(false);
    expect(anyInMelee([], door)).toBe(false);
  });
});
