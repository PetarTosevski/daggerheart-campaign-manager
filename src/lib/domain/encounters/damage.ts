// Damage, HP and Stress rules of an adversary instance in a running encounter (D8 A4). Pure: the Convex mutations
// (convex/encounterTracking.ts) and the tracker's optimistic updates both use these, so the client predicts exactly
// what the server stores.
//
// Core Book p.91 (applied to adversaries by CB p.193, "These systems function the same way they do for PCs"):
//   "Severe damage is equal to or above your Severe threshold; you mark 3 HP. • Major damage is equal to or above your
//   Major threshold but below Severe; you mark 2 HP. • Minor damage is anything below your Major threshold; you mark
//   1 HP. If you ever reduce incoming damage to 0 or less … you don't mark any HP."
// Core Book p.91, "OPTIONAL RULE: MASSIVE DAMAGE": "your table can implement a Massive threshold. If you ever take damage
//   equal to double your Severe threshold, you mark 4 Hit Points." A campaign switch (rule `massiveDamage`, off by
//   default; user 2026-10-30: PCs and adversaries): damage at or above twice the Severe threshold marks 4 HP.
// Core Book p.99: "When a creature has resistance to a damage type, they halve damage of that type before comparing it
//   to their damage thresholds." (26 → 13; an odd amount is rounded up, CB p.107 "round up unless otherwise specified".)
//
// Rule switches (plan rule-switches, tracer RDM; docs/tasks/TASK-RULES-RDM.md): every rule function takes a
// `DamageRules` (the campaign's modes; `ruleModesOf(campaign)` fits) whose missing fields are the Book behaviour, so a
// caller that passes nothing behaves as before. Manual: D2 `resistance` applies the full damage; D4 `stressOverflow`
// drops the extra Stress (the result still says `overflow`); D5 `fullStressVulnerable` never makes a full track
// Vulnerable (`stressFull` still says it is full); D8 `adversaryDefeated` never defeats at the last HP (`lastHp`).
// Core Book p.92: "If you're ever forced to mark 1 or more Stress but your slots are already full, you must instead
//   mark 1 Hit Point … If you would take 2 Stress from an enemy and you have 1 Stress left, you would mark 1 Stress and
//   1 Hit Point." Applied to adversaries (open question 2: yes).
// Core Book p.178: "an adversary or PC becomes Vulnerable while their Stress slots are full".
// Core Book p.199: "Horde (X) - Passive: When the Horde has marked half or more of their HP, their standard attack deals
//   X damage instead."
// Core Book p.201: "Minion (X) - Passive: This adversary is defeated when they take any damage. For every X damage a PC
//   deals to this adversary, defeat an additional Minion within range the attack would succeed against." The count is
//   a suggestion the GM confirms (open question 4), since range is the GM's call.
// Core Book p.208: "When an adversary marks their last Hit Point, they are defeated".
//
// ```ts
// hpForDamage(9, { major: 8, severe: 15 }, false);   // 2 (Major)
// hpForDamage(15, { major: 8, severe: 15 }, true);   // 2 (halved to 8, rounded up: Major)
// hpForDamage(30, { major: 8, severe: 15 }, false, { massiveDamage: true }); // 4 (Massive, CB p.91)
// markStress({ hp: 0, hpMax: 7, stress: 2, stressMax: 2 }, 1); // { stress: 2, hp: 1, overflow: true }
// minionDefeats(7, 3);                                // 3
// ```

import type { RuleModes } from "../../rules/registry";

/**
 * The damage rules' modes (plan rule-switches): D2 `resistance`, D4 `stressOverflow`, D5 `fullStressVulnerable`, D8
 * `adversaryDefeated` and the optional `massiveDamage`. A missing field is the Book behaviour (Massive Damage off), so
 * `{}` is today's rules; `ruleModesOf(campaign)` can be passed as it is.
 */
export type DamageRules = Partial<Pick<RuleModes, "resistance" | "stressOverflow" | "fullStressVulnerable" | "adversaryDefeated" | "massiveDamage">>;

/** The Book rules: what every caller that passes no modes gets. */
export const BOOK_DAMAGE_RULES: DamageRules = {};

/** Largest damage number the tracker accepts. */
export const MAX_DAMAGE = 999;

export type Thresholds = { major: number | null; severe: number | null };

/** How a hit landed: no HP, Minor (1), Major (2), Severe (3), or "defeat" when the block has no thresholds at all. */
export type DamageSeverity = "none" | "minor" | "major" | "severe" | "defeat";

export const SEVERITY_LABEL: Record<DamageSeverity, string> = {
  none: "No damage",
  minor: "Minor",
  major: "Major",
  severe: "Severe",
  defeat: "Defeated",
};

/**
 * Damage after resistance: halved and rounded up (CB p.107 "round up", Q6) when `resistant`, never below 0. D2 Manual:
 * the full damage (the caller tells the GM "Target resists: halve?").
 */
export function damageTaken(amount: number, resistant: boolean, rules: DamageRules = BOOK_DAMAGE_RULES): number {
  const taken = resistant && rules.resistance !== "manual" ? Math.ceil(amount / 2) : amount;
  return Math.max(0, taken);
}

/**
 * Whether `taken` damage (after resistance) reaches the Massive threshold, twice the Severe threshold (CB p.91), with
 * the optional rule on. Never without a Severe threshold.
 */
export function isMassive(taken: number, thresholds: Pick<Thresholds, "severe">, rules: DamageRules = BOOK_DAMAGE_RULES): boolean {
  return rules.massiveDamage === true && thresholds.severe !== null && thresholds.severe > 0 && taken >= 2 * thresholds.severe;
}

/**
 * Severity of `amount` damage against `thresholds` (CB p.91, p.99). A threshold of null ("None") is never reached;
 * with both null (Minions) any damage defeats. Massive damage is still "severe" here; `hpForDamage` marks its 4 HP.
 */
export function damageSeverity(amount: number, thresholds: Thresholds, resistant: boolean, rules: DamageRules = BOOK_DAMAGE_RULES): DamageSeverity {
  const taken = damageTaken(amount, resistant, rules);
  if (taken <= 0) return "none";
  if (thresholds.major === null && thresholds.severe === null) return "defeat";
  if (thresholds.severe !== null && taken >= thresholds.severe) return "severe";
  if (thresholds.major !== null && taken >= thresholds.major) return "major";
  return "minor";
}

/** HP the hit marks: 0 / 1 / 2 / 3 (4 for Massive damage, CB p.91), or "all" (every remaining HP) for a block without thresholds. */
export function hpForDamage(amount: number, thresholds: Thresholds, resistant: boolean, rules: DamageRules = BOOK_DAMAGE_RULES): number | "all" {
  const severity = damageSeverity(amount, thresholds, resistant, rules);
  if (severity === "defeat") return "all";
  if (severity === "severe" && isMassive(damageTaken(amount, resistant, rules), thresholds, rules)) return 4;
  return { none: 0, minor: 1, major: 2, severe: 3 }[severity];
}

/** An instance's tracks as the rules see them. */
export type Tracks = { hp: number; hpMax: number; stress: number; stressMax: number };

const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));

/** HP marked (positive) or cleared (negative) by `delta`, kept within 0..hpMax. */
export function markHp(tracks: Tracks, delta: number): { hp: number } {
  return { hp: clamp(tracks.hp + delta, tracks.hpMax) };
}

/**
 * Stress marked (positive) or cleared (negative) by `delta`, kept within 0..stressMax. Marking past a full track
 * marks 1 HP instead (CB p.92), however much Stress overflowed. D4 Manual: the extra Stress is dropped and no HP is
 * marked; `overflow` still says it happened, so the caller can tell the GM.
 */
export function markStress(tracks: Tracks, delta: number, rules: DamageRules = BOOK_DAMAGE_RULES): { stress: number; hp: number; overflow: boolean } {
  const stress = clamp(tracks.stress + delta, tracks.stressMax);
  const overflow = delta > 0 && tracks.stress + delta > tracks.stressMax;
  const marksHp = overflow && rules.stressOverflow !== "manual";
  return { stress, hp: marksHp ? clamp(tracks.hp + 1, tracks.hpMax) : tracks.hp, overflow };
}

/** Every HP marked: the adversary's last HP is marked (CB p.208), whatever the D8 mode. */
export function lastHp(tracks: Pick<Tracks, "hp" | "hpMax">): boolean {
  return tracks.hp >= tracks.hpMax;
}

/** All HP marked (CB p.208). D8 Manual: never; the adversary stays up until the GM marks it defeated. */
export function isDefeated(tracks: Pick<Tracks, "hp" | "hpMax">, rules: DamageRules = BOOK_DAMAGE_RULES): boolean {
  return rules.adversaryDefeated !== "manual" && lastHp(tracks);
}

/** Every Stress slot marked; a block with no Stress never is. */
export function stressFull(tracks: Pick<Tracks, "stress" | "stressMax">): boolean {
  return tracks.stressMax > 0 && tracks.stress >= tracks.stressMax;
}

/**
 * Vulnerable while every Stress slot is marked (CB p.178); a block with no Stress is never made Vulnerable this way.
 * D5 Manual: never (the tracker shows "Stress full" only; the GM adds Vulnerable by hand).
 */
export function vulnerableFromStress(tracks: Pick<Tracks, "stress" | "stressMax">, rules: DamageRules = BOOK_DAMAGE_RULES): boolean {
  return rules.fullStressVulnerable !== "manual" && stressFull(tracks);
}

/** Half or more of the HP marked: a Horde's attack now deals its Horde (X) damage (CB p.199). */
export function hordeHalved(tracks: Pick<Tracks, "hp" | "hpMax">): boolean {
  return tracks.hp >= Math.ceil(tracks.hpMax / 2);
}

/**
 * Minions the hit defeats, as a suggestion (CB p.201): the one hit, plus one more per X damage. 0 for no damage;
 * at most `remaining` when given.
 */
export function minionDefeats(amount: number, x: number | null, remaining?: number): number {
  if (amount <= 0) return 0;
  const count = 1 + (x !== null && x > 0 ? Math.floor(amount / x) : 0);
  return remaining === undefined ? count : Math.min(count, Math.max(0, remaining));
}

/**
 * One HP or Stress click on an instance, as the server applies it; the tracker's optimistic update uses the same.
 * D8 Manual: marking HP never defeats; a defeated flag stays while every HP is still marked.
 */
export function applyMark<T extends { hp: number; stress: number; defeated: boolean; stats: { hpMax: number; stressMax: number } }>(
  instance: T,
  track: "hp" | "stress",
  delta: number,
  rules: DamageRules = BOOK_DAMAGE_RULES,
): T {
  const tracks = { hp: instance.hp, stress: instance.stress, hpMax: instance.stats.hpMax, stressMax: instance.stats.stressMax };
  const next = track === "hp" ? { ...markHp(tracks, delta), stress: instance.stress } : markStress(tracks, delta, rules);
  return { ...instance, hp: next.hp, stress: next.stress, defeated: defeatedAfter(instance.defeated, { hp: next.hp, hpMax: tracks.hpMax }, rules) };
}

/**
 * The defeated flag after the tracks changed: Book, every HP marked (CB p.208); D8 Manual, a flag already set stays
 * while every HP is still marked, and marking the last HP never sets it.
 */
export function defeatedAfter(wasDefeated: boolean, tracks: Pick<Tracks, "hp" | "hpMax">, rules: DamageRules = BOOK_DAMAGE_RULES): boolean {
  return rules.adversaryDefeated === "manual" ? wasDefeated && lastHp(tracks) : isDefeated(tracks, rules);
}

/** A condition switched on or off (conditions don't stack, CB p.102), as the server stores it; also the optimistic update. */
export function applyCondition<C extends string, T extends { conditions: C[] }>(instance: T, condition: C): T {
  const on = instance.conditions.includes(condition);
  return { ...instance, conditions: on ? instance.conditions.filter((c) => c !== condition) : [...instance.conditions, condition] };
}
