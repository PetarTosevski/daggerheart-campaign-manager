// Character rules from the Core Book, chapter 1 (creation) and chapter 2
// (damage thresholds, armor). Pure module: bundled into Convex.

import type { TraitId } from "../../srd/types";
import type { Condition } from "../../validation/characters";

/** Trait modifiers distributed at creation: "+2, +1, +1, 0, 0, −1" (Core p.17). */
export const TRAIT_POOL: readonly number[] = [2, 1, 1, 0, 0, -1];

export const STARTING_STRESS = 6; // "Every class starts with 6 Stress."
export const STARTING_HOPE = 2; // "You start with 2 Hope."
export const BASE_HOPE_MAX = 6; // "to a maximum of 6"; each scar removes one slot
export const STARTING_PROFICIENCY = 1; // "At Level 1, your Proficiency is 1."
export const STARTING_EXPERIENCE_VALUE = 2; // two Experiences at +2
export const STARTING_DOMAIN_CARDS = 2;
export const MAX_LEVEL = 10;

/** True when the six values are exactly the creation pool, in any order. */
export function isValidTraitSpread(traits: Record<TraitId, number>): boolean {
  const values = Object.values(traits).slice().sort((a, b) => a - b);
  const pool = TRAIT_POOL.slice().sort((a, b) => a - b);
  return values.length === pool.length && values.every((v, i) => v === pool[i]);
}

/**
 * Hope slots left: 6, plus a seventh from Light in the Dark (`hopeSlotBonus`,
 * CB 40, dcm-bxp.14), minus one per scar (CB 18 and 90: "a maximum of 6"; CB 106, scars).
 */
export function hopeMax(scars: number, hopeSlotBonus = 0): number {
  return Math.max(0, BASE_HOPE_MAX + hopeSlotBonus - scars);
}

/** The most scars a sheet can hold: one per Hope slot, Light in the Dark's included (CB 40, 106). */
export function scarsMax(hopeSlotBonus = 0): number {
  return BASE_HOPE_MAX + hopeSlotBonus;
}

/** Tier of a level: 1 (level 1), 2 (2–4), 3 (5–7), 4 (8–10). */
export function tierForLevel(level: number): 1 | 2 | 3 | 4 {
  if (level >= 8) return 4;
  if (level >= 5) return 3;
  if (level >= 2) return 2;
  return 1;
}

export type Thresholds = { major: number; severe: number };

/**
 * Damage thresholds: the armor's base thresholds plus the character's level;
 * unarmored, Major = level and Severe = 2 × level (Core p.18, "Unarmored").
 * `bonus` adds permanent modifiers to both values.
 */
export function damageThresholds(level: number, armorBase: Thresholds | null, bonus = 0): Thresholds {
  if (!armorBase) return { major: level + bonus, severe: level * 2 + bonus };
  return { major: armorBase.major + level + bonus, severe: armorBase.severe + level + bonus };
}

export type Severity = "none" | "minor" | "major" | "severe";

/** Severity of incoming damage against the thresholds. */
export function damageSeverity(damage: number, t: Thresholds): Severity {
  if (damage <= 0) return "none";
  if (damage >= t.severe) return "severe";
  if (damage >= t.major) return "major";
  return "minor";
}

const MARKS: Record<Severity, number> = { none: 0, minor: 1, major: 2, severe: 3 };
const ORDER: Severity[] = ["none", "minor", "major", "severe"];

/**
 * Hit Points to mark: Minor 1, Major 2, Severe 3. Marking an Armor Slot
 * reduces the severity by one threshold ("Severe to Major, Major to Minor, or
 * Minor to None"); one slot per attack.
 */
export function hitPointsToMark(damage: number, t: Thresholds, useArmorSlot = false): { severity: Severity; marks: number } {
  let severity = damageSeverity(damage, t);
  if (useArmorSlot && severity !== "none") severity = ORDER[ORDER.indexOf(severity) - 1];
  return { severity, marks: MARKS[severity] };
}

/**
 * Marks Stress ("Marking Stress", Core ch. 3): "If you're ever forced to mark
 * 1 or more Stress but your slots are already full, you must instead mark 1
 * Hit Point" — one Hit Point in total, however much Stress overflowed. Marking
 * the last Stress slot makes the character Vulnerable until they clear one.
 */
export function markStress(
  current: { stress: number; stressMax: number; hp: number; hpMax: number },
  amount: number,
): { stress: number; hp: number; vulnerable: boolean } {
  const free = Math.max(0, current.stressMax - current.stress);
  const toStress = Math.min(free, Math.max(0, amount));
  const overflow = amount - toStress > 0;
  const stress = current.stress + toStress;
  return {
    stress,
    hp: overflow ? Math.min(current.hpMax, current.hp + 1) : current.hp,
    vulnerable: stress >= current.stressMax,
  };
}

const MODIFIER = /([+\-−]\d+) to (Evasion|Armor Score)(?! while)/g;

/**
 * Permanent Evasion and Armor Score modifiers from equipped items' features,
 * e.g. "Heavy: −1 to Evasion", "+1 to Armor Score". Conditional modifiers
 * ("… while it's active") are left to the player.
 */
export function equipmentModifiers(featureTexts: readonly (string | undefined)[]): { evasion: number; armorScore: number } {
  let evasion = 0;
  let armorScore = 0;
  for (const text of featureTexts) {
    if (!text) continue;
    for (const m of text.matchAll(MODIFIER)) {
      const value = Number(m[1].replace("−", "-"));
      if (m[2] === "Evasion") evasion += value;
      else armorScore += value;
    }
  }
  return { evasion, armorScore };
}

export type Resource = "hp" | "stress" | "hope" | "scars";
type Tracks = {
  hp: number;
  hpMax: number;
  stress: number;
  stressMax: number;
  hope: number;
  scars: number;
  hopeSlotBonus?: number;
  conditions?: readonly Condition[];
};

/**
 * Marks or clears a resource track by `delta` (used by the server's
 * adjustResource and optimistic UI updates). Hope stops at `hopeMax`;
 * clearing a Hit Point wakes an Unconscious character (CB 106, Avoid Death).
 */
export function applyResourceDelta<T extends Tracks>(sheet: T, resource: Resource, delta: number): T {
  const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n));
  const max = (scars: number) => hopeMax(scars, sheet.hopeSlotBonus ?? 0);
  const next = { ...sheet };
  if (resource === "hp") {
    next.hp = clamp(sheet.hp + delta, sheet.hpMax);
    if (next.hp < sheet.hp && sheet.conditions?.includes("unconscious")) {
      Object.assign(next, { conditions: sheet.conditions.filter((c) => c !== "unconscious") });
    }
  }
  if (resource === "stress") {
    if (delta > 0) {
      const marked = markStress(sheet, delta);
      next.stress = marked.stress;
      next.hp = marked.hp;
    } else next.stress = clamp(sheet.stress + delta, sheet.stressMax);
  }
  if (resource === "hope") next.hope = clamp(sheet.hope + delta, max(sheet.scars));
  if (resource === "scars") {
    next.scars = clamp(sheet.scars + delta, scarsMax(sheet.hopeSlotBonus ?? 0));
    next.hope = Math.min(next.hope, max(next.scars));
  }
  return next;
}

