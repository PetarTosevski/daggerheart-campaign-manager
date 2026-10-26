// Lunar Phases (Moon Witch mastery, Hope & Fear p.17). Pure: bundled into Convex, shared with the sheet.
//
// "At the beginning of each session, roll a d6 and place it on this card. You gain the matching effect until the
// end of session. 1 New: Spend a Hope to negate Minor damage. 2-3 Waxing: +2 to damage rolls. 4 Full: +3 to damage
// thresholds. 5-6 Waning: +1 to Evasion. Once per rest, you can spend a Hope to increase the value of this die by
// one. If you increase the value of a 6, it becomes a 1."
//
// U6: the die is rolled at session start; Waxing, Full and Waning apply automatically (hooks.ts damage option,
// derived.ts thresholds and Evasion); New offers to spend a Hope to negate Minor damage; the once-per-rest bump is
// the featureUses entry `lunarPhasesBump` until "rest" (expired by any rest, CB 105).
import { RuleError } from "../../errors/app-error";
import type { FeatureScope, Rng } from "../class-features/types";
import type { Severity } from "../characters/index";
import type { CharacterSheet } from "../../validation/characters";
import { EVERYTHING, holdsLunarPhases } from "./holders";
import { featuresOf, withFeatures } from "./state";

export type MoonPhaseKey = "new" | "waxing" | "full" | "waning";

export type MoonPhase = {
  key: MoonPhaseKey;
  /** "New", "Waxing", "Full", "Waning". */
  name: string;
  /** The die values that give this phase. */
  min: number;
  max: number;
  /** The effect, as the sheet shows it. */
  effect: string;
};

/** The four phases in die order (HF 17). */
export const MOON_PHASES: readonly MoonPhase[] = [
  { key: "new", name: "New", min: 1, max: 1, effect: "Spend a Hope to negate Minor damage" },
  { key: "waxing", name: "Waxing", min: 2, max: 3, effect: "+2 to damage rolls" },
  { key: "full", name: "Full", min: 4, max: 4, effect: "+3 to damage thresholds" },
  { key: "waning", name: "Waning", min: 5, max: 6, effect: "+1 to Evasion" },
];

/** The featureUses key of the once-per-rest bump. */
export const LUNAR_BUMP_KEY = "lunarPhasesBump";

/** The phase of a die value 1-6 (1 New, 2-3 Waxing, 4 Full, 5-6 Waning). Throws on any other value (a bug). */
export function phaseOf(die: number): MoonPhase {
  const phase = MOON_PHASES.find((p) => die >= p.min && die <= p.max);
  if (!Number.isInteger(die) || phase === undefined) throw new Error(`Not a moon die value: ${die}`);
  return phase;
}

/** "4 (Full: +3 to damage thresholds)": how reports and the feed name a die. */
export function moonDieLabel(die: number): string {
  const phase = phaseOf(die);
  return `${die} (${phase.name}: ${phase.effect})`;
}

/** The moon die on the sheet, or undefined (no phase). */
export function moonDie(sheet: Pick<CharacterSheet, "sessionFeatures">): number | undefined {
  return featuresOf(sheet).moonDie;
}

type LunarSheet = Pick<CharacterSheet, "subclassId"> & Partial<Pick<CharacterSheet, "subclassRank" | "multiclass" | "sessionFeatures">>;

/** The current phase for a Lunar Phases holder with a die, else undefined. */
export function currentPhase(sheet: LunarSheet, scope: FeatureScope = EVERYTHING): MoonPhase | undefined {
  const die = featuresOf(sheet).moonDie;
  return die !== undefined && holdsLunarPhases(sheet, scope) ? phaseOf(die) : undefined;
}

export type LunarBonuses = { damage: 2 | 0; thresholds: 3 | 0; evasion: 1 | 0 };

/**
 * The always-on numbers of the current phase, read only from `sessionFeatures.moonDie` and `holdsLunarPhases`:
 * Waxing +2 damage rolls, Full +3 to both damage thresholds, Waning +1 Evasion; all 0 without a die (E6).
 */
export function lunarBonuses(sheet: LunarSheet, scope: FeatureScope = EVERYTHING): LunarBonuses {
  const key = currentPhase(sheet, scope)?.key;
  return { damage: key === "waxing" ? 2 : 0, thresholds: key === "full" ? 3 : 0, evasion: key === "waning" ? 1 : 0 };
}

/** Rolls the moon die (session start) and places it; the caller decides who holds Lunar Phases. */
export function rollMoonDie<T extends CharacterSheet>(sheet: T, rng: Rng): T {
  return withFeatures(sheet, { moonDie: rng(6) });
}

/** The sheet without its moon die (session end, U8). */
export function endMoon<T extends CharacterSheet>(sheet: T): T {
  return moonDie(sheet) === undefined ? sheet : withFeatures(sheet, { moonDie: undefined });
}

/**
 * The once-per-rest bump (U6): spends a Hope and raises the die by one, a 6 becoming a 1; marks `lunarPhasesBump`
 * until the next rest. Refuses with CLASS_FEATURE_RULE without Lunar Phases, without a die or when already used
 * this rest; NOT_ENOUGH_HOPE at 0 Hope.
 */
export function bumpMoonDie<T extends CharacterSheet>(sheet: T, scope: FeatureScope = EVERYTHING): { sheet: T; from: number; to: number } {
  if (!holdsLunarPhases(sheet, scope)) throw new RuleError("CLASS_FEATURE_RULE", "Only a Moon Witch with the mastery has Lunar Phases.");
  const from = moonDie(sheet);
  if (from === undefined) throw new RuleError("CLASS_FEATURE_RULE", "No moon die: it is rolled when the session starts.");
  if (sheet.featureUses.some((u) => u.key === LUNAR_BUMP_KEY)) throw new RuleError("CLASS_FEATURE_RULE", "You already raised the moon die this rest.");
  if (sheet.hope < 1) throw new RuleError("NOT_ENOUGH_HOPE", "Not enough Hope.");
  const to = from === 6 ? 1 : from + 1;
  const next = withFeatures({ ...sheet, hope: sheet.hope - 1, featureUses: [...sheet.featureUses, { key: LUNAR_BUMP_KEY, until: "rest" as const }] }, { moonDie: to });
  return { sheet: next, from, to };
}

/** Whether the bump was used this rest (the sheet's button disables on it). */
export function bumpUsed(sheet: Pick<CharacterSheet, "featureUses">): boolean {
  return sheet.featureUses.some((u) => u.key === LUNAR_BUMP_KEY);
}

/** Whether a New moon lets the sheet negate damage of this severity (after any Armor Slot): Minor only, 1 Hope to spend. */
export function canNegateMinor(sheet: LunarSheet & Pick<CharacterSheet, "hope">, severity: Severity, scope: FeatureScope = EVERYTHING): boolean {
  return severity === "minor" && currentPhase(sheet, scope)?.key === "new" && sheet.hope >= 1;
}

/** New moon (U6): spends the Hope that negates Minor damage; refuses with CLASS_FEATURE_RULE unless `canNegateMinor`. */
export function negateMinor<T extends CharacterSheet>(sheet: T, severity: Severity, scope: FeatureScope = EVERYTHING): T {
  if (!canNegateMinor(sheet, severity, scope)) throw new RuleError("CLASS_FEATURE_RULE", "Only a New moon negates Minor damage, for a Hope.");
  return { ...sheet, hope: sheet.hope - 1 };
}
