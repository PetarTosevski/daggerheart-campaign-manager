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
import type { Cost, DamageType } from "../card-effects/types";
import { rollD20 } from "../card-effects/run";
import { resolveHits, type HitResult } from "../combat-actions/hits";
import { rollDamage, type Rng } from "../dice/index";
import type { RollRecord } from "../duality";
import { hordeHalved } from "../encounters/damage";
import { versusMods, type CreatureInfo, type PassiveSheet, type PassiveState } from "../feature-effects/passives";

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

/** Extra d20s: each advantage or disadvantage source of the roll; they cancel one for one (CB p.161 keeps one extra die). */
export interface AttackAdvantage {
  advantage?: number;
  disadvantage?: number;
}

/**
 * A PC an attack is made against: their Evasion is the Difficulty (AR1). `advantage` / `disadvantage` are the sources the
 * target's passives put on an attack against them (Sturdy, CB p.68); `pcTarget` fills all three. Several disadvantage
 * sources count as one (DA17).
 */
export interface EvasionTarget {
  readonly id: string;
  readonly evasion: number;
  readonly advantage?: number;
  readonly disadvantage?: number;
  /**
   * Lane E7 round 3 (dcm-eut): disadvantages the attacker may buy off (Defensive stance, HF p.12: "unless the attacker
   * marks a Stress to negate the disadvantage"), by feature id; once paid (`CreatureInfo.paidOff`) they are not counted.
   */
  readonly buyOff?: readonly { featureId: string; costs: readonly Cost[] }[];
}

/**
 * A PC as a target of one adversary attack (SD2, NV9): their Evasion (already with the always-on passives, `derivedDefense`)
 * plus the passives keyed to this attacker (CB p.39 Elusive Predator, HF p.8 Scorpion's Poise, CB p.38 Battle-Bonded:
 * "+2 bonus to your Evasion against the attack"), and the disadvantage their passives put on attacks against them (CB p.68
 * Sturdy: "When you have 1 Hit Point remaining, attacks against you have disadvantage"). `attacker` says what the adversary
 * is: its condition tags (Focus, Marked for Death) and whether it is within the PC's companion's Melee range.
 */
export function pcTarget(id: string, sheet: PassiveSheet, evasion: number, attacker: CreatureInfo, state: PassiveState = {}): EvasionTarget {
  const v = versusMods(sheet, "attacksByThem", attacker, state);
  return { id, evasion: evasion + v.evasion, ...(v.advantage ? { advantage: v.advantage } : {}), ...(v.disadvantage ? { disadvantage: v.disadvantage } : {}), ...(v.buyOff && v.buyOff.length > 0 ? { buyOff: v.buyOff } : {}) };
}

/** One target's reading of the shared attack roll (DA1): the d20 it keeps, its total, a natural 20, hit or miss. */
export interface TargetRoll {
  readonly id: string;
  /** The d20 this target keeps from the roll's dice (its own advantage / disadvantage over the same dice). */
  readonly natural: number;
  readonly total: number;
  /** A natural 20 on the die this target keeps: a hit and critical damage (CB p.148). */
  readonly critical: boolean;
  readonly hit: boolean;
}

export interface AdversaryAttackResult {
  /**
   * The attack roll as `actionLog.roll` stores it (kind "action"; the d20s plus any modifier dice). `record`, `natural`,
   * `total` and `critical` read the roll with every source any target carries counted once (SD2); `targets` per target.
   */
  record: RollRecord;
  /** The kept d20. */
  natural: number;
  total: number;
  /** A natural 20: succeeds against every target and deals critical damage (AR2). */
  critical: boolean;
  /** Hit or miss per target, one roll for all (AR7), each judged with the die it keeps (DA1). */
  hits: HitResult[];
  /** DA1: each target's kept d20, total and critical. */
  targets: TargetRoll[];
}

/**
 * The d20 one reader keeps from the roll's dice (CB p.161: "If an NPC has advantage, roll an extra d20 and take the
 * highest result. Similarly, if an NPC has disadvantage, roll an extra d20 and use the lowest result."): `net` is the
 * advantage sources minus the disadvantage sources (they cancel one for one); none, or no second die, keeps the first.
 */
export function keptDie(first: number, second: number | null, net: number): number {
  if (net === 0 || second === null) return first;
  return net > 0 ? Math.max(first, second) : Math.min(first, second);
}

/**
 * A target's own disadvantage sources on an attack against them, on or off (DA17; user 2026-10-30): Sturdy (CB p.68)
 * and Harrowing Invocation (HF p.14) on the same PC give that PC one disadvantage, which one advantage source cancels.
 */
export function ownDisadvantage(sources: number | undefined): 0 | 1 {
  return (sources ?? 0) > 0 ? 1 : 0;
}

/**
 * The extra disadvantage each target puts on one attack roll against several targets (DA1; user 2026-10-30): Sturdy
 * (CB p.68) and Harrowing Invocation (HF p.14) count only against their own target, and several of them on one target
 * count once (DA17, `ownDisadvantage`). What every target shares (`common`) counts for the whole roll; `residual` is what
 * is left, by target id. A single target, or targets that all carry it, leave no residual: the roll is made as before.
 */
export function splitTargetDisadvantage(extra: readonly { id: string; disadvantage: number }[]): { common: number; residual: Map<string, number> } {
  const own = extra.map((t) => ({ id: t.id, disadvantage: ownDisadvantage(t.disadvantage) }));
  const common = own.length === 0 ? 0 : Math.min(...own.map((t) => t.disadvantage));
  const residual = new Map<string, number>();
  for (const t of own) if (t.disadvantage - common > 0) residual.set(t.id, t.disadvantage - common);
  return { common, residual };
}

/**
 * One attack roll for every target (AR1, AR2, AR7): d20 (two with advantage or disadvantage, keeping the higher or
 * lower) + the Attack Modifier + an Experience bought with a Fear (`experienceBonus`; the caller charges the Fear, Q19).
 * Hit when the total meets or beats the target's Evasion; a natural 20 always hits. Modifier dice ("+2d4") roll after
 * the d20s.
 *
 * DA1 (user 2026-10-30, CB p.68 Sturdy): a target's own advantage / disadvantage counts only against that target. The
 * roll is one pair of d20s; each target keeps its own die from it (`keptDie`): the extra d20 is kept low only for the
 * Sturdy target, and its total, hit and critical are its own (`targets`).
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
  // The record (SD2): a source a target's passives add counts once for the roll, however many targets have it.
  const advantage = (adv.advantage ?? 0) + (targets.some((t) => t.advantage) ? 1 : 0);
  const disadvantage = (adv.disadvantage ?? 0) + (targets.some((t) => t.disadvantage) ? 1 : 0);
  const base = (adv.advantage ?? 0) - (adv.disadvantage ?? 0);
  // DA17: a target's own disadvantage sources count once (on / off); one advantage source cancels them.
  const netOf = (t: EvasionTarget) => base + (t.advantage ?? 0) - ownDisadvantage(t.disadvantage);
  const twoDice = advantage - disadvantage !== 0 || targets.some((t) => netOf(t) !== 0);
  const first = rng(20);
  const second = twoDice ? rng(20) : null;
  const preset = second === null ? [first] : [first, second];
  const rolled = rollD20((sides) => preset.shift() ?? rng(sides), flat, advantage, disadvantage);
  // A second die only some targets read: listed, dropped for the record's reading.
  const role = targets.some((t) => netOf(t) < 0) ? ("disadvantage" as const) : ("advantage" as const);
  const d20s = rolled.record.dice.length === 1 && second !== null ? [...rolled.record.dice, { sides: 20, value: second, role, dropped: true }] : rolled.record.dice;
  const extra = mod.dice ? Array.from({ length: mod.dice.count }, () => rng(mod.dice!.sides)) : [];
  const extraSum = extra.reduce((s, n) => s + n, 0);
  const total = rolled.record.total + extraSum;
  const dice = [...d20s, ...extra.map((value) => ({ sides: mod.dice!.sides, value, role: "extra" as const }))];
  const perTarget = targets.map((t): TargetRoll => {
    const kept = keptDie(first, second, netOf(t));
    const own = kept + flat + extraSum;
    return { id: t.id, natural: kept, total: own, critical: kept === 20, hit: resolveHits(own, kept === 20, [{ id: t.id, difficulty: t.evasion }])[0]!.hit };
  });
  return {
    record: { ...rolled.record, kind: "action", dice, total },
    natural: rolled.natural,
    total,
    critical: rolled.natural === 20,
    hits: perTarget.map((t) => ({ id: t.id, hit: t.hit })),
    targets: perTarget,
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

/**
 * Plan lanes-2, lane E7 (dcm-idz; user answer 2026-10-31): a GM-controlled PC (Enthralled, HF p.92: "you can spotlight
 * them during a GM turn as if they were an adversary … makes a weapon attack against them using a d20 instead of Duality
 * Dice") attacks like an adversary: one d20 + the weapon's trait against each target's Evasion or Difficulty, a natural 20
 * hits and crits (CB p.148). The damage text is the weapon's with the PC's Proficiency as its dice count (CB, Damage Rolls: "you roll a
 * number of your weapon's damage dice equal to your Proficiency"): "d8+1 phy" at Proficiency 2 is "2d8+1 phy".
 *
 * ```ts
 * gmControlledWeaponAttack(2, "d8+1 phy", 2, [{ id: "mira", evasion: 12 }], rng); // d20 + 2 vs 12; damage "2d8+1 phy"
 * ```
 */
export function gmControlledWeaponAttack(trait: number, weaponDamage: string, proficiency: number, targets: readonly EvasionTarget[], rng: Rng): { attack: AdversaryAttackResult; damage: string } {
  const damage = weaponDamage.trim().replace(/^(\d*)d/, `${Math.max(1, Math.trunc(proficiency))}d`);
  return { attack: adversaryAttack(trait, {}, 0, targets, rng), damage };
}
