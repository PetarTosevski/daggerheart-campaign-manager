// Rest-time heritage features (plan sheet-drawer, tracer SD-R; user answer Q15 b). Pure: which of the four features a
// sheet holds (through `owned()`, so mixed ancestries and Shapeshifter resolve as the drawer does) and what each does in
// the rest flow. `convex/rests.ts` calls it from `choose`, `current` and the rest's one transaction.
//
// Book texts (printed pages, CB = Core Book, HF = Hope & Fear):
// - Hardy (Frostborne, HF p.29): "When you take a rest, you clear a Hit Point."
// - Efficient (Clank, CB p.53): "When you take a short rest, you can choose a long rest move instead of a short rest move."
// - Celestial Trance (Elf, CB p.56): "During a rest, you can drop into a trance to choose an additional downtime move."
// - Oasis (Duneborne, HF p.27): "During a short rest, you or an ally can reroll a die used for a downtime move and take
//   the higher result." The player picks the die after the dice are shown (user 2026-10-30, DA5): `applyMovesWithDice`
//   records the dice, `oasisReroll` rerolls one die per holder per short rest and keeps the higher, and
//   `applyDieDelta` clears the extra on the move's target.
// - CB p.105: an interrupted short rest gives no benefits; an interrupted long rest "gain[s] the benefits of a short rest",
//   so it runs these features as a short rest (Oasis applies, Efficient has nothing left to offer).
//
// ```ts
// const features = restFeaturesOf(sheet, { hopeAndFear: true });
// features.trance;                                      // true for an elf
// restMoveSlots(features);                              // { min: 2, max: 3 }
// const { dice } = applyMovesWithDice("short", sheets, choices, rollDie); // the moves and their dice, in roll order
// const r = oasisReroll(dice, 0, "holder-id", rollDie);                  // keeps the higher; r.delta more to clear
// ```

import { RuleError } from "../../errors/app-error";
import type { CharacterSheet } from "../../validation/characters";
import { applyResourceDelta, tierForLevel } from "../characters/index";
import { owned, type OwnedScope, type OwnedSheet } from "../feature-effects/owned";
import type { Rng } from "../class-features/types";
import { applyMoves, type MovesResult } from "./index";
import { ALLY_MOVES, MOVE_LABELS, MOVES_PER_REST, REST_MOVES, type ChosenMove, type RestChoice, type RestKind, type RestMove } from "./moves";

/** The four rest-time feature ids (the rest-trigger entries of FE-ancestry-core and FE-heritage-hf). */
export const REST_FEATURE_IDS = {
  hardy: "community:frostborne:hardy",
  efficient: "ancestry:clank:efficient",
  trance: "ancestry:elf:celestial-trance",
  oasis: "community:duneborne:oasis",
} as const;

export type RestFeatures = { hardy: boolean; efficient: boolean; trance: boolean; oasis: boolean };

export const NO_REST_FEATURES: RestFeatures = { hardy: false, efficient: false, trance: false, oasis: false };

/** Which rest-time features the sheet holds. */
export function restFeaturesOf(sheet: OwnedSheet, scope: OwnedScope = {}): RestFeatures {
  const ids = new Set(owned(sheet, scope).map((f) => f.featureId));
  return {
    hardy: ids.has(REST_FEATURE_IDS.hardy),
    efficient: ids.has(REST_FEATURE_IDS.efficient),
    trance: ids.has(REST_FEATURE_IDS.trance),
    oasis: ids.has(REST_FEATURE_IDS.oasis),
  };
}

/**
 * The moves Efficient adds to a short rest: the long rest's moves the short rest does not already list, without the
 * frame's forbidden ones. Nothing on a long rest or without the feature. "a long rest move instead of a short rest move"
 * (CB p.53) is one move: `validateFeatureChoice` takes at most one of them (open question to the user).
 */
export function efficientMoves(kind: RestKind, features: RestFeatures, base: readonly RestMove[], forbidden: readonly RestMove[] = []): RestMove[] {
  if (kind !== "short" || !features.efficient) return [];
  return REST_MOVES.long.filter((m) => !base.includes(m) && !forbidden.includes(m));
}

/** How many moves a PC picks: two, and Celestial Trance can add one more (optional: "you can"). */
export function restMoveSlots(features: RestFeatures): { min: number; max: number } {
  return { min: MOVES_PER_REST, max: MOVES_PER_REST + (features.trance ? 1 : 0) };
}

/**
 * Checks one PC's picks like `validateChoice` (./index.ts) with the feature slots: `min` to `max` moves, each one the
 * rest allows (`allowed` already lists the frame, class and Efficient moves), at most one of the `efficient` moves
 * (Efficient swaps "a long rest move" for a short rest move, CB p.53), a target only on an ally move and never yourself,
 * a countdown only on Work on a Project. Throws `RuleError("REST_RULE")`.
 */
export function validateFeatureChoice(
  characterId: string,
  moves: readonly ChosenMove[],
  allowed: readonly RestMove[],
  features: RestFeatures,
  efficient: readonly RestMove[] = [],
): void {
  const fail = (message: string): never => {
    throw new RuleError("REST_RULE", message);
  };
  const { min, max } = restMoveSlots(features);
  if (moves.length < min || moves.length > max) fail(min === max ? `Choose ${min} downtime moves.` : `Choose ${min} downtime moves, or ${max} with Celestial Trance.`);
  if (moves.filter((m) => efficient.includes(m.move)).length > 1) fail("Efficient (CB 53): choose one long rest move instead of a short rest move.");
  for (const m of moves) {
    if (!allowed.includes(m.move)) fail(`${MOVE_LABELS[m.move]} isn't a move this rest allows.`);
    if (m.targetId !== undefined && !ALLY_MOVES.includes(m.move)) fail(`${MOVE_LABELS[m.move]} can't target an ally.`);
    if (m.targetId === characterId) fail("Leave the target empty to use a move on yourself.");
    if (m.countdownId !== undefined && m.move !== "workOnProject") fail("Only Work on a Project takes a countdown.");
  }
}

/** Hardy: clears one marked Hit Point at the end of any rest. */
export function applyHardy(sheet: CharacterSheet, features: RestFeatures): { sheet: CharacterSheet; line: string | null } {
  if (!features.hardy) return { sheet, line: null };
  if (sheet.hp <= 0) return { sheet, line: "Hardy: no Hit Point to clear" };
  return { sheet: applyResourceDelta(sheet, "hp", -1), line: "Hardy: clears 1 HP" };
}

/** The downtime moves that roll a die: 1d4 + the mover's tier (CB 105). */
export const DICE_MOVES = ["tendToWounds", "clearStress", "repairArmor"] as const;
export type DiceMove = (typeof DICE_MOVES)[number];

const isDiceMove = (m: RestMove): m is DiceMove => (DICE_MOVES as readonly RestMove[]).includes(m);

/** What a dice move clears, for the feed ("2 more Stress"). */
export const DIE_UNIT: Record<DiceMove, string> = { tendToWounds: "HP", clearStress: "Stress", repairArmor: "Armor Slots" };

/** One Oasis reroll of a downtime die: the holder, the new roll and the result kept (the higher). */
export type OasisReroll = { holderId: string; rolled: number; kept: number };

/**
 * A die rolled for a downtime move, stored on the rest so an Oasis holder can reroll it after the dice are shown.
 * `targetId` only on an ally move; `value` is the result the move used, raised by each reroll that came out higher.
 */
export type DowntimeDie = {
  characterId: string;
  move: DiceMove;
  targetId?: string;
  sides: number;
  /** The mover's tier, added to the die (CB 105). */
  bonus: number;
  rolled: number;
  value: number;
  rerolls: OasisReroll[];
};

/**
 * `applyMoves` plus the downtime dice it rolled, in roll order. Each die belongs to the dice move that rolled it, in the
 * order `applyMoves` resolves them: choice order, then move order, skipping movers and targets who are not resting.
 */
export function applyMovesWithDice(
  kind: RestKind,
  input: Readonly<Record<string, CharacterSheet>>,
  choices: readonly RestChoice[],
  rng: Rng,
): MovesResult & { dice: DowntimeDie[] } {
  const rolls: { sides: number; value: number }[] = [];
  const result = applyMoves(kind, input, choices, (sides) => {
    const value = rng(sides);
    rolls.push({ sides, value });
    return value;
  });
  const slots: Pick<DowntimeDie, "characterId" | "move" | "targetId" | "bonus">[] = [];
  for (const choice of choices) {
    const mover = input[choice.characterId];
    if (mover === undefined) continue;
    for (const m of choice.moves) {
      const targetId = m.targetId ?? choice.characterId;
      if (input[targetId] === undefined || !isDiceMove(m.move)) continue;
      slots.push({ characterId: choice.characterId, move: m.move, ...(targetId !== choice.characterId ? { targetId } : {}), bonus: tierForLevel(mover.level) });
    }
  }
  // A programming error: applyMoves rolled a die for something other than a dice move, or skipped one.
  if (slots.length !== rolls.length) throw new Error(`applyMovesWithDice: ${rolls.length} dice for ${slots.length} dice moves`);
  const dice = slots.map((slot, i) => ({ ...slot, sides: rolls[i]!.sides, rolled: rolls[i]!.value, value: rolls[i]!.value, rerolls: [] }));
  return { ...result, dice };
}

/**
 * Oasis (HF p.27): "During a short rest, you or an ally can reroll a die used for a downtime move and take the higher
 * result." The player picks the die after the dice are shown (user 2026-10-30): `holderId` rerolls `dice[index]`, once
 * per short rest, and keeps the higher result. Returns the dice with the reroll recorded, the rerolled die, the new roll,
 * the result before and how much the kept result raised it (`delta`, 0 when the reroll is not higher). Throws
 * `RuleError("REST_RULE")` for a missing die or a holder who already rerolled a die this rest.
 */
export function oasisReroll(
  dice: readonly DowntimeDie[],
  index: number,
  holderId: string,
  rng: Rng,
): { dice: DowntimeDie[]; die: DowntimeDie; rolled: number; before: number; delta: number } {
  const die = Number.isInteger(index) && index >= 0 ? dice[index] : undefined;
  if (die === undefined) throw new RuleError("REST_RULE", "That downtime die doesn't exist.");
  if (dice.some((d) => d.rerolls.some((r) => r.holderId === holderId))) throw new RuleError("REST_RULE", "Oasis is used once per short rest: this character already rerolled a die.");
  const rolled = rng(die.sides);
  const kept = Math.max(die.value, rolled);
  const next: DowntimeDie = { ...die, value: kept, rerolls: [...die.rerolls, { holderId, rolled, kept }] };
  return { dice: dice.map((d, i) => (i === index ? next : d)), die: next, rolled, before: die.value, delta: kept - die.value };
}

/**
 * The extra a raised die clears on the move's target, as if the move had used the higher result: Tend to Wounds clears
 * Hit Points, Clear Stress Stress, Repair Armor Armor Slots, `delta` more of each (never below zero marked).
 */
export function applyDieDelta(sheet: CharacterSheet, move: DiceMove, delta: number): { sheet: CharacterSheet; cleared: number } {
  if (delta <= 0) return { sheet, cleared: 0 };
  switch (move) {
    case "tendToWounds": {
      const next = applyResourceDelta(sheet, "hp", -delta);
      return { sheet: next, cleared: sheet.hp - next.hp };
    }
    case "clearStress": {
      const next = applyResourceDelta(sheet, "stress", -delta);
      return { sheet: next, cleared: sheet.stress - next.stress };
    }
    case "repairArmor": {
      const armorMarked = Math.max(0, sheet.armorMarked - delta);
      return { sheet: { ...sheet, armorMarked }, cleared: sheet.armorMarked - armorMarked };
    }
  }
}
