import { describe, expect, it } from "vitest";

import {
  OBJECT_KINDS,
  SIGHT_DEFAULTS,
  blocksSight,
  boxSeen,
  clean,
  createView,
  los,
  objectSampleBox,
  prepareMap,
  sightOf,
  tokenVisibility,
  type VisionObject,
  type VisionToken,
} from "@/lib/domain/combat-map";
import { CLASSIC_MOVE, buildMovementGrid, defaultMove, isDoor, moveEffect, pathBlocked, type MovementObject } from "@/lib/domain/combat-map/movement";
import { spriteMove, spriteTraits } from "@/lib/sprite-packs";

// Map movement M2 (plan .omc/plans/map-movement.yaml): doors. D7: a closed door blocks movement, an open one does not;
// a closed solid door (Classic `door`, the wooden door sprite) blocks sight, bars and gates stay cover; open = no effect.

const W = 30;
const H = 20;
const ME = "char-me";

/** A wall column on x = 10 with a one-square doorway at row 10. */
const WALL = [
  { terrain: "wall", shape: "rect", x: 10, y: 0, w: 1, h: 10 },
  { terrain: "wall", shape: "rect", x: 10, y: 11, w: 1, h: 9 },
] as const;

function spriteDoor(key: string, extra: Partial<VisionObject> = {}): VisionObject & { move: ReturnType<typeof spriteMove> } {
  const ref = { builtin: key };
  const traits = spriteTraits(ref);
  if (traits === null) throw new Error(`unknown sprite ${key}`);
  return { kind: "crate", x: 10.5, y: 10.5, r: 0.5, rot: 0, traits, move: spriteMove(ref), ...extra };
}

const classicDoor = (open?: boolean): VisionObject => ({ kind: "door", x: 10.5, y: 10.5, r: 1, rot: 0, ...(open === undefined ? {} : { open }) });

const me: VisionToken = { x: 5, y: 10, size: 1, face: 0, side: "pc", characterId: ME };
const goblin: VisionToken = { x: 15, y: 10, size: 1, face: Math.PI, side: "enemy" };

function seesGoblin(door: VisionObject): boolean {
  const map = prepareMap({ w: W, h: H, base: "grass", areas: [...WALL], objects: [door] });
  const view = createView(map, { token: me, characterId: ME, instinct: 0 }, { phase: "Morning", tokens: [me, goblin] });
  return tokenVisibility(view, goblin) === "clear";
}

describe("doors: the kind and the stored field", () => {
  it("OBJECT_KINDS gains door (widened, every older kind still there); its sight default blocks", () => {
    expect(OBJECT_KINDS).toContain("door");
    expect(OBJECT_KINDS).toContain("hull");
    expect(SIGHT_DEFAULTS.door).toBe("block");
    expect(CLASSIC_MOVE.door).toBe("door");
  });

  it("clean() keeps a door and its open flag (true only)", () => {
    const spec = clean({ w: 20, h: 12, objects: [{ kind: "door", x: 3, y: 3, open: true }, { kind: "door", x: 5, y: 3, open: "yes" }] });
    expect(spec?.objects.map((o) => [o.kind, o.open])).toEqual([
      ["door", true],
      ["door", undefined],
    ]);
  });
});

describe("doors: sight (D7)", () => {
  it("a closed solid door blocks sight, an open one has no effect; the GM's override yields to open", () => {
    expect(sightOf({ kind: "door" })).toBe("block");
    expect(sightOf({ kind: "door", open: false })).toBe("block");
    expect(sightOf({ kind: "door", open: true })).toBe("none");
    expect(sightOf({ kind: "door", sight: "block", open: true })).toBe("none");
    expect(blocksSight({ kind: "door", open: true })).toBe(false);
  });

  it("the wooden door sprite blocks while closed; portcullis, crypt gate, iron gate and wooden gates stay cover", () => {
    expect(sightOf(spriteDoor("dungeon/wooden-door-closed"))).toBe("block");
    expect(sightOf(spriteDoor("dungeon/wooden-door-closed", { open: true }))).toBe("none");
    for (const key of [
      "dungeon/portcullis-section",
      "crypt-and-graveyard/crypt-gate",
      "sewers/iron-gate",
      "grassland-and-road/wooden-gate",
      "town-street-and-market/wooden-fence-gate",
    ]) {
      expect([key, sightOf(spriteDoor(key))]).toEqual([key, "cover"]);
      expect([key, spriteMove({ builtin: key })]).toEqual([key, "door"]);
    }
  });

  it("a closed Classic door in a doorway hides the goblin beyond it; opened, the viewer sees through", () => {
    const empty = prepareMap({ w: W, h: H, base: "grass", areas: [...WALL] });
    expect(los(empty, 5.5, 10.5, 15.5, 10.5)).toBe(true);
    expect(seesGoblin(classicDoor())).toBe(false);
    expect(seesGoblin(classicDoor(false))).toBe(false);
    expect(seesGoblin(classicDoor(true))).toBe(true);
  });

  it("a wooden door sprite blocks the doorway while closed; a portcullis lets the viewer see through while closed", () => {
    expect(seesGoblin(spriteDoor("dungeon/wooden-door-closed"))).toBe(false);
    expect(seesGoblin(spriteDoor("dungeon/wooden-door-closed", { open: true }))).toBe(true);
    expect(seesGoblin(spriteDoor("dungeon/portcullis-section"))).toBe(true);
  });

  it("a viewer looking at a closed door's face has seen it (any sample of its footprint counts)", () => {
    const door = classicDoor();
    const map = prepareMap({ w: W, h: H, base: "grass", areas: [...WALL], objects: [door] });
    const box = objectSampleBox(map, door);
    expect(box).toEqual({ sx0: 20, sy0: 20, sx1: 22, sy1: 22 });
    const view = createView(map, { token: me, characterId: ME, instinct: 0 }, { phase: "Morning", tokens: [me] });
    expect(boxSeen(view, box)).toBe(true);
    // Facing away (west): not seen now, but an explored sample of it counts.
    const away = createView(map, { token: { ...me, face: Math.PI }, characterId: ME, instinct: 0 }, { phase: "Morning", tokens: [me] });
    expect(boxSeen(away, box)).toBe(false);
    const explored = new Uint8Array(map.sw * map.sh);
    explored[21 * map.sw + 20] = 1;
    expect(boxSeen(away, box, explored)).toBe(true);
  });

  it("a rotated rect door's box covers its turned footprint", () => {
    const door = spriteDoor("town-street-and-market/wooden-fence-gate", { x: 10.5, y: 6.5, r: undefined, rot: Math.PI / 2 });
    const map = prepareMap({ w: W, h: H });
    const box = objectSampleBox(map, door);
    // 3 x 1 turned upright: one square wide, three tall.
    expect([box.sx1 - box.sx0, box.sy1 - box.sy0]).toEqual([2, 6]);
  });
});

describe("doors: movement (M0 reads open)", () => {
  const grid = (objects: MovementObject[]) => buildMovementGrid({ w: W, h: H, base: "grass", areas: [...WALL], objects });
  const sq = (x: number, y: number) => ({ x, y });

  it("a hand-placed Classic door (r 0.5) still blocks its doorway when closed", () => {
    expect(pathBlocked(grid([{ kind: "door", x: 10.5, y: 10.5, r: 0.5 }]), sq(5, 10), sq(14, 10), 1)).toBe(true);
    expect(pathBlocked(grid([{ kind: "door", x: 10.5, y: 10.5, r: 0.5, open: true }]), sq(5, 10), sq(14, 10), 1)).toBe(false);
  });

  it("a closed Classic door blocks the doorway, an open one lets a token through", () => {
    expect(pathBlocked(grid([]), sq(5, 10), sq(14, 10), 1)).toBe(false);
    expect(pathBlocked(grid([{ kind: "door", x: 10.5, y: 10.5, r: 1 }]), sq(5, 10), sq(14, 10), 1)).toBe(true);
    expect(pathBlocked(grid([{ kind: "door", x: 10.5, y: 10.5, r: 1, open: true }]), sq(5, 10), sq(14, 10), 1)).toBe(false);
  });

  it("a closed portcullis blocks movement though it is see-through; opened it does not", () => {
    const gate = spriteDoor("dungeon/portcullis-section");
    expect(pathBlocked(grid([gate]), sq(5, 10), sq(14, 10), 1)).toBe(true);
    expect(pathBlocked(grid([{ ...gate, open: true }]), sq(5, 10), sq(14, 10), 1)).toBe(false);
  });

  it("isDoor: a sprite's move \"door\", else the Classic kind door; an uploaded sprite of Classic kind door defaults to a door", () => {
    expect(isDoor({ kind: "door" })).toBe(true);
    expect(isDoor({ kind: "door", move: null })).toBe(true);
    expect(isDoor({ kind: "crate", move: "door" })).toBe(true);
    expect(isDoor({ kind: "door", move: "open" })).toBe(false);
    expect(isDoor({ kind: "crate" })).toBe(false);
    expect(defaultMove({ sight: "block", height: "tall", classicKind: "door" })).toBe("door");
    expect(defaultMove({ sight: "cover", height: "low", classicKind: "door" })).toBe("door");
    expect(moveEffect({ kind: "door" })).toBe("block");
    expect(moveEffect({ kind: "door", open: true })).toBe("open");
  });
});

describe("doors: the panel's labels", () => {
  it("solid doors are Doors, bars and gates are Gates, numbered per kind in reading order", async () => {
    const { doorLabels } = await import("@/components/combat-map/vision/use-vision");
    const d = (id: string, x: number, y: number, solid: boolean) => ({ _id: id, x, y, r: 1, rot: 0, open: false, solid }) as never;
    const labels = doorLabels([d("c", 2, 5, true), d("a", 9, 1, true), d("b", 1, 1, false), d("e", 1, 5, false)]);
    expect(Object.fromEntries(labels)).toEqual({ b: "Gate 1", a: "Door 1", e: "Gate 2", c: "Door 2" });
  });
});
