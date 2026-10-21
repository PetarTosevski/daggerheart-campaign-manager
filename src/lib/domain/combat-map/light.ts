/**
 * Light by campaign time (R8) and light sources (R9, Q2, Q3).
 *
 * R8: Day phases and Nautical Dawn = full vision in the cone. Dim phases are
 * ONLY Nautical Twilight (last DAY day) and Nightfall (first NIGHT day): full
 * vision, tokens shown, ranged attacks at disadvantage. Other night phases are
 * night. (The board wrongly listed Nautical Dawn as dim.)
 *
 * R9 at night, [clear, dim] reach in squares: no light [1, 3]; torch and
 * lantern [6, 12]; Alistair's Torch [12, 12] (clear to Far, CB p.129);
 * wall torch [6, 12]; campfire [12, 24].
 */

import type { CampaignPhaseName } from "../campaign-time";
import { RANGE_SQUARES } from "./ranges";
import type { LightTrait } from "./traits";

/** "day": full vision; "dim": full vision + disadvantage badge; "night": lights only. */
export type LightLevel = "day" | "dim" | "night";

const NIGHT_PHASES: ReadonlySet<string> = new Set<CampaignPhaseName>([
  "Nightfall",
  "Moonrise",
  "Deep Night",
  "Midnight",
  "Witching Hour",
  "Small Hours",
  "Nautical Dawn",
]);

/** R8: the only dim phases. Nautical Dawn is NOT dim (board fix). */
export const DIM_PHASES: ReadonlySet<string> = new Set<CampaignPhaseName>([
  "Nautical Twilight",
  "Nightfall",
]);

/** Badge text for the dim phases (brief, section 5). */
export const DIM_PHASE_BADGE = "Dim light: ranged attacks at disadvantage";

/** R8: the light level for a campaign time phase. Unknown names count as day. */
export function lightOf(phase: CampaignPhaseName | string): LightLevel {
  if (DIM_PHASES.has(phase)) return "dim";
  if (phase === "Nautical Dawn") return "day";
  if (NIGHT_PHASES.has(phase)) return "night";
  return "day";
}

/** A reach pair in squares: clear up to `clear`, dim up to `dim`. */
export type LightReach = readonly [clear: number, dim: number];

export type CarriedLight = "none" | "torch" | "lantern" | "alistair";

export const CARRIED_LIGHTS: readonly CarriedLight[] = ["none", "torch", "lantern", "alistair"];

/**
 * R9 carried light reach at night. "none" is the bearer's own night vision
 * (clear in Melee, dim to Very Close) and lights nothing for anyone else.
 * Lantern = torch (Q2). Any token may carry one (Q3).
 */
export const CARRIED_LIGHT_REACH: Readonly<Record<CarriedLight, LightReach>> = {
  none: [RANGE_SQUARES.melee, RANGE_SQUARES.veryClose],
  torch: [RANGE_SQUARES.close, RANGE_SQUARES.far],
  lantern: [RANGE_SQUARES.close, RANGE_SQUARES.far],
  alistair: [RANGE_SQUARES.far, RANGE_SQUARES.far],
};

export const CARRIED_LIGHT_LABEL: Readonly<Record<CarriedLight, string>> = {
  none: "No light",
  torch: "Torch",
  lantern: "Lantern",
  alistair: "Alistair’s Torch",
};

/**
 * Sprite-packs Q1 (answered b): faint glow, for things that only glow (candles,
 * candelabra, glowing mushrooms, luminous moss, crystals, wisps, lava): clear
 * in Melee (1), dim to Very Close (3). Tunable here. A switchable map light
 * like the others; its dim band hides tokens at night (R10).
 */
export const FAINT_GLOW_REACH: LightReach = [RANGE_SQUARES.melee, RANGE_SQUARES.veryClose];

/**
 * R9 map lights (objects the GM and players switch on and off), keyed by
 * Classic kind, plus `faintglow`, the sprite light trait of Q1 (no Classic
 * object kind has that name).
 */
export const MAP_LIGHT_REACH: Readonly<Record<string, LightReach>> = {
  torch: [RANGE_SQUARES.close, RANGE_SQUARES.far],
  walltorch: [RANGE_SQUARES.close, RANGE_SQUARES.far],
  campfire: [RANGE_SQUARES.far, RANGE_SQUARES.far * 2],
  faintglow: FAINT_GLOW_REACH,
};

export function isLightObject(kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(MAP_LIGHT_REACH, kind);
}

/** An object as the light rules read it: a Classic kind, optionally sprite traits (P3). */
export type LightSubject = {
  readonly kind: string;
  readonly lit?: boolean | null;
  readonly traits?: { readonly light?: LightTrait | null } | null;
};

/**
 * The reach of an object's light when lit, or null if it gives none: the
 * sprite's light trait when it has one (Q1; "none" = no light, even on a
 * Classic light kind), else the Classic kind (R9, D2).
 */
export function mapLightReach(object: LightSubject): LightReach | null {
  const trait = object.traits?.light;
  if (trait) return trait === "none" ? null : (MAP_LIGHT_REACH[trait] ?? null);
  return isLightObject(object.kind) ? MAP_LIGHT_REACH[object.kind] : null;
}

/** A switchable map light: a Classic light kind, or a sprite whose light trait is not none. */
export function givesLight(object: LightSubject): boolean {
  return mapLightReach(object) !== null;
}

/** A map light is lit unless switched off (`lit === false`), as on the board. */
export function isLit(object: LightSubject): boolean {
  return givesLight(object) && object.lit !== false;
}
