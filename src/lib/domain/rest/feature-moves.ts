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
//   records the dice, `oasisReroll` spends one reroll of the party's Oasis pool (one per Duneborne holder; DA15, user
//   2026-10-30) on any die and keeps the higher, `oasisPool` says what is left, and `applyDieDelta` clears the extra on
//   the move's target.
// - CB p.105: an interrupted short rest gives no benefits; an interrupted long rest "gain[s] the benefits of a short rest",
//   so it runs these features as a short rest (Oasis applies; Efficient keeps one long rest pick at full strength,
//   user 2026-10-30, dcm-bxp.99.19.58, `interruptedMoves` in ./index.ts).
//
// ```ts
// const features = restFeaturesOf(sheet, { hopeAndFear: true });
// features.trance;                                      // true for an elf
// restMoveSlots(features);                              // { min: 2, max: 3 }
// const { dice } = applyMovesWithDice("short", sheets, choices, rollDie); // the moves and their dice, in roll order
// const pool = { holders: ["a", "b"], closed: [] };                     // one reroll per Duneborne (DA15)
// const r = oasisReroll(dice, 0, "a", rollDie, pool);                    // keeps the higher; r.delta more to clear
// oasisPool(r.dice, pool).left;                                          // 1
// ```

import { RuleError } from "../../errors/app-error";
import type { CharacterSheet } from "../../validation/characters";
import { applyResourceDelta, tierForLevel } from "../characters/index";
import { featureEffect } from "../../srd/feature-effects/index";
import type { Step, Trigger } from "../card-effects/types";
import { owned, type OwnedScope, type OwnedSheet } from "../feature-effects/owned";
import type { FeatureEffect } from "../feature-effects/types";
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

/**
 * Which rest-time features the sheet holds: the four ids above, or any held feature whose entry says so in the rest
 * vocabulary (`restFeaturesOfEntry`, dcm-2a1). `entryOf` looks a feature's entry up (default the SRD registry).
 */
export function restFeaturesOf(
  sheet: OwnedSheet,
  scope: OwnedScope = {},
  entryOf: (featureId: string) => FeatureEffect | undefined = featureEffect,
): RestFeatures {
  const ids = owned(sheet, scope).map((f) => f.featureId);
  const held = new Set(ids);
  const out: RestFeatures = {
    hardy: held.has(REST_FEATURE_IDS.hardy),
    efficient: held.has(REST_FEATURE_IDS.efficient),
    trance: held.has(REST_FEATURE_IDS.trance),
    oasis: held.has(REST_FEATURE_IDS.oasis),
  };
  for (const id of ids) {
    const entry = entryOf(id);
    if (entry === undefined) continue;
    const found = restFeaturesOfEntry(entry);
    out.efficient ||= found.efficient;
    out.trance ||= found.trance;
    out.oasis ||= found.oasis;
  }
  return out;
}

/** Whether a trigger is a rest timing (`afterRest`, the during-rest and short / long narrowings of plan lanes V). */
function restTiming(trigger: Trigger): trigger is Extract<Trigger, { kind: "timing" }> {
  return trigger.kind === "timing" && (trigger.at === "afterRest" || trigger.at === "afterLongRest");
}

/** Every step of a list, nested ones included (optional, choose options, follow-ups, saves, checks). */
function allSteps(steps: readonly Step[]): Step[] {
  return steps.flatMap((s): Step[] => {
    if (s.kind === "optional" || s.kind === "followUp") return [s, ...allSteps(s.steps)];
    if (s.kind === "choose") return [s, ...s.options.flatMap((o) => allSteps(o.steps))];
    if (s.kind === "save") return [s, ...allSteps(s.onFail), ...allSteps(s.onSuccess)];
    if (s.kind === "check") return [s, ...allSteps(s.then), ...allSteps(s.otherwise)];
    return [s];
  });
}

/**
 * The rest-flow features one entry declares (dcm-2a1; plan lanes V: `timing.restType` / `.during`, step `downtime`): a
 * use set off by a rest timing whose steps hold a `downtime` step for this rest (`at` unset or `thisRest`):
 * `longMoveOnShort` is Efficient (CB p.53), `extraMove` Celestial Trance (CB p.56), `rerollDie` Oasis (HF p.27). The
 * rest flow runs them as SD-R built them; a `downtime` step `at: "nextRest"` is a grant from a use instead (Eloquent,
 * `extraMoveGrants`).
 */
export function restFeaturesOfEntry(entry: Pick<FeatureEffect, "uses">): Omit<RestFeatures, "hardy"> {
  const out = { efficient: false, trance: false, oasis: false };
  for (const use of entry.uses) {
    const a = use.activation;
    if ((a.kind !== "reaction" && a.kind !== "auto") || !restTiming(a.trigger)) continue;
    for (const s of allSteps(use.steps)) {
      if (s.kind !== "downtime" || s.at === "nextRest") continue;
      if (s.op === "longMoveOnShort") out.efficient = true;
      else if (s.op === "extraMove") out.trance = true;
      else out.oasis = true;
    }
  }
  return out;
}

// ---------------------------------------------------------------- an extra downtime move granted for the next rest

/**
 * The `featureUses` key prefix of an extra downtime move granted for the recipient's next rest (Eloquent, CB p.29: "Give
 * them an additional downtime move during their next rest"; dcm-bxp.99.19.2). Each grant is one entry until "rest", so
 * the next rest reads it while it is open and its own expiry clears it.
 */
export const EXTRA_MOVE_KEY = "downtime:extraMove";

/** How many extra downtime moves the sheet was granted for its next rest. */
export function extraMoveGrants(sheet: Pick<CharacterSheet, "featureUses">): number {
  return sheet.featureUses.filter((u) => u.key === EXTRA_MOVE_KEY || u.key.startsWith(`${EXTRA_MOVE_KEY}:`)).length;
}

/** The sheet with one more extra downtime move for its next rest (key `downtime:extraMove:<n>`, until "rest"). */
export function grantExtraMove<T extends Pick<CharacterSheet, "featureUses">>(sheet: T): T {
  const n = extraMoveGrants(sheet) + 1;
  return { ...sheet, featureUses: [...sheet.featureUses, { key: `${EXTRA_MOVE_KEY}:${n}`, until: "rest" as const }] };
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

/**
 * How many moves a PC picks: two, and Celestial Trance can add one more (optional: "you can"); `extra` granted moves
 * (Eloquent, `extraMoveGrants`) add one each, also optional (the player may leave a granted move unused).
 */
export function restMoveSlots(features: RestFeatures, extra = 0): { min: number; max: number } {
  return { min: MOVES_PER_REST, max: MOVES_PER_REST + (features.trance ? 1 : 0) + Math.max(0, extra) };
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
  extra = 0,
): void {
  const fail = (message: string): never => {
    throw new RuleError("REST_RULE", message);
  };
  const { min, max } = restMoveSlots(features, extra);
  const why = features.trance && extra > 0 ? "Celestial Trance and your extra moves" : features.trance ? "Celestial Trance" : "your extra moves";
  if (moves.length < min || moves.length > max) fail(min === max ? `Choose ${min} downtime moves.` : `Choose ${min} downtime moves, or up to ${max} with ${why}.`);
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

/**
 * One Oasis reroll of a downtime die: the holder who pressed, the new roll, the result kept (the higher) and whose
 * reroll of the pool it spent (`spentFrom`, DA15; absent on DA5 rows, where it is the holder's own).
 */
export type OasisReroll = { holderId: string; rolled: number; kept: number; spentFrom?: string };

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

/** The Oasis holders of a rest and the holders who closed their Oasis panel (DA15). */
export type OasisPoolState = { holders: readonly string[]; closed: readonly string[] };

/**
 * The party's Oasis pool (HF p.27; DA15, user 2026-10-30): each Duneborne holder adds one reroll. A holder's reroll is
 * gone once a reroll spent it (`spentFrom`, or the pressing holder on DA5 rows) or once that holder closed their panel
 * (closing withdraws an unused reroll). `unused` lists the holders whose reroll is still in the pool, in holder order;
 * `left` is how many rerolls the pool holds; `open` lists the holders whose panel is still open.
 */
export function oasisPool(dice: readonly DowntimeDie[], { holders, closed }: OasisPoolState): { left: number; unused: string[]; open: string[] } {
  const spent = new Set(dice.flatMap((d) => d.rerolls.map((r) => r.spentFrom ?? r.holderId)));
  const open = holders.filter((h) => !closed.includes(h));
  const unused = open.filter((h) => !spent.has(h));
  return { left: unused.length, unused, open };
}

/**
 * Oasis (HF p.27): "During a short rest, you or an ally can reroll a die used for a downtime move and take the higher
 * result." The player picks the die after the dice are shown (user 2026-10-30, DA5). The rerolls are a party pool
 * (DA15, user 2026-10-30): one per holder; any holder whose panel is open spends one on any party member's die, and the
 * same die can be rerolled again while the pool lasts, keeping the higher each time. The reroll spends the pressing
 * holder's own reroll first, else the first unused one in holder order. Returns the dice with the reroll recorded, the
 * rerolled die, the new roll, the result before and how much the kept result raised it (`delta`, 0 when the reroll is
 * not higher). Throws `RuleError("REST_RULE")` for a missing die, a non-holder, a holder who closed their panel or an
 * empty pool.
 */
export function oasisReroll(
  dice: readonly DowntimeDie[],
  index: number,
  holderId: string,
  rng: Rng,
  pool: OasisPoolState,
): { dice: DowntimeDie[]; die: DowntimeDie; rolled: number; before: number; delta: number; spentFrom: string } {
  const die = Number.isInteger(index) && index >= 0 ? dice[index] : undefined;
  if (die === undefined) throw new RuleError("REST_RULE", "That downtime die doesn't exist.");
  if (!pool.holders.includes(holderId)) throw new RuleError("REST_RULE", "Only a character who held Oasis (HF 27) during this rest can reroll.");
  if (pool.closed.includes(holderId)) throw new RuleError("REST_RULE", "This character closed their Oasis panel: they can no longer reroll.");
  const { unused } = oasisPool(dice, pool);
  const spentFrom = unused.includes(holderId) ? holderId : unused[0];
  if (spentFrom === undefined) throw new RuleError("REST_RULE", "The party's Oasis rerolls are used up for this rest.");
  const rolled = rng(die.sides);
  const kept = Math.max(die.value, rolled);
  const next: DowntimeDie = { ...die, value: kept, rerolls: [...die.rerolls, { holderId, rolled, kept, spentFrom }] };
  return { dice: dice.map((d, i) => (i === index ? next : d)), die: next, rolled, before: die.value, delta: kept - die.value, spentFrom };
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
