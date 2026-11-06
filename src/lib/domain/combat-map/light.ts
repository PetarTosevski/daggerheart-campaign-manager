/**
 * Light by campaign time (R8) and light sources (R9, Q2, Q3).
 *
 * R8, as changed by dcm-p40 (user 2026-10-30): dim light is the last day of a day cycle and the first day of a night
 * cycle (Nautical Twilight, Nightfall), and the last day of a night cycle and the first day of a day cycle (Nautical
 * Dawn, Dawn). Dim = full vision, tokens shown, ranged attacks at disadvantage. Every other day phase is day, every
 * other night phase is night.
 *
 * Every campaign has a time of day (dcm-bxp.54, user 2026-10-21 / 2026-10-30): outside the Witherwild it is the GM's
 * Day / Dim / Night (`campaigns.timeOfDay`), so `lightOf` also reads a light level as itself.
 *
 * R9 at night, [clear, dim] reach in squares: no light [1, 3]; torch and
 * lantern [6, 12]; Alistair's Torch [12, 12] (clear to Far, CB p.129);
 * wall torch [6, 12]; campfire [12, 24].
 */

import type { ModeOf } from "../../rules/registry";
import type { CampaignPhaseName } from "../campaign-time";
import { RANGE_SQUARES } from "./ranges";
import type { LightTrait } from "./traits";

/** "day": full vision; "dim": full vision + disadvantage badge; "night": lights only. */
export type LightLevel = "day" | "dim" | "night";

export const LIGHT_LEVELS: readonly LightLevel[] = ["day", "dim", "night"];

export const LIGHT_LEVEL_LABEL: Readonly<Record<LightLevel, string>> = { day: "Day", dim: "Dim", night: "Night" };

export function isLightLevel(value: unknown): value is LightLevel {
  return value === "day" || value === "dim" || value === "night";
}

const NIGHT_PHASES: ReadonlySet<string> = new Set<CampaignPhaseName>([
  "Moonrise",
  "Deep Night",
  "Midnight",
  "Witching Hour",
  "Small Hours",
]);

/** R8 / dcm-p40: the dim phases, the boundary days of the day and night cycles (days 1 and 7 of each). */
export const DIM_PHASES: ReadonlySet<string> = new Set<CampaignPhaseName>([
  "Dawn",
  "Nautical Twilight",
  "Nightfall",
  "Nautical Dawn",
]);

/** Badge text for dim light (brief, section 5). */
export const DIM_PHASE_BADGE = "Dim light: ranged attacks at disadvantage";

/** M3 Darkness (plan rule-switches RM): Book (the badge), the variants (tracer OE) or Manual. */
export type DarknessMode = ModeOf<"darkness">;

/**
 * M3 (plan rule-switches RM; CB p.104: "Darkness can also make certain actions more challenging. The GM should reflect
 * this by raising the Difficulty of action rolls or imposing disadvantage"). The dim-light badge, or null: Book shows
 * `DIM_PHASE_BADGE` in dim light (nothing is added to a roll); Manual shows none (the GM rules it at the table). The
 * variants (disadvantage, +N Difficulty, both) keep the Book badge here until tracer OE gives them their own.
 */
export function dimLightBadge(light: LightLevel, mode: DarknessMode = "book"): string | null {
  if (light !== "dim" || mode === "manual") return null;
  return DIM_PHASE_BADGE;
}

/**
 * R8: the light level for a campaign time phase (dcm-p40), or a light level read as itself (the campaign's time of
 * day outside the Witherwild, dcm-bxp.54). Unknown names count as day.
 */
export function lightOf(phase: CampaignPhaseName | LightLevel | string): LightLevel {
  if (isLightLevel(phase)) return phase;
  if (DIM_PHASES.has(phase)) return "dim";
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

/**
 * Glowing terrain (followups-5 F6, dcm-bxp.91; user 2026-10-21: "glowing terrain gives off light like other
 * faint-glow objects - very dim light only around its own squares"). The Classic terrains that glow. A Sprites map
 * asks its textures instead (a texture whose light trait is not none glows: `glowingSquares` in
 * src/lib/combat-map/sprites/terrain.ts). Each glowing square is a faint-glow light at its centre, always lit
 * (terrain has no switch).
 */
export const GLOWING_TERRAINS: ReadonlySet<string> = new Set(["lava"]);

/** The reach of one glowing square's light: the faint glow (clear in Melee, dim to Very Close). */
export const TERRAIN_GLOW_REACH: LightReach = FAINT_GLOW_REACH;

/** Whether a Classic terrain glows (F6). */
export function terrainGlows(terrain: string | null | undefined): boolean {
  return typeof terrain === "string" && GLOWING_TERRAINS.has(terrain);
}

/** A map light is lit unless switched off (`lit === false`), as on the board. */
export function isLit(object: LightSubject): boolean {
  return givesLight(object) && object.lit !== false;
}
