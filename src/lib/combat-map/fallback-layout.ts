// Keyword fallback layout (D9 tracer C2): the board's CMAP.generate (reference/designs/project/Combat.dc.html).
// Turns the GM's description into a usable layout without Claude: ship deck, cavern, dungeon or ruins, and outdoor
// scenes (forest, camp, snow, swamp, coast, river, road, cliff...). Pure and deterministic for a seed.
//
// Deviations from the board (deliberate):
//   - Light objects are "walltorch" (the map light of R9) instead of the board's legacy "torch".
//   - Optional keys are omitted instead of set to undefined, and every number is finite, so the result passes
//     C1's spec schema as it is.
//   - The caller may fix the height as well as the width (the app's sizes are 22x15, 30x20 and 40x27).

import { rasterize, rng, type TerrainId } from "./raster";

export type LayoutShape = "rect" | "ellipse" | "poly" | "path" | "border";
export type LayoutPoint = [number, number];

export interface LayoutArea {
  terrain: TerrainId;
  shape: LayoutShape;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  rx?: number;
  ry?: number;
  width?: number;
  points?: LayoutPoint[];
}

export type LayoutObjectKind =
  | "tree" | "bush" | "deadtree" | "rock" | "boulder" | "tent" | "campfire" | "log" | "crate" | "barrel" | "chest"
  | "pillar" | "statue" | "rubble" | "mast" | "mushroom" | "walltorch" | "crystal" | "bones" | "hull";

export interface LayoutObject {
  kind: LayoutObjectKind;
  x: number;
  y: number;
  r: number;
  rot?: number;
  len?: number;
  span?: number;
  variant?: string;
  points?: LayoutPoint[];
}

export interface FallbackLayout {
  w: number;
  h: number;
  seed: number;
  base: TerrainId;
  plankV: boolean;
  title: string;
  areas: LayoutArea[];
  objects: LayoutObject[];
}

export interface FallbackOptions {
  seed?: number;
  /** Width in squares (12..44). Default from the description: huge 36, small 22, else 30. */
  w?: number;
  /** Height in squares (10..32). Default round(w x 0.66). */
  h?: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const round2 = (v: number) => Math.round(v * 100) / 100;

export const generateFallbackLayout = (prompt: string, opts: FallbackOptions = {}): FallbackLayout => {
  const p = String(prompt || "").toLowerCase();
  const seed = (opts.seed || 7) | 0;
  const R = rng(seed);
  const has = (re: RegExp) => re.test(p);
  const W = clamp(Math.round(opts.w || (has(/\b(huge|large|big|vast)\b/) ? 36 : has(/\b(small|tight|tiny|cramped)\b/) ? 22 : 30)), 12, 44);
  const H = clamp(Math.round(opts.h || W * 0.66), 10, 32);
  const spec: FallbackLayout = { w: W, h: H, seed, base: "grass", plankV: false, areas: [], objects: [], title: "" };
  const A = (a: LayoutArea) => { spec.areas.push(a); };
  const O = (o: LayoutObject) => { spec.objects.push(o); };
  const rx = (a: number, b: number) => a + R() * (b - a);
  const free = (x: number, y: number, r: number) => spec.objects.every((o) => Math.hypot(o.x - x, o.y - y) > (o.r || 1) + r);
  const scatter = (kind: LayoutObjectKind, n: number, extra: { r: number; variant?: string }, inside?: (x: number, y: number) => boolean) => {
    let tries = 0;
    while (n > 0 && tries++ < 400) {
      const x = rx(1, W - 1), y = rx(1, H - 1);
      if (inside && !inside(x, y)) continue;
      if (!free(x, y, extra.r * 0.8)) continue;
      const o: LayoutObject = { kind, x, y, r: extra.r };
      if (extra.variant) o.variant = extra.variant;
      O(o);
      n--;
    }
  };
  const ring = (cx: number, cy: number, r0: number) => (x: number, y: number) => Math.hypot((x - cx) / 1.15, y - cy) > r0;
  const cx = W / 2 + rx(-2, 2), cy = H / 2 + rx(-1.5, 1.5);
  const finish = (title: string): FallbackLayout => {
    spec.title = title;
    spec.areas = spec.areas.slice(0, 60);
    spec.objects = spec.objects.slice(0, 300).map((o) => ({ ...o, x: round2(o.x), y: round2(o.y) }));
    return spec;
  };

  if (has(/\b(ship|boat|deck|galleon|sail|vessel)\b/)) {
    spec.base = "deep";
    const L = W * 0.72, B = H * 0.38, x0 = (W - L) / 2, y0 = H / 2;
    O({ kind: "hull", x: x0 + L / 2, y: y0, r: 1, points: [[x0, y0 - B / 2 + 0.4], [x0 + 0.5, y0 - B / 2], [x0 + L * 0.72, y0 - B / 2], [x0 + L * 0.92, y0 - B * 0.3], [x0 + L, y0], [x0 + L * 0.92, y0 + B * 0.3], [x0 + L * 0.72, y0 + B / 2], [x0 + 0.5, y0 + B / 2], [x0, y0 + B / 2 - 0.4]] });
    [0.22, 0.5, 0.72].forEach((f) => O({ kind: "mast", x: x0 + L * f, y: y0, r: 1, span: B * 1.1 }));
    const onDeck = (x: number, y: number) => x > x0 + 1 && x < x0 + L - 2 && Math.abs(y - y0) < B / 2 - 1;
    scatter("barrel", 4, { r: 0.8 }, onDeck);
    scatter("crate", 3, { r: 0.8 }, onDeck);
    return finish("Ship deck at sea");
  }

  if (has(/\b(cave|cavern|tunnel|mine|underground|grotto|lair)\b/)) {
    spec.base = "wall";
    let x = 2, y = H / 2;
    const chambers: [number, number, number][] = [];
    for (let i = 0; i < 5; i++) {
      const nx = 3 + ((W - 6) * (i + 1)) / 5, ny = rx(3, H - 3);
      A({ terrain: "cave", shape: "path", points: [[x, y], [nx, ny]], width: rx(2.4, 3.6) });
      const r = rx(2.2, 4);
      A({ terrain: "cave", shape: "ellipse", x: nx, y: ny, rx: r * 1.2, ry: r });
      chambers.push([nx, ny, r]);
      x = nx; y = ny;
    }
    const [bx, by, br] = chambers[Math.floor(R() * chambers.length)];
    A({ terrain: "cave", shape: "ellipse", x: bx, y: by, rx: br + 2, ry: br + 1.5 });
    if (has(/\b(water|pool|lake|river|underground lake)\b/) || R() < 0.4) A({ terrain: "water", shape: "ellipse", x: bx + 1, y: by, rx: br * 0.6, ry: br * 0.45 });
    if (has(/\blava|magma|fire\b/)) A({ terrain: "lava", shape: "ellipse", x: bx, y: by + 1, rx: br * 0.5, ry: br * 0.35 });
    const inCave = (px: number, py: number) => chambers.some(([qx, qy, qr]) => Math.hypot((px - qx) / 1.2, py - qy) < qr - 0.6);
    scatter("rock", 7, { r: 0.8 }, inCave);
    scatter("rubble", 3, { r: 1 }, inCave);
    if (has(/crystal|glow|mushroom|fung/)) { scatter("crystal", 4, { r: 0.6 }, inCave); scatter("mushroom", 5, { r: 0.6 }, inCave); }
    if (has(/bone|lair|den|beast|dragon/)) scatter("bones", 4, { r: 0.8 }, inCave);
    if (has(/torch|camp|bandit/)) scatter("walltorch", 3, { r: 0.5 }, inCave);
    return finish("Cavern");
  }

  if (has(/\b(dungeon|crypt|tomb|temple|hall|castle|keep|room|chamber|vault|ruin|ruins|shrine)\b/)) {
    const ruin = has(/ruin|overgrown|shrine/);
    spec.base = ruin ? "grass" : "wall";
    const rooms: [number, number, number, number][] = [];
    const n = ruin ? 2 : 3 + Math.floor(R() * 2);
    for (let i = 0; i < n; i++) {
      const w = rx(6, 11), h = rx(5, 8);
      const x = rx(1.5, W - w - 1.5), y = rx(1.5, H - h - 1.5);
      A({ terrain: "stone", shape: "rect", x, y, w, h });
      rooms.push([x, y, w, h]);
    }
    for (let i = 1; i < rooms.length; i++) {
      const a = rooms[i - 1], b = rooms[i];
      A({ terrain: "stone", shape: "path", points: [[a[0] + a[2] / 2, a[1] + a[3] / 2], [b[0] + b[2] / 2, a[1] + a[3] / 2], [b[0] + b[2] / 2, b[1] + b[3] / 2]], width: 2.2 });
    }
    rooms.forEach(([x, y, w, h]) => {
      if (w > 7) {
        O({ kind: "pillar", x: x + 1.5, y: y + 1.5, r: 0.9 }); O({ kind: "pillar", x: x + w - 1.5, y: y + 1.5, r: 0.9 });
        O({ kind: "pillar", x: x + 1.5, y: y + h - 1.5, r: 0.9 }); O({ kind: "pillar", x: x + w - 1.5, y: y + h - 1.5, r: 0.9 });
      }
    });
    const inRoom = (px: number, py: number) => rooms.some(([x, y, w, h]) => px > x + 1 && px < x + w - 1 && py > y + 1 && py < y + h - 1);
    if (has(/statue|temple|shrine/)) { const r0 = rooms[0]; O({ kind: "statue", x: r0[0] + r0[2] / 2, y: r0[1] + r0[3] / 2, r: 1.2 }); }
    scatter("rubble", ruin ? 6 : 3, { r: 1 }, inRoom);
    if (has(/chest|treasure|vault/)) scatter("chest", 2, { r: 0.8 }, inRoom);
    scatter("walltorch", ruin ? 0 : 4, { r: 0.5 }, inRoom);
    if (has(/crypt|tomb|bone|undead/)) scatter("bones", 4, { r: 0.8 }, inRoom);
    if (ruin) {
      const outside = (x: number, y: number) => !rooms.some(([rx0, ry0, w, h]) => x > rx0 - 1 && x < rx0 + w + 1 && y > ry0 - 1 && y < ry0 + h + 1);
      if (has(/withered|dead|blight|wither|corrupt|haunted/)) scatter("deadtree", 4, { r: 1.8 }, outside);
      scatter("tree", 8, { r: 1.6, variant: has(/autumn|fall/) ? "autumn" : undefined }, outside);
      scatter("bush", 5, { r: 0.9 }, outside);
    }
    return finish(ruin ? "Overgrown ruins" : "Dungeon halls");
  }

  // outdoor scenes
  spec.base = has(/\b(snow|winter|frozen|ice|tundra)\b/) ? "snow" : has(/\b(beach|coast|shore|desert|dune)\b/) ? "sand" : has(/\b(swamp|marsh|bog|fen|mire)\b/) ? "swamp" : "grass";
  if (has(/\b(beach|coast|shore)\b/)) {
    A({ terrain: "water", shape: "rect", x: W * 0.68, y: 0, w: W, h: H });
    A({ terrain: "deep", shape: "rect", x: W * 0.85, y: 0, w: W, h: H });
  }
  if (has(/\b(river|stream|creek|ford|bridge)\b/)) {
    const y1 = rx(3, H - 3), y2 = rx(3, H - 3);
    const pts: LayoutPoint[] = [[-1, y1], [W * 0.35, rx(3, H - 3)], [W * 0.7, rx(3, H - 3)], [W + 1, y2]];
    A({ terrain: "water", shape: "path", points: pts, width: rx(2.4, 3.4) });
    if (has(/bridge/)) {
      const bx = W * 0.5;
      const yy = pts[1][1] + (pts[2][1] - pts[1][1]) * ((bx - pts[1][0]) / (pts[2][0] - pts[1][0]));
      A({ terrain: "wood", shape: "rect", x: bx - 1.2, y: yy - 3, w: 2.4, h: 6 });
      spec.plankV = true;
    }
  }
  if (has(/\b(pond|lake|pool|spring)\b/)) A({ terrain: "water", shape: "ellipse", x: rx(6, W - 6), y: rx(5, H - 5), rx: rx(3, 5), ry: rx(2.5, 4) });
  if (spec.base === "swamp") for (let i = 0; i < 6; i++) A({ terrain: "water", shape: "ellipse", x: rx(2, W - 2), y: rx(2, H - 2), rx: rx(1.2, 3), ry: rx(1, 2.4) });
  if (has(/\b(road|path|trail)\b/)) A({ terrain: "path", shape: "path", points: [[-1, rx(3, H - 3)], [cx, cy], [W + 1, rx(3, H - 3)]], width: 2.2 });
  const clearing = has(/\b(clearing|glade|camp|campsite|camping|tents?|campfire|ambush|meadow)\b/) || !has(/\b(dense|deep)\b/);
  if (clearing && spec.base === "grass") A({ terrain: "dirt", shape: "ellipse", x: cx, y: cy, rx: rx(3, 4.5), ry: rx(2.2, 3.4) });
  if (has(/\b(cliff|ridge|ravine|canyon|ledge)\b/)) A({ terrain: "wall", shape: "path", points: [[rx(2, 6), -1], [rx(4, 9), H * 0.5], [rx(2, 6), H + 1]], width: 3 });
  if (has(/\b(camp|campsite|tents?|bandit)\b/)) {
    const n = has(/\btents\b|several|many/) ? 3 : 2;
    for (let i = 0; i < n; i++) { const a = -2.2 + i * 0.7; O({ kind: "tent", x: cx + Math.cos(a) * 4.2, y: cy + Math.sin(a) * 3.4, r: 2, rot: a + Math.PI / 2 }); }
  }
  if (has(/\b(camp|campsite|campfire|fire|bonfire|tents?)\b/)) {
    O({ kind: "campfire", x: cx, y: cy, r: 1 });
    O({ kind: "log", x: cx - 1.4, y: cy + 1.8, r: 1, len: 2.6, rot: -0.5 });
    O({ kind: "log", x: cx + 1.8, y: cy + 1.4, r: 1, len: 2.4, rot: 0.2 });
  }
  if (has(/\b(rocks?|boulders?|stones?|standing stones|circle)\b/)) {
    if (has(/standing stones|stone circle|circle of stones/)) for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.28; O({ kind: "boulder", x: cx + Math.cos(a) * 4, y: cy + Math.sin(a) * 3, r: 1 }); }
    else scatter("rock", 6, { r: 1 }, ring(cx, cy, 2));
  }
  if (has(/\bstatue\b/)) O({ kind: "statue", x: cx, y: cy - 1, r: 1.2 });
  if (has(/\b(crates?|cart|wagon|caravan|supplies)\b/)) scatter("crate", 4, { r: 0.8 }, (x, y) => Math.hypot(x - cx, y - cy) < 6);
  if (has(/\bbarrels?\b/)) scatter("barrel", 3, { r: 0.8 }, (x, y) => Math.hypot(x - cx, y - cy) < 6);
  if (has(/\b(withered|dead|blight|wither|corrupt|haunted)\b/)) scatter("deadtree", 4, { r: 1.8 }, ring(cx, cy, 4));
  const treeN = spec.base === "sand" ? 3 : has(/\b(forest|woods|wood|jungle|grove|thicket|dense)\b/) ? 30 : spec.base === "swamp" ? 12 : 16;
  const variant = has(/autumn|fall/) ? "autumn" : spec.base === "snow" ? "pine" : spec.base === "swamp" ? "dark" : undefined;
  const grid = rasterize(spec);
  const blockedTerrain = new Set<TerrainId>(["water", "deep", "wall", "path", "wood", "dirt"]);
  const okT = (x: number, y: number) => !blockedTerrain.has(grid[Math.floor(clamp(y, 0, H - 1))][Math.floor(clamp(x, 0, W - 1))]);
  scatter("tree", treeN, { r: 1.6, variant }, (x, y) => okT(x, y) && Math.hypot((x - cx) / 1.3, y - cy) > 5.5 && (x < 3 || x > W - 3 || y < 3 || y > H - 3 || R() < 0.7));
  scatter("bush", Math.round(treeN / 3), { r: 1, variant }, (x, y) => okT(x, y) && Math.hypot(x - cx, y - cy) > 3.5);
  scatter("rock", 3, { r: 0.7 }, (x, y) => okT(x, y) && Math.hypot(x - cx, y - cy) > 2.5);
  const place = spec.base === "snow" ? "Snowy " : spec.base === "swamp" ? "Marsh " : spec.base === "sand" ? "Coastal " : "Forest ";
  return finish(place + (has(/camp|tent/) ? "camp" : "clearing"));
};
