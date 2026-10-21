import { describe, expect, it } from "vitest";

import { prepareMap, type VisionObject } from "@/lib/domain/combat-map/vision";
import { bandOf, lineOfSight, rangeCheck, rangeFromWeapon, tokenDistance, withinRange } from "@/lib/domain/combat-actions";

// Plan combat-actions, tracer CA1. CB p.103 Defined Ranges: "Melee: 1 square • Very Close: 3 squares • Close: 6 squares •
// Far: 12 squares • Very Far: 13+ squares". CB p.104: line of sight, cover gives disadvantage (Q2).

describe("tokenDistance (nearest edges, diagonal = 1)", () => {
  it("adjacent squares are 1 apart, diagonals too", () => {
    expect(tokenDistance({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(1);
    expect(tokenDistance({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(1);
    expect(tokenDistance({ x: 0, y: 0 }, { x: 3, y: 2 })).toBe(3);
  });
  it("overlapping footprints are 0 apart", () => {
    expect(tokenDistance({ x: 0, y: 0, size: 2 }, { x: 1, y: 1 })).toBe(0);
  });
  it("measures from the nearest edge square of large tokens (size 2-3)", () => {
    expect(tokenDistance({ x: 0, y: 0, size: 2 }, { x: 5, y: 0 })).toBe(4);
    expect(tokenDistance({ x: 0, y: 0, size: 3 }, { x: 10, y: 1, size: 2 })).toBe(8);
    expect(tokenDistance({ x: 10, y: 1, size: 2 }, { x: 0, y: 0, size: 3 })).toBe(8);
  });
  it("clamps sizes to 1..3", () => {
    expect(tokenDistance({ x: 0, y: 0, size: 9 }, { x: 5, y: 0 })).toBe(3);
    expect(tokenDistance({ x: 0, y: 0, size: 0 }, { x: 5, y: 0 })).toBe(5);
  });
});

describe("bands and range checks (CB p.103, Q1)", () => {
  it("maps distances onto the Defined Ranges", () => {
    expect([0, 1, 2, 3, 4, 6, 7, 12, 13, 40].map(bandOf)).toEqual([
      "melee",
      "melee",
      "veryClose",
      "veryClose",
      "close",
      "close",
      "far",
      "far",
      "veryFar",
      "veryFar",
    ]);
  });
  it("reports out of range without refusing (the server asks the GM, Q1)", () => {
    expect(rangeCheck({ x: 0, y: 0 }, { x: 7, y: 0 }, "close")).toEqual({ distance: 7, band: "far", inRange: false });
    expect(rangeCheck({ x: 0, y: 0 }, { x: 6, y: 0 }, "close")).toEqual({ distance: 6, band: "close", inRange: true });
    expect(rangeCheck({ x: 0, y: 0 }, { x: 30, y: 0 }, "veryFar").inRange).toBe(true);
    expect(rangeCheck({ x: 0, y: 0 }, { x: 30, y: 0 }, "unlimited").inRange).toBe(true);
  });
  it("orders bands nearest first", () => {
    expect(withinRange("melee", "far")).toBe(true);
    expect(withinRange("far", "melee")).toBe(false);
    expect(withinRange("veryFar", "far")).toBe(false);
  });
  it("reads a weapon's printed range", () => {
    expect(rangeFromWeapon("Melee")).toBe("melee");
    expect(rangeFromWeapon("Very Close")).toBe("veryClose");
    expect(rangeFromWeapon("Very Far")).toBe("veryFar");
  });
});

describe("lineOfSight (CB p.104, Q2)", () => {
  it("sees across an open map, no cover", () => {
    const map = prepareMap({ w: 20, h: 10 });
    expect(lineOfSight(map, { x: 1, y: 4 }, { x: 10, y: 4 })).toEqual({ lineOfSight: true, cover: false });
  });
  it("a full wall between the tokens blocks sight", () => {
    const map = prepareMap({ w: 20, h: 10, areas: [{ terrain: "wall", shape: "rect", x: 5, y: 0, w: 1, h: 10 }] });
    expect(lineOfSight(map, { x: 1, y: 4 }, { x: 10, y: 4 })).toEqual({ lineOfSight: false, cover: false });
  });
  it("a wall that hides only part of a large target still lets the attacker see it", () => {
    const map = prepareMap({ w: 20, h: 12, areas: [{ terrain: "wall", shape: "rect", x: 5, y: 0, w: 1, h: 5 }] });
    // Attacker at y 4; a 3-square target spans y 4..7: the lower part is in sight past the wall's end at y 5.
    expect(lineOfSight(map, { x: 1, y: 4 }, { x: 10, y: 4, size: 3 }).lineOfSight).toBe(true);
  });
  it("a cover object on every clear line gives cover (disadvantage)", () => {
    const crate: VisionObject = { kind: "crate", x: 6, y: 4.5, r: 1.5 };
    const map = prepareMap({ w: 20, h: 10, objects: [crate] });
    expect(lineOfSight(map, { x: 1, y: 4 }, { x: 10, y: 4 }, [crate])).toEqual({ lineOfSight: true, cover: true });
  });
  it("a cover object off to the side gives no cover", () => {
    const crate: VisionObject = { kind: "crate", x: 6, y: 1, r: 0.5 };
    const map = prepareMap({ w: 20, h: 10, objects: [crate] });
    expect(lineOfSight(map, { x: 1, y: 4 }, { x: 10, y: 4 }, [crate])).toEqual({ lineOfSight: true, cover: false });
  });
  it("a blocking object (a tree) blocks rather than covers", () => {
    const tree: VisionObject = { kind: "tree", x: 6, y: 4.5, r: 3 };
    const map = prepareMap({ w: 20, h: 10, objects: [tree] });
    expect(lineOfSight(map, { x: 1, y: 4 }, { x: 10, y: 4 }, [tree]).lineOfSight).toBe(false);
  });
  it("cover the attacker or target stands in does not count", () => {
    const crate: VisionObject = { kind: "crate", x: 1.5, y: 4.5, r: 0.5 };
    const map = prepareMap({ w: 20, h: 10, objects: [crate] });
    expect(lineOfSight(map, { x: 1, y: 4 }, { x: 10, y: 4 }, [crate]).cover).toBe(false);
  });
  it("an open door blocks nothing; a cover-mode override counts as cover", () => {
    const door: VisionObject = { kind: "door", x: 6, y: 4.5, r: 1.5, open: true };
    const rock: VisionObject = { kind: "tree", x: 6, y: 4.5, r: 1.5, sight: "cover" };
    expect(lineOfSight(prepareMap({ w: 20, h: 10, objects: [door] }), { x: 1, y: 4 }, { x: 10, y: 4 }, [door])).toEqual({ lineOfSight: true, cover: false });
    expect(lineOfSight(prepareMap({ w: 20, h: 10, objects: [rock] }), { x: 1, y: 4 }, { x: 10, y: 4 }, [rock]).cover).toBe(true);
  });
});
