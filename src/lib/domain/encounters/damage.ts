// Damage, HP and Stress rules of an adversary instance in a running encounter (D8 A4). Pure: the Convex mutations
// (convex/encounterTracking.ts) and the tracker's optimistic updates both use these, so the client predicts exactly
// what the server stores.
//
// Core Book p.91 (applied to adversaries by CB p.193, "These systems function the same way they do for PCs"):
//   "Severe damage is equal to or above your Severe threshold; you mark 3 HP. • Major damage is equal to or above your
//   Major threshold but below Severe; you mark 2 HP. • Minor damage is anything below your Major threshold; you mark
//   1 HP. If you ever reduce incoming damage to 0 or less … you don't mark any HP." The optional Massive Damage rule is
//   not used for adversaries (open question 3: off).
// Core Book p.99: "When a creature has resistance to a damage type, they halve damage of that type before comparing it
//   to their damage thresholds." (26 → 13; an odd amount is rounded down here, see the task doc's QUESTIONS.)
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
// hpForDamage(15, { major: 8, severe: 15 }, true);   // 1 (halved to 7: Minor)
// markStress({ hp: 0, hpMax: 7, stress: 2, stressMax: 2 }, 1); // { stress: 2, hp: 1, overflow: true }
// minionDefeats(7, 3);                                // 3
// ```

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

/** Damage after resistance: halved (rounded down) when `resistant`, never below 0. */
export function damageTaken(amount: number, resistant: boolean): number {
  const taken = resistant ? Math.floor(amount / 2) : amount;
  return Math.max(0, taken);
}

/**
 * Severity of `amount` damage against `thresholds` (CB p.91, p.99). A threshold of null ("None") is never reached;
 * with both null (Minions) any damage defeats.
 */
export function damageSeverity(amount: number, thresholds: Thresholds, resistant: boolean): DamageSeverity {
  const taken = damageTaken(amount, resistant);
  if (taken <= 0) return "none";
  if (thresholds.major === null && thresholds.severe === null) return "defeat";
  if (thresholds.severe !== null && taken >= thresholds.severe) return "severe";
  if (thresholds.major !== null && taken >= thresholds.major) return "major";
  return "minor";
}

/** HP the hit marks: 0 / 1 / 2 / 3, or "all" (every remaining HP) for a block without thresholds. */
export function hpForDamage(amount: number, thresholds: Thresholds, resistant: boolean): number | "all" {
  const severity = damageSeverity(amount, thresholds, resistant);
  return severity === "defeat" ? "all" : { none: 0, minor: 1, major: 2, severe: 3 }[severity];
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
 * marks 1 HP instead (CB p.92), however much Stress overflowed.
 */
export function markStress(tracks: Tracks, delta: number): { stress: number; hp: number; overflow: boolean } {
  const stress = clamp(tracks.stress + delta, tracks.stressMax);
  const overflow = delta > 0 && tracks.stress + delta > tracks.stressMax;
  return { stress, hp: overflow ? clamp(tracks.hp + 1, tracks.hpMax) : tracks.hp, overflow };
}

/** All HP marked (CB p.208). */
export function isDefeated(tracks: Pick<Tracks, "hp" | "hpMax">): boolean {
  return tracks.hp >= tracks.hpMax;
}

/** Vulnerable while every Stress slot is marked (CB p.178); a block with no Stress is never made Vulnerable this way. */
export function vulnerableFromStress(tracks: Pick<Tracks, "stress" | "stressMax">): boolean {
  return tracks.stressMax > 0 && tracks.stress >= tracks.stressMax;
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

/** One HP or Stress click on an instance, as the server applies it; the tracker's optimistic update uses the same. */
export function applyMark<T extends { hp: number; stress: number; defeated: boolean; stats: { hpMax: number; stressMax: number } }>(
  instance: T,
  track: "hp" | "stress",
  delta: number,
): T {
  const tracks = { hp: instance.hp, stress: instance.stress, hpMax: instance.stats.hpMax, stressMax: instance.stats.stressMax };
  const next = track === "hp" ? { ...markHp(tracks, delta), stress: instance.stress } : markStress(tracks, delta);
  return { ...instance, hp: next.hp, stress: next.stress, defeated: isDefeated({ hp: next.hp, hpMax: tracks.hpMax }) };
}

/** A condition switched on or off (conditions don't stack, CB p.102), as the server stores it; also the optimistic update. */
export function applyCondition<C extends string, T extends { conditions: C[] }>(instance: T, condition: C): T {
  const on = instance.conditions.includes(condition);
  return { ...instance, conditions: on ? instance.conditions.filter((c) => c !== condition) : [...instance.conditions, condition] };
}
