// Damage, Stress and HP on a creature hit by a PC's move (plan combat-actions, tracer CA1; rules R3, R5, R10). Pure:
// reuses the tracker's rules in encounters/damage.ts so the map and the encounter tracker never disagree.
//
// CB p.99, "Resistance and Immunity": "When a creature has resistance to a damage type, they halve damage of that type
//   before comparing it to their damage thresholds. … when your character deals 26 physical damage to a creature with
//   physical resistance, the creature only takes 13 physical damage. … When a creature has immunity to a damage type,
//   they do not take any damage from an attack that deals damage of that type. … If an attack deals both physical and
//   magic damage, you can only benefit from resistance or immunity if you are resistant or immune to both damage types."
//   Halving rounds down (encounters/damage.ts `damageTaken`; plan acceptance; see the task doc's QUESTIONS).
// CB p.91, "Marking Hit Points": Severe 3 HP, Major 2 HP, Minor 1 HP; "If you ever reduce incoming damage to 0 or less
//   …, you don't mark any HP." Adversaries alike (CB p.193). The optional Massive Damage rule is off for adversaries.
// CB p.201, "Minion (X)": "This adversary is defeated when they take any damage. For every X damage a PC deals to this
//   adversary, defeat an additional Minion within range the attack would succeed against."
// CB p.92, "Marking Stress": "If you're ever forced to mark 1 or more Stress but your slots are already full, you must
//   instead mark 1 Hit Point."
// CB p.208: "When an adversary marks their last Hit Point, they are defeated".
//
// ```ts
// applyDamageTo(bandit, 26, "physical");  // physical resistance: taken 13, then thresholds
// applyDamageTo(minion, 7, "magic");      // defeated, minionExtra = floor(7 / X)
// applyStressTo(bandit, 2);               // overflow past a full track marks 1 HP
// ```

import {
  damageSeverity,
  damageTaken,
  hpForDamage,
  isDefeated,
  markHp,
  markStress,
  type DamageSeverity,
  type Thresholds,
} from "../encounters/damage";
import type { DamageType, Severity } from "../card-effects/types";
import type { ResistanceLevel } from "../../srd/adversary-resistance";

export type { ResistanceLevel, Thresholds };

/** A creature a move can hit: an adversary instance or a PC, as the engine needs it. */
export interface Combatant {
  readonly id: string;
  readonly side: "pc" | "adversary";
  /** An adversary's Difficulty (CB p.193). */
  readonly difficulty?: number;
  /** A PC's Evasion. */
  readonly evasion?: number;
  /** Null = "None" (never reached); both null (Minions) = any damage defeats. */
  readonly thresholds: Thresholds;
  readonly hp: number;
  readonly hpMax: number;
  readonly stress: number;
  readonly stressMax: number;
  readonly armor?: number;
  readonly armorMax?: number;
  readonly defeated: boolean;
  /** X of "Minion (X)", or null / absent. */
  readonly minionX?: number | null;
  /** Always-on (or GM-toggled) resistance (CA2's table, the instance's `resistance` when active). */
  readonly resistance?: { readonly physical: ResistanceLevel; readonly magic: ResistanceLevel };
  /** Standard conditions (vulnerable, restrained, …). */
  readonly conditions: readonly string[];
  /** Card-specific condition tags (Horrified, On Fire, …). */
  readonly tags?: readonly string[];
  readonly flying?: boolean;
}

const LEVEL_ORDER: readonly ResistanceLevel[] = ["none", "resistant", "immune"];

/** The resistance that applies to damage of `type`; "both" needs it against both types (the weaker one counts, R10). */
export function resistanceAgainst(target: Pick<Combatant, "resistance">, type: DamageType | "both"): ResistanceLevel {
  const r = target.resistance;
  if (!r) return "none";
  if (type === "physical") return r.physical;
  if (type === "magic") return r.magic;
  return LEVEL_ORDER[Math.min(LEVEL_ORDER.indexOf(r.physical), LEVEL_ORDER.indexOf(r.magic))]!;
}

export interface DamageOptions {
  /** Onslaught: "you never deal damage beneath a target's Major damage threshold" (raises Minor to Major). */
  minimumSeverity?: Severity;
}

export interface DamageResult {
  targetId: string;
  /** The damage total before resistance. */
  incoming: number;
  /** What the resistance did. */
  resisted: ResistanceLevel;
  /** After immunity / resistance. */
  taken: number;
  severity: DamageSeverity;
  /** HP marked by this hit (after the track's cap). */
  hpMarked: number;
  /** Extra Minions the attacker may defeat (CB p.201, Q6): floor(taken / X); 0 for non-Minions. */
  minionExtra: number;
  defeated: boolean;
  after: Combatant;
}

const SEVERITY_HP: Record<Severity, number> = { minor: 1, major: 2, severe: 3 };

/**
 * Applies one move's damage total to `target` (R2: the caller totals the move's damage first): immunity, then resistance
 * (halve, round down), then thresholds 1 / 2 / 3 HP, none at 0 or less, no Massive damage; a Minion is defeated by any
 * damage and returns its extra defeats.
 */
export function applyDamageTo(target: Combatant, amount: number, type: DamageType | "both", options: DamageOptions = {}): DamageResult {
  const incoming = Math.max(0, Math.trunc(amount));
  const resisted = resistanceAgainst(target, type);
  const taken = resisted === "immune" ? 0 : damageTaken(incoming, resisted === "resistant");
  let severity = damageSeverity(taken, target.thresholds, false);
  let hp = hpForDamage(taken, target.thresholds, false);
  const floor = options.minimumSeverity;
  if (floor && severity !== "none" && severity !== "defeat" && SEVERITY_HP[severity] < SEVERITY_HP[floor]) {
    severity = floor;
    hp = SEVERITY_HP[floor];
  }
  const isMinion = target.minionX !== undefined && target.minionX !== null;
  const toMark = hp === "all" || (isMinion && taken > 0) ? target.hpMax - target.hp : hp;
  if (isMinion && taken > 0) severity = "defeat";
  const next = markHp(target, toMark);
  const defeated = target.defeated || isDefeated({ hp: next.hp, hpMax: target.hpMax });
  const minionExtra = isMinion && taken > 0 && target.minionX! > 0 ? Math.floor(taken / target.minionX!) : 0;
  return {
    targetId: target.id,
    incoming,
    resisted,
    taken,
    severity,
    hpMarked: next.hp - target.hp,
    minionExtra,
    defeated,
    after: { ...target, hp: next.hp, defeated },
  };
}

export interface MarkResult {
  targetId: string;
  /** Stress actually marked. */
  stressMarked: number;
  /** HP marked: by Stress overflow (R5) or by a forced HP mark. */
  hpMarked: number;
  overflow: boolean;
  defeated: boolean;
  after: Combatant;
}

/** "must mark N Stress": past a full track it marks 1 HP instead (R5, CB p.92). */
export function applyStressTo(target: Combatant, amount: number): MarkResult {
  const n = Math.max(0, Math.trunc(amount));
  const next = markStress(target, n);
  const defeated = target.defeated || isDefeated({ hp: next.hp, hpMax: target.hpMax });
  return {
    targetId: target.id,
    stressMarked: next.stress - target.stress,
    hpMarked: next.hp - target.hp,
    overflow: next.overflow,
    defeated,
    after: { ...target, stress: next.stress, hp: next.hp, defeated },
  };
}

/** "force them to mark N Hit Points" with no damage roll or thresholds (Reaper's Strike). */
export function applyHpTo(target: Combatant, amount: number): MarkResult {
  const next = markHp(target, Math.max(0, Math.trunc(amount)));
  const defeated = target.defeated || isDefeated({ hp: next.hp, hpMax: target.hpMax });
  return {
    targetId: target.id,
    stressMarked: 0,
    hpMarked: next.hp - target.hp,
    overflow: false,
    defeated,
    after: { ...target, hp: next.hp, defeated },
  };
}

/** "clear N Hit Points / Stress / Armor Slots" on a creature, kept within the track. */
export function clearTrack(target: Combatant, track: "hp" | "stress" | "armor", amount: number): { cleared: number; after: Combatant } {
  const n = Math.max(0, Math.trunc(amount));
  const current = track === "hp" ? target.hp : track === "stress" ? target.stress : (target.armor ?? 0);
  const value = Math.max(0, current - n);
  const after = { ...target, [track]: value, defeated: track === "hp" && value < target.hpMax ? false : target.defeated };
  return { cleared: current - value, after };
}
