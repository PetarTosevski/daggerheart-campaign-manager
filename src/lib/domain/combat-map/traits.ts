/**
 * Per-object vision traits (sprite-packs P3). A sprite object carries the
 * traits its pack manifest gives it (P1 `spriteTraits`); Classic objects carry
 * none and behave exactly as before (E5).
 *
 * D3: sight = the GM's per-object override ?? traits.sight ?? the Classic
 * kind's R7 default. Q1 (answered b): light is none, faint glow, torch or
 * campfire; any light other than none is a switchable map light (R9-R11).
 * D4: footprint w x h squares; `r` scales it (default r = max(w, h) / 2) and
 * `rot` (radians) turns it.
 */

import type { SightMode } from "./sight";

/** Light a sprite gives (Q1 = b). "faintglow" is FAINT_GLOW_REACH in light.ts. */
export type LightTrait = "none" | "faintglow" | "torch" | "campfire";

export const LIGHT_TRAITS: readonly LightTrait[] = ["none", "faintglow", "torch", "campfire"];

/** "circle": a round footprint (trees, boulders, props); "rect": a long one (wall sections, counters, bridges). */
export type FootprintShape = "circle" | "rect";

export type VisionTraits = {
  /** The manifest's sight default (D3); the object's own `sight` field still wins. */
  readonly sight: SightMode;
  readonly light: LightTrait;
  readonly footprint: FootprintShape;
  /** Size in squares (1..4 per side, D4). */
  readonly w: number;
  readonly h: number;
};

/** D4: the radius an object with traits has when `r` is unset. */
export function defaultTraitRadius(traits: Pick<VisionTraits, "w" | "h">): number {
  return Math.max(traits.w, traits.h) / 2;
}
