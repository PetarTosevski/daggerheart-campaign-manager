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

/** R9 map lights (objects the GM and players switch on and off). */
export const MAP_LIGHT_REACH: Readonly<Record<string, LightReach>> = {
  torch: [RANGE_SQUARES.close, RANGE_SQUARES.far],
  walltorch: [RANGE_SQUARES.close, RANGE_SQUARES.far],
  campfire: [RANGE_SQUARES.far, RANGE_SQUARES.far * 2],
};

export function isLightObject(kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(MAP_LIGHT_REACH, kind);
}

/** A map light is lit unless switched off (`lit === false`), as on the board. */
export function isLit(object: { readonly kind: string; readonly lit?: boolean | null }): boolean {
  return isLightObject(object.kind) && object.lit !== false;
}
