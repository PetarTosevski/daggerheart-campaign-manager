import { describe, expect, it } from "vitest";

import { generateFallbackLayout, type FallbackLayout } from "../../src/lib/combat-map/fallback-layout";
import {
  LIGHT_KINDS,
  mapPixelSize,
  objectBounds,
  paintMap,
  paintMapRect,
  prepareMap,
  terrainDirtyRect,
  unionRect,
  withObjects,
} from "../../src/lib/combat-map/painter";
import {
  TERRAIN_IDS,
  mergePaint,
  paintKey,
  rasterize,
  type PaintSpec,
  type TerrainGrid,
} from "../../src/lib/combat-map/raster";

// ---------------------------------------------------------------------------------------------------- recording context
// jsdom has no canvas: a mock CanvasRenderingContext2D that records every call and keeps putImageData pixels.

type Call = { op: string; args: unknown[] };
interface Recorder {
  ctx: CanvasRenderingContext2D;
  calls: Call[];
  puts: { data: Uint8ClampedArray; w: number; h: number; x: number; y: number }[];
}

const recorder = (): Recorder => {
  const calls: Call[] = [];
  const puts: Recorder["puts"] = [];
  const state: Record<string | symbol, unknown> = {};
  const special: Record<string, (...a: unknown[]) => unknown> = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray((w as number) * (h as number) * 4) }),
    putImageData: (img, x, y) => {
      const i = img as ImageData;
      puts.push({ data: i.data, w: i.width, h: i.height, x: x as number, y: y as number });
    },
    createRadialGradient: () => ({ addColorStop: (...a: unknown[]) => calls.push({ op: "addColorStop", args: a }) }),
  };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (typeof prop !== "string") return undefined;
      if (prop in target) return target[prop];
      return (...args: unknown[]) => {
        calls.push({ op: prop, args });
        return special[prop]?.(...args);
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      calls.push({ op: `set:${String(prop)}`, args: [value] });
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, puts };
};

const count = (r: Recorder, op: string) => r.calls.filter((c) => c.op === op).length;
const checksum = (d: Uint8ClampedArray) => {
  let h = 0;
  for (let i = 0; i < d.length; i++) h = (Math.imul(h, 31) + d[i]) | 0;
  return h;
};

// ---------------------------------------------------------------------------------------------------- rasterize

const blank = (extra: Partial<PaintSpec> = {}): PaintSpec => ({ w: 10, h: 8, base: "grass", areas: [], ...extra });
const at = (g: TerrainGrid, x: number, y: number) => g[y][x];

describe("rasterize", () => {
  it("fills the base terrain and falls back to grass for an unknown base", () => {
    const g = rasterize(blank({ base: "stone" }));
    expect(g).toHaveLength(8);
    expect(g[0]).toHaveLength(10);
    expect(g.flat().every((t) => t === "stone")).toBe(true);
    expect(rasterize(blank({ base: "lava-ish" })).flat().every((t) => t === "grass")).toBe(true);
  });

  it("rect covers squares whose centres are inside", () => {
    const g = rasterize(blank({ areas: [{ terrain: "water", shape: "rect", x: 2, y: 1, w: 3, h: 2 }] }));
    expect(at(g, 2, 1)).toBe("water");
    expect(at(g, 4, 2)).toBe("water");
    expect(at(g, 5, 2)).toBe("grass");
    expect(at(g, 1, 1)).toBe("grass");
    expect(at(g, 2, 3)).toBe("grass");
  });

  it("ellipse uses centre and radii", () => {
    const g = rasterize(blank({ areas: [{ terrain: "sand", shape: "ellipse", x: 5, y: 4, rx: 3, ry: 1.5 }] }));
    expect(at(g, 5, 4)).toBe("sand");
    expect(at(g, 2, 3)).toBe("sand"); // centre (2.5, 3.5): (2.5/3)^2 + (0.5/1.5)^2 < 1
    expect(at(g, 1, 4)).toBe("grass");
    expect(at(g, 5, 6)).toBe("grass");
  });

  it("poly uses an even-odd point-in-polygon test and needs three points", () => {
    const tri = rasterize(blank({ areas: [{ terrain: "wall", shape: "poly", points: [[0, 0], [8, 0], [0, 8]] }] }));
    expect(at(tri, 1, 1)).toBe("wall");
    expect(at(tri, 6, 6)).toBe("grass");
    const two = rasterize(blank({ areas: [{ terrain: "wall", shape: "poly", points: [[0, 0], [8, 0]] }] }));
    expect(two.flat().includes("wall")).toBe(false);
  });

  it("path covers squares within half its width of any segment", () => {
    const g = rasterize(blank({ areas: [{ terrain: "path", shape: "path", points: [[0, 4], [10, 4]], width: 2 }] }));
    expect(at(g, 0, 3)).toBe("path");
    expect(at(g, 9, 4)).toBe("path");
    expect(at(g, 5, 2)).toBe("grass");
    expect(at(g, 5, 5)).toBe("grass"); // centre 5.5 is 1.5 away
    const elbow = rasterize(blank({ areas: [{ terrain: "dirt", shape: "path", points: [[1, 1], [8, 1], [8, 7]], width: 1 }] }));
    expect(at(elbow, 8, 6)).toBe("dirt");
    expect(at(elbow, 4, 5)).toBe("grass");
  });

  it("border rings the map edge with its width", () => {
    const g = rasterize(blank({ areas: [{ terrain: "wall", shape: "border", width: 1 }] }));
    expect(at(g, 0, 0)).toBe("wall");
    expect(at(g, 9, 4)).toBe("wall");
    expect(at(g, 4, 7)).toBe("wall");
    expect(at(g, 1, 1)).toBe("grass");
  });

  it("later areas win, unknown terrains and shapes are ignored", () => {
    const g = rasterize(blank({
      areas: [
        { terrain: "water", shape: "rect", x: 0, y: 0, w: 10, h: 8 },
        { terrain: "stone", shape: "rect", x: 0, y: 0, w: 2, h: 2 },
        { terrain: "plasma", shape: "rect", x: 0, y: 0, w: 10, h: 8 },
        { terrain: "lava", shape: "hexagon", x: 0, y: 0, w: 10, h: 8 },
      ],
    }));
    expect(at(g, 0, 0)).toBe("stone");
    expect(at(g, 5, 5)).toBe("water");
  });

  it("supersamples with a factor", () => {
    const g = rasterize(blank({ areas: [{ terrain: "water", shape: "rect", x: 0, y: 0, w: 1.5, h: 1 }] }), 4);
    expect(g).toHaveLength(32);
    expect(g[0]).toHaveLength(40);
    expect(at(g, 5, 0)).toBe("water"); // 1.375
    expect(at(g, 6, 0)).toBe("grass"); // 1.625
  });

  it("merges painted squares on top of the areas, at any factor", () => {
    const spec = blank({ areas: [{ terrain: "water", shape: "rect", x: 0, y: 0, w: 10, h: 8 }] });
    const paint = { [paintKey(3, 2)]: "stone", [paintKey(20, 2)]: "stone", "x,y": "stone", [paintKey(1, 1)]: "nonsense" };
    const g = rasterize(spec, 1, paint);
    expect(at(g, 3, 2)).toBe("stone");
    expect(at(g, 1, 1)).toBe("water");
    const f = rasterize(spec, 2, paint);
    expect([at(f, 6, 4), at(f, 7, 4), at(f, 6, 5), at(f, 7, 5)]).toEqual(["stone", "stone", "stone", "stone"]);
    expect(at(f, 8, 4)).toBe("water");
    const again = mergePaint(rasterize(spec), { [paintKey(0, 0)]: "snow" });
    expect(at(again, 0, 0)).toBe("snow");
  });
});

// ---------------------------------------------------------------------------------------------------- fallback layout

const KINDS = new Set([
  "tree", "bush", "deadtree", "rock", "boulder", "tent", "campfire", "log", "crate", "barrel", "chest", "table", "pillar",
  "statue", "rubble", "mast", "mushroom", "torch", "walltorch", "crystal", "bones", "hull",
]);
const SHAPES = new Set(["rect", "ellipse", "poly", "path", "border"]);

/** The board's CMAP.clean limits (what C1's spec.ts enforces). */
const expectValidLayout = (s: FallbackLayout) => {
  expect(s.w).toBeGreaterThanOrEqual(12);
  expect(s.w).toBeLessThanOrEqual(44);
  expect(s.h).toBeGreaterThanOrEqual(10);
  expect(s.h).toBeLessThanOrEqual(32);
  expect(TERRAIN_IDS).toContain(s.base);
  expect(s.title.length).toBeGreaterThan(0);
  expect(s.title.length).toBeLessThanOrEqual(80);
  expect(s.areas.length).toBeLessThanOrEqual(60);
  expect(s.objects.length).toBeLessThanOrEqual(300);
  for (const a of s.areas) {
    expect(TERRAIN_IDS).toContain(a.terrain);
    expect(SHAPES.has(a.shape)).toBe(true);
    expect(a.points?.length ?? 0).toBeLessThanOrEqual(40);
  }
  for (const o of s.objects) {
    expect(KINDS.has(o.kind)).toBe(true);
    expect(o.r).toBeGreaterThanOrEqual(0.3);
    expect(o.r).toBeLessThanOrEqual(4);
  }
  // every number finite, no undefined values anywhere (clean JSON round trip)
  const json = JSON.stringify(s);
  expect(JSON.parse(json)).toEqual(s);
  expect(json).not.toMatch(/null|NaN|Infinity/);
};

describe("generateFallbackLayout", () => {
  it("lays out a forest camp: grass, dirt clearing, tents, campfire, logs and trees", () => {
    const s = generateFallbackLayout("A bandit camp in a forest clearing with tents and a campfire", { seed: 11, w: 30, h: 20 });
    expectValidLayout(s);
    expect([s.w, s.h]).toEqual([30, 20]);
    expect(s.base).toBe("grass");
    expect(s.areas.some((a) => a.terrain === "dirt" && a.shape === "ellipse")).toBe(true);
    const kinds = s.objects.map((o) => o.kind);
    expect(kinds.filter((k) => k === "tent")).toHaveLength(3);
    expect(kinds).toContain("campfire");
    expect(kinds.filter((k) => k === "log")).toHaveLength(2);
    expect(kinds.filter((k) => k === "tree").length).toBeGreaterThan(10);
    expect(s.title).toBe("Forest camp");
  });

  it("lays out dungeon halls: wall base, stone rooms joined by corridors, wall torches", () => {
    const s = generateFallbackLayout("A dungeon crypt with a treasure vault", { seed: 5 });
    expectValidLayout(s);
    expect(s.base).toBe("wall");
    expect(s.areas.filter((a) => a.terrain === "stone" && a.shape === "rect").length).toBeGreaterThanOrEqual(3);
    expect(s.areas.some((a) => a.shape === "path")).toBe(true);
    const kinds = s.objects.map((o) => o.kind);
    expect(kinds).toContain("walltorch");
    expect(kinds).not.toContain("torch");
    expect(kinds).toContain("chest");
    expect(kinds).toContain("bones");
    expect(s.title).toBe("Dungeon halls");
  });

  it("lays out a ship deck: deep water, a hull and three masts", () => {
    const s = generateFallbackLayout("ship deck at sea", { seed: 3 });
    expectValidLayout(s);
    expect(s.base).toBe("deep");
    const kinds = s.objects.map((o) => o.kind);
    expect(kinds.filter((k) => k === "hull")).toHaveLength(1);
    expect(kinds.filter((k) => k === "mast")).toHaveLength(3);
    expect(s.objects.find((o) => o.kind === "hull")?.points?.length).toBe(9);
  });

  it("covers snow, swamp, coast, cavern and ruins scenes", () => {
    const snow = generateFallbackLayout("frozen winter forest", { seed: 2 });
    expectValidLayout(snow);
    expect(snow.base).toBe("snow");
    expect(snow.objects.filter((o) => o.kind === "tree").every((o) => o.variant === "pine")).toBe(true);
    const swamp = generateFallbackLayout("a misty swamp", { seed: 2 });
    expectValidLayout(swamp);
    expect(swamp.base).toBe("swamp");
    expect(swamp.areas.filter((a) => a.terrain === "water")).toHaveLength(6);
    const coast = generateFallbackLayout("rocky coast with a river and a bridge", { seed: 9 });
    expectValidLayout(coast);
    expect(coast.base).toBe("sand");
    expect(coast.areas.map((a) => a.terrain)).toEqual(expect.arrayContaining(["water", "deep", "wood"]));
    expect(coast.plankV).toBe(true);
    const cave = generateFallbackLayout("underground cavern with glowing crystals", { seed: 4 });
    expectValidLayout(cave);
    expect(cave.base).toBe("wall");
    expect(cave.objects.map((o) => o.kind)).toContain("crystal");
    const ruins = generateFallbackLayout("overgrown shrine ruins in autumn", { seed: 8 });
    expectValidLayout(ruins);
    expect(ruins.title).toBe("Overgrown ruins");
  });

  it("is deterministic for a seed, differs between seeds, and sizes from the description", () => {
    const a = generateFallbackLayout("forest camp", { seed: 42 });
    expect(generateFallbackLayout("forest camp", { seed: 42 })).toEqual(a);
    expect(generateFallbackLayout("forest camp", { seed: 43 })).not.toEqual(a);
    expect(generateFallbackLayout("a huge battlefield").w).toBe(36);
    expect(generateFallbackLayout("a tiny room").w).toBe(22);
    const big = generateFallbackLayout("forest", { w: 40, h: 27 });
    expect([big.w, big.h]).toEqual([40, 27]);
    const clamped = generateFallbackLayout("forest", { w: 100, h: 2 });
    expect([clamped.w, clamped.h]).toEqual([44, 10]);
  });

  it("returns a layout the painter accepts (structural PaintSpec)", () => {
    const s: PaintSpec = generateFallbackLayout("forest camp", { seed: 1 });
    expect(rasterize(s)).toHaveLength(s.h);
  });
});

// ---------------------------------------------------------------------------------------------------- painter

const CELL = 12;
const scene: PaintSpec = {
  w: 12,
  h: 10,
  seed: 77,
  base: "grass",
  areas: [
    { terrain: "water", shape: "ellipse", x: 3, y: 3, rx: 2, ry: 1.5 },
    { terrain: "stone", shape: "rect", x: 7, y: 5, w: 4, h: 4 },
    { terrain: "wall", shape: "path", points: [[0, 9], [12, 9]], width: 1 },
    { terrain: "wood", shape: "rect", x: 5, y: 0, w: 2, h: 3 },
  ],
  objects: [
    { kind: "tree", x: 2, y: 8, r: 1.4 },
    { kind: "campfire", x: 9, y: 7, r: 1 },
    { kind: "walltorch", x: 10, y: 5.5, r: 0.5, lit: false },
    { kind: "tent", x: 9, y: 2, r: 1.5, rot: 0.3 },
    { kind: "log", x: 7, y: 4, r: 1, len: 2 },
    { kind: "crate", x: 1, y: 1, r: 0.8 },
    { kind: "mast", x: 4, y: 6, r: 1, span: 3 },
    { kind: "hull", x: 0, y: 0, r: 1, points: [[0.5, 0.5], [3, 0.5], [3, 2], [0.5, 2]] },
    { kind: "rock", x: 11, y: 1, r: 0.7 },
    { kind: "deadtree", x: 6, y: 8, r: 1 },
    { kind: "something-new", x: 6, y: 6, r: 1 },
  ],
};

describe("painter", () => {
  it("mapPixelSize multiplies squares by the cell size", () => {
    expect(mapPixelSize({ w: 30, h: 20 })).toEqual({ width: 1440, height: 960 });
    expect(mapPixelSize({ w: 12, h: 10 }, 16)).toEqual({ width: 192, height: 160 });
  });

  it("paints the whole map: one opaque terrain image, strokes, objects, grid and vignette", () => {
    const r = recorder();
    const m = paintMap(r.ctx, scene, { cell: CELL });
    expect(m.grid).toHaveLength(10);
    expect(r.puts).toHaveLength(1);
    const put = r.puts[0];
    expect([put.x, put.y, put.w, put.h]).toEqual([0, 0, 12 * CELL, 10 * CELL]);
    for (let i = 3; i < put.data.length; i += 4) expect(put.data[i]).toBe(255);
    expect(count(r, "clip")).toBeGreaterThan(0);
    expect(count(r, "ellipse")).toBeGreaterThan(10); // texture strokes, shadows
    expect(count(r, "roundRect")).toBeGreaterThan(0); // log and wall torch
    expect(count(r, "quadraticCurveTo")).toBe(2); // the mast's sail
    expect(count(r, "fillRect")).toBeGreaterThan(0);
    // grid lines: 13 vertical + 11 horizontal
    expect(count(r, "moveTo")).toBeGreaterThan(24);
    expect(r.calls.at(-1)?.op).toBe("restore");
    expect(count(r, "save")).toBe(count(r, "restore"));
  });

  it("is deterministic for a seed and changes with the seed", () => {
    const a = recorder(), b = recorder(), c = recorder();
    paintMap(a.ctx, scene, { cell: CELL });
    paintMap(b.ctx, scene, { cell: CELL });
    paintMap(c.ctx, { ...scene, seed: 78 }, { cell: CELL });
    expect(checksum(b.puts[0].data)).toBe(checksum(a.puts[0].data));
    expect(JSON.stringify(b.calls)).toBe(JSON.stringify(a.calls));
    expect(checksum(c.puts[0].data)).not.toBe(checksum(a.puts[0].data));
  });

  it("draws map lights lit or unlit: glow gradients follow each light's flag or the override", () => {
    const glows = (lights?: "spec" | "lit" | "unlit") => {
      const r = recorder();
      paintMap(r.ctx, { ...scene, areas: [] }, { cell: CELL, lights, vignette: false });
      return count(r, "createRadialGradient");
    };
    expect(glows()).toBe(1); // the campfire; the wall torch is unlit
    expect(glows("lit")).toBe(2);
    expect(glows("unlit")).toBe(0);
    expect(LIGHT_KINDS.has("walltorch")).toBe(true);
  });

  it("options turn off the grid and the vignette", () => {
    const r = recorder();
    paintMap(r.ctx, { w: 4, h: 3, base: "stone" }, { cell: CELL, grid: false, vignette: false });
    expect(count(r, "createRadialGradient")).toBe(0);
    expect(count(r, "stroke")).toBe(0); // stone has no texture strokes, no objects, no grid
  });

  it("repaints a dirty rectangle: same terrain pixels as the full paint, clipped, only the objects that reach it", () => {
    const full = recorder();
    const m = paintMap(full.ctx, scene, { cell: CELL });
    const r = recorder();
    paintMapRect(r.ctx, m, { x: 6.5, y: 4, w: 3, h: 2.5 }, { cell: CELL });
    expect(r.puts).toHaveLength(1);
    const put = r.puts[0];
    const x0 = Math.floor(6.5 * CELL), y0 = 4 * CELL;
    expect([put.x, put.y, put.w, put.h]).toEqual([x0, y0, Math.ceil(9.5 * CELL) - x0, Math.ceil(6.5 * CELL) - y0]);
    const fw = full.puts[0].w;
    for (let y = 0; y < put.h; y++)
      for (let x = 0; x < put.w; x++)
        for (let k = 0; k < 4; k++) {
          const a = full.puts[0].data[((y + y0) * fw + x + x0) * 4 + k], b = put.data[(y * put.w + x) * 4 + k];
          if (a !== b) throw new Error(`pixel ${x + x0},${y + y0} differs`);
        }
    const rect = r.calls.find((c) => c.op === "rect");
    expect(rect?.args).toEqual([x0, y0, put.w, put.h]);
    expect(count(r, "clip")).toBeGreaterThan(0);
    // the far-away tree (2, 8) and crate (1, 1) are not drawn: fewer canopy arcs than the full paint
    expect(count(r, "arc")).toBeLessThan(count(full, "arc"));
    expect(count(r, "quadraticCurveTo")).toBe(2); // the mast at (4, 6) with a 3-square sail reaches in
  });

  it("accepts a spec directly and ignores rectangles outside the map", () => {
    const r = recorder();
    paintMapRect(r.ctx, scene, { x: 20, y: 20, w: 2, h: 2 }, { cell: CELL });
    expect(r.calls).toHaveLength(0);
    paintMapRect(r.ctx, scene, { x: -3, y: -3, w: 4, h: 4 }, { cell: CELL });
    expect([r.puts[0].x, r.puts[0].y, r.puts[0].w, r.puts[0].h]).toEqual([0, 0, CELL, CELL]);
  });

  it("withObjects keeps the terrain and swaps the objects", () => {
    const m = prepareMap(scene);
    const moved = withObjects(m, [{ kind: "campfire", x: 2, y: 2, r: 1 }]);
    expect(moved.fine).toBe(m.fine);
    const r = recorder();
    paintMapRect(r.ctx, moved, { x: 0, y: 0, w: 12, h: 10 }, { cell: CELL, vignette: false });
    expect(count(r, "createRadialGradient")).toBe(1);
  });

  it("prepareMap merges painted terrain", () => {
    const m = prepareMap(scene, { [paintKey(0, 0)]: "lava" });
    expect(m.grid[0][0]).toBe("lava");
    expect(m.fine[3][3]).toBe("lava");
  });

  it("objectBounds covers each kind's drawing, dirty-rect helpers pad and join", () => {
    const tree = objectBounds({ kind: "tree", x: 5, y: 5, r: 2 });
    expect(tree.x).toBeLessThanOrEqual(5 - 2.8);
    expect(tree.x + tree.w).toBeGreaterThanOrEqual(5 + 2.8);
    const log = objectBounds({ kind: "log", x: 5, y: 5, r: 1, len: 6 });
    expect(log.w).toBeGreaterThanOrEqual(6);
    const hull = objectBounds({ kind: "hull", x: 0, y: 0, points: [[1, 2], [9, 2], [9, 6]] });
    expect(hull.x).toBeLessThan(1);
    expect(hull.x + hull.w).toBeGreaterThan(9);
    const mast = objectBounds({ kind: "mast", x: 5, y: 5, r: 1, span: 8 });
    expect(mast.h).toBeGreaterThanOrEqual(8);
    expect(unionRect({ x: 0, y: 0, w: 1, h: 1 }, { x: 3, y: 2, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 4, h: 3 });
    expect(terrainDirtyRect({ x: 4, y: 4, w: 1, h: 1 })).toEqual({ x: 2, y: 2, w: 5, h: 5 });
  });
});
