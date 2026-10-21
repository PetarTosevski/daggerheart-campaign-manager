import { describe, expect, it } from "vitest";

import {
  paintMap as classicPaintMap,
  paintMapRect as classicPaintMapRect,
  prepareMap as classicPrepareMap,
  type PreparedMap as PaintPrepared,
} from "../../src/lib/combat-map/painter";
import type { SpriteArt } from "../../src/lib/combat-map/sprites/loader";
import { paintMap as spritePaintMap, type SpritePaintSpec } from "../../src/lib/combat-map/sprites/painter";
import { glowingSquares, planTextures, type GlowUploads } from "../../src/lib/combat-map/sprites/terrain";
import {
  FAINT_GLOW_REACH,
  GLOWING_TERRAINS,
  SAMPLES_PER_SQUARE,
  TERRAIN_GLOW_REACH,
  createView,
  prepareMap,
  terrainGlows,
  tokenVisibility,
  visibleSquares,
  type PreparedMap,
  type VisionArea,
  type VisionMapInput,
  type VisionObject,
  type VisionToken,
} from "../../src/lib/domain/combat-map";
import { BUILTIN_LOOKUP, builtinSpriteUrl } from "../../src/lib/sprite-packs/builtin/index";

// Glowing terrain (followups-5 F6, dcm-bxp.91; user 2026-10-21: "glowing terrain gives off light like other faint-glow
// objects - very dim light only around its own squares").

const ME = "char-me";
const DAY = "Morning";
const NIGHT = "Deep Night";
const S = SAMPLES_PER_SQUARE;

/** My PC at (2, 10), facing east, no carried light (own night vision reaches 3 squares only). */
const mine: VisionToken = { x: 2, y: 10, size: 1, face: 0, side: "pc", characterId: ME, light: "none" };
const enemy = (x: number, y: number, extra: Partial<VisionToken> = {}): VisionToken => ({ x, y, size: 1, face: Math.PI, side: "enemy", ...extra });

/** A 2 x 2 lava pool on squares (15..16, 10..11). */
const LAVA: VisionArea = { terrain: "lava", shape: "rect", x: 15, y: 10, w: 1.9, h: 1.9 };

function see(token: VisionToken, map: Partial<VisionMapInput>, phase = NIGHT) {
  const prepared = prepareMap({ w: 30, h: 20, base: "grass", ...map });
  const view = createView(prepared, { token: mine, characterId: ME, instinct: 2 }, { phase, tokens: [mine, token] });
  return tokenVisibility(view, token);
}

/** The glow level of the sample holding the point (squares). */
const glowAt = (map: PreparedMap, x: number, y: number) => map.glow?.[Math.floor(y * S) * map.sw + Math.floor(x * S)] ?? 0;

describe("glowing terrain: the rule (F6)", () => {
  it("Classic lava glows with the faint-glow reach; other terrains do not", () => {
    expect([...GLOWING_TERRAINS]).toEqual(["lava"]);
    expect(TERRAIN_GLOW_REACH).toBe(FAINT_GLOW_REACH);
    expect(terrainGlows("lava")).toBe(true);
    for (const t of ["grass", "stone", "cave", "water", "wall", null, undefined]) expect(terrainGlows(t)).toBe(false);
  });
});

describe("glowing terrain: vision at night (F6)", () => {
  it("a lava square shows a token on it and one square away; the dim band hides tokens unless revealed (R10)", () => {
    expect(see(enemy(15, 10), {})).toBe("hidden");
    expect(see(enemy(15, 10), { areas: [LAVA] })).toBe("clear");
    expect(see(enemy(16, 11), { areas: [LAVA] })).toBe("clear");
    expect(see(enemy(14, 10), { areas: [LAVA] })).toBe("clear"); // the edge: one square off the pool
    expect(see(enemy(13, 10), { areas: [LAVA] })).toBe("hidden"); // dim band
    expect(see(enemy(13, 10, { revealedTo: [ME] }), { areas: [LAVA] })).toBe("dim");
    expect(see(enemy(10, 10, { revealedTo: [ME] }), { areas: [LAVA] })).toBe("hidden"); // past Very Close
  });

  it("by day and in dim phases nothing changes", () => {
    for (const phase of [DAY, "Nautical Twilight"]) {
      const a = createView(prepareMap({ w: 30, h: 20, base: "grass" }), { token: mine, characterId: ME, instinct: 2 }, { phase, tokens: [mine] });
      const b = createView(prepareMap({ w: 30, h: 20, base: "grass", areas: [LAVA] }), { token: mine, characterId: ME, instinct: 2 }, { phase, tokens: [mine] });
      expect(visibleSquares(b).levels).toEqual(visibleSquares(a).levels);
    }
  });

  it("the light needs a sight line from the square (a wall stops it) and the viewer still needs one too", () => {
    const wall: VisionArea = { terrain: "wall", shape: "rect", x: 17, y: 8, w: 0.9, h: 6 };
    const map = prepareMap({ w: 30, h: 20, base: "grass", areas: [LAVA, wall] });
    expect(glowAt(map, 15.25, 10.25)).toBe(2);
    expect(glowAt(map, 14.25, 10.25)).toBe(2);
    expect(glowAt(map, 13.25, 10.25)).toBe(1);
    expect(glowAt(map, 18.25, 10.25)).toBe(0); // behind the wall
    expect(glowAt(map, 10.25, 10.25)).toBe(0);
    // A tall wall between viewer and pool hides the pool.
    const between: VisionArea = { terrain: "wall", shape: "rect", x: 8, y: 0, w: 1, h: 20 };
    expect(see(enemy(15, 10), { areas: [LAVA, between] })).toBe("hidden");
  });

  it("painted squares count: painted lava glows, grass painted over lava does not", () => {
    expect(see(enemy(20, 5), { paint: { "20,5": "lava" } })).toBe("clear");
    expect(see(enemy(15, 10), { areas: [LAVA], paint: { "15,10": "grass", "16,10": "grass", "15,11": "grass", "16,11": "grass" } })).toBe("hidden");
  });

  it("the caller's glow list replaces the terrain rule (Sprites maps); an uploaded image has no terrain glow", () => {
    expect(see(enemy(15, 10), { areas: [LAVA], glow: [] })).toBe("hidden");
    expect(see(enemy(20, 5), { glow: ["20,5", "99,99", "junk"] })).toBe("clear");
    expect(see(enemy(15, 10), { areas: [LAVA], image: true })).toBe("hidden");
    expect(see(enemy(20, 5), { image: true, glow: ["20,5"] })).toBe("clear");
  });

  it("a map without glowing terrain prepares exactly as before (no glow field)", () => {
    const input: VisionMapInput = { w: 30, h: 20, base: "grass", areas: [{ terrain: "water", shape: "ellipse", x: 10, y: 10, rx: 3, ry: 2 }] };
    const map = prepareMap(input);
    expect("glow" in map).toBe(false);
    expect(Object.keys(map).sort()).toEqual(["blocked", "h", "lights", "sh", "sw", "w"]);
    expect(prepareMap({ ...input, glow: [] })).toEqual(map);
  });
});

describe("glowing terrain: speed (C1 budget: 44 x 32, 300 objects, one viewer < 50 ms)", () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function scene(): { input: VisionMapInput; tokens: VisionToken[] } {
    const r = rng(11);
    const objects: VisionObject[] = Array.from({ length: 300 }, (_, i) => ({
      kind: i % 3 === 0 ? "tree" : i % 3 === 1 ? "boulder" : "bush",
      x: r() * 44,
      y: r() * 32,
      r: 0.5 + r(),
      ...(i % 25 === 0 ? { kind: "torch" } : {}),
    }));
    const areas: VisionArea[] = [
      { terrain: "lava", shape: "ellipse", x: 22, y: 16, rx: 12, ry: 8 },
      { terrain: "lava", shape: "path", points: [[0, 4], [44, 28]], width: 3 },
      { terrain: "wall", shape: "border", width: 1 },
    ];
    const tokens: VisionToken[] = Array.from({ length: 30 }, () => enemy(Math.floor(r() * 44), Math.floor(r() * 32)));
    return { input: { w: 44, h: 32, base: "cave", areas, objects }, tokens };
  }

  it("prepares the glow once and keeps one viewer at night under 50 ms", () => {
    const { input, tokens } = scene();
    const viewer: VisionToken = { x: 4, y: 16, size: 1, face: 0, side: "pc", characterId: ME, light: "torch" };
    const run = () => {
      const t0 = performance.now();
      const map = prepareMap(input);
      const t1 = performance.now();
      const view = createView(map, { token: viewer, characterId: ME, instinct: 8 }, { phase: NIGHT, tokens: [viewer, ...tokens] });
      const grid = visibleSquares(view);
      for (const t of tokens) tokenVisibility(view, t);
      const t2 = performance.now();
      return { prepare: t1 - t0, view: t2 - t1, total: t2 - t0, glowing: map.glow?.filter((g) => g > 0).length ?? 0, seen: grid.levels.filter((l) => l > 0).length };
    };
    run();
    const runs = Array.from({ length: 9 }, run);
    const median = (k: "prepare" | "view" | "total") => runs.map((x) => x[k]).sort((a, b) => a - b)[4]!;
    expect(runs[0]!.glowing).toBeGreaterThan(1000);
    expect(runs[0]!.seen).toBeGreaterThan(0);
    console.info(`F6 speed: prepare ${median("prepare").toFixed(2)} ms, one viewer ${median("view").toFixed(2)} ms, together ${median("total").toFixed(2)} ms`);
    // The budget is per viewer; the glow is prepared once per map and shared by every viewer of the query. Unloaded:
    // prepare about 9 ms, one viewer about 4 ms. The looser bound on the total keeps a busy CI machine from flaking.
    // Asserted on the best of 9 runs: parallel worktrees load the machine and stretch the median several times over.
    const best = (k: "view" | "total") => Math.min(...runs.map((x) => x[k]));
    expect(best("view")).toBeLessThan(50);
    expect(best("total")).toBeLessThan(100);
  });
});

// ---------------------------------------------------------------------------------------------------- Sprites maps

const NO_UPLOADS: GlowUploads = new Map();
const glowSet = (...args: Parameters<typeof glowingSquares>) => new Set(glowingSquares(...args));

describe("glowing terrain: which squares of a Sprites map glow (F6)", () => {
  const volcanic = { w: 12, h: 10, seed: 3, base: "stone", areas: [{ terrain: "lava", shape: "rect", x: 2, y: 2, w: 3.9, h: 2.9 }] };

  it("lava draws glowing lava textures in the volcanic setting: every lava square glows, the stone does not", () => {
    const glow = glowSet(volcanic, undefined, undefined, "volcanic", NO_UPLOADS);
    expect(glow.size).toBe(12);
    for (let y = 2; y < 5; y++) for (let x = 2; x < 6; x++) expect(glow.has(`${x},${y}`)).toBe(true);
    expect(glow.has("0,0")).toBe(false);
  });

  it("lava with no texture in the setting draws Classic, and Classic lava glows", () => {
    expect(glowSet(volcanic, undefined, undefined, "forest", NO_UPLOADS).size).toBe(12);
  });

  it("a texture cell decides its square: a dark rock cell on lava does not glow, a glowing moss cell on stone does", () => {
    const textures = { "2,2": { builtin: "volcanic/black-volcanic-rock" }, "8,8": { builtin: "mushroom-cavern/glowing-moss-floor" } };
    const glow = glowSet(volcanic, undefined, textures, "volcanic", NO_UPLOADS);
    expect(glow.has("2,2")).toBe(false);
    expect(glow.has("3,2")).toBe(true);
    expect(glow.has("8,8")).toBe(true);
    // An unknown ref counts as none: the square falls back to its terrain.
    expect(glowSet(volcanic, undefined, { "3,3": { builtin: "volcanic/nope" } }, "volcanic", NO_UPLOADS).has("3,3")).toBe(true);
  });

  it("an area's texture decides the squares it painted (unless a square was hand-painted another terrain)", () => {
    const spec = { w: 12, h: 10, seed: 3, base: "grass", areas: [{ terrain: "cave", shape: "rect", x: 6, y: 6, w: 2.9, h: 1.9, texture: { builtin: "mushroom-cavern/violet-glowing-moss" } }] };
    const glow = glowSet(spec, undefined, undefined, "forest", NO_UPLOADS);
    expect(glow.size).toBe(6);
    expect(glowSet(spec, { "6,6": "grass" }, undefined, "forest", NO_UPLOADS).has("6,6")).toBe(false);
  });

  it("a mixed terrain class glows where its glowing variant is drawn, deterministically per seed", () => {
    const spec = { w: 44, h: 32, seed: 9, base: "cave", areas: [] };
    const a = glowSet(spec, undefined, undefined, "mushroom-cavern", NO_UPLOADS);
    expect(a.size).toBeGreaterThan(0);
    expect(a.size).toBeLessThan(44 * 32);
    expect(glowSet(spec, undefined, undefined, "mushroom-cavern", NO_UPLOADS)).toEqual(a);
    // A setting whose cave textures do not glow: nothing.
    expect(glowSet(spec, undefined, undefined, "cave", NO_UPLOADS).size).toBe(0);
  });

  it("an uploaded texture glows by its light trait; a deleted one falls back", () => {
    const uploads: GlowUploads = new Map([
      ["up-glow", { category: "texture", light: "faintglow", url: "https://files.test/glow.webp" }],
      ["up-dark", { category: "texture", light: "none", url: "https://files.test/dark.webp" }],
    ]);
    const textures = { "0,0": { uploaded: "up-glow" }, "3,3": { uploaded: "up-dark" }, "1,0": { uploaded: "up-gone" } };
    const glow = glowSet(volcanic, undefined, textures, "volcanic", uploads);
    expect(glow.has("0,0")).toBe(true);
    expect(glow.has("3,3")).toBe(false);
    expect(glow.has("1,0")).toBe(false); // stone underneath
  });

  it("feeds vision: a lava square textured dark gives no light on a Sprites map", () => {
    const textures = { "15,10": { builtin: "volcanic/black-volcanic-rock" }, "16,10": { builtin: "volcanic/black-volcanic-rock" }, "15,11": { builtin: "volcanic/black-volcanic-rock" }, "16,11": { builtin: "volcanic/black-volcanic-rock" } };
    const spec = { w: 30, h: 20, seed: 1, base: "grass", areas: [LAVA] };
    expect(see(enemy(15, 10), { areas: [LAVA], glow: glowingSquares(spec, undefined, undefined, "volcanic", NO_UPLOADS) })).toBe("clear");
    expect(see(enemy(15, 10), { areas: [LAVA], glow: glowingSquares(spec, undefined, textures, "volcanic", NO_UPLOADS) })).toBe("hidden");
  });
});

// ---------------------------------------------------------------------------------------------------- painters

const CELL = 8;

/** A 2D context mock that keeps a real RGBA buffer for put/getImageData (jsdom has no canvas). */
function canvas(width: number, height: number) {
  const buffer = new Uint8ClampedArray(width * height * 4);
  const special: Record<string, (...a: unknown[]) => unknown> = {
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray((w as number) * (h as number) * 4) }),
    putImageData: (img, x, y) => {
      const i = img as ImageData;
      for (let yy = 0; yy < i.height; yy++)
        for (let xx = 0; xx < i.width; xx++) {
          const gx = (x as number) + xx, gy = (y as number) + yy;
          if (gx < 0 || gy < 0 || gx >= width || gy >= height) continue;
          buffer.set(i.data.subarray((yy * i.width + xx) * 4, (yy * i.width + xx) * 4 + 4), (gy * width + gx) * 4);
        }
    },
    getImageData: (x, y, w, h) => {
      const ox = x as number, oy = y as number, rw = w as number, rh = h as number;
      const data = new Uint8ClampedArray(rw * rh * 4);
      for (let yy = 0; yy < rh; yy++) data.set(buffer.subarray(((oy + yy) * width + ox) * 4, ((oy + yy) * width + ox + rw) * 4), yy * rw * 4);
      return { width: rw, height: rh, data };
    },
    createRadialGradient: () => ({ addColorStop: () => undefined }),
  };
  const state: Record<string | symbol, unknown> = {};
  const ctx = new Proxy(state, {
    get: (t, p) => (typeof p !== "string" ? undefined : p in t ? t[p] : (...args: unknown[]) => special[p]?.(...args)),
    set: (t, p, v) => ((t[p] = v), true),
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, buffer };
}

/** Sum of r + g + b over the pixels of square (x, y). */
function squareLight(buffer: Uint8ClampedArray, mapW: number, x: number, y: number): number {
  let sum = 0;
  for (let py = y * CELL; py < (y + 1) * CELL; py++)
    for (let px = x * CELL; px < (x + 1) * CELL; px++) {
      const i = (py * mapW * CELL + px) * 4;
      sum += buffer[i]! + buffer[i + 1]! + buffer[i + 2]!;
    }
  return sum;
}

describe("glowing terrain: Classic painter (F6)", () => {
  const spec = { w: 12, h: 10, seed: 5, base: "stone", areas: [{ terrain: "lava", shape: "rect", x: 4, y: 4, w: 2.9, h: 1.9 }], objects: [] };

  it("a map without glowing terrain has no glow field", () => {
    const m = classicPrepareMap({ ...spec, areas: [{ ...spec.areas[0]!, terrain: "water" }] });
    expect("glow" in m).toBe(false);
  });

  it("lava squares are lifted, the glow fades into the next squares, far squares are untouched", () => {
    const m = classicPrepareMap(spec);
    expect(m.glow).toBeInstanceOf(Float32Array);
    const lit = canvas(12 * CELL, 10 * CELL);
    const plain = canvas(12 * CELL, 10 * CELL);
    classicPaintMap(lit.ctx, spec, { cell: CELL, grid: false, vignette: false });
    // The same terrain without the glow field: what the painter drew before F6.
    const unglowed: PaintPrepared = { ...m, glow: undefined };
    classicPaintMapRect(plain.ctx, unglowed, { x: 0, y: 0, w: m.w, h: m.h }, { cell: CELL, grid: false, vignette: false });
    expect(squareLight(lit.buffer, 12, 5, 4)).toBeGreaterThan(squareLight(plain.buffer, 12, 5, 4));
    expect(squareLight(lit.buffer, 12, 3, 4)).toBeGreaterThan(squareLight(plain.buffer, 12, 3, 4)); // halo next door
    expect(squareLight(lit.buffer, 12, 0, 0)).toBe(squareLight(plain.buffer, 12, 0, 0));
    expect(squareLight(lit.buffer, 12, 10, 8)).toBe(squareLight(plain.buffer, 12, 10, 8));
  });
});

/** A fake art source: every texture a flat mid-grey tile, so a lift shows as brighter pixels. */
const greyArt: SpriteArt = {
  sprite: () => null,
  shadow: () => null,
  texture: (_url, size) => {
    const out = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < out.length; i += 4) { out[i] = 120; out[i + 1] = 110; out[i + 2] = 100; out[i + 3] = 255; }
    return out;
  },
};

describe("glowing terrain: sprite painter (F6)", () => {
  const lavaSpec = (setting: string): SpritePaintSpec => ({
    w: 12, h: 10, seed: 5, base: "stone", setting, objects: [],
    areas: [{ terrain: "lava", shape: "rect", x: 4, y: 4, w: 2.9, h: 1.9 }],
  });

  it("the texture plan names the glowing textures; a map without them names none", () => {
    const m = classicPrepareMap(lavaSpec("volcanic"));
    const plan = planTextures(m, lavaSpec("volcanic").areas!, undefined, undefined, "volcanic", new Map());
    expect(plan.glow?.has(builtinSpriteUrl(BUILTIN_LOOKUP.get("volcanic/glowing-lava")!.art!))).toBe(true);
    const forest = { ...lavaSpec("forest"), areas: [{ terrain: "grass", shape: "rect", x: 4, y: 4, w: 2.9, h: 1.9 }] };
    expect("glow" in planTextures(classicPrepareMap(forest), forest.areas, undefined, undefined, "forest", new Map())).toBe(false);
  });

  it("glowing textures are drawn a little brighter than the same tile not glowing", () => {
    const lit = canvas(12 * CELL, 10 * CELL);
    spritePaintMap(lit.ctx, lavaSpec("volcanic"), { cell: CELL, grid: false, vignette: false, art: greyArt });
    // Stone (black volcanic rock etc.) and lava (glowing lava) share the grey tile: lava squares come out brighter.
    const lava = squareLight(lit.buffer, 12, 5, 4);
    const stone = squareLight(lit.buffer, 12, 0, 0);
    expect(lava).toBeGreaterThan(stone * 1.1);
    const flat = (120 + 110 + 100) * CELL * CELL;
    expect(Math.abs(stone - flat) / flat).toBeLessThan(0.12); // only the brightness variation, no lift
  });
});
