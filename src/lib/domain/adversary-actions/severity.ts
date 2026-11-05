// Damage to a PC from an adversary: severity against the PC's own thresholds, Armor Slots, direct damage, Stress
// overflow and the death move (plan combat-actions, tracer AA1; rules AR3, AR4, AR5). Pure: the reaction window
// (window.ts) resolves a hit through `applyHitToPc`; the hit PC's prompt previews it with `armorPreview` (Q14).
//
// CB p.91, "Damage Thresholds": "Severe damage is equal to or above your Severe threshold; you mark 3 HP. Major damage
//   is equal to or above your Major threshold but below Severe; you mark 2 HP. Minor damage is anything below your Major
//   threshold; you mark 1 HP. If you ever reduce incoming damage to 0 or less …, you don't mark any HP. When you mark your
//   last Hit Point, you must make a death move."
// CB p.91, "OPTIONAL RULE: MASSIVE DAMAGE": "your table can implement a Massive threshold. If you ever take damage equal
//   to double your Severe threshold, you mark 4 Hit Points." On when the campaign turns it on (`rules.massiveDamage`).
//   Read as a threshold above Severe, so an Armor Slot reduces Massive to Severe (3 HP), the next to Major.
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
// CB p.99: resistance halves the damage before the thresholds (rounded up, CB p.107 "round up unless otherwise
//   specified", like combat-actions/damage.ts), immunity takes none.
//
// Rule switches (plan rule-switches, tracer RDM): every function takes `rules` (the campaign's modes; unset = the
// Book). D2 Manual: resistance and immunity are not applied (`resistanceApplied` false; tell the GM "halve?"); D4 Manual:
// Stress past a full track is dropped, no HP (`overflow` true); Massive Damage as above.
// Plan lanes E2 (dcm-s77): an attacker can make Armor Slots dearer for its hit (`ArmorCost`): Armor Eater (HF p.71: "that
//   PC must mark an additional Armor Slot to reduce the severity of the damage"), Tormenting Lash (CB p.235: "they must
//   mark 2 Armor Slots"), Rending Jaws (HF p.81: "must mark 2 Armor Slots to reduce the severity by one threshold") take
//   `slotsPerStep` 2; Boiling Blast (CB p.236: "If a target marks an Armor Slot to reduce the damage, they must also mark
//   a Stress") takes `alsoMark` Stress per slot used.
// Unstuck (CB p.237, user answer 2026-10-31, dcm-3m5k): an Armor Slot needs two free slots; both are marked for its benefit.
//
// ```ts
// pcSeverity(14, { major: 10, severe: 20 });                       // { severity: "major", hp: 2 }
// applyHitToPc(rune, { amount: 14, type: "physical", direct: false }, { armorSlots: 1 }); // Major -> Minor, 1 HP, 1 slot
// ```

import type { DamageType } from "../card-effects/types";
import { damageSeverity, isMassiveDamage, markStress, type PcDamageRules, type Severity, type Thresholds } from "../characters/index";
import { resistanceAgainst, type ResistanceLevel } from "../combat-actions/damage";
import { damageTaken, type DamageRules } from "../encounters/damage";

/** The damage rule modes a hit on a PC reads (plan rule-switches): D2, D4, D5 and Massive Damage. Unset = the Book. */
export type PcHitRules = PcDamageRules & Pick<DamageRules, "resistance">;

export type { Severity as PcSeverity, Thresholds as PcThresholds };

const ORDER: readonly Severity[] = ["none", "minor", "major", "severe"];
const MARKS: Record<Severity, number> = { none: 0, minor: 1, major: 2, severe: 3 };
const MASSIVE_HP = 4;

/** Whether a Stress mark overflowed: Book, it marked the 1 HP (CB p.92); D4 Manual, the extra Stress was dropped. */
function overflowed(next: { hp: number; overflow?: true }, hpBefore: number, rules: PcHitRules): boolean {
  return rules.stressOverflow === "manual" ? next.overflow === true : next.hp > hpBefore;
}

/** Severity of damage against a PC's thresholds and the HP it marks (AR3, CB p.91; Massive marks 4 when on, `massive: true`). */
export function pcSeverity(damage: number, thresholds: Thresholds, rules: PcHitRules = {}): { severity: Severity; hp: number; massive?: true } {
  const severity = damageSeverity(damage, thresholds);
  return isMassiveDamage(damage, thresholds, rules) ? { severity, hp: MASSIVE_HP, massive: true } : { severity, hp: MARKS[severity] };
}

/**
 * The severity after `steps` threshold steps when the hit may be Massive: Massive is a threshold above Severe (CB p.91),
 * so the first step takes it to Severe and the rest step down as usual.
 */
export function stepDownMassive(severity: Severity, massive: boolean, steps: number): { severity: Severity; massive: boolean } {
  const n = Math.max(0, Math.trunc(steps));
  if (!massive) return { severity: stepDown(severity, n), massive: false };
  return n === 0 ? { severity, massive: true } : { severity: stepDown(severity, n - 1), massive: false };
}

/** HP a severity marks; 4 for Massive damage. */
function marksOf(severity: Severity, massive: boolean): number {
  return massive ? MASSIVE_HP : MARKS[severity];
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
  /**
   * Plan lanes-2, E2 (dcm-kvx4): added to any damage the PC takes, before resistance and the thresholds (Burrowing
   * Leechpoles, HF p.90: "any damage the target takes gains a +1 bonus for each leechpole under their skin"; the bearer's
   * `damageTaken` `add` mods). Damage reduced to 0 gains nothing.
   */
  readonly damageTakenBonus?: number;
  /**
   * Plan lanes-2, E2 (dcm-fbsr): the hit's marks are multiplied (Unstuck, CB p.237: "When an Unstuck target spends Hope or
   * marks Armor Slots, HP, or Stress, they must double the amount spent or marked"; the bearer's `marksMultiplier` mod).
   */
  readonly marksMultiplier?: { readonly factor: number; readonly of: readonly ("hope" | "hp" | "stress" | "armor")[] };
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
  /** Plan lanes E2 (dcm-s77): the attacker's dearer Armor Slots for this hit. */
  readonly armorCost?: ArmorCost;
}

/**
 * Plan lanes E2 (dcm-s77; the `armorCost` step): `slotsPerStep` Armor Slots buy one severity step (default 1); `alsoMark`
 * is marked for each slot used (Stress with the CB p.92 overflow, or HP).
 */
export interface ArmorCost {
  readonly slotsPerStep?: number;
  readonly alsoMark?: { readonly track: "stress" | "hp"; readonly amount: number };
}

/** Slots one severity step costs on this hit (1 unless the attacker made them dearer). */
export function slotsPerStep(hit: Pick<PcHit, "armorCost">): number {
  return Math.max(1, Math.trunc(hit.armorCost?.slotsPerStep ?? 1));
}

/** The severity steps `slots` Armor Slots buy on this hit (a slot short of a full step buys nothing). */
export function armorSteps(hit: Pick<PcHit, "armorCost">, slots: number): number {
  return Math.floor(Math.max(0, Math.trunc(slots)) / slotsPerStep(hit));
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

/**
 * How many Armor Slots the PC may mark for their benefit on this hit, after forced slots. E2 (dcm-s77): with dearer slots
 * every step costs `slotsPerStep`; the allowance (one step, plus `extraSlots` more steps) and the free slots are counted
 * in whole steps, so `maxSlots` is a multiple of it.
 */
export function armorOptions(pc: PcDefense, hit: PcHit, extraSlots: number | "any" = 0, offer = true): { canUseArmor: boolean; maxSlots: number; free: number } {
  const room = Math.max(0, pc.armorMax - pc.armor);
  // Plan lanes-2, E2.3 (dcm-3m5k, user answer 2026-10-31): under Unstuck (CB p.237: "double the amount spent or marked")
  // every slot is marked `factor` times, the forced ones too, so one slot's benefit needs `factor` free slots: with only
  // one free slot the armor option is unavailable. That is the offer (the window's prompt, `armorCapable`, the answer's
  // check); `applyHitToPc` (`offer` false) only clamps the slots it was given to a full track, as before.
  const factor = offer ? marksFactor(pc, "armor") : 1;
  const forced = Math.min(Math.max(0, hit.forcedArmor ?? 0) * factor, room);
  const free = Math.max(0, room - forced);
  const per = slotsPerStep(hit) * factor;
  const steps = hit.direct || pc.noArmorSlots ? 0 : extraSlots === "any" ? Math.floor(free / per) : Math.min(Math.floor(free / per), 1 + Math.max(0, extraSlots));
  const allowed = steps * slotsPerStep(hit);
  return { canUseArmor: allowed > 0, maxSlots: allowed, free };
}

/**
 * Damage after reductions and resistance, and its severity before armor (what the hit PC's prompt shows, Q14).
 * `massive: true`: Massive damage (CB p.91) with the rule on. D2 Manual: resistance and immunity are not applied
 * (`resistanceApplied: false`). Both are only set then, so the Book's result is unchanged.
 */
export function damageBeforeArmor(
  pc: PcDefense,
  hit: PcHit,
  reduceDamage = 0,
  rules: PcHitRules = {},
): { taken: number; resisted: ResistanceLevel; resistanceApplied?: false; severity: Severity; massive?: true } {
  const reduced = Math.max(0, Math.trunc(hit.amount) - Math.max(0, reduceDamage));
  // E2 (dcm-kvx4): the bearer's "any damage … gains a +N bonus", on damage that is still there.
  const incoming = reduced > 0 ? reduced + Math.max(0, Math.trunc(pc.damageTakenBonus ?? 0)) : 0;
  const resisted = resistanceAgainst(pc, hit.type);
  const resistanceApplied = resisted === "none" || rules.resistance !== "manual";
  const taken = resisted === "immune" && resistanceApplied ? 0 : damageTaken(incoming, resisted === "resistant", rules);
  let severity = damageSeverity(taken, pc.thresholds);
  if (pc.noMinorDamage && severity === "minor") severity = "none";
  const massive = severity === "severe" && isMassiveDamage(taken, pc.thresholds, rules);
  return { taken, resisted, severity, ...(resistanceApplied ? {} : { resistanceApplied: false as const }), ...(massive ? { massive: true as const } : {}) };
}

/**
 * The severity and HP for every number of slots the PC may mark (0..maxSlots), for the "mark an Armor Slot?" prompt. E2
 * (dcm-s77): with dearer slots only whole steps are listed (0, 2, 4 for Armor Eater).
 */
export function armorPreview(
  pc: PcDefense,
  hit: PcHit,
  extraSlots: number | "any" = 0,
  rules: PcHitRules = {},
): { slots: number; severity: Severity; hp: number; massive?: true }[] {
  const { severity, massive = false } = damageBeforeArmor(pc, hit, 0, rules);
  const { maxSlots } = armorOptions(pc, hit, extraSlots);
  const per = slotsPerStep(hit);
  return Array.from({ length: Math.floor(maxSlots / per) + 1 }, (_, n) => {
    const s = stepDownMassive(severity, massive, n);
    const m = marksOf(s.severity, s.massive);
    const hp = Math.max(0, m + (m > 0 ? (hit.hpMarkedDelta ?? 0) : 0)) * marksFactor(pc, "hp");
    return { slots: n * per, severity: s.severity, hp, ...(s.massive ? { massive: true as const } : {}) };
  });
}

/** E2 (dcm-fbsr): the multiplier on `track` (Hope spent, or marks) from the PC's `marksMultiplier`; 1 without one. */
export function marksFactor(pc: Pick<PcDefense, "marksMultiplier">, track: "hope" | "hp" | "stress" | "armor"): number {
  const m = pc.marksMultiplier;
  return m && m.of.includes(track) ? Math.max(1, Math.trunc(m.factor)) : 1;
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
  /** Set (false) only when D2 is Manual and the PC resists or is immune (the damage was not halved; tell the GM). */
  resistanceApplied?: false;
  /** Before any Armor Slot. */
  severityBefore: Severity;
  /** Set (true) only for Massive damage before any Armor Slot (CB p.91, the optional rule on). */
  massiveBefore?: true;
  /** Slots marked without benefit (CB p.195). */
  forcedArmor: number;
  /** Slots marked to step the severity down (E2, dcm-s77: whole steps of the hit's `slotsPerStep`). */
  armorSlots: number;
  severity: Severity;
  /** Set (true) only when still Massive after armor: 4 HP (before Chains of Affliction and Unstuck). */
  massive?: true;
  hpMarked: number;
  stressMarked: number;
  hopeSpent: number;
  /** A Stress mark went past a full track: 1 HP marked (CB p.92), or none under D4 Manual (tell the GM). */
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
export function applyHitToPc(pc: PcDefense, hit: PcHit, adj: HitAdjustments = {}, rules: PcHitRules = {}): PcHitResult {
  const before: PcTracks = { hp: pc.hp, stress: pc.stress, armor: pc.armor, hope: pc.hope ?? 0 };
  const forced = Math.min(Math.max(0, hit.forcedArmor ?? 0), Math.max(0, pc.armorMax - pc.armor));
  const incoming = Math.max(0, Math.trunc(hit.amount));
  const pre = damageBeforeArmor(pc, hit, adj.reduceDamage ?? 0, rules);
  const severityBefore = adj.negate ? "none" : pre.severity;
  const massiveBefore = !adj.negate && pre.massive === true;
  const { maxSlots } = armorOptions(pc, hit, adj.extraSlots ?? 0, false);
  // E2 (dcm-s77): only whole steps of dearer slots are marked.
  const steps = severityBefore === "none" ? 0 : armorSteps(hit, Math.min(maxSlots, Math.max(0, Math.trunc(adj.armorSlots ?? 0))));
  const armorSlots = steps * slotsPerStep(hit);
  const armored = stepDownMassive(severityBefore, massiveBefore, steps);
  const { severity, massive } = stepDownMassive(armored.severity, armored.massive, adj.reduceSeverity ?? 0);
  const base = marksOf(severity, massive);
  const marks = base > 0 ? Math.max(0, base + (hit.hpMarkedDelta ?? 0)) : 0;

  let { hp, stress, hope } = before;
  let stressMarked = 0;
  let hopeSpent = 0;
  let overflow = false;
  // E2 (dcm-fbsr): Unstuck doubles the HP marked, the Stress marked instead and the Hope spent instead (each converted HP
  // costs the Hope factor; what the Hope can't cover is marked as HP).
  let hpMarks = marks;
  if (marks > 0 && adj.convert === "hope") {
    const per = marksFactor(pc, "hope");
    const covered = Math.min(marks, Math.floor(hope / per));
    hopeSpent = covered * per;
    hope -= hopeSpent;
    hpMarks = marks - covered;
  } else if (marks > 0 && adj.convert === "stress") {
    const next = markStress({ stress, stressMax: pc.stressMax, hp, hpMax: pc.hpMax }, marks * marksFactor(pc, "stress"), rules);
    stressMarked = next.stress - stress;
    overflow = overflowed(next, hp, rules);
    stress = next.stress;
    hp = next.hp;
    hpMarks = 0;
  }
  hp = Math.min(pc.hpMax, hp + hpMarks * marksFactor(pc, "hp"));
  // E2 (dcm-s77): Boiling Blast's Stress (CB p.236) per Armor Slot used, with the CB p.92 overflow; or HP.
  const also = hit.armorCost?.alsoMark;
  if (also && armorSlots > 0 && also.amount > 0) {
    const n = Math.trunc(also.amount) * armorSlots * marksFactor(pc, also.track);
    if (also.track === "stress") {
      const next = markStress({ stress, stressMax: pc.stressMax, hp, hpMax: pc.hpMax }, n, rules);
      stressMarked += next.stress - stress;
      overflow = overflow || overflowed(next, hp, rules);
      stress = next.stress;
      hp = next.hp;
    } else hp = Math.min(pc.hpMax, hp + n);
  }
  // E2 (dcm-fbsr): Unstuck marks each Armor Slot it marks twice; the extra slots give no benefit and stop at a full track.
  const slotsMarked = Math.min(Math.max(0, pc.armorMax - pc.armor), (forced + armorSlots) * marksFactor(pc, "armor"));
  const after: PcTracks = { hp, stress, armor: pc.armor + Math.max(forced + armorSlots, slotsMarked), hope };
  return {
    targetId: pc.id,
    incoming,
    resisted: pre.resisted,
    ...(pre.resistanceApplied === false ? { resistanceApplied: false as const } : {}),
    taken: adj.negate ? 0 : pre.taken,
    severityBefore,
    ...(massiveBefore ? { massiveBefore: true as const } : {}),
    forcedArmor: forced,
    armorSlots,
    severity,
    ...(massive ? { massive: true as const } : {}),
    hpMarked: hp - before.hp,
    stressMarked,
    hopeSpent,
    overflow,
    deathMove: before.hp < pc.hpMax && hp >= pc.hpMax,
    before,
    after,
  };
}
