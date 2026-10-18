// Downtime moves and rest counting (CB 105): the light part of the rest rules,
// with no imports, so the rest UI can use it without the class-feature registry.
// The rules that change sheets live in ./index.ts, which re-exports this module.

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
  | "tribute";

/** One chosen move, with plain id strings (the Convex caller converts). */
export type ChosenMove = { move: RestMove; targetId?: string; countdownId?: string };
export type RestChoice = { characterId: string; moves: readonly ChosenMove[] };

/** "Choose two of the following moves (or choose the same move twice)" (CB 105). */
export const MOVES_PER_REST = 2;
/** "A party can take up to three short rests before their next rest must be a long rest" (CB 105). */
export const MAX_SHORT_RESTS = 3;

/** The core moves of each rest (CB 105). Frame and class moves (Make a Feast, Tribute) come from their own rules. */
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
};

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

/** True when a new rest of this kind needs the GM's override: a fourth short rest in a row (CB 105). */
export function needsOverride(kind: RestKind, shortRests: number): boolean {
  return kind === "short" && shortRests >= MAX_SHORT_RESTS;
}
