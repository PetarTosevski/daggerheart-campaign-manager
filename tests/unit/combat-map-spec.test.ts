import { describe, expect, it } from "vitest";

import {
  OBJECT_KINDS,
  RANGE_BANDS,
  RANGE_SQUARES,
  SIGHT_DEFAULTS,
  TERRAINS,
  VERY_FAR_MIN_SQUARES,
  blocksSight,
  clean,
  mapSpecSchema,
  rangeBandOf,
  sightOf,
} from "@/lib/domain/combat-map";

describe("clean (port of the board's CMAP.clean)", () => {
  it("returns null for anything that is not an object", () => {
    expect(clean(null)).toBeNull();
    expect(clean("a forest")).toBeNull();
    expect(clean(42)).toBeNull();
    expect(clean([{ w: 20 }])).toBeNull();
  });

  it("fills defaults for an empty object and passes the schema", () => {
    const spec = clean({});
    expect(spec).toEqual({ w: 30, h: 20, seed: 7, base: "grass", plankV: false, title: "", areas: [], objects: [] });
    expect(mapSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("clamps w to 12..44 and h to 10..32 and coerces numeric strings", () => {
    expect(clean({ w: 200, h: 1 })).toMatchObject({ w: 44, h: 10 });
    expect(clean({ w: 3, h: 99 })).toMatchObject({ w: 12, h: 32 });
    expect(clean({ w: "22", h: "15.7" })).toMatchObject({ w: 22, h: 15 });
    expect(clean({ w: "wide", h: Number.NaN })).toMatchObject({ w: 30, h: 20 });
  });

  it("keeps the seed, a known base, the title (capped at 80)", () => {
    const spec = clean({ base: "snow", title: "x".repeat(200), plankV: true }, 12);
    expect(spec).toMatchObject({ base: "snow", seed: 12, plankV: true });
    expect(spec?.title).toHaveLength(80);
    expect(clean({ base: "marshmallow" })?.base).toBe("grass");
  });

  it("drops junk areas and keeps valid ones", () => {
    const spec = clean({
      areas: [
        { terrain: "water", shape: "ellipse", x: 10, y: 8, rx: 3, ry: 2 },
        { terrain: "plasma", shape: "rect", x: 1, y: 1, w: 2, h: 2 },
        { terrain: "stone", shape: "hexagon" },
        { terrain: "dirt", shape: "poly", points: [[1, 1], [2, 2]] },
        { terrain: "path", shape: "path", points: [[-1, 5], [31, 5]], width: "3" },
        null,
        "rect",
        { terrain: "wall", shape: "border", width: 1 },
      ],
    });
    expect(spec?.areas.map((a) => `${a.terrain}:${a.shape}`)).toEqual(["water:ellipse", "path:path", "wall:border"]);
    expect(spec?.areas[1]).toMatchObject({ width: 3, points: [[-1, 5], [31, 5]] });
    expect(mapSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("drops unknown object kinds, keeps walltorch and hull, sanitises fields", () => {
    const spec = clean({
      objects: [
        { kind: "walltorch", x: 3, y: 1, r: 0.6, lit: false },
        { kind: "dragon", x: 5, y: 5 },
        { kind: "tree", x: "7", y: 8, r: 99, variant: "autumn", sight: "cover" },
        { kind: "bush", x: 1, y: 1, variant: "rainbow", sight: "solid", lit: true },
        { kind: "hull", x: 0, y: 0, points: [[1, 1], [9, 1], [9, 4], "junk", [1, 4]] },
        { x: 1, y: 1 },
      ],
    });
    expect(spec?.objects.map((o) => o.kind)).toEqual(["walltorch", "tree", "bush", "hull"]);
    expect(spec?.objects[0]).toMatchObject({ lit: false });
    expect(spec?.objects[1]).toMatchObject({ x: 7, r: 4, variant: "autumn", sight: "cover" });
    expect(spec?.objects[2].variant).toBeUndefined();
    expect(spec?.objects[2].sight).toBeUndefined();
    expect(spec?.objects[2].lit).toBeUndefined();
    expect(spec?.objects[3].points).toHaveLength(4);
    expect(mapSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("caps areas at 60, objects at 300 and points at 40", () => {
    const spec = clean({
      areas: Array.from({ length: 90 }, () => ({ terrain: "dirt", shape: "rect", x: 1, y: 1, w: 1, h: 1 })),
      objects: Array.from({ length: 400 }, (_, i) => ({ kind: "rock", x: i % 30, y: 3 })),
    });
    expect(spec?.areas).toHaveLength(60);
    expect(spec?.objects).toHaveLength(300);
    const path = clean({ areas: [{ terrain: "path", shape: "path", points: Array.from({ length: 80 }, (_, i) => [i, 2]) }] });
    expect(path?.areas[0].points).toHaveLength(40);
  });

  it("clamps coordinates near the map and radius to 0.3..4", () => {
    const spec = clean({ w: 20, h: 12, objects: [{ kind: "rock", x: 1e9, y: -1e9, r: 0.01 }] });
    expect(spec?.objects[0]).toMatchObject({ x: 24, y: -4, r: 0.3 });
  });

  it("knows every board terrain and object kind", () => {
    expect(TERRAINS).toHaveLength(14);
    expect(OBJECT_KINDS).toContain("walltorch");
    expect(OBJECT_KINDS).toHaveLength(22);
  });
});

describe("mapSpecSchema", () => {
  const good = clean({ w: 22, h: 15, objects: [{ kind: "tree", x: 3, y: 3 }] });

  it("accepts a cleaned spec", () => {
    expect(mapSpecSchema.parse(good)).toEqual(good);
  });

  it("rejects out-of-range sizes, unknown kinds and non-finite numbers", () => {
    expect(mapSpecSchema.safeParse({ ...good, w: 45 }).success).toBe(false);
    expect(mapSpecSchema.safeParse({ ...good, h: 9 }).success).toBe(false);
    expect(mapSpecSchema.safeParse({ ...good, base: "plasma" }).success).toBe(false);
    expect(
      mapSpecSchema.safeParse({ ...good, objects: [{ ...good!.objects[0], kind: "dragon" }] }).success,
    ).toBe(false);
    expect(
      mapSpecSchema.safeParse({ ...good, objects: [{ ...good!.objects[0], x: Number.POSITIVE_INFINITY }] }).success,
    ).toBe(false);
  });
});

describe("sight defaults (R7)", () => {
  it("blocks sight for things big enough to hide behind", () => {
    for (const kind of ["tree", "tent", "boulder", "pillar", "statue", "mast"]) {
      expect(sightOf({ kind }), kind).toBe("block");
    }
  });

  it("gives cover only for bushes, rocks, logs, crates, barrels, chests, tables, rubble", () => {
    for (const kind of ["bush", "rock", "log", "crate", "barrel", "chest", "table", "rubble"]) {
      expect(sightOf({ kind }), kind).toBe("cover");
      expect(blocksSight({ kind })).toBe(false);
    }
  });

  it("has a default for every object kind", () => {
    for (const kind of OBJECT_KINDS) expect(SIGHT_DEFAULTS[kind]).toMatch(/^(block|cover|none)$/);
    expect(sightOf({ kind: "unknown-thing" })).toBe("none");
  });

  it("lets the GM override any object", () => {
    expect(sightOf({ kind: "crate", sight: "block" })).toBe("block");
    expect(sightOf({ kind: "tree", sight: "none" })).toBe("none");
    expect(sightOf({ kind: "tree", sight: null })).toBe("block");
  });
});

describe("range bands (CB p.103)", () => {
  it("is Melee 1, Very Close 3, Close 6, Far 12", () => {
    expect(RANGE_BANDS.map((b) => [b.label, b.squares])).toEqual([
      ["Melee", 1],
      ["Very Close", 3],
      ["Close", 6],
      ["Far", 12],
    ]);
    expect(RANGE_SQUARES).toEqual({ melee: 1, veryClose: 3, close: 6, far: 12 });
    expect(VERY_FAR_MIN_SQUARES).toBe(13);
  });

  it("classifies distances", () => {
    expect(rangeBandOf(1)).toBe("melee");
    expect(rangeBandOf(2)).toBe("veryClose");
    expect(rangeBandOf(6)).toBe("close");
    expect(rangeBandOf(12)).toBe("far");
    expect(rangeBandOf(13)).toBe("veryFar");
    expect(rangeBandOf(Number.NaN)).toBe("veryFar");
  });
});
