// An adversary's attack roll and its damage (plan combat-actions, tracer AA1; rules AR1, AR2, AR7, AR9, AR10). Pure:
// the server (AA2) rolls through these, the feature runner (adversary-effects/run.ts) reuses them.
//
// CB p.160, "Adversary Attack Rolls": "You make your attack roll with a d20. If the adversary has advantage or
//   disadvantage on the attack, add an extra d20 to that roll." "the stat block's Attack Modifier is the value added to or
//   subtracted from the adversary's attack roll. You can also spend a Fear to add an adversary's Experience to the roll's
//   result." "If the attack meets or beats that value [the PC's Evasion], it is successful".
// CB p.161: "If an NPC has advantage, roll an extra d20 and take the highest result. Similarly, if an NPC has
//   disadvantage, roll an extra d20 and use the lowest result." "When an adversary's action lets you make an attack
//   against multiple targets, you make one attack roll and ask if it hits any of the targets."
// CB p.148, "GM Critical Successes": "Whenever you roll a 20 on the d20, your roll automatically succeeds. If you
//   critically succeed on an attack roll, you also deal extra damage. Start with the highest possible value the damage
//   dice can roll, and then make a damage roll as usual, adding it to that value." (2d8+2 rolling 5 and 7: 30.)
// CB p.199, "Horde (X)": "When the Horde has marked half or more of their HP, their standard attack deals X damage
//   instead."
// CB p.201, "Group Attack": "Those Minions … make one shared attack roll. On a success, they deal X damage each. Combine
//   this damage."
//
// ```ts
// adversaryAttack(2, {}, 0, [{ id: "mira", evasion: 12 }], rng);   // d20 + 2 vs Evasion 12, one roll for all targets
// adversaryDamage("2d8+2 phy", true, queueRng([5, 7]));            // total 30 (CB p.148)
// standardAttackDamage("1d10+2 phy", { hp: 3, hpMax: 6 }, "1d4+1"); // "1d4+1 phy" (Horde X once half the HP is marked)
// groupAttackDamage(2, 4);                                          // 8 (four Minions with X = 2)
// ```

import { maxDamage, parseDamage, type ParsedDamage } from "../adversaries/index";
import type { DamageType } from "../card-effects/types";
import { rollD20 } from "../card-effects/run";
import { resolveHits, type HitResult } from "../combat-actions/hits";
import { rollDamage, type Rng } from "../dice/index";
import type { RollRecord } from "../duality";
import { hordeHalved } from "../encounters/damage";

/** A stat block's Attack Modifier: a number ("+3") or extra dice ("+2d4", the only one in the SRD). */
export interface AttackModifier {
  flat: number;
  dice: { count: number; sides: number } | null;
}

/** Reads a printed Attack Modifier: 3, "+3", "−1", "+2d4". Unreadable text counts as +0. */
export function parseAttackModifier(modifier: number | string): AttackModifier {
  if (typeof modifier === "number") return { flat: modifier, dice: null };
  const text = modifier.trim().replace(/[−–]/g, "-");
  const dice = /^\+?(\d*)d(\d+)$/.exec(text);
  if (dice) return { flat: 0, dice: { count: dice[1] ? Number(dice[1]) : 1, sides: Number(dice[2]) } };
  const n = Number(text);
  return { flat: Number.isFinite(n) ? Math.trunc(n) : 0, dice: null };
}

/** Extra d20s: each advantage or disadvantage source; they cancel one for one (CB p.161 keeps one extra die). */
export interface AttackAdvantage {
  advantage?: number;
  disadvantage?: number;
}

/** A PC an attack is made against: their Evasion is the Difficulty (AR1). */
export interface EvasionTarget {
  readonly id: string;
  readonly evasion: number;
}

export interface AdversaryAttackResult {
  /** The attack roll as `actionLog.roll` stores it (kind "action"; the kept d20 plus any modifier dice). */
  record: RollRecord;
  /** The kept d20. */
  natural: number;
  total: number;
  /** A natural 20: succeeds against every target and deals critical damage (AR2). */
  critical: boolean;
  /** Hit or miss per target, one roll for all (AR7). */
  hits: HitResult[];
}

/**
 * One attack roll for every target (AR1, AR2, AR7): d20 (two with advantage or disadvantage, keeping the higher or
 * lower) + the Attack Modifier + an Experience bought with a Fear (`experienceBonus`; the caller charges the Fear, Q19).
 * Hit when the total meets or beats the target's Evasion; a natural 20 always hits. Modifier dice ("+2d4") roll after
 * the d20s.
 */
export function adversaryAttack(
  atk: number | string,
  adv: AttackAdvantage,
  experienceBonus: number,
  targets: readonly EvasionTarget[],
  rng: Rng,
): AdversaryAttackResult {
  const mod = parseAttackModifier(atk);
  const flat = mod.flat + experienceBonus;
  const { record, natural } = rollD20(rng, flat, adv.advantage ?? 0, adv.disadvantage ?? 0);
  const extra = mod.dice ? Array.from({ length: mod.dice.count }, () => rng(mod.dice!.sides)) : [];
  const total = record.total + extra.reduce((s, n) => s + n, 0);
  const dice = [...record.dice, ...extra.map((value) => ({ sides: mod.dice!.sides, value, role: "extra" as const }))];
  const critical = natural === 20;
  return {
    record: { ...record, kind: "action", dice, total },
    natural,
    total,
    critical,
    hits: resolveHits(total, critical, targets.map((t) => ({ id: t.id, difficulty: t.evasion }))),
  };
}

export interface AdversaryDamageResult {
  record: RollRecord;
  type: DamageType | "both";
  /** "direct" in the text: Armor Slots can't reduce it (CB p.99). */
  direct: boolean;
}

/** The damage type a stat block prints: phy, mag, phy/mag (both); none printed counts as physical. */
export function damageTypeOf(parsed: Pick<ParsedDamage, "type">): DamageType | "both" {
  return parsed.type === "mag" ? "magic" : parsed.type === "phy/mag" ? "both" : "physical";
}

/**
 * Rolls a stat block's damage text ("2d8+2 phy", "2 phy", "40 direct phy"). A critical starts from the dice's maximum
 * (AR2, CB p.148); flat damage is not rolled and gains nothing. Null for unreadable text.
 */
export function adversaryDamage(text: string, critical: boolean, rng: Rng): AdversaryDamageResult | null {
  const parsed = parseDamage(text);
  if (!parsed) return null;
  const record: RollRecord = parsed.dice
    ? rollDamage({ dice: [parsed.dice], flat: parsed.modifier, critical }, rng)
    : { kind: "damage", dice: [], modifier: parsed.modifier, total: Math.max(0, parsed.modifier), outcome: "none", manual: false };
  return { record, type: damageTypeOf(parsed), direct: parsed.direct };
}

/** The highest a damage text's dice can roll (the critical bonus, CB p.148); 0 for flat damage. */
export function criticalBonus(text: string): number {
  return maxDamage(parseDamage(text)?.dice ?? null);
}

/** Writes parsed damage back as text: "1d4+1 phy", "2 mag", "40 direct phy". */
export function formatDamage(parsed: ParsedDamage): string {
  const dice = parsed.dice ? `${parsed.dice.count}d${parsed.dice.sides}` : "";
  const mod = parsed.modifier === 0 && dice ? "" : parsed.modifier < 0 ? `-${-parsed.modifier}` : dice ? `+${parsed.modifier}` : `${parsed.modifier}`;
  const type = parsed.type ? ` ${parsed.direct ? "direct " : ""}${parsed.type}` : parsed.direct ? " direct" : "";
  return `${dice}${mod}${type}`;
}

export interface StandardDamageOptions {
  /** A passive's or an instance effect's flat bonus ("+2 to damage"). */
  add?: number;
  /** A passive that changes the attack's type. */
  type?: DamageType;
  /** Direct damage (an "attacks deal direct damage" passive, CB p.99). */
  direct?: boolean;
}

/**
 * The standard attack's damage text right now: Horde (X) once half or more of the HP is marked (AR10, CB p.199; the
 * printed type is kept), then a flat bonus, a new type or directness. The text is unchanged when nothing applies.
 */
export function standardAttackDamage(
  printed: string,
  tracks: { hp: number; hpMax: number },
  hordeX: string | null | undefined,
  options: StandardDamageOptions = {},
): string {
  const base = parseDamage(printed);
  if (!base) return printed;
  let parsed: ParsedDamage = base;
  if (hordeX && hordeHalved(tracks)) {
    const horde = parseDamage(hordeX);
    if (horde) parsed = { ...horde, type: horde.type ?? base.type, direct: horde.direct || base.direct };
  }
  if (options.add) parsed = { ...parsed, modifier: parsed.modifier + options.add };
  if (options.type) parsed = { ...parsed, type: options.type === "magic" ? "mag" : "phy" };
  if (options.direct) parsed = { ...parsed, direct: true };
  return parsed === base ? printed : formatDamage(parsed);
}

/** Minion Group Attack (AR9, CB p.201): X damage per Minion in the group, combined. */
export function groupAttackDamage(x: number, groupSize: number): number {
  return Math.max(0, x) * Math.max(0, Math.trunc(groupSize));
}
