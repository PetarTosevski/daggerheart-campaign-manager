// The GM-only notes of the Manual rule switches on adversary attacks and hits on PCs (plan rule-switches, tracer RC2).
// Pure: the server posts each one with `postRuleNote` in the action's group (convex/lib/ruleModes.ts), so undoing the
// action undoes its notes. Manual = the app stops applying the rule and tells the GM (user answer 2026-11-05).
//
// A1 (CB p.114 "negate some (or all) of it by marking an available Armor Slot"; CB p.19 "You can only mark one Armor Slot
//   per attack"): Manual offers no slot; "Mira took Major damage; Armor Slot not offered".
// D2 (CB p.99 "they halve damage of that type before comparing it to their damage thresholds"; CB p.107 "round up"):
//   Manual takes the damage in full; "Mira resists: halve? (14 taken in full; halved: 7)".
// D4 (CB p.92 "If you're ever forced to mark 1 or more Stress but your slots are already full, you must instead mark 1 Hit
//   Point"): Manual drops the extra Stress; "Mira: Stress full, mark 1 HP?".
// C1 (CB p.102 "While Hidden, any rolls against you have disadvantage"; Cloaked, CB p.42): Manual rolls without it;
//   "Bandit attacks Mira (Hidden): roll with disadvantage?".
//   CB p.102 "While you are Vulnerable, all rolls targeting you have advantage" (tracer RFA, user 2026-11-06): Book gives
//   the attack advantage against each Vulnerable PC target; Manual rolls without it; "Bandit attacks Mira (Vulnerable):
//   roll with advantage?".
// S1 has no note here: adversary actions always move the spotlight to the GM, in every mode (user 2026-11-06, tracer
//   RFA; S1 Manual stops only the PC-roll half, convex/lib/rollAftermath.ts).

import { hordeHalved } from "../encounters/damage";
import type { PcHitResult, PcSeverity, HitRules } from "./severity";

export type HitRuleNote = { ruleId: "armorSlots" | "resistance" | "stressOverflow"; summary: string };

const SEVERITY: Record<PcSeverity, string> = { none: "no", minor: "Minor", major: "Major", severe: "Severe" };

/**
 * The Manual notes one resolved hit on a PC calls for. `armorWouldBeOffered`: under the Book the PC could have marked an
 * Armor Slot on this hit (a free slot, not direct damage, no Frenzy). `riderOverflowDropped`: a Stress rider of the
 * attack went past a full track and D4 Manual dropped it. Book modes return nothing.
 */
export function hitRuleNotes(name: string, result: PcHitResult, rules: HitRules, facts: { armorWouldBeOffered: boolean; riderOverflowDropped?: boolean }): HitRuleNote[] {
  const out: HitRuleNote[] = [];
  if (rules.armorSlots === "manual" && facts.armorWouldBeOffered && result.severityBefore !== "none") {
    const severity = result.massiveBefore ? "Massive" : SEVERITY[result.severityBefore];
    out.push({ ruleId: "armorSlots", summary: `${name} took ${severity} damage; Armor Slot not offered` });
  }
  if (result.resistanceApplied === false) {
    out.push({
      ruleId: "resistance",
      summary:
        result.resisted === "immune"
          ? `${name} is immune: no damage? (${result.taken} taken in full)`
          : `${name} resists: halve? (${result.taken} taken in full; halved: ${Math.ceil(result.taken / 2)})`,
    });
  }
  if (rules.stressOverflow === "manual" && (result.overflow || facts.riderOverflowDropped === true)) {
    out.push({ ruleId: "stressOverflow", summary: `${name}: Stress full, mark 1 HP?` });
  }
  return out;
}

/** C1 Manual: the attack on a Hidden or Cloaked PC is rolled without its disadvantage. */
export function hiddenTargetNote(attacker: string, target: string, condition: "hidden" | "cloaked"): string {
  return `${attacker} attacks ${target} (${condition === "hidden" ? "Hidden" : "Cloaked"}): roll with disadvantage?`;
}

/** C1 Manual (CB p.102, tracer RFA): the attack on a Vulnerable PC is rolled without its advantage. */
export function vulnerableTargetNote(attacker: string, target: string): string {
  return `${attacker} attacks ${target} (Vulnerable): roll with advantage?`;
}

/** C1 (CB p.102): the condition of a PC target that gives an attack against them disadvantage, or null. */
export function hiddenCondition(conditions: readonly string[]): "hidden" | "cloaked" | null {
  return conditions.includes("hidden") ? "hidden" : conditions.includes("cloaked") ? "cloaked" : null;
}

/** WF, F4 / F5 Manual (CB p.154): the GM's line for Fear the app no longer spends ("Spend 2 Fear by hand"). */
export function fearByHandText(amount: number): string {
  return `Spend ${amount} Fear by hand`;
}

/**
 * WF, D7 `hordes` Manual (CB p.199 "When the Horde has marked half or more of their HP, their standard attack deals X
 * damage instead"): the GM's note when a Horde at half HP or more attacked with its printed damage; null when the Horde
 * damage would not apply.
 */
export function hordeNote(label: string, horde: string | null | undefined, tracks: { hp: number; hpMax: number }): string | null {
  return horde && hordeHalved(tracks) ? `${label}: Horde at half HP: it deals ${horde} instead?` : null;
}

/** WF, M4 `outOfRange` Manual (CB p.103): "Mira attacked Theo out of range" ("Mira used Fireball on Theo out of range"). */
export function outOfRangeNote(actor: string, targets: readonly string[], what?: string): string {
  const names = targets.length > 0 ? targets.join(", ") : "a target";
  return what ? `${actor} used ${what} on ${names} out of range` : `${actor} attacked ${names} out of range`;
}

/** WF, C4 `unconscious` Book (CB p.106 "they can't be targeted by an attack"): the refusal's message. */
export function unconsciousTargetText(names: readonly string[]): string {
  return `${names.join(", ")} ${names.length === 1 ? "is" : "are"} unconscious and can't be targeted by an attack.`;
}
