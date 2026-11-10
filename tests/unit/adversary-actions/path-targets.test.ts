import { describe, expect, it } from "vitest";

import { crossedBy, pathMoveRange, pathSquares } from "@/lib/domain/adversary-actions/path-targets";

describe("WF: path features (pathMoveRange, crossedBy)", () => {
  it("reads the move's range only for a path area with a move of itself", () => {
    const move = { kind: "move", to: "self", range: "close" };
    expect(pathMoveRange({ targets: { side: "any", area: "path" }, steps: [move] })).toBe("close");
    expect(pathMoveRange({ targets: { side: "enemy", area: "front" }, steps: [move] })).toBeNull();
    expect(pathMoveRange({ targets: { side: "enemy", area: "path" }, steps: [{ kind: "damage" }] })).toBeNull();
    expect(pathMoveRange({ targets: { side: "enemy", area: "path" }, steps: [{ kind: "optional", steps: [{ kind: "move", range: "far" }] }] })).toBe("far");
  });

  it("covers every square the footprint slides over, both ends included", () => {
    expect([...pathSquares({ x: 0, y: 0, size: 1 }, { x: 3, y: 0 })].sort()).toEqual(["0,0", "1,0", "2,0", "3,0"]);
    expect(pathSquares({ x: 0, y: 0, size: 2 }, { x: 1, y: 0 }).size).toBe(6);
  });

  it("names the tokens on the line, nearest first, never the mover, and a diagonal line", () => {
    const tokens = [
      { id: "far", x: 4, y: 0, size: 1 },
      { id: "near", x: 1, y: 0, size: 1 },
      { id: "off", x: 2, y: 3, size: 1 },
      { id: "me", x: 0, y: 0, size: 1 },
    ];
    expect(crossedBy({ id: "me", x: 0, y: 0, size: 1 }, { x: 4, y: 0 }, tokens)).toEqual(["near", "far"]);
    expect(crossedBy({ x: 0, y: 0, size: 1 }, { x: 3, y: 3 }, [{ id: "d", x: 2, y: 2, size: 1 }, { id: "x", x: 0, y: 3, size: 1 }])).toEqual(["d"]);
  });
});
