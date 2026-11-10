// Downtime moves and rest counting (CB 105): the light part of the rest rules,
// with no runtime imports, so the rest UI can use it without the class-feature registry.
// The rules that change sheets live in ./index.ts, which re-exports this module.

import type { ModeOf } from "../../rules/registry";

/** T2 Short-rest limit (rule switch, plan rule-switches RR): Book refuses a fourth short rest, Manual warns. */
export type ShortRestLimitMode = ModeOf<"shortRestLimit">;

export type RestKind = "short" | "long";

/** Every downtime move id (mirrors `restMoveValidator`, convex/lib/validators/rests.ts). */
export type RestMove =
  | "tendToWounds"
  | "clearStress"
  | "repairArmor"
  | "prepare"
  | "prepareTogether"
  | "tendToAllWounds"
  | "clearAllStress"
  | "repairAllArmor"
  | "workOnProject"
  | "makeAFeast"
  | "tribute"
  | "keepWatch"
  | "haltLycanthropy"
  | "martialPreparation"
  /** Journey to Horizon (HF 176): "the players gain access to an additional downtime move: Locate Soul Echoes". */
  | "locateSoulEchoes"
  /** Dark Heart of Andaluria, Reanimated (HF 153): "use a downtime move to raise their maximum loadout by one". */
  | "raiseLoadout";

/** One chosen move, with plain id strings (the Convex caller converts). */
export type ChosenMove = { move: RestMove; targetId?: string; countdownId?: string };
export type RestChoice = { characterId: string; moves: readonly ChosenMove[] };

/** "Choose two of the following moves (or choose the same move twice)" (CB 105). */
export const MOVES_PER_REST = 2;
/** T1 Two moves per rest (rule switch, plan rule-switches WD): Book = the book's two, Manual = any number up to `MANUAL_MOVES_MAX`. */
export type TwoDowntimeMovesMode = ModeOf<"twoDowntimeMoves">;
/** T1 Manual (Q9 a): a PC may pick from 0 to this many moves (more only when the PC's features already give more). */
export const MANUAL_MOVES_MAX = 4;
/** "A party can take up to three short rests before their next rest must be a long rest" (CB 105). */
export const MAX_SHORT_RESTS = 3;

/** The core moves of each rest (CB 105). Frame and class moves (Make a Feast, Keep Watch, Tribute…) come from their own rules. */
export const REST_MOVES: Record<RestKind, readonly RestMove[]> = {
  short: ["tendToWounds", "clearStress", "repairArmor", "prepare", "prepareTogether"],
  long: ["tendToAllWounds", "clearAllStress", "repairAllArmor", "prepare", "prepareTogether", "workOnProject"],
};

/** Moves that "you can do to an ally instead" (CB 105). */
export const ALLY_MOVES: readonly RestMove[] = ["tendToWounds", "repairArmor", "tendToAllWounds", "repairAllArmor"];

export const MOVE_LABELS: Record<RestMove, string> = {
  tendToWounds: "Tend to Wounds",
  clearStress: "Clear Stress",
  repairArmor: "Repair Armor",
  prepare: "Prepare",
  prepareTogether: "Prepare together",
  tendToAllWounds: "Tend to All Wounds",
  clearAllStress: "Clear All Stress",
  repairAllArmor: "Repair All Armor",
  workOnProject: "Work on a Project",
  makeAFeast: "Make a Feast",
  tribute: "Tribute",
  keepWatch: "Keep Watch",
  haltLycanthropy: "Halt lycanthropy",
  martialPreparation: "Martial Preparation",
  locateSoulEchoes: "Locate Soul Echoes",
  raiseLoadout: "Raise loadout",
};

/**
 * The moves a PC can pick: the rest's core moves without the frame's
 * `forbidden` ones (Beast Feast, CB 278), then the frame and class `extra`
 * moves, in that order.
 */
export function allowedMoves(kind: RestKind, extra: readonly RestMove[] = [], forbidden: readonly RestMove[] = []): RestMove[] {
  return [...REST_MOVES[kind].filter((m) => !forbidden.includes(m)), ...extra.filter((m) => !forbidden.includes(m))];
}

/**
 * Short rests since the last finished long rest, from rests newest first. Only
 * finished short rests count: an interrupted one gave nothing, and an
 * interrupted long rest is not a long rest (CB 105).
 */
export function shortRestsSinceLong(newestFirst: readonly { kind: RestKind; status: "open" | "finished" | "interrupted" }[]): number {
  let count = 0;
  for (const rest of newestFirst) {
    if (rest.status !== "finished") continue;
    if (rest.kind === "long") break;
    count += 1;
  }
  return count;
}

/** The refusal of a fourth short rest in a row, quoting the rule. */
export const SHORT_REST_LIMIT_MESSAGE = "A party can take up to three short rests before their next rest must be a long rest (CB 105).";

/**
 * True when a new rest of this kind is refused: a fourth short rest in a row,
 * in every frame and with no GM override (CB 105; HF 176 "When the party takes
 * three short rests in a row, their next rest must be a long rest"). An
 * interrupted long rest still gives short-rest benefits "(even if they've
 * already had three short rests)" (CB 105); that is not a new rest.
 */
export function mustLongRest(kind: RestKind, shortRests: number, mode: ShortRestLimitMode = "book"): boolean {
  return mode === "book" && overShortRestLimit(kind, shortRests);
}

/**
 * True when a new rest of this kind breaks the book's limit (a fourth short rest in a row, CB 105), whatever the mode:
 * in Manual (T2) the rest still starts, the launcher warns and the GM gets `SHORT_REST_LIMIT_NOTE`.
 */
export function overShortRestLimit(kind: RestKind, shortRests: number): boolean {
  return kind === "short" && shortRests >= MAX_SHORT_RESTS;
}

/** T2 Manual: the GM's note when a fourth short rest in a row starts anyway. */
export const SHORT_REST_LIMIT_NOTE = "Fourth short rest in a row: the book says long rest";
