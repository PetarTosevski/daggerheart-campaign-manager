import { describe, expect, it } from "vitest";

import {
  CARRIED_LIGHT_REACH,
  DIM_PHASES,
  FOG_PAD_SQUARES,
  MAP_LIGHT_REACH,
  VISION_BASE_DEG,
  VISION_STEP_DEG,
  coneDeg,
  createView,
  decodeExplored,
  encodeExplored,
  exploredFrom,
  exploredGrows,
  exploredLength,
  lightOf,
  los,
  mergeExplored,
  pointLevel,
  prepareMap,
  tokenVisibility,
  visibleSquares,
  type CarriedLight,
  type FogMark,
  type VisionMapInput,
  type VisionToken,
} from "@/lib/domain/combat-map";
import { getCyclePhases } from "@/lib/domain/campaign-time";

const ME = "char-me";
const DAY = "Morning";
const NIGHT = "Deep Night";

/** My PC at (5, 10), facing east; eye at (5.5, 10.5). */
function me(light: CarriedLight = "none", face = 0): VisionToken {
  return { x: 5, y: 10, size: 1, face, side: "pc", characterId: ME, light };
}

function enemy(x: number, y: number, extra: Partial<VisionToken> = {}): VisionToken {
  return { x, y, size: 1, face: Math.PI, side: "enemy", ...extra };
}

function see(
  token: VisionToken,
  opts: {
    map?: Partial<VisionMapInput>;
    phase?: string;
    light?: CarriedLight;
    instinct?: number;
    tokens?: VisionToken[];
    fog?: Record<string, FogMark>;
    face?: number;
  } = {},
) {
  const map = prepareMap({ w: 30, h: 20, base: "grass", ...opts.map });
  const mine = me(opts.light, opts.face);
  const view = createView(
    map,
    { token: mine, characterId: ME, instinct: opts.instinct ?? 0 },
    { phase: opts.phase ?? DAY, tokens: [mine, token, ...(opts.tokens ?? [])], fog: opts.fog },
  );
  return tokenVisibility(view, token);
}

describe("vision cone (R6)", () => {
  it("is 70 + 15 x Instinct with named constants", () => {
    expect(VISION_BASE_DEG).toBe(70);
    expect(VISION_STEP_DEG).toBe(15);
    expect(coneDeg(0)).toBe(70);
    expect(coneDeg(-1)).toBe(55);
    expect(coneDeg(1)).toBe(85);
    expect(coneDeg(2)).toBe(100);
    expect(coneDeg(4)).toBe(130);
  });

  it("is capped at 180 and floored at 10", () => {
    expect(coneDeg(8)).toBe(180);
    expect(coneDeg(20)).toBe(180);
    expect(coneDeg(-5)).toBe(10);
    expect(coneDeg(Number.NaN)).toBe(70);
  });

  it("sees ahead inside the cone and not outside it", () => {
    expect(see(enemy(10, 12))).toBe("clear"); // about 22 degrees off the facing
    expect(see(enemy(10, 15))).toBe("hidden"); // about 42 degrees: outside 70
    expect(see(enemy(10, 15), { instinct: 2 })).toBe("clear"); // inside 100
  });

  it("never sees behind, even at the 180 cap", () => {
    expect(see(enemy(3, 10))).toBe("hidden");
    expect(see(enemy(4, 10), { instinct: 8 })).toBe("hidden"); // adjacent, straight behind
    expect(see(enemy(4, 8), { instinct: 8 })).toBe("hidden"); // behind and to the side
    expect(see(enemy(5, 5), { instinct: 8 })).toBe("clear"); // exactly sideways
    expect(see(enemy(5, 5), { instinct: 0 })).toBe("hidden");
  });

  it("follows the facing", () => {
    expect(see(enemy(3, 10), { face: Math.PI })).toBe("clear");
    expect(see(enemy(12, 10), { face: Math.PI })).toBe("hidden");
  });
});

describe("line of sight (R7)", () => {
  const wall = { terrain: "wall", shape: "rect", x: 8, y: 0, w: 1, h: 20 };

  it("a wall blocks sight", () => {
    expect(see(enemy(12, 10))).toBe("clear");
    expect(see(enemy(12, 10), { map: { areas: [wall] } })).toBe("hidden");
  });

  it("a wall painted over with floor no longer blocks", () => {
    const paint: Record<string, string> = {};
    for (let y = 0; y < 20; y++) paint[`8,${y}`] = "stone";
    expect(see(enemy(12, 10), { map: { areas: [wall], paint } })).toBe("clear");
  });

  it("a tree blocks sight, a bush does not, an overridden bush does", () => {
    const at = { x: 8, y: 10.5 };
    expect(see(enemy(12, 10), { map: { objects: [{ kind: "tree", r: 1.6, ...at }] } })).toBe("hidden");
    expect(see(enemy(12, 10), { map: { objects: [{ kind: "bush", r: 1, ...at }] } })).toBe("clear");
    expect(see(enemy(12, 10), { map: { objects: [{ kind: "bush", r: 1, sight: "block", ...at }] } })).toBe("hidden");
    expect(see(enemy(12, 10), { map: { objects: [{ kind: "tree", r: 1.6, sight: "cover", ...at }] } })).toBe("clear");
  });

  it("painted sight blockers block, also on an uploaded image whose terrain is ignored", () => {
    expect(see(enemy(12, 10), { map: { block: ["8,10"] } })).toBe("hidden");
    expect(see(enemy(12, 10), { map: { image: true, base: "wall" } })).toBe("clear");
    expect(see(enemy(12, 10), { map: { image: true, areas: [wall], block: ["8,10"] } })).toBe("hidden");
  });

  it("sees the face of a wall but not past it", () => {
    const map = prepareMap({ w: 30, h: 20, areas: [{ terrain: "wall", shape: "rect", x: 8, y: 0, w: 1, h: 20 }] });
    expect(los(map, 5.5, 10.5, 8.25, 10.5)).toBe(true);
    expect(los(map, 5.5, 10.5, 8.75, 10.5)).toBe(false);
    expect(los(map, 5.5, 10.5, 12.5, 10.5)).toBe(false);
    expect(los(map, 5.5, 10.5, 7.5, 3.5)).toBe(true);
  });
});

describe("light by phase (R8)", () => {
  it("only Nautical Twilight and Nightfall are dim; Nautical Dawn is day (board fix)", () => {
    expect([...DIM_PHASES].sort()).toEqual(["Nautical Twilight", "Nightfall"]);
    expect(lightOf("Nautical Dawn")).toBe("day");
    expect(lightOf("Nautical Twilight")).toBe("dim");
    expect(lightOf("Nightfall")).toBe("dim");
  });

  it("maps every campaign phase", () => {
    for (const phase of getCyclePhases("DAY")) {
      expect(lightOf(phase), phase).toBe(phase === "Nautical Twilight" ? "dim" : "day");
    }
    const night = getCyclePhases("NIGHT").map((p) => [p, lightOf(p)]);
    expect(night).toEqual([
      ["Nightfall", "dim"],
      ["Moonrise", "night"],
      ["Deep Night", "night"],
      ["Midnight", "night"],
      ["Witching Hour", "night"],
      ["Small Hours", "night"],
      ["Nautical Dawn", "day"],
    ]);
  });

  it("day, dawn and the dim phases show the whole cone to the map edge", () => {
    for (const phase of ["Dawn", "High Noon", "Nautical Dawn", "Nautical Twilight", "Nightfall"]) {
      expect(see(enemy(28, 10), { phase }), phase).toBe("clear");
    }
    expect(see(enemy(28, 10), { phase: NIGHT })).toBe("hidden");
  });
});

describe("light at night (R9, R10, Q2, Q3)", () => {
  const revealed = { revealedTo: [ME] };

  it("no light: clear in Melee, dim to Very Close, nothing beyond", () => {
    expect(CARRIED_LIGHT_REACH.none).toEqual([1, 3]);
    expect(see(enemy(6, 10), { phase: NIGHT })).toBe("clear");
    expect(see(enemy(8, 10), { phase: NIGHT })).toBe("hidden");
    expect(see(enemy(8, 10, revealed), { phase: NIGHT })).toBe("dim");
    expect(see(enemy(10, 10, revealed), { phase: NIGHT })).toBe("hidden");
  });

  it("torch and lantern: clear to Close, dim to Far (lantern = torch, Q2)", () => {
    for (const light of ["torch", "lantern"] as const) {
      expect(CARRIED_LIGHT_REACH[light]).toEqual([6, 12]);
      expect(see(enemy(11, 10), { phase: NIGHT, light }), light).toBe("clear");
      expect(see(enemy(15, 10), { phase: NIGHT, light }), light).toBe("hidden");
      expect(see(enemy(15, 10, revealed), { phase: NIGHT, light }), light).toBe("dim");
      expect(see(enemy(20, 10, revealed), { phase: NIGHT, light }), light).toBe("hidden");
    }
  });

  it("Alistair's Torch: clear to Far, nothing beyond", () => {
    expect(CARRIED_LIGHT_REACH.alistair).toEqual([12, 12]);
    expect(see(enemy(15, 10), { phase: NIGHT, light: "alistair" })).toBe("clear");
    expect(see(enemy(17, 10), { phase: NIGHT, light: "alistair" })).toBe("clear");
    expect(see(enemy(19, 10, revealed), { phase: NIGHT, light: "alistair" })).toBe("hidden");
  });

  it("wall torch (map object): like a torch, and only while lit", () => {
    expect(MAP_LIGHT_REACH.walltorch).toEqual([6, 12]);
    const lit = { kind: "walltorch", x: 15, y: 10.5, r: 0.6 };
    expect(see(enemy(17, 10), { phase: NIGHT, map: { objects: [lit] } })).toBe("clear");
    expect(see(enemy(25, 10, revealed), { phase: NIGHT, map: { objects: [lit] } })).toBe("dim");
    expect(see(enemy(25, 10), { phase: NIGHT, map: { objects: [lit] } })).toBe("hidden");
    expect(see(enemy(17, 10), { phase: NIGHT, map: { objects: [{ ...lit, lit: false }] } })).toBe("hidden");
  });

  it("campfire (map object): clear to 12, dim to 24", () => {
    expect(MAP_LIGHT_REACH.campfire).toEqual([12, 24]);
    const fire = { kind: "campfire", x: 15, y: 10.5, r: 1 };
    const map = { w: 44, h: 20, objects: [fire] };
    expect(see(enemy(25, 10), { phase: NIGHT, map })).toBe("clear");
    expect(see(enemy(37, 10, revealed), { phase: NIGHT, map })).toBe("dim");
    expect(see(enemy(40, 10, revealed), { phase: NIGHT, map })).toBe("hidden");
  });

  it("a light the viewer cannot see past a wall does not reveal anything", () => {
    const wall = { terrain: "wall", shape: "rect", x: 12, y: 0, w: 1, h: 20 };
    const fire = { kind: "campfire", x: 15, y: 10.5, r: 1 };
    expect(see(enemy(16, 10), { phase: NIGHT, map: { areas: [wall], objects: [fire] } })).toBe("hidden");
  });

  it("an enemy's carried torch lights the squares around it (Q3)", () => {
    expect(see(enemy(20, 10), { phase: NIGHT })).toBe("hidden");
    expect(see(enemy(20, 10, { light: "torch" }), { phase: NIGHT })).toBe("clear");
    const torchBearer = enemy(20, 12, { light: "torch" });
    expect(see(enemy(22, 10), { phase: NIGHT, tokens: [torchBearer] })).toBe("clear");
  });

  it("a carried light does not light around a wall", () => {
    const wall = { terrain: "wall", shape: "rect", x: 21, y: 0, w: 1, h: 20 };
    // The bearer is behind the wall; the square next to the viewer's side of the wall is out of its line.
    const bearer = enemy(24, 10, { light: "torch" });
    expect(see(enemy(19, 10), { phase: NIGHT, map: { areas: [wall] }, tokens: [bearer] })).toBe("hidden");
  });
});

describe("token visibility (R10, R11, Q4)", () => {
  it("other PCs are always shown, even in the dark or behind a wall (Q4)", () => {
    const pc: VisionToken = { x: 25, y: 3, size: 1, side: "pc", characterId: "char-other" };
    expect(see(pc, { phase: NIGHT })).toBe("clear");
    expect(see(pc, { map: { areas: [{ terrain: "wall", shape: "rect", x: 8, y: 0, w: 1, h: 20 }] } })).toBe("clear");
  });

  it("another PC's vision is not shared (R11, Q4)", () => {
    const other: VisionToken = { x: 22, y: 10, size: 1, face: 0, side: "pc", characterId: "char-other" };
    expect(see(enemy(23, 10), { phase: NIGHT, tokens: [other] })).toBe("hidden");
  });

  it("allies and neutral tokens follow R10 like enemies", () => {
    expect(see(enemy(8, 10, { side: "ally" }), { phase: NIGHT })).toBe("hidden");
    expect(see(enemy(8, 10, { side: "neutral", revealedTo: [ME] }), { phase: NIGHT })).toBe("dim");
  });

  it("a reveal to another character does not count for me", () => {
    expect(see(enemy(8, 10, { revealedTo: ["char-other"] }), { phase: NIGHT })).toBe("hidden");
  });

  it("a revealed token out of sight is hidden (R11)", () => {
    const wall = { terrain: "wall", shape: "rect", x: 7, y: 0, w: 1, h: 20 };
    expect(see(enemy(8, 10, { revealedTo: [ME] }), { phase: NIGHT, map: { areas: [wall] } })).toBe("hidden");
  });

  it("a large token is seen when any of its squares is seen", () => {
    const wall = { terrain: "wall", shape: "rect", x: 8, y: 9, w: 1, h: 2 };
    expect(see(enemy(12, 10, { size: 1 }), { map: { areas: [wall] } })).toBe("hidden");
    expect(see(enemy(12, 10, { size: 3 }), { map: { areas: [wall] } })).toBe("clear");
  });

  it("GM fog marks force hide and reveal (R12)", () => {
    const wall = { terrain: "wall", shape: "rect", x: 8, y: 0, w: 1, h: 20 };
    expect(see(enemy(12, 10), { fog: { "12,10": "hide" } })).toBe("hidden");
    expect(see(enemy(12, 10), { map: { areas: [wall] }, fog: { "12,10": "reveal" } })).toBe("clear");
  });
});

describe("visibleSquares and pointLevel", () => {
  it("returns per-half-square levels for the whole map", () => {
    const map = prepareMap({ w: 30, h: 20 });
    const mine = me("torch");
    const view = createView(map, { token: mine, characterId: ME, instinct: 0 }, { phase: NIGHT, tokens: [mine] });
    const grid = visibleSquares(view);
    expect(grid).toMatchObject({ sw: 60, sh: 40, scale: 2 });
    const at = (x: number, y: number) => grid.levels[Math.floor(y * 2) * 60 + Math.floor(x * 2)];
    expect(at(5.25, 10.25)).toBe(2); // own square
    expect(at(4.25, 10.25)).toBe(0); // behind
    expect(at(9.25, 10.25)).toBe(2); // clear band
    expect(at(14.25, 10.25)).toBe(1); // dim band
    expect(at(20.25, 10.25)).toBe(0); // dark
    expect(pointLevel(view, 14.25, 10.25)).toBe(1);
    expect(pointLevel(view, -3, 10)).toBe(0);
  });

  it("a map light the viewer can see has a level > 0 (toggleLight check, C7)", () => {
    const map = prepareMap({ w: 30, h: 20, objects: [{ kind: "campfire", x: 20, y: 10.5, lit: false }] });
    const mine = me();
    const view = createView(map, { token: mine, characterId: ME, instinct: 0 }, { phase: DAY, tokens: [mine] });
    expect(pointLevel(view, 20, 10.5)).toBe(2);
  });

  it("exports the fog pad for hidden map edges (Q1)", () => {
    expect(FOG_PAD_SQUARES).toBe(24);
  });
});

describe("explored areas (R11)", () => {
  it("encodes, decodes, merges and detects growth", () => {
    const len = exploredLength(12, 10);
    expect(len).toBe(24 * 20);
    const a = new Uint8Array(len);
    a[0] = 1;
    a[7] = 1;
    a[len - 1] = 1;
    const text = encodeExplored(a);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(text.length).toBe(Math.ceil(len / 6));
    expect(decodeExplored(text, len)).toEqual(a);
    const b = new Uint8Array(len);
    b[3] = 1;
    const merged = mergeExplored(a, b);
    expect([merged[0], merged[3], merged[7], merged[1]]).toEqual([1, 1, 1, 0]);
    expect(exploredGrows(a, merged)).toBe(true);
    expect(exploredGrows(merged, a)).toBe(false);
    expect(decodeExplored("", len).every((v) => v === 0)).toBe(true);
  });

  it("builds the explored mask from a vision grid", () => {
    const map = prepareMap({ w: 12, h: 10 });
    const mine: VisionToken = { x: 1, y: 5, size: 1, face: 0, side: "pc", characterId: ME };
    const view = createView(map, { token: mine, characterId: ME, instinct: 0 }, { phase: DAY });
    const mask = exploredFrom(visibleSquares(view));
    expect(mask.length).toBe(exploredLength(12, 10));
    expect(mask.some((v) => v === 1)).toBe(true);
    expect(mask.every((v) => v === 0 || v === 1)).toBe(true);
  });
});

describe("speed (runs inside Convex queries)", () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function bigScene() {
    const r = rng(42);
    const kinds = [
      ...Array(100).fill("tree"),
      ...Array(50).fill("boulder"),
      ...Array(60).fill("bush"),
      ...Array(40).fill("crate"),
      ...Array(25).fill("campfire"),
      ...Array(25).fill("walltorch"),
    ] as string[];
    const objects = kinds.map((kind) => ({ kind, x: r() * 44, y: r() * 32, r: 0.6 + r() * 1.4 }));
    const areas = [
      { terrain: "wall", shape: "border", width: 1 },
      { terrain: "water", shape: "ellipse", x: 30, y: 8, rx: 5, ry: 3 },
      { terrain: "wall", shape: "rect", x: 10, y: 4, w: 1, h: 10 },
      { terrain: "wall", shape: "poly", points: [[30, 20], [36, 22], [33, 27]] },
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
    return { ms, shown, seen: grid.levels.reduce((n, l) => n + (l > 0 ? 1 : 0), 0) };
  }

  function median(xs: number[]) {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }

  it("computes one viewer's visibility on a 44 x 32 map with 300 objects in under 50 ms", () => {
    run(NIGHT); // warm up the JIT
    run(DAY);
    const results: Record<string, number> = {};
    for (const phase of [DAY, NIGHT]) {
      const times: number[] = [];
      for (let i = 0; i < 9; i++) {
        const { ms, shown, seen } = run(phase);
        expect(shown).toBeGreaterThan(0);
        expect(seen).toBeGreaterThan(0);
        times.push(ms);
      }
      results[phase] = median(times);
    }
    console.info(`combat-map vision median: day ${results[DAY].toFixed(2)} ms, night ${results[NIGHT].toFixed(2)} ms`);
    expect(results[DAY]).toBeLessThan(50);
    expect(results[NIGHT]).toBeLessThan(50);
  });
});
