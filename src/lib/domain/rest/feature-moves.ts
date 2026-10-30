// Rest-time heritage features (plan sheet-drawer, tracer SD-R; user answer Q15 b). Pure: which of the four features a
// sheet holds (through `owned()`, so mixed ancestries and Shapeshifter resolve as the drawer does) and what each does in
// the rest flow. `convex/rests.ts` calls it from `choose`, `current` and the rest's one transaction.
//
// Book texts (printed pages, CB = Core Book, HF = Hope & Fear):
// - Hardy (Frostborne, HF p.29): "When you take a rest, you clear a Hit Point."
// - Efficient (Clank, CB p.53): "When you take a short rest, you can choose a long rest move instead of a short rest move."
// - Celestial Trance (Elf, CB p.56): "During a rest, you can drop into a trance to choose an additional downtime move."
// - Oasis (Duneborne, HF p.27): "During a short rest, you or an ally can reroll a die used for a downtime move and take
//   the higher result."
// - CB p.105: an interrupted short rest gives no benefits; an interrupted long rest "gain[s] the benefits of a short rest",
//   so it runs these features as a short rest (Oasis applies, Efficient has nothing left to offer).
//
// ```ts
// const features = restFeaturesOf(sheet, { hopeAndFear: true });
// features.trance;                                      // true for an elf
// restMoveSlots(features);                              // { min: 2, max: 3 }
// const r = applyMovesWithOasis("short", sheets, choices, rollDie, ["holder-id"]); // rerolls the lowest die, keeps the higher
// ```

import { RuleError } from "../../errors/app-error";
import type { CharacterSheet } from "../../validation/characters";
import { applyResourceDelta } from "../characters/index";
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

/**
 * Resolves the moves (`applyMoves`) and then spends each Oasis holder's reroll. Oasis: "you or an ally can reroll a die
 * used for a downtime move and take the higher result". The die is picked here: the lowest not yet rerolled, among every
 * downtime die the party rolled, which is the one a reroll helps most (open question to the user: pick it instead).
 * Every holder gets one reroll. Only on a short rest (and an interrupted long rest, which runs as one, CB 105).
 *
 * The moves run twice on the same input: first to see the dice, then replaying the kept results, so the sheets, the
 * lines and the project work all come from `applyMoves` itself.
 */
export function applyMovesWithOasis(
  kind: RestKind,
  input: Readonly<Record<string, CharacterSheet>>,
  choices: readonly RestChoice[],
  rng: Rng,
  oasisHolders: readonly string[],
): MovesResult {
  const holders = kind === "short" ? oasisHolders.filter((id) => input[id] !== undefined) : [];
  if (holders.length === 0) return applyMoves(kind, input, choices, rng);

  const rolled: { sides: number; value: number }[] = [];
  applyMoves(kind, input, choices, (sides) => {
    const value = rng(sides);
    rolled.push({ sides, value });
    return value;
  });

  const notes = new Map<string, string[]>();
  const rerolled = new Set<number>();
  for (const holder of holders) {
    let lowest = -1;
    rolled.forEach((die, i) => {
      if (!rerolled.has(i) && (lowest === -1 || die.value < rolled[lowest]!.value)) lowest = i;
    });
    if (lowest === -1) break;
    rerolled.add(lowest);
    const die = rolled[lowest]!;
    const again = rng(die.sides);
    const kept = Math.max(die.value, again);
    (notes.get(holder) ?? notes.set(holder, []).get(holder)!).push(`Oasis: rerolled a d${die.sides} (${die.value}, then ${again}), kept ${kept}`);
    rolled[lowest] = { sides: die.sides, value: kept };
  }

  let next = 0;
  const result = applyMoves(kind, input, choices, (sides) => {
    const die = rolled[next++];
    return die !== undefined && die.sides === sides ? die.value : rng(sides);
  });
  for (const [id, lines] of notes) result.lines[id] = [...(result.lines[id] ?? []), ...lines];
  return result;
}
