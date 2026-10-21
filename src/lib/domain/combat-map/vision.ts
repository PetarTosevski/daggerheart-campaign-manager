/**
 * The vision engine: what one character sees on a combat map.
 *
 * Runs on the server (Convex queries filter tokens per player, C7) and in the
 * browser (fog painting, C8) from the same code, so the two never disagree.
 * Port of the board's VIS (reference/designs/project/Combat.dc.html) with two
 * changes: line of sight walks the grid cells exactly (no fixed-step sampling)
 * and sample levels are computed lazily and cached, so a token check does not
 * pay for the whole map.
 *
 * Geometry: squares are map cells (1 square = 5 ft, R1). Vision works on
 * half-squares ("samples", SAMPLES_PER_SQUARE per side). Coordinates in
 * squares; a token at (x, y) with size s covers [x, x+s) x [y, y+s) and looks
 * from its centre. Facing is in radians, 0 = east, y grows downwards.
 *
 * Levels per sample: 0 = unseen or dark, 1 = dim (faint terrain, no tokens),
 * 2 = clear.
 */

import { CARRIED_LIGHT_REACH, isLit, lightOf, mapLightReach, type CarriedLight, type LightLevel } from "./light";
import { blockRadiusFactor, blocksSight, type SightMode } from "./sight";
import { SIGHT_BLOCKING_TERRAINS, type Terrain } from "./spec";
import { defaultTraitRadius, type VisionTraits } from "./traits";

// ---------------------------------------------------------------- constants

/** R6: cone at Instinct 0, in degrees (the user may tune it). */
export const VISION_BASE_DEG = 70;
/** R6: degrees per point of Instinct (the user may tune it). */
export const VISION_STEP_DEG = 15;
export const VISION_MIN_DEG = 10;
export const VISION_MAX_DEG = 180;

/** Vision resolution: samples per square side (half-squares, as on the board). */
export const SAMPLES_PER_SQUARE = 2;

/**
 * Q1: the player's fog extends this many squares beyond every map edge (the
 * farthest light reach, a campfire's dim band), so the edge cannot be seen.
 */
export const FOG_PAD_SQUARES = 24;

/** A sample within this many squares of the line's start never blocks it (the board's 0.75). */
const LOS_NEAR = 0.75;
/** Light reaches half a square past its nominal range (the board's +0.5). */
const LIGHT_SLACK = 0.5;

/** R6: clamp(70 + 15 x Instinct, 10, 180) degrees. Never behind: at most 180. */
export function coneDeg(instinct: number): number {
  const i = Number.isFinite(instinct) ? instinct : 0;
  return Math.max(VISION_MIN_DEG, Math.min(VISION_MAX_DEG, VISION_BASE_DEG + VISION_STEP_DEG * i));
}

// ---------------------------------------------------------------- map preparation

type Point = readonly [number, number] | readonly number[];

/** An area as stored (structurally a MapArea from spec.ts). */
export type VisionArea = {
  readonly terrain: string;
  readonly shape: string;
  readonly x?: number;
  readonly y?: number;
  readonly w?: number;
  readonly h?: number;
  readonly rx?: number;
  readonly ry?: number;
  readonly width?: number;
  readonly points?: readonly Point[];
};

/** A map object as stored (combatMapObjects row or a spec object). */
export type VisionObject = {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly r?: number;
  readonly sight?: SightMode | null;
  readonly lit?: boolean | null;
  /** Doors only (map-movement M2): true = open, so it blocks no sight (`sightOf`); absent = closed. */
  readonly open?: boolean | null;
  /** Rotation in radians (turns rect footprints). */
  readonly rot?: number | null;
  /** Sprite traits (sprite-packs P3); absent = the Classic kind's behaviour, unchanged. */
  readonly traits?: VisionTraits | null;
};

export type VisionMapInput = {
  readonly w: number;
  readonly h: number;
  readonly base?: string;
  readonly areas?: readonly VisionArea[];
  readonly objects?: readonly VisionObject[];
  /** Hand-painted terrain, "x,y" (square) -> terrain; painted over the areas. */
  readonly paint?: Readonly<Record<string, string>>;
  /** Painted sight blockers, "x,y" square keys. */
  readonly block?: Iterable<string>;
  /** An uploaded image: terrain is ignored, only painted blockers and objects block. */
  readonly image?: boolean;
};

export type MapLightSource = { readonly x: number; readonly y: number; readonly clear: number; readonly dim: number };

/** A map ready for vision queries. Build once per query, reuse for every viewer. */
export type PreparedMap = {
  readonly w: number;
  readonly h: number;
  /** Width and height in samples. */
  readonly sw: number;
  readonly sh: number;
  /** 1 = the sample blocks sight. Index sy * sw + sx. */
  readonly blocked: Uint8Array;
  /** Lit map lights (R9). */
  readonly lights: readonly MapLightSource[];
};

const S = SAMPLES_PER_SQUARE;

function parseKey(key: string): [number, number] | null {
  const comma = key.indexOf(",");
  if (comma < 0) return null;
  const x = Number(key.slice(0, comma));
  const y = Number(key.slice(comma + 1));
  return Number.isInteger(x) && Number.isInteger(y) ? [x, y] : null;
}

const isWallish = (t: string | undefined) => t !== undefined && SIGHT_BLOCKING_TERRAINS.has(t as Terrain);

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

function inPoly(px: number, py: number, pts: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i][0];
    const yi = pts[i][1];
    const xj = pts[j][0];
    const yj = pts[j][1];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Rasterise areas (in order, later wins) into a "blocks sight" grid at sample resolution. */
function rasterizeWalls(input: VisionMapInput, sw: number, sh: number, out: Uint8Array): void {
  const baseWall = isWallish(input.base) ? 1 : 0;
  out.fill(baseWall);
  for (const a of input.areas ?? []) {
    if (typeof a.terrain !== "string") continue;
    const wall = isWallish(a.terrain) ? 1 : 0;
    const pts = a.points ?? [];
    let hit: ((cx: number, cy: number) => boolean) | null = null;
    let x0 = 0;
    let y0 = 0;
    let x1 = input.w;
    let y1 = input.h;
    const ax = a.x ?? 0;
    const ay = a.y ?? 0;
    if (a.shape === "rect") {
      const aw = a.w ?? 1;
      const ah = a.h ?? 1;
      [x0, y0, x1, y1] = [ax, ay, ax + aw, ay + ah];
      hit = (cx, cy) => cx >= ax && cx <= ax + aw && cy >= ay && cy <= ay + ah;
    } else if (a.shape === "ellipse") {
      const rx = a.rx || 1;
      const ry = a.ry || 1;
      [x0, y0, x1, y1] = [ax - rx, ay - ry, ax + rx, ay + ry];
      hit = (cx, cy) => ((cx - ax) / rx) ** 2 + ((cy - ay) / ry) ** 2 <= 1;
    } else if (a.shape === "poly" && pts.length > 2) {
      x0 = Math.min(...pts.map((p) => p[0]));
      x1 = Math.max(...pts.map((p) => p[0]));
      y0 = Math.min(...pts.map((p) => p[1]));
      y1 = Math.max(...pts.map((p) => p[1]));
      hit = (cx, cy) => inPoly(cx, cy, pts);
    } else if (a.shape === "path" && pts.length > 1) {
      const hw = (a.width || 2) / 2;
      x0 = Math.min(...pts.map((p) => p[0])) - hw;
      x1 = Math.max(...pts.map((p) => p[0])) + hw;
      y0 = Math.min(...pts.map((p) => p[1])) - hw;
      y1 = Math.max(...pts.map((p) => p[1])) + hw;
      hit = (cx, cy) => {
        for (let i = 0; i < pts.length - 1; i++) {
          if (segDist(cx, cy, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]) <= hw) return true;
        }
        return false;
      };
    } else if (a.shape === "border") {
      const th = a.width || 2;
      hit = (cx, cy) => cx < th || cy < th || cx > input.w - th || cy > input.h - th;
    }
    if (!hit) continue;
    const sx0 = Math.max(0, Math.floor(x0 * S) - 1);
    const sy0 = Math.max(0, Math.floor(y0 * S) - 1);
    const sx1 = Math.min(sw - 1, Math.ceil(x1 * S) + 1);
    const sy1 = Math.min(sh - 1, Math.ceil(y1 * S) + 1);
    for (let sy = sy0; sy <= sy1; sy++) {
      const cy = (sy + 0.5) / S;
      for (let sx = sx0; sx <= sx1; sx++) {
        if (hit((sx + 0.5) / S, cy)) out[sy * sw + sx] = wall;
      }
    }
  }
  for (const [key, terrain] of Object.entries(input.paint ?? {})) {
    const xy = parseKey(key);
    if (!xy) continue;
    fillSquare(out, sw, sh, xy[0], xy[1], isWallish(terrain) ? 1 : 0);
  }
}

function fillSquare(out: Uint8Array | Int8Array, sw: number, sh: number, x: number, y: number, value: number): void {
  for (let yy = 0; yy < S; yy++) {
    for (let xx = 0; xx < S; xx++) {
      const sx = x * S + xx;
      const sy = y * S + yy;
      if (sx >= 0 && sy >= 0 && sx < sw && sy < sh) out[sy * sw + sx] = value;
    }
  }
}

/**
 * Block a rect footprint (sprite-packs D4): w x h squares centred on the
 * object, scaled by r / (max(w, h) / 2) when r is set, turned by rot. Marks
 * every sample whose centre lies inside the rotated rectangle.
 */
function blockRect(out: Uint8Array, sw: number, sh: number, o: VisionObject, t: VisionTraits): void {
  const tw = t.w > 0 ? t.w : 1;
  const th = t.h > 0 ? t.h : 1;
  const scale = o.r ? o.r / defaultTraitRadius({ w: tw, h: th }) : 1;
  const hw = (tw * scale) / 2;
  const hh = (th * scale) / 2;
  const rot = Number.isFinite(o.rot) ? (o.rot as number) : 0;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const ex = Math.abs(hw * cos) + Math.abs(hh * sin);
  const ey = Math.abs(hw * sin) + Math.abs(hh * cos);
  const sx0 = Math.max(0, Math.floor((o.x - ex) * S));
  const sx1 = Math.min(sw, Math.ceil((o.x + ex) * S));
  const sy0 = Math.max(0, Math.floor((o.y - ey) * S));
  const sy1 = Math.min(sh, Math.ceil((o.y + ey) * S));
  const eps = 1e-9;
  for (let sy = sy0; sy < sy1; sy++) {
    const dy = (sy + 0.5) / S - o.y;
    for (let sx = sx0; sx < sx1; sx++) {
      const dx = (sx + 0.5) / S - o.x;
      // Into the object's frame: rotate by -rot.
      const lx = dx * cos + dy * sin;
      const ly = -dx * sin + dy * cos;
      if (Math.abs(lx) <= hw + eps && Math.abs(ly) <= hh + eps) out[sy * sw + sx] = 1;
    }
  }
}

/**
 * Build the blocking grid (terrain walls, painted blockers, sight-blocking
 * objects, R7) and the list of lit map lights (R9). Objects with sprite
 * traits (P3) use their sight default (D3), light (Q1) and footprint (D4).
 */
export function prepareMap(input: VisionMapInput): PreparedMap {
  const w = Math.max(1, Math.trunc(input.w));
  const h = Math.max(1, Math.trunc(input.h));
  const sw = w * S;
  const sh = h * S;
  const blocked = new Uint8Array(sw * sh);
  if (!input.image) rasterizeWalls({ ...input, w, h }, sw, sh, blocked);
  for (const key of input.block ?? []) {
    const xy = parseKey(key);
    if (xy) fillSquare(blocked, sw, sh, xy[0], xy[1], 1);
  }
  const lights: MapLightSource[] = [];
  for (const o of input.objects ?? []) {
    if (!o || !Number.isFinite(o.x) || !Number.isFinite(o.y)) continue;
    if (isLit(o)) {
      const [clear, dim] = mapLightReach(o)!;
      lights.push({ x: o.x, y: o.y, clear, dim });
    }
    if (!blocksSight(o)) continue;
    const t = o.traits;
    if (t && t.footprint === "rect") {
      blockRect(blocked, sw, sh, o, t);
      continue;
    }
    const rr = (o.r || (t ? defaultTraitRadius(t) : 1)) * blockRadiusFactor(o.kind);
    const sy0 = Math.max(0, Math.floor((o.y - rr) * S));
    const sy1 = Math.min(sh, Math.ceil((o.y + rr) * S));
    const sx0 = Math.max(0, Math.floor((o.x - rr) * S));
    const sx1 = Math.min(sw, Math.ceil((o.x + rr) * S));
    for (let sy = sy0; sy < sy1; sy++) {
      for (let sx = sx0; sx < sx1; sx++) {
        if (Math.hypot((sx + 0.5) / S - o.x, (sy + 0.5) / S - o.y) <= rr) blocked[sy * sw + sx] = 1;
      }
    }
  }
  return { w, h, sw, sh, blocked, lights };
}

// ---------------------------------------------------------------- line of sight

/**
 * Line of sight between two points (in squares). Blocked by any blocking
 * sample the segment passes through, except samples within 0.75 squares of
 * the start (the viewer's own footprint) and the target's own sample (a wall
 * face is seen). Leaving the map blocks.
 */
export function los(map: PreparedMap, ax: number, ay: number, bx: number, by: number): boolean {
  const { sw, sh, blocked } = map;
  const x0 = ax * S;
  const y0 = ay * S;
  const dx = bx * S - x0;
  const dy = by * S - y0;
  const tx = Math.floor(bx * S);
  const ty = Math.floor(by * S);
  let cx = Math.floor(x0);
  let cy = Math.floor(y0);
  if (cx === tx && cy === ty) return true;
  const len = Math.hypot(dx, dy);
  const near = LOS_NEAR * S;
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tDeltaY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tMaxX = dx > 0 ? (cx + 1 - x0) / dx : dx < 0 ? (x0 - cx) / -dx : Infinity;
  let tMaxY = dy > 0 ? (cy + 1 - y0) / dy : dy < 0 ? (y0 - cy) / -dy : Infinity;
  for (let guard = sw + sh + 4; guard > 0; guard--) {
    let t: number;
    if (tMaxX < tMaxY) {
      t = tMaxX;
      tMaxX += tDeltaX;
      cx += stepX;
    } else {
      t = tMaxY;
      tMaxY += tDeltaY;
      cy += stepY;
    }
    if (t >= 1 || (cx === tx && cy === ty)) return true;
    if (cx < 0 || cy < 0 || cx >= sw || cy >= sh) return false;
    if (blocked[cy * sw + cx] && Math.min(tMaxX, tMaxY, 1) * len > near) return false;
  }
  return true;
}

// ---------------------------------------------------------------- one viewer's view

export type TokenSide = "pc" | "enemy" | "ally" | "neutral";

/** A token as the engine needs it (structurally a combatTokens row plus ids). */
export type VisionToken = {
  readonly x: number;
  readonly y: number;
  /** 1..3 squares. */
  readonly size?: number;
  /** Radians, 0 = east. */
  readonly face?: number;
  /** Carried light (any token, Q3). */
  readonly light?: CarriedLight | null;
  readonly side: TokenSide;
  /** The PC's character id (pc tokens). */
  readonly characterId?: string | null;
  /** Character ids the GM revealed this token to (R10). */
  readonly revealedTo?: readonly string[] | null;
};

export type ViewerInput = {
  /** The viewing character's own token. */
  readonly token: VisionToken;
  readonly characterId: string;
  /** The character's Instinct (R6). */
  readonly instinct: number;
};

/** GM fog marks per square (R12): "reveal" forces clear, "hide" forces unseen. */
export type FogMark = "reveal" | "hide";

export type SceneInput = {
  /** Campaign time phase name (R8). */
  readonly phase: string;
  /** Every token on the map (for carried lights, Q3). May include the viewer's. */
  readonly tokens?: readonly VisionToken[];
  /** GM fog marks, "x,y" square -> mark. */
  readonly fog?: Readonly<Record<string, FogMark>>;
};

type Source = { x: number; y: number; clear: number; dim: number; self: boolean };

/** One character's view of a prepared map. Levels are computed lazily and cached. */
export type ViewerView = {
  readonly map: PreparedMap;
  readonly characterId: string;
  readonly light: LightLevel;
  readonly coneDeg: number;
  /** Eye position in squares (the token's centre). */
  readonly eyeX: number;
  readonly eyeY: number;
  readonly face: number;
  readonly sources: readonly Source[];
  /** Internal caches. */
  readonly _half: number;
  readonly _foot: readonly [number, number, number, number];
  readonly _fog: Int8Array | null;
  readonly _cache: Int8Array;
};

const tokenSize = (t: VisionToken) => Math.max(1, Math.min(3, Math.trunc(t.size ?? 1) || 1));

/** Build a viewer's view: cone (R6), light by phase (R8), light sources (R9, Q3), fog marks (R12). */
export function createView(map: PreparedMap, viewer: ViewerInput, scene: SceneInput): ViewerView {
  const light = lightOf(scene.phase);
  const own = viewer.token;
  const size = tokenSize(own);
  const eyeX = own.x + size / 2;
  const eyeY = own.y + size / 2;
  const deg = coneDeg(viewer.instinct);
  const sources: Source[] = [];
  if (light === "night") {
    const [clear, dim] = CARRIED_LIGHT_REACH[own.light ?? "none"] ?? CARRIED_LIGHT_REACH.none;
    sources.push({ x: eyeX, y: eyeY, clear, dim, self: true });
    for (const t of scene.tokens ?? []) {
      if (t === own || (t.characterId != null && t.characterId === viewer.characterId)) continue;
      if (!t.light || t.light === "none") continue;
      const reach = CARRIED_LIGHT_REACH[t.light];
      if (!reach) continue;
      const z = tokenSize(t);
      sources.push({ x: t.x + z / 2, y: t.y + z / 2, clear: reach[0], dim: reach[1], self: false });
    }
    for (const l of map.lights) sources.push({ ...l, self: false });
  }
  let fog: Int8Array | null = null;
  const marks = Object.entries(scene.fog ?? {});
  if (marks.length > 0) {
    fog = new Int8Array(map.sw * map.sh).fill(-1);
    for (const [key, mark] of marks) {
      const xy = parseKey(key);
      if (xy && (mark === "reveal" || mark === "hide")) fillSquare(fog, map.sw, map.sh, xy[0], xy[1], mark === "reveal" ? 2 : 0);
    }
  }
  return {
    map,
    characterId: viewer.characterId,
    light,
    coneDeg: deg,
    eyeX,
    eyeY,
    face: Number.isFinite(own.face) ? (own.face as number) : 0,
    sources,
    _half: ((deg / 2) * Math.PI) / 180 + 1e-9,
    _foot: [own.x, own.y, own.x + size, own.y + size],
    _fog: fog,
    _cache: new Int8Array(map.sw * map.sh).fill(-1),
  };
}

function computeSample(view: ViewerView, sx: number, sy: number): 0 | 1 | 2 {
  const px = (sx + 0.5) / S;
  const py = (sy + 0.5) / S;
  const [fx0, fy0, fx1, fy1] = view._foot;
  const own = px >= fx0 && px < fx1 && py >= fy0 && py < fy1;
  if (!own) {
    // R6 cone, never behind.
    let a = Math.atan2(py - view.eyeY, px - view.eyeX) - view.face;
    a = Math.atan2(Math.sin(a), Math.cos(a));
    if (Math.abs(a) > view._half) return 0;
  }
  if (view.light !== "night") {
    return own || los(view.map, view.eyeX, view.eyeY, px, py) ? 2 : 0;
  }
  // Night: cheap distance pass first, so dark samples skip the sight line.
  let reachable = false;
  for (const s of view.sources) {
    if (Math.hypot(px - s.x, py - s.y) <= s.dim + LIGHT_SLACK) {
      reachable = true;
      break;
    }
  }
  if (!reachable) return 0;
  if (!own && !los(view.map, view.eyeX, view.eyeY, px, py)) return 0;
  let level: 0 | 1 | 2 = 0;
  for (const s of view.sources) {
    const d = Math.hypot(px - s.x, py - s.y);
    if (d > s.dim + LIGHT_SLACK) continue;
    const lv = d <= s.clear + LIGHT_SLACK ? 2 : 1;
    if (lv <= level) continue;
    if (s.self || los(view.map, s.x, s.y, px, py)) {
      level = lv;
      if (level === 2) break;
    }
  }
  return level;
}

/** Level of one sample (half-square indices). Outside the map = 0. */
export function sampleLevel(view: ViewerView, sx: number, sy: number): 0 | 1 | 2 {
  const { sw, sh } = view.map;
  if (sx < 0 || sy < 0 || sx >= sw || sy >= sh) return 0;
  const i = sy * sw + sx;
  const cached = view._cache[i];
  if (cached >= 0) return cached as 0 | 1 | 2;
  const forced = view._fog ? view._fog[i] : -1;
  const level = forced >= 0 ? (forced as 0 | 2) : computeSample(view, sx, sy);
  view._cache[i] = level;
  return level;
}

/** Level at a point in squares (e.g. a map light's centre, for C7's toggleLight). */
export function pointLevel(view: ViewerView, x: number, y: number): 0 | 1 | 2 {
  return sampleLevel(view, Math.floor(x * S), Math.floor(y * S));
}

/** A box of samples, half-open: [sx0, sx1) x [sy0, sy1). */
export type SampleBox = { readonly sx0: number; readonly sy0: number; readonly sx1: number; readonly sy1: number };

/**
 * The samples an object stands on (map-movement M2: whether a viewer has seen a door): the axis-aligned box around
 * its footprint as `prepareMap` blocks it (a rect sprite turned by `rot`, else the circle `r * blockRadiusFactor`),
 * at least its own square, clamped to the map. A closed door blocks its own samples, so its centre alone is hidden
 * from anyone who looks at its face; any sample of the box counts.
 */
export function objectSampleBox(map: Pick<PreparedMap, "sw" | "sh">, o: VisionObject): SampleBox {
  const t = o.traits;
  let ex: number;
  let ey: number;
  if (t && t.footprint === "rect") {
    const tw = t.w > 0 ? t.w : 1;
    const th = t.h > 0 ? t.h : 1;
    const scale = o.r ? o.r / defaultTraitRadius({ w: tw, h: th }) : 1;
    const rot = Number.isFinite(o.rot) ? (o.rot as number) : 0;
    const hw = (tw * scale) / 2;
    const hh = (th * scale) / 2;
    ex = Math.abs(hw * Math.cos(rot)) + Math.abs(hh * Math.sin(rot));
    ey = Math.abs(hw * Math.sin(rot)) + Math.abs(hh * Math.cos(rot));
  } else {
    ex = ey = (o.r || (t ? defaultTraitRadius(t) : 1)) * blockRadiusFactor(o.kind);
  }
  // Samples whose centre lies within the extents (as prepareMap marks them), at least the one holding the centre.
  const span = (c: number, e: number, size: number): [number, number] => {
    const e2 = Math.max(0.5, e);
    let lo = Math.ceil((c - e2) * S - 0.5);
    let hi = Math.floor((c + e2) * S - 0.5) + 1;
    if (hi <= lo) {
      lo = Math.floor(c * S);
      hi = lo + 1;
    }
    return [Math.max(0, lo), Math.min(size, hi)];
  };
  const [sx0, sx1] = span(o.x, ex, map.sw);
  const [sy0, sy1] = span(o.y, ey, map.sh);
  return { sx0, sy0, sx1, sy1 };
}

/** Whether any sample of the box is dim or clear for the viewer now, or set in `explored` (index sy * sw + sx). */
export function boxSeen(view: ViewerView, box: SampleBox, explored?: Uint8Array | null): boolean {
  const { sw } = view.map;
  for (let sy = box.sy0; sy < box.sy1; sy++) {
    for (let sx = box.sx0; sx < box.sx1; sx++) {
      if (explored?.[sy * sw + sx]) return true;
      if (sampleLevel(view, sx, sy) > 0) return true;
    }
  }
  return false;
}

/** Per-sample levels for the whole map (C8 paints fog from this; explored = level > 0). */
export type VisionGrid = {
  /** Width and height in samples. */
  readonly sw: number;
  readonly sh: number;
  /** Samples per square side. */
  readonly scale: number;
  /** 0 unseen/dark, 1 dim, 2 clear. Index sy * sw + sx. */
  readonly levels: Uint8Array;
};

/** Every sample's level for this viewer. */
export function visibleSquares(view: ViewerView): VisionGrid {
  const { sw, sh } = view.map;
  const levels = new Uint8Array(sw * sh);
  for (let sy = 0; sy < sh; sy++) {
    for (let sx = 0; sx < sw; sx++) levels[sy * sw + sx] = sampleLevel(view, sx, sy);
  }
  return { sw, sh, scale: S, levels };
}

/**
 * "clear": shown normally. "dim": in dim light at night but revealed to this
 * viewer by the GM (R10), shown marked as revealed. "hidden": not sent.
 */
export type TokenVisibility = "clear" | "dim" | "hidden";

/**
 * Whether the viewer sees a token now. The viewer's own token and every other
 * PC token are always shown (Q4; their vision is not shared, R11). Other
 * tokens take the best level over the samples they cover: clear = shown;
 * dim = hidden unless revealedTo holds the viewer (R10); unseen = hidden, even
 * if revealed or in an explored area (R11).
 */
export function tokenVisibility(view: ViewerView, token: VisionToken): TokenVisibility {
  if (token.side === "pc") return "clear";
  const size = tokenSize(token);
  const sx0 = Math.floor(token.x * S);
  const sy0 = Math.floor(token.y * S);
  let best = 0;
  for (let sy = sy0; sy < sy0 + size * S && best < 2; sy++) {
    for (let sx = sx0; sx < sx0 + size * S && best < 2; sx++) {
      best = Math.max(best, sampleLevel(view, sx, sy));
    }
  }
  if (best === 2) return "clear";
  if (best === 1 && token.revealedTo?.includes(view.characterId)) return "dim";
  return "hidden";
}

// ---------------------------------------------------------------- explored areas (R11)

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Sample count of a map's explored bitmap (w x h squares). */
export function exploredLength(w: number, h: number): number {
  return Math.max(1, Math.trunc(w)) * S * Math.max(1, Math.trunc(h)) * S;
}

/** 1 where the grid shows anything (dim or clear). */
export function exploredFrom(grid: VisionGrid): Uint8Array {
  return grid.levels.map((l) => (l > 0 ? 1 : 0));
}

/** Pack a 0/1 mask, 6 samples per URL-safe character. */
export function encodeExplored(mask: Uint8Array): string {
  let out = "";
  for (let i = 0; i < mask.length; i += 6) {
    let v = 0;
    for (let b = 0; b < 6; b++) if (mask[i + b]) v |= 1 << b;
    out += B64[v];
  }
  return out;
}

/** Unpack to a mask of `length` samples; unknown characters and missing tail read as 0. */
export function decodeExplored(text: string, length: number): Uint8Array {
  const mask = new Uint8Array(length);
  for (let c = 0; c < text.length && c * 6 < length; c++) {
    const v = B64.indexOf(text[c]);
    if (v <= 0) continue;
    for (let b = 0; b < 6 && c * 6 + b < length; b++) if (v & (1 << b)) mask[c * 6 + b] = 1;
  }
  return mask;
}

/** Union of two masks of the same length (the longer length wins). */
export function mergeExplored(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = a[i] || b[i] ? 1 : 0;
  return out;
}

/** True when `next` adds a sample `prev` lacks (send markExplored only then). */
export function exploredGrows(prev: Uint8Array, next: Uint8Array): boolean {
  for (let i = 0; i < next.length; i++) if (next[i] && !prev[i]) return true;
  return false;
}
