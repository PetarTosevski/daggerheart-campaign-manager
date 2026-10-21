import { describe, expect, it } from "vitest";

import {
  FAINT_GLOW_REACH,
  LIGHT_TRAITS,
  MAP_LIGHT_REACH,
  SAMPLES_PER_SQUARE,
  createView,
  givesLight,
  isLit,
  los,
  mapLightReach,
  prepareMap,
  sightOf,
  tokenVisibility,
  visibleSquares,
  type PreparedMap,
  type VisionMapInput,
  type VisionObject,
  type VisionToken,
  type VisionTraits,
} from "@/lib/domain/combat-map";

const ME = "char-me";
const DAY = "Morning";
const NIGHT = "Deep Night";
const S = SAMPLES_PER_SQUARE;

/** My PC at (5, 10), facing east; eye at (5.5, 10.5); no carried light. */
const mine: VisionToken = { x: 5, y: 10, size: 1, face: 0, side: "pc", characterId: ME, light: "none" };

function enemy(x: number, y: number, extra: Partial<VisionToken> = {}): VisionToken {
  return { x, y, size: 1, face: Math.PI, side: "enemy", ...extra };
}

function see(token: VisionToken, objects: VisionObject[], phase = DAY, map: Partial<VisionMapInput> = {}) {
  const prepared = prepareMap({ w: 30, h: 20, base: "grass", objects, ...map });
  const view = createView(prepared, { token: mine, characterId: ME, instinct: 2 }, { phase, tokens: [mine, token] });
  return tokenVisibility(view, token);
}

const traits = (t: Partial<VisionTraits>): VisionTraits => ({ sight: "none", light: "none", footprint: "circle", w: 1, h: 1, ...t });

/** Whether the sample containing the point (in squares) blocks sight. */
const blockedAt = (map: PreparedMap, x: number, y: number) => map.blocked[Math.floor(y * S) * map.sw + Math.floor(x * S)] === 1;

describe("faint glow (sprite-packs Q1 = b)", () => {
  it("is one named constant: clear to Melee (1), dim to Very Close (3), keyed faintglow next to the R9 lights", () => {
    expect(FAINT_GLOW_REACH).toEqual([1, 3]);
    expect(MAP_LIGHT_REACH.faintglow).toBe(FAINT_GLOW_REACH);
    expect(LIGHT_TRAITS).toEqual(["none", "faintglow", "torch", "campfire"]);
  });

  it("a candle sprite clears its own square and dims to 3 squares at night; dim hides tokens unless revealed (R10)", () => {
    const candle: VisionObject = { kind: "crystal", x: 15.5, y: 10.5, traits: traits({ light: "faintglow" }) };
    expect(see(enemy(15, 10), [], NIGHT)).toBe("hidden");
    expect(see(enemy(15, 10), [candle], NIGHT)).toBe("clear");
    expect(see(enemy(16, 10), [candle], NIGHT)).toBe("clear"); // 1 square away: inside clear + slack
    expect(see(enemy(17, 10), [candle], NIGHT)).toBe("hidden"); // dim band
    expect(see(enemy(17, 10, { revealedTo: [ME] }), [candle], NIGHT)).toBe("dim");
    expect(see(enemy(20, 10, { revealedTo: [ME] }), [candle], NIGHT)).toBe("hidden"); // beyond 3
  });

  it("is switchable like the other map lights", () => {
    const candle: VisionObject = { kind: "crystal", x: 15.5, y: 10.5, traits: traits({ light: "faintglow" }) };
    expect(givesLight(candle)).toBe(true);
    expect(isLit(candle)).toBe(true);
    expect(isLit({ ...candle, lit: false })).toBe(false);
    expect(see(enemy(15, 10), [{ ...candle, lit: false }], NIGHT)).toBe("hidden");
  });
});

describe("sight precedence (D3): override, then traits, then the kind", () => {
  it("sightOf reads the traits between the override and the R7 default", () => {
    expect(sightOf({ kind: "bush" })).toBe("cover");
    expect(sightOf({ kind: "bush", traits: { sight: "block" } })).toBe("block");
    expect(sightOf({ kind: "bush", sight: "none", traits: { sight: "block" } })).toBe("none");
    expect(sightOf({ kind: "tree", traits: { sight: "none" } })).toBe("none");
    expect(sightOf({ kind: "tree", traits: null })).toBe("block");
  });

  it("a sprite tree blocks sight", () => {
    const oak: VisionObject = { kind: "tree", x: 9, y: 10.5, traits: traits({ sight: "block", w: 2, h: 2 }) };
    expect(see(enemy(13, 10), [])).toBe("clear");
    expect(see(enemy(13, 10), [oak])).toBe("hidden");
  });

  it("a sprite pool does not block, even on a blocking Classic fallback", () => {
    const pool: VisionObject = { kind: "boulder", x: 9, y: 10.5, r: 1, traits: traits({ sight: "none", w: 2, h: 2 }) };
    expect(see(enemy(13, 10), [{ kind: "boulder", x: 9, y: 10.5, r: 1 }])).toBe("hidden");
    expect(see(enemy(13, 10), [pool])).toBe("clear");
  });

  it("a cover-only sprite never blocks sight", () => {
    const counter: VisionObject = { kind: "table", x: 9, y: 10.5, traits: traits({ sight: "cover", footprint: "rect", w: 2, h: 1 }) };
    expect(see(enemy(13, 10), [counter])).toBe("clear");
  });

  it("the GM's override beats the manifest both ways", () => {
    const oak: VisionObject = { kind: "tree", x: 9, y: 10.5, traits: traits({ sight: "block", w: 2, h: 2 }) };
    expect(see(enemy(13, 10), [{ ...oak, sight: "none" }])).toBe("clear");
    const rug: VisionObject = { kind: "bones", x: 9, y: 10.5, traits: traits({ sight: "none", w: 2, h: 2 }) };
    expect(see(enemy(13, 10), [{ ...rug, sight: "block" }])).toBe("hidden");
  });
});

describe("rect footprints (D4)", () => {
  const wallSection = (rot: number, extra: Partial<VisionObject> = {}): VisionObject => ({
    kind: "pillar",
    x: 15,
    y: 10,
    rot,
    traits: traits({ sight: "block", footprint: "rect", w: 4, h: 1 }),
    ...extra,
  });

  it("blocks exactly the w x h rectangle, unrotated", () => {
    const map = prepareMap({ w: 30, h: 20, objects: [wallSection(0)] });
    expect(blockedAt(map, 13.25, 10)).toBe(true);
    expect(blockedAt(map, 16.75, 10)).toBe(true);
    expect(blockedAt(map, 15, 9.75)).toBe(true);
    expect(blockedAt(map, 12.75, 10)).toBe(false);
    expect(blockedAt(map, 17.25, 10)).toBe(false);
    expect(blockedAt(map, 15, 10.75)).toBe(false);
    expect(blockedAt(map, 15, 9.25)).toBe(false);
    let count = 0;
    for (const b of map.blocked) count += b;
    expect(count).toBe(4 * S * 1 * S);
  });

  it("a rotated wall section blocks along its length only", () => {
    const flat = prepareMap({ w: 30, h: 20, objects: [wallSection(0)] });
    const turned = prepareMap({ w: 30, h: 20, objects: [wallSection(Math.PI / 2)] });
    // Unrotated: 4 squares east-west, 1 north-south.
    expect(los(flat, 15, 5, 15, 15)).toBe(false); // across it
    expect(los(flat, 5, 8, 25, 8)).toBe(true); // beside it, parallel
    expect(los(flat, 11, 10, 5, 10)).toBe(true); // past its end
    // Turned 90 degrees: 1 square east-west, 4 north-south (y 8..12).
    expect(los(turned, 5, 10, 25, 10)).toBe(false);
    expect(los(turned, 5, 13, 25, 13)).toBe(true);
    expect(los(turned, 15, 5, 15, 7.5)).toBe(true);
    expect(blockedAt(turned, 15, 8.25)).toBe(true);
    expect(blockedAt(turned, 15, 11.75)).toBe(true);
    expect(blockedAt(turned, 13.25, 10)).toBe(false);
  });

  it("a diagonal section blocks its own diagonal, not the bounding box corners", () => {
    const diag = prepareMap({ w: 30, h: 20, objects: [wallSection(Math.PI / 4)] });
    expect(blockedAt(diag, 15 + 1.2, 10 + 1.2)).toBe(true); // on the long axis
    expect(blockedAt(diag, 15 + 1.2, 10 - 1.2)).toBe(false); // bounding-box corner
  });

  it("r scales the rectangle (default r = max(w, h) / 2)", () => {
    const big = prepareMap({ w: 30, h: 20, objects: [wallSection(0, { r: 4 })] }); // twice the default 2
    expect(blockedAt(big, 11.25, 10)).toBe(true);
    expect(blockedAt(big, 18.75, 10.75)).toBe(true);
    expect(blockedAt(big, 10.75, 10)).toBe(false);
  });

  it("a rect footprint that does not block (bridge) marks nothing", () => {
    const bridge = wallSection(0, { traits: traits({ sight: "none", footprint: "rect", w: 2, h: 1 }) });
    const map = prepareMap({ w: 30, h: 20, objects: [bridge] });
    expect(map.blocked.every((b) => b === 0)).toBe(true);
  });

  it("circle footprints keep blockRadiusFactor and default r = max(w, h) / 2", () => {
    const oak = prepareMap({ w: 30, h: 20, objects: [{ kind: "tree", x: 15, y: 10, traits: traits({ sight: "block", w: 2, h: 2 }) }] });
    // r = 1, tree factor 0.8: radius 0.8.
    expect(blockedAt(oak, 15.6, 10)).toBe(true);
    expect(blockedAt(oak, 16.1, 10)).toBe(false);
    const classic = prepareMap({ w: 30, h: 20, objects: [{ kind: "tree", x: 15, y: 10, r: 1 }] });
    expect(Array.from(oak.blocked)).toEqual(Array.from(classic.blocked));
  });
});

describe("sprite lights (Q1, D2)", () => {
  it("mapLightReach: the trait wins over the kind; none means no light", () => {
    expect(mapLightReach({ kind: "torch" })).toEqual([6, 12]);
    expect(mapLightReach({ kind: "crate" })).toBeNull();
    expect(mapLightReach({ kind: "crate", traits: { light: "torch" } })).toEqual([6, 12]);
    expect(mapLightReach({ kind: "torch", traits: { light: "campfire" } })).toEqual([12, 24]);
    expect(mapLightReach({ kind: "torch", traits: { light: "none" } })).toBeNull();
    expect(mapLightReach({ kind: "crystal", traits: { light: "faintglow" } })).toEqual([1, 3]);
  });

  it("a brazier sprite lights like a torch at night", () => {
    const brazier: VisionObject = { kind: "torch", x: 15.5, y: 10.5, traits: traits({ light: "torch" }) };
    const classic: VisionObject = { kind: "torch", x: 15.5, y: 10.5 };
    for (const [x, revealed] of [[18, false], [21, false], [25, true], [28, true]] as const) {
      const t = enemy(x, 10, revealed ? { revealedTo: [ME] } : {});
      expect(see(t, [brazier], NIGHT), `x=${x}`).toBe(see(t, [classic], NIGHT));
    }
    expect(see(enemy(20, 10), [brazier], NIGHT)).toBe("clear");
    expect(see(enemy(20, 10), [], NIGHT)).toBe("hidden");
    // A non-light Classic fallback with a torch trait lights too.
    expect(see(enemy(20, 10), [{ ...brazier, kind: "pillar", traits: traits({ light: "torch" }) }], NIGHT)).toBe("clear");
  });

  it("a campfire sprite lights like a campfire", () => {
    const hearth: VisionObject = { kind: "campfire", x: 15.5, y: 10.5, traits: traits({ light: "campfire", w: 2, h: 1, footprint: "rect" }) };
    const map = { w: 44 };
    expect(see(enemy(26, 10), [hearth], NIGHT, map)).toBe("clear");
    expect(see(enemy(36, 10, { revealedTo: [ME] }), [hearth], NIGHT, map)).toBe("dim");
  });

  it("a candle sprite with the default light none lights nothing (Q1 a-list)", () => {
    const candle: VisionObject = { kind: "crystal", x: 15.5, y: 10.5, traits: traits({ light: "none" }) };
    expect(isLit(candle)).toBe(false);
    expect(see(enemy(15, 10), [candle], NIGHT)).toBe("hidden");
    expect(see(enemy(15, 10, { revealedTo: [ME] }), [candle], NIGHT)).toBe("hidden");
  });
});

describe("maps without traits are unchanged (E5)", () => {
  it("traits equal to the Classic behaviour give the same grid and lights", () => {
    const plain: VisionObject[] = [
      { kind: "tree", x: 8, y: 6, r: 1.6 },
      { kind: "boulder", x: 20, y: 12, r: 1.2 },
      { kind: "bush", x: 12, y: 15, r: 0.8 },
      { kind: "campfire", x: 18, y: 4, r: 1 },
      { kind: "walltorch", x: 3, y: 3, r: 0.6, lit: false },
    ];
    const lightOfKind = (k: string) => (k === "campfire" ? "campfire" : k === "walltorch" ? "torch" : "none") as VisionTraits["light"];
    const withTraits = plain.map((o) => ({ ...o, traits: traits({ sight: sightOf(o), light: lightOfKind(o.kind), w: 2, h: 2 }) }));
    const a = prepareMap({ w: 30, h: 20, objects: plain });
    const b = prepareMap({ w: 30, h: 20, objects: withTraits });
    expect(Array.from(b.blocked)).toEqual(Array.from(a.blocked));
    expect(b.lights).toEqual(a.lights);
  });
});

describe("speed with sprite traits (E5: 44 x 32, 300 objects, one viewer < 50 ms)", () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function bigScene() {
    const r = rng(7);
    const make = (n: number, kind: string, t: Partial<VisionTraits>, rect = false): VisionObject[] =>
      Array.from({ length: n }, () => ({
        kind,
        x: r() * 44,
        y: r() * 32,
        r: rect ? undefined : 0.6 + r() * 1.4,
        rot: rect ? r() * Math.PI : 0,
        traits: traits(t),
      }));
    const objects: VisionObject[] = [
      ...make(90, "tree", { sight: "block", w: 2, h: 2 }),
      ...make(40, "pillar", { sight: "block", footprint: "rect", w: 2, h: 1 }, true),
      ...make(30, "boulder", { sight: "block", w: 1, h: 1 }),
      ...make(50, "bush", { sight: "cover", w: 1, h: 1 }),
      ...make(20, "table", { sight: "cover", footprint: "rect", w: 2, h: 1 }, true),
      ...make(20, "bones", { sight: "none", w: 2, h: 2 }),
      ...make(15, "campfire", { light: "campfire", w: 2, h: 2 }),
      ...make(15, "torch", { light: "torch" }),
      ...make(20, "crystal", { light: "faintglow" }),
    ];
    expect(objects).toHaveLength(300);
    const areas = [
      { terrain: "wall", shape: "border", width: 1 },
      { terrain: "water", shape: "ellipse", x: 30, y: 8, rx: 5, ry: 3 },
      { terrain: "wall", shape: "rect", x: 10, y: 4, w: 1, h: 10 },
      { terrain: "path", shape: "path", points: [[0, 16], [22, 18], [44, 15]], width: 3 },
    ];
    const tokens: VisionToken[] = Array.from({ length: 80 }, (_, i) => ({
      x: Math.floor(r() * 43),
      y: Math.floor(r() * 31),
      size: i % 10 === 0 ? 2 : 1,
      side: i < 5 ? "pc" : "enemy",
      characterId: i < 5 ? `char-${i}` : null,
      light: i % 7 === 0 ? "torch" : "none",
      revealedTo: [],
    }));
    const viewer: VisionToken = { x: 22, y: 16, size: 1, face: 0.3, side: "pc", characterId: ME, light: "torch" };
    return { input: { w: 44, h: 32, base: "grass", areas, objects }, tokens: [viewer, ...tokens], viewer };
  }

  function run(phase: string) {
    const { input, tokens, viewer } = bigScene();
    const t0 = performance.now();
    const map = prepareMap(input);
    const view = createView(map, { token: viewer, characterId: ME, instinct: 8 }, { phase, tokens });
    const grid = visibleSquares(view);
    let shown = 0;
    for (const t of tokens) if (tokenVisibility(view, t) !== "hidden") shown++;
    const ms = performance.now() - t0;
    return { ms, shown, seen: grid.levels.reduce((n, l) => n + (l > 0 ? 1 : 0), 0), lights: map.lights.length };
  }

  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

  it("computes one viewer's visibility with 300 sprite objects in under 50 ms", () => {
    run(NIGHT);
    run(DAY);
    const results: Record<string, number> = {};
    for (const phase of [DAY, NIGHT]) {
      const times: number[] = [];
      for (let i = 0; i < 9; i++) {
        const { ms, shown, seen, lights } = run(phase);
        expect(shown).toBeGreaterThan(0);
        expect(seen).toBeGreaterThan(0);
        expect(lights).toBe(50);
        times.push(ms);
      }
      results[phase] = median(times);
    }
    console.info(`combat-map vision with sprite traits, median: day ${results[DAY].toFixed(2)} ms, night ${results[NIGHT].toFixed(2)} ms`);
    expect(results[DAY]).toBeLessThan(50);
    expect(results[NIGHT]).toBeLessThan(50);
  });
});
