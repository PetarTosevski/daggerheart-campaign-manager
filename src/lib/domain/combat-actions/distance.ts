// Token-to-token distance and range checks on the battle grid (plan combat-actions, tracer CA1). Pure: bundled into
// Convex (the server routes an out-of-range action to the GM's sanction, Q1) and used by the map UI for hints.
//
// CB p.103, "Optional Rule: Defined Ranges": "Melee: 1 square • Very Close: 3 squares • Close: 6 squares • Far: 12
//   squares • Very Far: 13+ squares • Out of Range: Off the battlemap". The bands are `RANGE_BANDS` (combat-map/ranges.ts).
// CB p.103: "these ranges aren't intended to be precisely measured during play". User answer Q1: an attack or card use on
//   a target outside its range is not refused; it waits for the GM's sanction. So `rangeCheck` only reports.
//
// ```ts
// tokenDistance({ x: 0, y: 0 }, { x: 1, y: 1 });               // 1 (diagonal = 1 square: Melee)
// tokenDistance({ x: 0, y: 0, size: 2 }, { x: 5, y: 0 });      // 4 (from the nearest edge square x=1)
// rangeCheck({ x: 0, y: 0 }, { x: 7, y: 0 }, "close");          // { distance: 7, band: "far", inRange: false }
// rangeFromWeapon("Very Close");                                // "veryClose"
// ```

import { rangeBandOf, type RangeBandKey } from "../combat-map/ranges";
import type { Range } from "../card-effects/types";
import type { Range as SrdRange } from "../../srd/types";

/** A token's footprint as the engine needs it: top-left square and size (1-3 squares per side). */
export interface Footprint {
  readonly x: number;
  readonly y: number;
  readonly size?: number;
}

/** Order of the Defined Ranges, nearest first. */
export const RANGE_ORDER: readonly Range[] = ["melee", "veryClose", "close", "far", "veryFar"];

const sizeOf = (t: Footprint) => Math.max(1, Math.min(3, Math.trunc(t.size ?? 1) || 1));

/**
 * Squares between the nearest edges of two footprints, a diagonal step counting as 1 (Chebyshev). Adjacent tokens are 1
 * square apart (Melee), overlapping ones 0.
 */
export function tokenDistance(a: Footprint, b: Footprint): number {
  const axis = (a0: number, as: number, b0: number, bs: number) => Math.max(0, b0 - (a0 + as - 1), a0 - (b0 + bs - 1));
  const sa = sizeOf(a);
  const sb = sizeOf(b);
  return Math.round(Math.max(axis(a.x, sa, b.x, sb), axis(a.y, sa, b.y, sb)));
}

/** The Defined Range a distance falls in (CB p.103); 0 counts as Melee. */
export function bandOf(distance: number): RangeBandKey | "veryFar" {
  return rangeBandOf(Math.max(0, distance));
}

/** The card vocabulary's range for a weapon's printed range ("Very Close" -> "veryClose"). */
export function rangeFromWeapon(range: SrdRange): Range {
  const map: Record<SrdRange, Range> = {
    Melee: "melee",
    "Very Close": "veryClose",
    Close: "close",
    Far: "far",
    "Very Far": "veryFar",
  };
  return map[range];
}

/** Whether `band` is within `range`: nearer or equal. Very Far reaches everything on the map (only off the map is out). */
export function withinRange(band: Range, range: Range | "unlimited"): boolean {
  if (range === "unlimited") return true;
  return RANGE_ORDER.indexOf(band) <= RANGE_ORDER.indexOf(range);
}

export interface RangeCheck {
  distance: number;
  band: Range;
  /** False sends the action to the GM's sanction (Q1); it never refuses on its own. */
  inRange: boolean;
}

/** Distance, band and whether `to` is within `range` of `from` (CB p.103, Q1). */
export function rangeCheck(from: Footprint, to: Footprint, range: Range | "unlimited"): RangeCheck {
  const distance = tokenDistance(from, to);
  const band = bandOf(distance);
  return { distance, band, inRange: withinRange(band, range) };
}
