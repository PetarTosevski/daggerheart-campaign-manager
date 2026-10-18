// Dice rules (D5 T1). Pure module with an injectable RNG: bundled into Convex,
// shared with the dice box. The server rolls through convex/lib/dice.ts `rollDie`;
// tests and manual entry pass their own `Rng`.
//
// Book references (Core Book, re-checked):
// - CB 90, 94-95: 2d12 Duality Dice + trait + modifiers against the Difficulty. Matching
//   dice are a critical success: a success with Hope that also clears a Stress. Hope higher:
//   +1 Hope (even on a failure). Fear higher: the GM gains a Fear (even on a success).
//   Hope is held to a maximum of 6 (`hopeMax`).
// - CB 90: an Experience costs 1 Hope and adds its modifier, on action and reaction rolls.
// - CB 99: reaction rolls generate no Hope or Fear, and nobody can help on them.
// - CB 90, 100: advantage adds a d6, disadvantage subtracts one; they cancel one for one
//   (settled rule: what is left is a single d6). Help an Ally adds a d6 advantage die per
//   helper, and the roller keeps the highest advantage die.
// - CB 98: weapon damage rolls Proficiency-many weapon dice plus the modifier; a critical
//   adds the dice's highest possible value.
//
// ```ts
// const plan = advantagePlan(1, 0, 1);                 // ["advantage", "help"]: roll both, keep the highest
// const { hope, fear, roll } = rollDuality({ kind: "action", trait: 2, modifier: 0, difficulty: 12,
//   advantage: 1, disadvantage: 0, help: 0 }, rng);
// const next = applyDualityEffects(sheet, dualityEffects("action", roll.outcome)); // +1 Hope, maybe −1 Stress
// const dmg = rollDamage({ dice: weaponDice("d8+1 phy", 2).dice, flat: 1, critical: true }, rng);
// ```

import type { Rng, RollOption } from "../class-features/types";
import { actionOutcome, type DieRole, type RolledDie, type RollOutcome, type RollRecord } from "../duality";
import { applyResourceDelta } from "../characters/index";
import type { CharacterSheet, Experience } from "../../validation/characters";

export type { Rng };

/** An expected dice-rule violation; Convex turns it into `DICE_RULE` (convex/lib/mechanics.ts `applyRule`). */
export class DiceRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DiceRuleError";
  }
}

/** Dice a die-count field may name. */
const DIE_SIDES = [4, 6, 8, 10, 12, 20] as const;
/** The most dice, modifier and steppers one roll accepts. */
const LIMITS = { dice: 30, modifier: 30, steppers: 6, difficulty: 50 } as const;

function assertInt(value: number, min: number, max: number, what: string): void {
  if (!Number.isInteger(value) || value < min || value > max) throw new DiceRuleError(`${what} must be a whole number from ${min} to ${max}.`);
}

function assertSides(sides: number): void {
  if (!(DIE_SIDES as readonly number[]).includes(sides)) throw new DiceRuleError(`A d${sides} isn't a die the app rolls.`);
}

// ---------------------------------------------------------------- advantage

/**
 * The advantage dice a roll uses, in rolling order. Disadvantage cancels the
 * roller's own advantage first, then help dice, one for one (CB 100). What is
 * left is a single disadvantage die, or one advantage die for any number of
 * own sources plus one die per remaining helper (CB 90).
 */
export function advantagePlan(advantage: number, disadvantage: number, help: number): DieRole[] {
  for (const [n, what] of [
    [advantage, "Advantage"],
    [disadvantage, "Disadvantage"],
    [help, "Help"],
  ] as const) {
    assertInt(n, 0, LIMITS.steppers, what);
  }
  const left = disadvantage - advantage - help;
  if (left > 0) return ["disadvantage"];
  const ownLeft = Math.max(0, advantage - disadvantage);
  const helpLeft = Math.min(help, advantage + help - disadvantage);
  return [...(ownLeft > 0 ? (["advantage"] as const) : []), ...Array.from({ length: helpLeft }, () => "help" as const)];
}

/** Rolls the plan's d6s: the highest advantage die counts (the others are `dropped`); a disadvantage die subtracts. */
export function rollAdvantage(plan: readonly DieRole[], rng: Rng): { dice: RolledDie[]; value: number } {
  const dice: RolledDie[] = plan.map((role) => ({ sides: 6, value: rng(6), role }));
  if (dice.length === 0) return { dice, value: 0 };
  if (dice[0]!.role === "disadvantage") return { dice, value: -dice[0]!.value };
  const best = dice.reduce((b, d, i) => (d.value > dice[b]!.value ? i : b), 0);
  return { dice: dice.map((d, i) => (i === best ? d : { ...d, dropped: true })), value: dice[best]!.value };
}

// ---------------------------------------------------------------- Duality rolls

export type DualityInput = {
  kind: "action" | "reaction";
  /** The trait's live value (`withEffects`). */
  trait: number;
  /** Every other flat bonus: typed modifier, Experiences, roll options, attack bonus. */
  modifier: number;
  difficulty?: number;
  advantage: number;
  disadvantage: number;
  help: number;
  /** Dice added by roll options (a Rally Die rolled now). */
  extraDice?: readonly { count: number; sides: number }[];
  /** Dice already rolled (a held Prayer Die): added as they are. */
  fixedDice?: readonly { sides: number; value: number }[];
};

export type DualityRoll = { hope: number; fear: number; roll: RollRecord };

/**
 * Rolls the Duality Dice, then the advantage dice, then extra dice, in that
 * order (manual entry supplies values in the same order).
 */
export function rollDuality(input: DualityInput, rng: Rng): DualityRoll {
  if (input.kind === "reaction" && input.help > 0) throw new DiceRuleError("Nobody can help on a reaction roll.");
  assertInt(input.modifier, -LIMITS.modifier * 2, LIMITS.modifier * 2, "The modifier");
  if (input.difficulty !== undefined) assertInt(input.difficulty, 1, LIMITS.difficulty, "The Difficulty");
  const plan = advantagePlan(input.advantage, input.disadvantage, input.help);
  const hope = rng(12);
  const fear = rng(12);
  const adv = rollAdvantage(plan, rng);
  const extra = rollPool(input.extraDice ?? [], "extra", rng);
  const fixed: RolledDie[] = (input.fixedDice ?? []).map((d) => ({ ...d, role: "extra" }));
  const modifier = input.trait + input.modifier;
  const total = hope + fear + adv.value + sum(extra) + sum(fixed) + modifier;
  return {
    hope,
    fear,
    roll: {
      kind: input.kind,
      dice: [{ sides: 12, value: hope, role: "hope" }, { sides: 12, value: fear, role: "fear" }, ...adv.dice, ...extra, ...fixed],
      modifier,
      total,
      ...(input.difficulty !== undefined ? { difficulty: input.difficulty } : {}),
      outcome: actionOutcome(hope, fear, total, input.difficulty),
      manual: false,
    },
  };
}

export type DualityEffects = { hope: number; clearStress: number; fear: number };

/** What a Duality roll changes (CB 94, 99): reaction rolls change nothing. */
export function dualityEffects(kind: "action" | "reaction", outcome: RollOutcome): DualityEffects {
  if (kind === "reaction") return { hope: 0, clearStress: 0, fear: 0 };
  switch (outcome) {
    case "critical":
      return { hope: 1, clearStress: 1, fear: 0 };
    case "successHope":
    case "failHope":
      return { hope: 1, clearStress: 0, fear: 0 };
    case "successFear":
    case "failFear":
      return { hope: 0, clearStress: 0, fear: 1 };
    case "none":
      return { hope: 0, clearStress: 0, fear: 0 };
  }
}

/** Gains the Hope (held to `hopeMax`) and clears the Stress of a roll's effects. */
export function applyDualityEffects(sheet: CharacterSheet, effects: DualityEffects): CharacterSheet {
  let next = sheet;
  if (effects.hope) next = applyResourceDelta(next, "hope", effects.hope);
  if (effects.clearStress) next = applyResourceDelta(next, "stress", -effects.clearStress);
  return next;
}

// ---------------------------------------------------------------- Hope costs

/** The Experiences used on a roll: their summed modifier and Hope cost (1 each, CB 90). */
export function experienceBonus(experiences: readonly Experience[], ids: readonly string[]): { value: number; hope: number; names: string[] } {
  if (new Set(ids).size !== ids.length) throw new DiceRuleError("Each Experience counts once.");
  const used = ids.map((id) => {
    const found = experiences.find((e) => e.id === id);
    if (!found) throw new DiceRuleError("That Experience isn't on the sheet.");
    return found;
  });
  return { value: used.reduce((s, e) => s + e.value, 0), hope: used.length, names: used.map((e) => e.name) };
}

/** Spends Hope, or refuses (the caller maps it to NOT_ENOUGH_HOPE). */
export class NotEnoughHopeError extends Error {
  constructor() {
    super("Not enough Hope.");
    this.name = "NotEnoughHopeError";
  }
}

export function spendHope(sheet: CharacterSheet, amount: number): CharacterSheet {
  if (amount <= 0) return sheet;
  if (sheet.hope < amount) throw new NotEnoughHopeError();
  return { ...sheet, hope: sheet.hope - amount };
}

// ---------------------------------------------------------------- roll options (class-feature hooks)

export type AppliedOptions = {
  /** The sheet with every chosen option's cost paid. */
  sheet: CharacterSheet;
  modifier: number;
  advantage: number;
  extraDice: { count: number; sides: number }[];
  fixedDice: { sides: number; value: number }[];
  labels: string[];
};

/**
 * Applies the auto options and the chosen ones (`rollOptions` hook): pays each
 * cost (Hope, Stress, a held die, a once-per use, an effect it ends) and collects what they add.
 * An unknown key or a feature already used is a dice-rule violation.
 */
export function applyRollOptions(sheet: CharacterSheet, available: readonly RollOption[], chosen: readonly string[]): AppliedOptions {
  for (const key of chosen) if (!available.some((o) => o.key === key)) throw new DiceRuleError("That option isn't available for this roll.");
  const picked = available.filter((o) => o.auto || chosen.includes(o.key));
  let next = sheet;
  const out: AppliedOptions = { sheet, modifier: 0, advantage: 0, extraDice: [], fixedDice: [], labels: [] };
  for (const option of picked) {
    const cost = option.cost;
    if (cost?.hope) next = spendHope(next, cost.hope);
    if (cost?.stress) next = applyResourceDelta(next, "stress", cost.stress);
    if (cost?.use) {
      const use = cost.use;
      if (next.featureUses.some((u) => u.key === use.key)) throw new DiceRuleError(`${option.label} is already used.`);
      next = { ...next, featureUses: [...next.featureUses, { key: use.key, until: use.until }] };
    }
    if (cost?.effectId !== undefined) {
      const effectId = cost.effectId;
      if (!next.effects.some((e) => e.id === effectId)) throw new DiceRuleError(`${option.label} is already used.`);
      next = { ...next, effects: next.effects.filter((e) => e.id !== effectId) };
    }
    const heldId = cost?.heldDieId ?? (option.effect.kind === "heldDie" ? option.effect.heldDieId : undefined);
    if (heldId !== undefined) {
      const held = next.heldDice.find((d) => d.id === heldId);
      if (!held) throw new DiceRuleError("That held die is gone.");
      next = { ...next, heldDice: next.heldDice.filter((d) => d.id !== heldId) };
      if (option.effect.kind === "heldDie") {
        if (held.value !== undefined) out.fixedDice.push({ sides: held.sides, value: held.value });
        else out.extraDice.push({ count: 1, sides: held.sides });
      }
    }
    const effect = option.effect;
    if (effect.kind === "modifier") out.modifier += effect.value;
    if (effect.kind === "dice") out.extraDice.push({ count: effect.count, sides: effect.sides });
    if (effect.kind === "advantage") out.advantage += 1;
    out.labels.push(option.label);
  }
  return { ...out, sheet: next };
}

// ---------------------------------------------------------------- damage

export type DicePool = readonly { count: number; sides: number }[];

/**
 * A weapon's damage dice at a Proficiency (CB 98): the leading die is rolled
 * Proficiency times; any further die and the flat bonus are added once.
 * `"d8+1 phy"` at Proficiency 2 → 2d8 + 1. `scaleAll` scales every die
 * (Brawler's Strike: "both the d8 and d6 scale off your Proficiency", HF 10).
 */
export function weaponDice(damage: string, proficiency: number, scaleAll = false): { dice: DicePool; flat: number } {
  const formula = damage.trim().split(/\s+/)[0] ?? "";
  const terms = formula.split("+");
  const dice: { count: number; sides: number }[] = [];
  let flat = 0;
  for (const [i, term] of terms.entries()) {
    const die = /^(\d*)d(\d+)$/.exec(term);
    if (die) {
      const count = die[1] ? Number(die[1]) : 1;
      dice.push({ count: i === 0 || scaleAll ? count * proficiency : count, sides: Number(die[2]) });
    } else if (/^\d+$/.test(term)) flat += Number(term);
    else throw new DiceRuleError(`Can't read the damage "${damage}".`);
  }
  if (dice.length === 0) throw new DiceRuleError(`Can't read the damage "${damage}".`);
  return { dice, flat };
}

function sum(dice: readonly { value: number; dropped?: boolean }[]): number {
  return dice.reduce((s, d) => s + (d.dropped ? 0 : d.value), 0);
}

function rollPool(pool: DicePool, role: DieRole, rng: Rng): RolledDie[] {
  const count = pool.reduce((s, p) => s + p.count, 0);
  if (count > LIMITS.dice) throw new DiceRuleError(`At most ${LIMITS.dice} dice per roll.`);
  return pool.flatMap(({ count: n, sides }) => {
    assertInt(n, 0, LIMITS.dice, "The dice count");
    assertSides(sides);
    return Array.from({ length: n }, () => ({ sides, value: rng(sides), role }));
  });
}

/** The highest value a pool can roll. */
function maxRoll(pool: DicePool): number {
  return pool.reduce((s, p) => s + p.count * p.sides, 0);
}

export type DamageInput = {
  dice: DicePool;
  /** Flat bonus: the weapon's, effects' and the typed modifier. */
  flat: number;
  critical: boolean;
  /** Replaces `dice`' maximum on a critical (Brawler: 14 × Proficiency). */
  critBase?: number;
  /** Dice roll options add (Marked for Death, Sneak Attack, a Rally Die), rolled after `dice`; a critical maxes them too. */
  bonusDice?: DicePool;
};

/**
 * A damage roll. A critical starts from the maximum of every damage die (CB 98: "add the highest
 * possible value of the damage dice"), `critBase` standing in for the base dice; folded into `modifier`.
 */
export function rollDamage(input: DamageInput, rng: Rng): RollRecord {
  assertInt(input.flat, -LIMITS.modifier * 2, LIMITS.modifier * 4, "The modifier");
  const bonus = input.bonusDice ?? [];
  const dice = rollPool([...input.dice, ...bonus], "damage", rng);
  const crit = input.critical ? (input.critBase ?? maxRoll(input.dice)) + maxRoll(bonus) : 0;
  const modifier = input.flat + crit;
  return { kind: "damage", dice, modifier, total: Math.max(0, sum(dice) + modifier), outcome: "none", manual: false };
}

/** A GM free roll: any dice plus a modifier, no Duality outcome. */
export function rollFree(pool: DicePool, modifier: number, rng: Rng): RollRecord {
  assertInt(modifier, -LIMITS.modifier * 2, LIMITS.modifier * 2, "The modifier");
  const dice = rollPool(pool, "extra", rng);
  if (dice.length === 0) throw new DiceRuleError("Roll at least one die.");
  return { kind: "free", dice, modifier, total: sum(dice) + modifier, outcome: "none", manual: false };
}

// ---------------------------------------------------------------- manual entry

/**
 * An `Rng` that returns typed-in dice in order (decision 1: physical dice). A
 * value outside the die, or too few values, is a dice-rule violation; check
 * `done()` afterwards so extra values are refused too.
 */
export function queueRng(values: readonly number[]): Rng & { done: () => void } {
  let i = 0;
  const rng = (sides: number) => {
    const value = values[i++];
    if (value === undefined) throw new DiceRuleError("Enter a value for every die.");
    assertInt(value, 1, sides, `A d${sides}`);
    return value;
  };
  return Object.assign(rng, {
    done: () => {
      if (i !== values.length) throw new DiceRuleError("More dice were entered than the roll uses.");
    },
  });
}

// ---------------------------------------------------------------- feed text

export const OUTCOME_LABEL: Record<RollOutcome, string> = {
  critical: "critical success",
  successHope: "success with Hope",
  successFear: "success with Fear",
  failHope: "failure with Hope",
  failFear: "failure with Fear",
  none: "",
};
