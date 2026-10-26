// Reach on the battle grid (plan d12-bugs, tracer B4): whether a token stands within Melee of a map object, so a player
// may open or close a door or light or put out a map light. Pure: bundled into Convex (toggleDoor, toggleLight, doors)
// and used by the map UI to disable switches out of reach.
//
// CB p.103, "Optional Rule: Defined Ranges": "Melee: 1 square". User 2026-10-22: "Make sure that player tokens need to be
//   in melee range to interact with doors or light sources (turn on off close open)". Default (plan B4): measured
//   Chebyshev from any square of the token to any square of the object's footprint, so adjacent (diagonal too) or
//   overlapping counts.
//
// An object's squares are the ones its footprint covers as the vision engine and movement read it (vision.ts
// `prepareMap`, movement.ts `markFootprints`): a rect sprite is its w x h rectangle (scaled by r) turned by `rot`; any
// other object the circle `r * blockRadiusFactor(kind)` (a door at least half a square). A square counts when the centre
// of one of its vision samples lies inside; the square under the object's centre always counts.
//
// ```ts
// inMelee({ x: 7, y: 10 }, { kind: "door", x: 8.5, y: 10.5, r: 1 });              // true  (adjacent)
// inMelee({ x: 6, y: 10 }, { kind: "door", x: 8.5, y: 10.5, r: 1 });              // false (2 squares away)
// anyInMelee([{ x: 0, y: 0, size: 2 }], { kind: "campfire", x: 3.5, y: 2.5 });    // true  (the 2x2 token's edge)
// ```

import { tokenDistance, type Footprint } from "../combat-actions/distance";
import { RANGE_SQUARES } from "./ranges";
import { blockRadiusFactor } from "./sight";
import { defaultTraitRadius, type VisionTraits } from "./traits";
import { SAMPLES_PER_SQUARE } from "./vision";

/** Melee reach in squares (CB p.103). */
export const MELEE_SQUARES = RANGE_SQUARES.melee;

/** An object as reach reads it: a combatMapObjects row (or a layout object) with its resolved sprite traits. */
export type ReachObject = {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
  readonly r?: number | null;
  /** Rotation in radians (turns rect footprints). */
  readonly rot?: number | null;
  /** Resolved sprite traits; absent = the Classic kind's circle. */
  readonly traits?: Pick<VisionTraits, "footprint" | "w" | "h"> | null;
};

export type Square = { readonly x: number; readonly y: number };

const S = SAMPLES_PER_SQUARE;

/** The squares the object's footprint covers (see the file comment), the square under its centre always included. */
export function objectSquares(o: ReachObject): Square[] {
  if (!Number.isFinite(o.x) || !Number.isFinite(o.y)) return [];
  const t = o.traits;
  let inside: (dx: number, dy: number) => boolean;
  let ex: number;
  let ey: number;
  if (t && t.footprint === "rect") {
    const tw = t.w > 0 ? t.w : 1;
    const th = t.h > 0 ? t.h : 1;
    const scale = o.r ? o.r / defaultTraitRadius({ w: tw, h: th }) : 1;
    const hw = (tw * scale) / 2;
    const hh = (th * scale) / 2;
    const rot = Number.isFinite(o.rot) ? (o.rot as number) : 0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    ex = Math.abs(hw * cos) + Math.abs(hh * sin);
    ey = Math.abs(hw * sin) + Math.abs(hh * cos);
    const eps = 1e-9;
    // Into the object's frame: rotate by -rot.
    inside = (dx, dy) => Math.abs(dx * cos + dy * sin) <= hw + eps && Math.abs(-dx * sin + dy * cos) <= hh + eps;
  } else {
    const base = (o.r || (t ? defaultTraitRadius(t) : 1)) * blockRadiusFactor(o.kind);
    const rr = o.kind === "door" ? Math.max(base, 0.5) : base;
    ex = ey = rr;
    inside = (dx, dy) => Math.hypot(dx, dy) <= rr;
  }
  const keys = new Set<string>([`${Math.floor(o.x)},${Math.floor(o.y)}`]);
  const sx0 = Math.floor((o.x - ex) * S);
  const sx1 = Math.ceil((o.x + ex) * S);
  const sy0 = Math.floor((o.y - ey) * S);
  const sy1 = Math.ceil((o.y + ey) * S);
  for (let sy = sy0; sy < sy1; sy++) {
    for (let sx = sx0; sx < sx1; sx++) {
      if (inside((sx + 0.5) / S - o.x, (sy + 0.5) / S - o.y)) keys.add(`${Math.floor(sx / S)},${Math.floor(sy / S)}`);
    }
  }
  return [...keys].map((k) => {
    const [x, y] = k.split(",").map(Number) as [number, number];
    return { x, y };
  });
}

/** Whether the token stands within Melee (1 square, Chebyshev; adjacent incl. diagonal, or overlapping) of the object. */
export function inMelee(token: Footprint, o: ReachObject): boolean {
  return objectSquares(o).some((sq) => tokenDistance(token, sq) <= MELEE_SQUARES);
}

/** Whether any of the tokens stands within Melee of the object. */
export function anyInMelee(tokens: readonly Footprint[], o: ReachObject): boolean {
  if (tokens.length === 0) return false;
  const squares = objectSquares(o);
  return tokens.some((token) => squares.some((sq) => tokenDistance(token, sq) <= MELEE_SQUARES));
}
