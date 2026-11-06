// Damage, Stress and HP on a creature hit by a PC's move (plan combat-actions, tracer CA1; rules R3, R5, R10). Pure:
// reuses the tracker's rules in encounters/damage.ts so the map and the encounter tracker never disagree.
//
// CB p.99, "Resistance and Immunity": "When a creature has resistance to a damage type, they halve damage of that type
//   before comparing it to their damage thresholds. … when your character deals 26 physical damage to a creature with
//   physical resistance, the creature only takes 13 physical damage. … When a creature has immunity to a damage type,
//   they do not take any damage from an attack that deals damage of that type. … If an attack deals both physical and
//   magic damage, you can only benefit from resistance or immunity if you are resistant or immune to both damage types."
//   Halving rounds up (CB p.107: "round up unless otherwise specified"; encounters/damage.ts `damageTaken`).
// CB p.91, "Marking Hit Points": Severe 3 HP, Major 2 HP, Minor 1 HP; "If you ever reduce incoming damage to 0 or less
//   …, you don't mark any HP." Adversaries alike (CB p.193). The optional Massive Damage rule (CB p.91: "If you ever
//   take damage equal to double your Severe threshold, you mark 4 Hit Points") applies when the campaign turns it on.
//
// Rule switches (plan rule-switches, tracer RDM): `DamageOptions.rules` carries the campaign's modes (D2 resistance,
// D4 Stress overflow, D8 defeat at the last HP, Massive Damage); unset = the Book, so unwired callers behave as before.
// D2 Manual applies the full damage (`resistanceApplied` false); D4 Manual drops the extra Stress (`overflow` true, no
// HP); D8 Manual leaves an adversary at its last HP up (`lastHp` true, `defeated` false). Tracer RC1: `minionPicker` /
// `minionNote` (D6: Book the attacker picks, `gmPicks` the GM, Manual only the hit Minion falls) and `damageRuleNotes`
// (the GM's D2 / D8 lines on a PC's hit).
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
  defeatedAfter,
  hpForDamage,
  isMassive,
  lastHp,
  markHp,
  markStress,
  type DamageRules,
  type DamageSeverity,
  type Thresholds,
} from "../encounters/damage";
import type { ModeOf } from "../../rules/registry";
import type { DamageType, Severity } from "../card-effects/types";
import type { ResistanceLevel } from "../../srd/adversary-resistance";

export type { DamageRules, ResistanceLevel, Thresholds };

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
  /** The campaign's damage rule modes (plan rule-switches); unset = the Book. */
  rules?: DamageRules;
}

/** D8 is an adversary rule (CB p.208): a PC target always takes the Book's tracks (its death move is X1). */
function rulesFor(target: Pick<Combatant, "side">, rules: DamageRules = {}): DamageRules {
  return target.side === "adversary" ? rules : { ...rules, adversaryDefeated: "book" };
}

/** Defeated after the hit: already defeated stays (Book); D8 Manual never defeats at the last HP. */
function defeatedNow(target: Combatant, hp: number, rules: DamageRules): boolean {
  return defeatedAfter(target.defeated, { hp, hpMax: target.hpMax }, rules) || (rules.adversaryDefeated !== "manual" && target.defeated);
}

export interface DamageResult {
  targetId: string;
  /** The damage total before resistance. */
  incoming: number;
  /** The target's resistance against this damage. */
  resisted: ResistanceLevel;
  /** Set (false) only when D2 is Manual and the target resists or is immune: not applied (tell the GM "halve?"). */
  resistanceApplied?: false;
  /** After immunity / resistance. */
  taken: number;
  severity: DamageSeverity;
  /** HP marked by this hit (after the track's cap). */
  hpMarked: number;
  /** Set (true) only for Massive damage (CB p.91, the optional rule on): at least twice the Severe threshold, 4 HP. */
  massive?: true;
  /** Set (true) only when every HP is marked but the target is not defeated (D8 Manual: it stays up; tell the GM). */
  lastHp?: true;
  /** Extra Minions the attacker may defeat (CB p.201, Q6): floor(taken / X); 0 for non-Minions. */
  minionExtra: number;
  defeated: boolean;
  after: Combatant;
}

const SEVERITY_HP: Record<Severity, number> = { minor: 1, major: 2, severe: 3 };

/**
 * Applies one move's damage total to `target` (R2: the caller totals the move's damage first): immunity, then resistance
 * (halve, round up), then thresholds 1 / 2 / 3 HP (4 for Massive damage when the campaign uses it), none at 0 or less;
 * a Minion is defeated by any damage and returns its extra defeats. `options.rules` carries the campaign's modes.
 */
export function applyDamageTo(target: Combatant, amount: number, type: DamageType | "both", options: DamageOptions = {}): DamageResult {
  const incoming = Math.max(0, Math.trunc(amount));
  const rules = rulesFor(target, options.rules);
  const resisted = resistanceAgainst(target, type);
  const resistanceApplied = resisted === "none" || rules.resistance !== "manual";
  const taken = resisted === "immune" && resistanceApplied ? 0 : damageTaken(incoming, resisted === "resistant", rules);
  let severity = damageSeverity(taken, target.thresholds, false);
  let hp = hpForDamage(taken, target.thresholds, false, rules);
  const floor = options.minimumSeverity;
  if (floor && severity !== "none" && severity !== "defeat" && SEVERITY_HP[severity] < SEVERITY_HP[floor]) {
    severity = floor;
    hp = SEVERITY_HP[floor];
  }
  const isMinion = target.minionX !== undefined && target.minionX !== null;
  const massive = !isMinion && severity === "severe" && isMassive(taken, target.thresholds, rules);
  const toMark = hp === "all" || (isMinion && taken > 0) ? target.hpMax - target.hp : hp;
  if (isMinion && taken > 0) severity = "defeat";
  const next = markHp(target, toMark);
  const defeated = defeatedNow(target, next.hp, rules);
  const minionExtra = isMinion && taken > 0 && target.minionX! > 0 ? Math.floor(taken / target.minionX!) : 0;
  return {
    targetId: target.id,
    incoming,
    resisted,
    ...(resistanceApplied ? {} : { resistanceApplied: false as const }),
    taken,
    severity,
    hpMarked: next.hp - target.hp,
    ...(massive ? { massive: true as const } : {}),
    ...(!defeated && lastHp({ hp: next.hp, hpMax: target.hpMax }) ? { lastHp: true as const } : {}),
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

/**
 * "must mark N Stress": past a full track it marks 1 HP instead (R5, CB p.92). D4 Manual: the extra Stress is dropped
 * (`overflow` true, no HP marked).
 */
export function applyStressTo(target: Combatant, amount: number, damageRules?: DamageRules): MarkResult {
  const n = Math.max(0, Math.trunc(amount));
  const rules = rulesFor(target, damageRules);
  const next = markStress(target, n, rules);
  const defeated = defeatedNow(target, next.hp, rules);
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
export function applyHpTo(target: Combatant, amount: number, damageRules?: DamageRules): MarkResult {
  const next = markHp(target, Math.max(0, Math.trunc(amount)));
  const defeated = defeatedNow(target, next.hp, rulesFor(target, damageRules));
  return {
    targetId: target.id,
    stressMarked: 0,
    hpMarked: next.hp - target.hp,
    overflow: false,
    defeated,
    after: { ...target, hp: next.hp, defeated },
  };
}

// ---------------------------------------------------------------- rule switches on a PC's damage (plan rule-switches RC1)

/** D6 `minions` (CB p.201): Book (the attacker picks), variant `gmPicks` (not in the books), Manual. */
export type MinionMode = ModeOf<"minions">;

/**
 * Who picks the extra Minions a PC's damage defeats (CB p.201: "defeat an additional Minion within range the attack
 * would succeed against"; the book doesn't say who picks): Book the attacker, `gmPicks` the GM (Q5 a), Manual nobody
 * (only the hit Minion falls; the GM is told, `minionNote`).
 */
export function minionPicker(mode: MinionMode = "book"): "attacker" | "gm" | null {
  return mode === "manual" ? null : mode === "gmPicks" ? "gm" : "attacker";
}

/** D6 Manual's note: "Ash's 7 damage: defeat 2 more Minions? (in range: Rats, Wolves)". */
export function minionNote(attacker: string, damage: number, extra: number, names: readonly string[]): string {
  return `${attacker}'s ${damage} damage: defeat ${extra} more Minion${extra === 1 ? "" : "s"}?${names.length > 0 ? ` (in range: ${names.join(", ")})` : ""}`;
}

/** A Manual rule's note on one hit: which rule and the GM's line. */
export type DamageRuleNote = { ruleId: "resistance" | "adversaryDefeated"; summary: string };

/**
 * The Manual notes one hit leaves (RDM's words, as the encounter tracker posts them): D2 when the resistance was not
 * applied (`resistanceApplied` false), D8 when the last HP is marked but the adversary stays up (`lastHp`). Empty in Book.
 */
export function damageRuleNotes(label: string, result: Pick<DamageResult, "resisted" | "resistanceApplied" | "incoming" | "lastHp">): DamageRuleNote[] {
  const notes: DamageRuleNote[] = [];
  if (result.resistanceApplied === false) {
    notes.push({
      ruleId: "resistance",
      summary: result.resisted === "immune" ? `${label} is immune: no damage? (${result.incoming} taken in full)` : `${label} resists: halve? (${result.incoming} taken in full; halved: ${Math.ceil(result.incoming / 2)})`,
    });
  }
  if (result.lastHp === true) notes.push({ ruleId: "adversaryDefeated", summary: `${label} marked its last HP: defeated?` });
  return notes;
}

/** "clear N Hit Points / Stress / Armor Slots" on a creature, kept within the track. */
export function clearTrack(target: Combatant, track: "hp" | "stress" | "armor", amount: number): { cleared: number; after: Combatant } {
  const n = Math.max(0, Math.trunc(amount));
  const current = track === "hp" ? target.hp : track === "stress" ? target.stress : (target.armor ?? 0);
  const value = Math.max(0, current - n);
  const after = { ...target, [track]: value, defeated: track === "hp" && value < target.hpMax ? false : target.defeated };
  return { cleared: current - value, after };
}
