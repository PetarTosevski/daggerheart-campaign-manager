import { describe, expect, it } from "vitest";

import {
  CLASSIC_MOVE,
  buildMovementGrid,
  checkMove,
  crossedDifficult,
  defaultMove,
  isBlocked,
  isDeck,
  isDifficult,
  moveEffect,
  pathBlocked,
  supercover,
  sweptSquares,
  terrainMove,
  type MovementGrid,
  type MovementObject,
} from "../../src/lib/domain/combat-map/movement";
import { OBJECT_KINDS } from "../../src/lib/domain/combat-map/spec";
import { spriteMove, spriteTraits } from "../../src/lib/sprite-packs/index";

// Map movement M0 (plan .omc/plans/map-movement.yaml): the pure rules. D1 blocking, D2 difficult, D4 path.

const W = 30;
const H = 20;

/** A sprite object from the built-in catalog: traits and move resolved as the server does. */
function sprite(key: string, x: number, y: number, extra: Partial<MovementObject> = {}): MovementObject {
  const ref = { builtin: key };
  const traits = spriteTraits(ref);
  if (traits === null) throw new Error(`unknown sprite ${key}`);
  return { kind: "pillar", x, y, traits, move: spriteMove(ref), ...extra };
}

function grid(objects: MovementObject[] = [], extra: Partial<Parameters<typeof buildMovementGrid>[0]> = {}): MovementGrid {
  return buildMovementGrid({ w: W, h: H, base: "grass", objects, ...extra });
}

function blockedSquares(g: MovementGrid): string[] {
  const out: string[] = [];
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (isBlocked(g, x, y)) out.push(`${x},${y}`);
  return out;
}

const sq = (x: number, y: number) => ({ x, y });

describe("traits (D1, D2)", () => {
  it("Classic kinds: the D1 blockers block, the D2 kinds are difficult, the rest are open", () => {
    const by = (m: string) => OBJECT_KINDS.filter((k) => CLASSIC_MOVE[k] === m).sort();
    expect(by("block")).toEqual(["boulder", "deadtree", "mast", "pillar", "statue", "tree"]);
    // A hull is a deck (open here, see the deck tests); the Classic door kind (M2) is a door.
    expect(CLASSIC_MOVE.hull).toBe("open");
    expect(CLASSIC_MOVE["door"]).toBe("door");
    expect(by("difficult")).toEqual(["bones", "bush", "log", "rubble"]);
    expect(by("door")).toEqual(["door"]);
  });

  it("terrain: wall and void block; water, deep, swamp, snow and lava are difficult", () => {
    expect(["wall", "void"].map(terrainMove)).toEqual(["block", "block"]);
    expect(["water", "deep", "swamp", "snow", "lava"].map(terrainMove)).toEqual(Array(5).fill("difficult"));
    expect(["grass", "dirt", "path", "sand", "stone", "cave", "wood"].map(terrainMove)).toEqual(Array(7).fill("open"));
  });

  it("the sprite default: blocks sight and tall blocks, anything else is open", () => {
    expect(defaultMove({ sight: "block", height: "tall" })).toBe("block");
    expect(defaultMove({ sight: "block", height: "low" })).toBe("open");
    expect(defaultMove({ sight: "cover", height: "tall" })).toBe("open");
    expect(defaultMove({ sight: "none", height: "flat" })).toBe("open");
    // A sprite of a difficult Classic kind (bush, log, bones, rubble) defaults to difficult; block + tall still wins.
    expect(defaultMove({ sight: "cover", height: "low", classicKind: "bush" })).toBe("difficult");
    expect(defaultMove({ sight: "none", height: "flat", classicKind: "rubble" })).toBe("difficult");
    expect(defaultMove({ sight: "block", height: "tall", classicKind: "bush" })).toBe("block");
    expect(defaultMove({ sight: "cover", height: "low", classicKind: "crate" })).toBe("open");
  });

  it("a door blocks unless open is true; a sprite's move wins over its Classic kind", () => {
    expect(moveEffect({ kind: "log", move: "door" })).toBe("block");
    expect(moveEffect({ kind: "log", move: "door", open: false })).toBe("block");
    expect(moveEffect({ kind: "log", move: "door", open: true })).toBe("open");
    expect(moveEffect({ kind: "pillar", move: "open" })).toBe("open");
    expect(moveEffect({ kind: "pillar" })).toBe("block");
    expect(moveEffect({ kind: "rubble", move: null })).toBe("difficult");
    expect(moveEffect({ kind: "unknown" })).toBe("open");
  });
});

describe("the grid", () => {
  it("painted terrain: areas and painted cells, cells over areas", () => {
    const g = grid([], {
      areas: [{ terrain: "wall", shape: "rect", x: 2, y: 2, w: 2, h: 1 }],
      paint: { "10,10": "water", "2,2": "grass" },
    });
    expect(isBlocked(g, 2, 2)).toBe(false);
    expect(isBlocked(g, 3, 2)).toBe(true);
    expect(isDifficult(g, 10, 10)).toBe(true);
    expect(isBlocked(g, 10, 10)).toBe(false);
  });

  it("a wall base blocks everything; an uploaded image ignores terrain", () => {
    expect(isBlocked(grid([], { base: "wall" }), 5, 5)).toBe(true);
    expect(isBlocked(grid([], { base: "wall", image: true }), 5, 5)).toBe(false);
    expect(isBlocked(grid([{ kind: "statue", x: 5.5, y: 5.5 }], { image: true }), 5, 5)).toBe(true);
  });

  it("a Classic blocker covers its vision footprint: r 1 at a square centre is that square", () => {
    expect(blockedSquares(grid([{ kind: "boulder", x: 5.5, y: 5.5, r: 1 }]))).toEqual(["5,5"]);
    // A cover-only Classic kind (rock) never blocks; a difficult one (rubble) is difficult, not blocking.
    const g = grid([{ kind: "rock", x: 7.5, y: 7.5 }, { kind: "rubble", x: 9.5, y: 9.5 }]);
    expect(blockedSquares(g)).toEqual([]);
    expect(isDifficult(g, 9, 9)).toBe(true);
  });

  it("a 3 x 4 barn sprite blocks its whole rectangle; turned a quarter, 4 x 3", () => {
    const barn = "town-street-and-market/timber-barn";
    const upright = blockedSquares(grid([sprite(barn, 10.5, 10)]));
    expect(upright).toHaveLength(12);
    expect(upright).toEqual(expect.arrayContaining(["9,8", "11,8", "9,11", "11,11"]));
    const turned = blockedSquares(grid([sprite(barn, 10, 10.5, { rot: Math.PI / 2 })]));
    expect(turned).toHaveLength(12);
    expect(turned).toEqual(expect.arrayContaining(["8,9", "11,9", "8,11", "11,11"]));
    expect(turned).not.toContain("9,8");
  });

  it("a rotated wall section (2 x 1 rect) blocks along its length only", () => {
    const wall = "grassland-and-road/stone-wall-section";
    expect(blockedSquares(grid([sprite(wall, 6, 5.5)])).sort()).toEqual(["5,5", "6,5"]);
    expect(blockedSquares(grid([sprite(wall, 5.5, 6, { rot: Math.PI / 2 })])).sort()).toEqual(["5,5", "5,6"]);
  });

  it("a difficult sprite (garden plot 3 x 3) is difficult under its footprint and never blocks", () => {
    const g = grid([sprite("town-street-and-market/vegetable-garden-plot", 5.5, 5.5)]);
    expect(blockedSquares(g)).toEqual([]);
    for (const [x, y] of [[4, 4], [6, 6], [5, 5]] as const) expect(isDifficult(g, x, y)).toBe(true);
    expect(isDifficult(g, 7, 5)).toBe(false);
  });

  it("the GM's painted sight blockers block movement, on image maps too", () => {
    expect(isBlocked(grid([], { block: ["4,4"] }), 4, 4)).toBe(true);
    expect(isBlocked(grid([], { block: ["4,4"], image: true }), 4, 4)).toBe(true);
    expect(isBlocked(grid([], { block: ["4,4", "99,99", "bad"] }), 5, 4)).toBe(false);
  });

  it("a Classic hull is a deck: inside its outline nothing is blocked or difficult; masts and painted blockers on it still block", () => {
    const deckPoints = [[5, 5], [15, 5], [17, 8], [15, 11], [5, 11]];
    const hull: MovementObject = { kind: "hull", x: 10, y: 8, r: 1, points: deckPoints };
    const g = grid([hull, { kind: "mast", x: 10.5, y: 8.5 }], { base: "deep", block: ["6,6"] });
    expect(isDifficult(g, 8, 8)).toBe(false);
    expect(isBlocked(g, 8, 8)).toBe(false);
    expect(isBlocked(g, 10, 8)).toBe(true);
    expect(isBlocked(g, 6, 6)).toBe(true);
    // Off the deck: deep water, difficult.
    expect(isDifficult(g, 2, 2)).toBe(true);
    expect(isDifficult(g, 16, 10)).toBe(true);
    expect(crossedDifficult(g, sq(6, 9), sq(13, 9), 1)).toBe(false);
    // Without an outline the hull's footprint is the deck.
    const bare = grid([{ kind: "hull", x: 3.5, y: 3.5 }], { base: "deep" });
    expect(isDifficult(bare, 3, 3)).toBe(false);
    expect(isDifficult(bare, 5, 3)).toBe(true);
  });

  it("M2 follow-up: a Classic hull is a deck whatever its sprite (the ship's-bow sprite keeps its deck walkable)", () => {
    const deckPoints = [[5, 5], [15, 5], [17, 8], [15, 11], [5, 11]];
    const bow = sprite("ship-deck/ships-bow", 10, 8, { kind: "hull", points: deckPoints });
    expect(bow.move).toBe("open");
    expect(isDeck(bow)).toBe(true);
    const g = grid([bow], { base: "deep" });
    expect(isDifficult(g, 8, 8)).toBe(false);
    expect(isBlocked(g, 8, 8)).toBe(false);
    expect(crossedDifficult(g, sq(6, 9), sq(13, 9), 1)).toBe(false);
    expect(isDifficult(g, 2, 2)).toBe(true);
    // Without an outline the sprite's footprint is the deck; a hull never blocks, even with a sprite whose move does.
    const bare = grid([sprite("ship-deck/ships-bow", 3.5, 3.5, { kind: "hull" })], { base: "deep" });
    expect(isDifficult(bare, 3, 3)).toBe(false);
    const blockingSprite = grid([{ kind: "hull", x: 3.5, y: 3.5, move: "block" }], { base: "deep" });
    expect(isBlocked(blockingSprite, 3, 3)).toBe(false);
    expect(isDifficult(blockingSprite, 3, 3)).toBe(false);
    expect(moveEffect({ kind: "hull", move: "block" })).toBe("open");
  });

  it("a blocking square is never also difficult", () => {
    const g = grid([{ kind: "pillar", x: 5.5, y: 5.5 }], { paint: { "5,5": "water" } });
    expect(isBlocked(g, 5, 5)).toBe(true);
    expect(isDifficult(g, 5, 5)).toBe(false);
  });
});

describe("the path (D4)", () => {
  it("supercover walks straight lines and takes both squares at an exact corner", () => {
    expect(supercover(sq(0, 0), sq(3, 0))).toEqual([sq(0, 0), sq(1, 0), sq(2, 0), sq(3, 0)]);
    expect(supercover(sq(0, 0), sq(2, 2))).toEqual([sq(0, 0), sq(1, 0), sq(0, 1), sq(1, 1), sq(2, 1), sq(1, 2), sq(2, 2)]);
    // (3.5, 1.5) -> (0.5, 0.5) passes the corner at (2, 1) exactly.
    expect(supercover(sq(3, 1), sq(0, 0))).toEqual([sq(3, 1), sq(2, 1), sq(1, 1), sq(2, 0), sq(1, 0), sq(0, 0)]);
    expect(supercover(sq(0, 0), sq(4, 1))).toEqual([sq(0, 0), sq(1, 0), sq(2, 0), sq(2, 1), sq(3, 1), sq(4, 1)]);
  });

  it("a wall across the way blocks; a move that stops short or goes around does not", () => {
    const g = grid([], { areas: [{ terrain: "wall", shape: "rect", x: 10, y: 0, w: 1, h: 15 }] });
    expect(pathBlocked(g, sq(5, 5), sq(15, 5), 1)).toBe(true);
    expect(pathBlocked(g, sq(5, 5), sq(9, 5), 1)).toBe(false);
    expect(pathBlocked(g, sq(5, 5), sq(10, 5), 1)).toBe(true);
    expect(pathBlocked(g, sq(5, 17), sq(15, 17), 1)).toBe(false);
  });

  it("no squeezing between two diagonal blockers", () => {
    const g = grid([{ kind: "pillar", x: 6.5, y: 5.5 }, { kind: "pillar", x: 5.5, y: 6.5 }]);
    expect(pathBlocked(g, sq(5, 5), sq(6, 6), 1)).toBe(true);
    const one = grid([{ kind: "pillar", x: 6.5, y: 5.5 }]);
    expect(pathBlocked(one, sq(5, 5), sq(6, 6), 1)).toBe(true);
    expect(pathBlocked(grid(), sq(5, 5), sq(6, 6), 1)).toBe(false);
  });

  it("a 2 x 2 token sweeps its whole footprint: a pillar beside a 1 x 1 path still stops it", () => {
    const g = grid([{ kind: "pillar", x: 8.5, y: 6.5 }]);
    expect(pathBlocked(g, sq(5, 5), sq(12, 5), 1)).toBe(false);
    expect(pathBlocked(g, sq(5, 5), sq(12, 5), 2)).toBe(true);
    expect(sweptSquares(sq(5, 5), sq(6, 5), 2)).toEqual([sq(7, 5), sq(7, 6)]);
  });

  it("a 3 x 3 token cannot pass a 2-square gap, a 2 x 2 can", () => {
    // Wall column 10 with a gap at rows 8-9.
    const g = grid([], {
      areas: [
        { terrain: "wall", shape: "rect", x: 10, y: 0, w: 1, h: 8 },
        { terrain: "wall", shape: "rect", x: 10, y: 10, w: 1, h: 10 },
      ],
    });
    expect(pathBlocked(g, sq(5, 8), sq(14, 8), 2)).toBe(false);
    expect(pathBlocked(g, sq(5, 8), sq(14, 8), 3)).toBe(true);
    expect(pathBlocked(g, sq(5, 7), sq(14, 7), 3)).toBe(true);
  });

  it("a fence with a gate: the closed gate blocks, an open gate and the gap past the fence let a token through", () => {
    const fence = "town-street-and-market/wooden-fence-section";
    const gate = "town-street-and-market/wooden-fence-gate";
    // A vertical fence on column 10, rows 2-4, the gate on rows 5-7, nothing from row 8.
    const objects = (open?: boolean) => [
      sprite(fence, 10.5, 3.5, { rot: Math.PI / 2 }),
      sprite(gate, 10.5, 6.5, { rot: Math.PI / 2, ...(open === undefined ? {} : { open }) }),
    ];
    const closed = grid(objects());
    expect(pathBlocked(closed, sq(5, 3), sq(15, 3), 1)).toBe(true);
    expect(pathBlocked(closed, sq(5, 6), sq(15, 6), 1)).toBe(true);
    expect(pathBlocked(closed, sq(5, 9), sq(15, 9), 1)).toBe(false);
    const opened = grid(objects(true));
    expect(pathBlocked(opened, sq(5, 6), sq(15, 6), 1)).toBe(false);
    expect(pathBlocked(opened, sq(5, 3), sq(15, 3), 1)).toBe(true);
  });

  it("difficult: crossing or ending on one counts; leaving the square it starts on does not", () => {
    const g = grid([], { paint: { "8,5": "swamp", "5,10": "snow" } });
    expect(crossedDifficult(g, sq(5, 5), sq(12, 5), 1)).toBe(true);
    expect(crossedDifficult(g, sq(5, 5), sq(8, 5), 1)).toBe(true);
    expect(crossedDifficult(g, sq(5, 5), sq(7, 5), 1)).toBe(false);
    expect(crossedDifficult(g, sq(5, 10), sq(7, 10), 1)).toBe(false);
    expect(checkMove(g, sq(5, 5), sq(12, 5), 1)).toEqual({ blocked: false, difficult: true });
  });

  it("standing still crosses nothing; a token may step off the blocker it stands on", () => {
    const g = grid([{ kind: "pillar", x: 5.5, y: 5.5 }]);
    expect(sweptSquares(sq(5, 5), sq(5, 5), 1)).toEqual([]);
    expect(checkMove(g, sq(5, 5), sq(5, 5), 1)).toEqual({ blocked: false, difficult: false });
    expect(pathBlocked(g, sq(5, 5), sq(3, 5), 1)).toBe(false);
  });
});
