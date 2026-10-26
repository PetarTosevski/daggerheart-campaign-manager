/**
 * Movement rules on the combat map (plan `.omc/plans/map-movement.yaml`, tracer M0; D1-D4, D6).
 *
 * Which squares stop a token (blocking) and which are difficult terrain, built once per map from its painted
 * terrain, its Classic objects and its sprites' `move` traits, and the path check of one move. Pure TypeScript,
 * shared by Convex (combatTokens.move refuses a player's blocked move) and the browser (M1 marks the squares).
 *
 * D1 blocking: terrain `wall` and `void`; the GM's painted sight blockers (the cells "block" layer); Classic kinds
 *    pillar, statue, boulder, mast, tree, deadtree; sprites whose `move` is "block", and doors (sprites with `move`
 *    "door", M2's Classic kind `door`) unless the object is open (user answer 2026-10-21: a closed door blocks, an open
 *    one doesn't; M2 adds the switch, `open` absent = closed).
 * D2 difficult: terrain water, deep, swamp, snow, lava; Classic kinds rubble, bush, log, bones; sprites whose `move`
 *    is "difficult" (a sprite without an explicit `move` of one of those Classic kinds defaults to difficult).
 *    Difficult never blocks.
 * Decks (orchestrator 2026-10-21): an object of Classic kind `hull` does not block, whatever its sprite (M2: a Sprites
 *    ship drawn with the ship's-bow sprite keeps its deck); the squares inside its outline (its `points` polygon, else
 *    its footprint) are deck, neither blocked nor difficult whatever the terrain under the ship. Objects on the deck
 *    (masts, crates) and painted blockers still count.
 * Doors (M2, D7): an object is a door when its sprite `move` is "door", or it has no sprite `move` and its Classic kind
 *    is `door` (an uploaded sprite whose Classic kind is `door` defaults to "door"). Its optional `open` (absent =
 *    closed) is read here; sight reads it in sight.ts.
 * D4 path: a move from A to B checks every square the token's footprint covers along the supercover line between
 *    the two positions (both squares at an exact diagonal corner), minus the squares it starts on.
 *
 * Object footprints are the vision engine's (vision.ts `prepareMap`): a rect sprite is its w x h rectangle turned by
 * `rot`, anything else the circle `r * blockRadiusFactor(kind)`. A square counts when any of its vision samples is
 * covered. An uploaded image ignores terrain, as vision does; only objects stop tokens there.
 */

import { pointInPolygon, rasterize, type PaintArea } from "../../combat-map/raster";
import type { SightMode } from "./sight";
import type { ObjectKind, Terrain } from "./spec";
import type { VisionTraits } from "./traits";
import { SAMPLES_PER_SQUARE, prepareMap, type PreparedMap, type VisionObject } from "./vision";

// ---------------------------------------------------------------- traits

/** A sprite's movement trait: "door" blocks while closed and is open while open. */
export const MOVE_TRAITS = ["open", "difficult", "block", "door"] as const;
export type MoveTrait = (typeof MOVE_TRAITS)[number];

/** What a square does to movement right now. */
export type MoveEffect = "open" | "difficult" | "block";

/** D1: painted terrain that blocks movement. */
export const MOVE_BLOCKING_TERRAINS: ReadonlySet<string> = new Set<Terrain>(["wall", "void"]);
/** D2: painted terrain that is difficult. */
export const DIFFICULT_TERRAINS: ReadonlySet<string> = new Set<Terrain>(["water", "deep", "swamp", "snow", "lava"]);

/**
 * D1, D2: what each Classic object kind does to movement. `hull` is a deck (see `buildMovementGrid`), so "open" here;
 * `door` blocks while closed (M2, D7).
 */
export const CLASSIC_MOVE: Readonly<Record<ObjectKind, MoveTrait>> & Readonly<Record<string, MoveTrait>> = {
  pillar: "block",
  statue: "block",
  boulder: "block",
  hull: "open",
  door: "door",
  mast: "block",
  tree: "block",
  deadtree: "block",
  rubble: "difficult",
  bush: "difficult",
  log: "difficult",
  bones: "difficult",
  rock: "open",
  tent: "open",
  campfire: "open",
  crate: "open",
  barrel: "open",
  chest: "open",
  table: "open",
  mushroom: "open",
  torch: "open",
  walltorch: "open",
  crystal: "open",
};

/**
 * A sprite's default `move` from its labels (D1, D2): a door when its Classic kind is `door` (M2: an uploaded door
 * sprite); else blocks sight and is tall = block; else difficult when its Classic kind is difficult in CLASSIC_MOVE
 * (bush, log, bones, rubble); else open.
 */
export function defaultMove(traits: { readonly sight: SightMode; readonly height: string; readonly classicKind?: string }): MoveTrait {
  if (traits.classicKind !== undefined && CLASSIC_MOVE[traits.classicKind] === "door") return "door";
  if (traits.sight === "block" && traits.height === "tall") return "block";
  return traits.classicKind !== undefined && CLASSIC_MOVE[traits.classicKind] === "difficult" ? "difficult" : "open";
}

/** A terrain's movement effect (D1, D2); textures take their terrain class's. */
export function terrainMove(terrain: string): MoveEffect {
  if (MOVE_BLOCKING_TERRAINS.has(terrain)) return "block";
  return DIFFICULT_TERRAINS.has(terrain) ? "difficult" : "open";
}

/** A map object as movement reads it: a combatMapObjects row (or spec object) plus its resolved sprite `move`. */
export type MovementObject = {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly r?: number;
  readonly rot?: number | null;
  /** Resolved sprite traits (footprint, size); absent = the Classic kind's circle. */
  readonly traits?: VisionTraits | null;
  /** The sprite's `move` (catalog or uploaded default); absent or null = the Classic kind's (CLASSIC_MOVE). */
  readonly move?: MoveTrait | null;
  /** Doors only (M2): true = open; absent = closed. */
  readonly open?: boolean | null;
  /** A Classic hull's outline (the deck polygon, in squares). */
  readonly points?: readonly (readonly number[])[];
};

/** An object of Classic kind `hull`, whatever its sprite (M2 follow-up): its squares are deck. */
export function isDeck(object: Pick<MovementObject, "kind">): boolean {
  return object.kind === "hull";
}

/** A door (M2, D7): its sprite `move` is "door", or it has none and its Classic kind is `door`. */
export function isDoor(object: Pick<MovementObject, "kind" | "move">): boolean {
  return (object.move ?? CLASSIC_MOVE[object.kind]) === "door";
}

/**
 * The object's movement effect now: its sprite `move`, else its Classic kind's; a door blocks unless open; a hull is
 * deck (never blocks, whatever its sprite).
 */
export function moveEffect(object: Pick<MovementObject, "kind" | "move" | "open">): MoveEffect {
  if (isDeck(object)) return "open";
  const trait = object.move ?? CLASSIC_MOVE[object.kind] ?? "open";
  if (trait === "door") return object.open === true ? "open" : "block";
  return trait;
}

// ---------------------------------------------------------------- the grid

export type MovementMapInput = {
  readonly w: number;
  readonly h: number;
  readonly base?: string;
  readonly areas?: readonly PaintArea[];
  /** Hand-painted terrain, "x,y" -> terrain, over the areas. */
  readonly paint?: Readonly<Record<string, string>>;
  /** The GM's painted sight blockers, "x,y" square keys: they block movement too (on image maps as well). */
  readonly block?: Iterable<string>;
  readonly objects?: readonly MovementObject[];
  /** An uploaded image: terrain is ignored. */
  readonly image?: boolean;
};

/** Per square (index y * w + x): 1 = blocks movement / is difficult. */
export type MovementGrid = {
  readonly w: number;
  readonly h: number;
  readonly blocked: Uint8Array;
  readonly difficult: Uint8Array;
};

export type Square = { readonly x: number; readonly y: number };

const S = SAMPLES_PER_SQUARE;

/** Marks the squares any of whose vision samples the prepared objects cover. */
function markFootprints(prepared: PreparedMap, w: number, h: number, out: Uint8Array): void {
  for (let sy = 0; sy < prepared.sh; sy++) {
    for (let sx = 0; sx < prepared.sw; sx++) {
      if (!prepared.blocked[sy * prepared.sw + sx]) continue;
      const x = Math.floor(sx / S);
      const y = Math.floor(sy / S);
      if (x < w && y < h) out[y * w + x] = 1;
    }
  }
}

/** The objects' vision footprints (every object treated as a sight blocker, lights off). */
function footprints(objects: readonly MovementObject[], w: number, h: number): PreparedMap {
  const asVision: VisionObject[] = objects.map((o) => ({
    kind: o.kind,
    x: o.x,
    y: o.y,
    ...(o.r === undefined ? {} : { r: o.r }),
    rot: o.rot ?? null,
    traits: o.traits ?? null,
    sight: "block",
    lit: false,
  }));
  return prepareMap({ w, h, image: true, objects: asVision });
}

/** Marks a hull's deck: squares whose centre lies inside its outline polygon, else its vision footprint. */
function markDeck(hull: MovementObject, w: number, h: number, out: Uint8Array): void {
  const pts = hull.points ?? [];
  if (pts.length < 3) {
    markFootprints(footprints([hull], w, h), w, h, out);
    return;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (pointInPolygon(x + 0.5, y + 0.5, pts)) out[y * w + x] = 1;
  }
}

/** D1, D2: the map's blocking and difficult squares. A square that blocks is never also difficult. */
export function buildMovementGrid(input: MovementMapInput): MovementGrid {
  const w = Math.max(1, Math.trunc(input.w));
  const h = Math.max(1, Math.trunc(input.h));
  const blocked = new Uint8Array(w * h);
  const difficult = new Uint8Array(w * h);
  if (!input.image) {
    const terrain = rasterize({ w, h, base: input.base, areas: input.areas }, 1, input.paint);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const effect = terrainMove(terrain[y]?.[x] ?? "");
        if (effect === "block") blocked[y * w + x] = 1;
        else if (effect === "difficult") difficult[y * w + x] = 1;
      }
    }
  }
  const valid = (input.objects ?? []).filter((o) => o && Number.isFinite(o.x) && Number.isFinite(o.y));
  const deck = new Uint8Array(w * h);
  for (const hull of valid.filter(isDeck)) markDeck(hull, w, h, deck);
  for (let i = 0; i < deck.length; i++) {
    if (deck[i]) {
      blocked[i] = 0;
      difficult[i] = 0;
    }
  }
  for (const key of input.block ?? []) {
    const comma = key.indexOf(",");
    const x = Number(key.slice(0, comma));
    const y = Number(key.slice(comma + 1));
    if (comma > 0 && Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < w && y < h) blocked[y * w + x] = 1;
  }
  const blockers = valid.filter((o) => moveEffect(o) === "block");
  const rough = valid.filter((o) => moveEffect(o) === "difficult");
  if (blockers.length > 0) markFootprints(footprints(blockers, w, h), w, h, blocked);
  if (rough.length > 0) markFootprints(footprints(rough, w, h), w, h, difficult);
  for (let i = 0; i < blocked.length; i++) if (blocked[i]) difficult[i] = 0;
  return { w, h, blocked, difficult };
}

export function isBlocked(grid: MovementGrid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.w && y < grid.h && grid.blocked[y * grid.w + x] === 1;
}

export function isDifficult(grid: MovementGrid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.w && y < grid.h && grid.difficult[y * grid.w + x] === 1;
}

// ---------------------------------------------------------------- the path (D4)

/**
 * The squares the line between the centres of squares `from` and `to` passes through, in order, from first to last.
 * Where the line crosses an exact corner both side squares are included (no squeezing between diagonal blockers).
 */
export function supercover(from: Square, to: Square): Square[] {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const sx = Math.sign(to.x - from.x);
  const sy = Math.sign(to.y - from.y);
  let x = from.x;
  let y = from.y;
  const out: Square[] = [{ x, y }];
  let ix = 0;
  let iy = 0;
  while (ix < dx || iy < dy) {
    const decision = (1 + 2 * ix) * dy - (1 + 2 * iy) * dx;
    if (decision === 0) {
      out.push({ x: x + sx, y }, { x, y: y + sy });
      x += sx;
      y += sy;
      ix++;
      iy++;
    } else if (decision < 0) {
      x += sx;
      ix++;
    } else {
      y += sy;
      iy++;
    }
    out.push({ x, y });
  }
  return out;
}

/**
 * Every square a token of `size` (its top-left square moving from `from` to `to`) covers along the supercover line,
 * except the squares it starts on (a token may always leave where it stands). Empty for a move to the same square.
 */
export function sweptSquares(from: Square, to: Square, size: number): Square[] {
  const s = Math.max(1, Math.trunc(size) || 1);
  if (from.x === to.x && from.y === to.y) return [];
  const start = (x: number, y: number) => x >= from.x && x < from.x + s && y >= from.y && y < from.y + s;
  const seen = new Set<string>();
  const out: Square[] = [];
  for (const anchor of supercover(from, to)) {
    for (let y = anchor.y; y < anchor.y + s; y++) {
      for (let x = anchor.x; x < anchor.x + s; x++) {
        const key = `${x},${y}`;
        if (start(x, y) || seen.has(key)) continue;
        seen.add(key);
        out.push({ x, y });
      }
    }
  }
  return out;
}

/** D3, D4: true when the move crosses or ends on a blocking square. */
export function pathBlocked(grid: MovementGrid, from: Square, to: Square, size: number): boolean {
  return sweptSquares(from, to, size).some((q) => isBlocked(grid, q.x, q.y));
}

/** D5: true when the move crosses or ends on a difficult square. */
export function crossedDifficult(grid: MovementGrid, from: Square, to: Square, size: number): boolean {
  return sweptSquares(from, to, size).some((q) => isDifficult(grid, q.x, q.y));
}

/** Both answers for one move, walking the path once. */
export function checkMove(grid: MovementGrid, from: Square, to: Square, size: number): { blocked: boolean; difficult: boolean } {
  let blocked = false;
  let difficult = false;
  for (const q of sweptSquares(from, to, size)) {
    blocked ||= isBlocked(grid, q.x, q.y);
    difficult ||= isDifficult(grid, q.x, q.y);
    if (blocked && difficult) break;
  }
  return { blocked, difficult };
}
