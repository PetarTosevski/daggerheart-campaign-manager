// Damage to a PC from an adversary: severity against the PC's own thresholds, Armor Slots, direct damage, Stress
// overflow and the death move (plan combat-actions, tracer AA1; rules AR3, AR4, AR5). Pure: the reaction window
// (window.ts) resolves a hit through `applyHitToPc`; the hit PC's prompt previews it with `armorPreview` (Q14).
//
// CB p.91, "Damage Thresholds": "Severe damage is equal to or above your Severe threshold; you mark 3 HP. Major damage
//   is equal to or above your Major threshold but below Severe; you mark 2 HP. Minor damage is anything below your Major
//   threshold; you mark 1 HP. If you ever reduce incoming damage to 0 or less …, you don't mark any HP. When you mark your
//   last Hit Point, you must make a death move." Massive damage is an optional rule; it is off here.
// CB p.114, "Reducing Damage": "When your character takes damage, you can negate some (or all) of it by marking an
//   available Armor Slot …, then reducing the severity of the damage by one threshold (Severe to Major, Major to Minor,
//   Minor to Nothing). Each time your character takes damage, you can only mark 1 Armor Slot." Example: "If an adversary
//   hits Rune for Major damage, Miles can mark an Armor Slot to reduce that to Minor instead."
// CB p.99: "Direct damage is physical or magic damage that Armor Slots can't be used to reduce."
// CB p.195 (Shredding Strike): "the target must mark an Armor Slot without gaining its benefit" (`forcedArmor`).
// CB p.341, I Am Your Shield: "When you take damage from this attack, you can mark any number of Armor Slots." Each slot
//   steps the severity down once more (`extraSlots`).
// CB p.92: "If you're ever forced to mark 1 or more Stress but your slots are already full, you must instead mark 1 Hit
//   Point."
// CB p.99: resistance halves the damage before the thresholds (rounded down like combat-actions/damage.ts), immunity
//   takes none.
//
// ```ts
// pcSeverity(14, { major: 10, severe: 20 });                       // { severity: "major", hp: 2 }
// applyHitToPc(rune, { amount: 14, type: "physical", direct: false }, { armorSlots: 1 }); // Major -> Minor, 1 HP, 1 slot
// ```

import type { DamageType } from "../card-effects/types";
import { damageSeverity, markStress, type Severity, type Thresholds } from "../characters/index";
import { resistanceAgainst, type ResistanceLevel } from "../combat-actions/damage";
import { damageTaken } from "../encounters/damage";

export type { Severity as PcSeverity, Thresholds as PcThresholds };

const ORDER: readonly Severity[] = ["none", "minor", "major", "severe"];
const MARKS: Record<Severity, number> = { none: 0, minor: 1, major: 2, severe: 3 };

/** Severity of damage against a PC's thresholds and the HP it marks (AR3, CB p.91). */
export function pcSeverity(damage: number, thresholds: Thresholds): { severity: Severity; hp: number } {
  const severity = damageSeverity(damage, thresholds);
  return { severity, hp: MARKS[severity] };
}

/** The severity `steps` thresholds lower (Severe to Major, Major to Minor, Minor to nothing; CB p.114). */
export function stepDown(severity: Severity, steps: number): Severity {
  return ORDER[Math.max(0, ORDER.indexOf(severity) - Math.max(0, Math.trunc(steps)))]!;
}

/** HP a severity marks. */
export function hpForSeverity(severity: Severity): number {
  return MARKS[severity];
}

/** A PC as a hit needs them: thresholds (armor base + level, `derivedThresholds`), tracks and the effects that change damage. */
export interface PcDefense {
  readonly id: string;
  readonly thresholds: Thresholds;
  readonly hp: number;
  readonly hpMax: number;
  readonly stress: number;
  readonly stressMax: number;
  /** Marked Armor Slots and the Armor Score (slots in all). */
  readonly armor: number;
  readonly armorMax: number;
  readonly hope?: number;
  /** Resistance from sheet effects (Rejuvenation Barrier, CB p.99). */
  readonly resistance?: { readonly physical: ResistanceLevel; readonly magic: ResistanceLevel };
  /** Frenzy: "you can't use Armor Slots". */
  readonly noArmorSlots?: boolean;
  /** On the Brink: "you don't take Minor damage". */
  readonly noMinorDamage?: boolean;
}

/** The damage of one hit before armor (the incoming-hit payload's numbers). */
export interface PcHit {
  readonly amount: number;
  readonly type: DamageType | "both";
  /** Armor Slots can't reduce it (CB p.99). */
  readonly direct: boolean;
  /** Slots the PC must mark without their benefit (CB p.195), marked before any slot the PC chooses. */
  readonly forcedArmor?: number;
  /** Chains of Affliction on the attacker: HP the target marks change by this much (never below 0). */
  readonly hpMarkedDelta?: number;
}

/** What the window decided for this hit (all optional; nothing set = take the damage without armor). */
export interface HitAdjustments {
  /** Armor Slots the PC chose to mark for their benefit (0 = none). Capped by `armorOptions`. */
  armorSlots?: number;
  /** Slots allowed beyond the usual one (I Am Your Shield "any", Brace 1). */
  extraSlots?: number | "any";
  /** Damage removed before the thresholds (Rune Ward's 1d8). */
  reduceDamage?: number;
  /** Severity steps removed after armor (Get Back Up). */
  reduceSeverity?: number;
  /** The damage is negated (Arcane Deflection). */
  negate?: boolean;
  /** Marks taken on another track instead of HP (Splendor-Touched): Stress (with overflow) or Hope spent. */
  convert?: "stress" | "hope";
}

/** How many Armor Slots the PC may mark for their benefit on this hit, after forced slots. */
export function armorOptions(pc: PcDefense, hit: PcHit, extraSlots: number | "any" = 0): { canUseArmor: boolean; maxSlots: number; free: number } {
  const forced = Math.min(Math.max(0, hit.forcedArmor ?? 0), Math.max(0, pc.armorMax - pc.armor));
  const free = Math.max(0, pc.armorMax - pc.armor - forced);
  const allowed = hit.direct || pc.noArmorSlots ? 0 : extraSlots === "any" ? free : Math.min(free, 1 + Math.max(0, extraSlots));
  return { canUseArmor: allowed > 0, maxSlots: allowed, free };
}

/** Damage after reductions and resistance, and its severity before armor (what the hit PC's prompt shows, Q14). */
export function damageBeforeArmor(pc: PcDefense, hit: PcHit, reduceDamage = 0): { taken: number; resisted: ResistanceLevel; severity: Severity } {
  const incoming = Math.max(0, Math.trunc(hit.amount) - Math.max(0, reduceDamage));
  const resisted = resistanceAgainst(pc, hit.type);
  const taken = resisted === "immune" ? 0 : damageTaken(incoming, resisted === "resistant");
  let severity = damageSeverity(taken, pc.thresholds);
  if (pc.noMinorDamage && severity === "minor") severity = "none";
  return { taken, resisted, severity };
}

/** The severity and HP for every number of slots the PC may mark (0..maxSlots), for the "mark an Armor Slot?" prompt. */
export function armorPreview(pc: PcDefense, hit: PcHit, extraSlots: number | "any" = 0): { slots: number; severity: Severity; hp: number }[] {
  const { severity } = damageBeforeArmor(pc, hit);
  const { maxSlots } = armorOptions(pc, hit, extraSlots);
  return Array.from({ length: maxSlots + 1 }, (_, slots) => {
    const s = stepDown(severity, slots);
    return { slots, severity: s, hp: Math.max(0, MARKS[s] + (MARKS[s] > 0 ? (hit.hpMarkedDelta ?? 0) : 0)) };
  });
}

export interface PcTracks {
  hp: number;
  stress: number;
  armor: number;
  hope: number;
}

export interface PcHitResult {
  targetId: string;
  incoming: number;
  resisted: ResistanceLevel;
  /** After reductions and resistance. */
  taken: number;
  /** Before any Armor Slot. */
  severityBefore: Severity;
  /** Slots marked without benefit (CB p.195). */
  forcedArmor: number;
  /** Slots marked to step the severity down. */
  armorSlots: number;
  severity: Severity;
  hpMarked: number;
  stressMarked: number;
  hopeSpent: number;
  /** A Stress mark past a full track marked 1 HP (CB p.92). */
  overflow: boolean;
  /** The PC marked their last HP: they must make a death move (CB p.91). */
  deathMove: boolean;
  before: PcTracks;
  after: PcTracks;
}

/**
 * Resolves one hit on a PC (AR3-AR5): reductions, resistance and severity; forced slots; up to the allowed Armor Slots,
 * one step each (none on direct damage); further severity steps; Chains of Affliction's delta; then HP (or Stress / Hope
 * instead), clamped to the tracks. Marking the last HP flags a death move.
 */
export function applyHitToPc(pc: PcDefense, hit: PcHit, adj: HitAdjustments = {}): PcHitResult {
  const before: PcTracks = { hp: pc.hp, stress: pc.stress, armor: pc.armor, hope: pc.hope ?? 0 };
  const forced = Math.min(Math.max(0, hit.forcedArmor ?? 0), Math.max(0, pc.armorMax - pc.armor));
  const incoming = Math.max(0, Math.trunc(hit.amount));
  const pre = damageBeforeArmor(pc, hit, adj.reduceDamage ?? 0);
  const severityBefore = adj.negate ? "none" : pre.severity;
  const { maxSlots } = armorOptions(pc, hit, adj.extraSlots ?? 0);
  const armorSlots = severityBefore === "none" ? 0 : Math.min(maxSlots, Math.max(0, Math.trunc(adj.armorSlots ?? 0)));
  const severity = stepDown(stepDown(severityBefore, armorSlots), adj.reduceSeverity ?? 0);
  const base = MARKS[severity];
  const marks = base > 0 ? Math.max(0, base + (hit.hpMarkedDelta ?? 0)) : 0;

  let { hp, stress, hope } = before;
  let stressMarked = 0;
  let hopeSpent = 0;
  let overflow = false;
  let hpMarks = marks;
  if (marks > 0 && adj.convert === "hope") {
    hopeSpent = Math.min(hope, marks);
    hope -= hopeSpent;
    hpMarks = marks - hopeSpent;
  } else if (marks > 0 && adj.convert === "stress") {
    const next = markStress({ stress, stressMax: pc.stressMax, hp, hpMax: pc.hpMax }, marks);
    stressMarked = next.stress - stress;
    overflow = next.hp > hp;
    stress = next.stress;
    hp = next.hp;
    hpMarks = 0;
  }
  hp = Math.min(pc.hpMax, hp + hpMarks);
  const after: PcTracks = { hp, stress, armor: pc.armor + forced + armorSlots, hope };
  return {
    targetId: pc.id,
    incoming,
    resisted: pre.resisted,
    taken: adj.negate ? 0 : pre.taken,
    severityBefore,
    forcedArmor: forced,
    armorSlots,
    severity,
    hpMarked: hp - before.hp,
    stressMarked,
    hopeSpent,
    overflow,
    deathMove: before.hp < pc.hpMax && hp >= pc.hpMax,
    before,
    after,
  };
}
