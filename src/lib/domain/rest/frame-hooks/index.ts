// Frame rest rules (D5 T3b): the pure parts of each campaign frame's own rest
// rule. convex/lib/restHooks.ts runs them when the GM finishes a rest. Pure
// module: bundled into Convex, relative imports only.
//
// ```ts
// const watchers = keepWatchRolls(choices, rng);           // Age of Umbra
// const days = horizonDaysPassed({ kind, interrupted, gmOverride });
// const marked = corruptionMarked(rng(12));                // Motherboard
// ```

import { z } from "zod";

import { RuleError } from "../../../errors/app-error";
import type { Rng } from "../../class-features/types";
import type { RestKind, RestMove } from "../moves";

export const FRAME_IDS = {
  ageOfUmbra: "age-of-umbra",
  colossus: "colossus-of-the-drylands",
  horizon: "journey-to-horizon",
  beastFeast: "beast-feast",
  andaluria: "dark-heart-of-andaluria",
  motherboard: "motherboard",
} as const;

/**
 * Keep Watch (CB 289): "Parties have access to an additional downtime move:
 * Keep Watch: … When the GM makes a Lurking Darkness roll at the end of
 * downtime, you roll your Hope Die".
 */
export const KEEP_WATCH_MOVE: RestMove = "keepWatch";
/** HF 153: "It ticks down each time the PC takes a rest without using a downtime move to halt their lycanthropy's progression." */
export const HALT_LYCANTHROPY_MOVE: RestMove = "haltLycanthropy";

type Choice = { characterId: string; moves: readonly { move: string }[] };

/** True when the character chose `move` among this rest's picks. */
export function chose(choices: readonly Choice[], characterId: string, move: string): boolean {
  return choices.some((c) => c.characterId === characterId && c.moves.some((m) => m.move === move));
}

/** One Hope Die (d12) per PC who chose Keep Watch (CB 289), among `resting` PCs. */
export function keepWatchRolls(choices: readonly Choice[], resting: ReadonlySet<string>, rng: Rng): number[] {
  return choices.filter((c) => resting.has(c.characterId) && c.moves.some((m) => m.move === KEEP_WATCH_MOVE)).map(() => rng(12));
}

/**
 * Journey to Horizon (HF 176): "Outside a sanctuary, the party can take only
 * short rests, each of which represents an entire day spent in one location."
 * A finished short rest passes a day; an interrupted long rest or a long rest
 * ("multiple days", no number given) passes none. Since RF2 a fourth short
 * rest in a row is refused (CB 105, HF 176), so no new rest carries
 * `gmOverride`; it is still honoured (no day) for rests stored before RF2.
 */
export function horizonDaysPassed(rest: { kind: RestKind; interrupted: boolean; gmOverride: boolean }): number {
  return rest.kind === "short" && !rest.interrupted && !rest.gmOverride ? 1 : 0;
}

/** HF 176: "At the end of a rest, each PC gains an Endurance Countdown (6)." */
export const ENDURANCE_START = 6;
/** HF 153: "activate a long-term Lycanthropy Countdown (6)". */
export const LYCANTHROPY_START = 6;

/** Frame-owned countdowns keyed per character, off the dashboard list and off the project picker (`rests.projects` reads ownerKey = the id). */
export const enduranceOwnerKey = (characterId: string) => `endurance:${characterId}`;
export const lycanthropyOwnerKey = (characterId: string) => `lycanthropy:${characterId}`;

/** CB 295: "the ranger rolls their Fear Die. If it lands on a 1, they must mark a Corruption". */
export function corruptionMarked(fearDie: number): boolean {
  if (!Number.isInteger(fearDie) || fearDie < 1 || fearDie > 12) throw new RangeError("The Fear Die shows 1–12.");
  return fearDie === 1;
}

/** How many Corruption rolls the tracker keeps. */
export const CORRUPTION_LOG_SIZE = 10;
export const CORRUPTION_TRACKER_KEY = "motherboard.corruption";
/** CB 295: the Corruption Track recorded on the Companion sheet has six boxes. */
export const CORRUPTION_TRACK_SIZE = 6;
/** CB 295: a technomancer's temporary repair "clears 1d4 Corruption". */
export const CORRUPTION_REPAIR_DIE = 4;

/**
 * The marked Corruption per Beastbound ranger (character id → marks), the
 * rangers whose companion is a remnant (CB 295: "If a Beastbound ranger has a
 * remnant companion…"), and the latest rolls. `remnant` was added by RF4 with
 * a default, so rows written before read as "no remnant companions". Marks
 * stored above six before RF4 read as a full track.
 */
export const corruptionStateSchema = z.object({
  marks: z.record(z.string(), z.number().int().min(0).max(100)),
  remnant: z.array(z.string()).max(100).default([]),
  log: z
    .array(z.object({ characterId: z.string(), fearDie: z.number().int().min(1).max(12), marked: z.boolean(), at: z.number() }))
    .max(CORRUPTION_LOG_SIZE),
});
export type CorruptionState = z.infer<typeof corruptionStateSchema>;
export const INITIAL_CORRUPTION: CorruptionState = { marks: {}, remnant: [], log: [] };

/** A ranger's marked Corruption, at most the track's six boxes. */
export const corruptionOf = (state: CorruptionState, characterId: string) => Math.min(state.marks[characterId] ?? 0, CORRUPTION_TRACK_SIZE);
export const isRemnant = (state: CorruptionState, characterId: string) => state.remnant.includes(characterId);
/** CB 295: "If the companion's last Corruption is ever marked, the remnant becomes violent and can no longer be commanded or repaired." */
export const companionLost = (state: CorruptionState, characterId: string) => corruptionOf(state, characterId) >= CORRUPTION_TRACK_SIZE;
/** Only a remnant companion that is not lost rolls at the start of downtime. */
export const rollsCorruption = (state: CorruptionState, characterId: string) => isRemnant(state, characterId) && !companionLost(state, characterId);


export const COMPANION_LOST =
  "The remnant has become violent: it can no longer be commanded or repaired. The ranger takes a new companion with two new Experiences (CB 295).";

/** Records one ranger's downtime Corruption roll; the track stops at six. */
export function rollCorruption(
  state: CorruptionState,
  characterId: string,
  fearDie: number,
  at: number,
): { state: CorruptionState; marked: boolean; total: number; lost: boolean } {
  const marked = corruptionMarked(fearDie);
  const total = Math.min(corruptionOf(state, characterId) + (marked ? 1 : 0), CORRUPTION_TRACK_SIZE);
  return {
    state: {
      ...state,
      marks: marked ? { ...state.marks, [characterId]: total } : state.marks,
      log: [{ characterId, fearDie, marked, at }, ...state.log].slice(0, CORRUPTION_LOG_SIZE),
    },
    marked,
    total,
    lost: total >= CORRUPTION_TRACK_SIZE,
  };
}

/** The owner or the GM marks (or unmarks) the companion as a remnant; a lost remnant can't be changed. */
export function setRemnant(state: CorruptionState, characterId: string, remnant: boolean): CorruptionState {
  if (companionLost(state, characterId)) throw new RuleError("EXTRA_RULE", COMPANION_LOST);
  const others = state.remnant.filter((id) => id !== characterId);
  return { ...state, remnant: remnant ? [...others, characterId] : others };
}

/** CB 295: a technomancer's temporary repair "clears 1d4 Corruption" (`d4` is the rolled die). */
export function repairCorruption(state: CorruptionState, characterId: string, d4: number): { state: CorruptionState; cleared: number; total: number } {
  if (!Number.isInteger(d4) || d4 < 1 || d4 > CORRUPTION_REPAIR_DIE) throw new RangeError("The repair die shows 1–4.");
  if (!isRemnant(state, characterId)) throw new RuleError("EXTRA_RULE", "Only a remnant companion can be repaired.");
  if (companionLost(state, characterId)) throw new RuleError("EXTRA_RULE", COMPANION_LOST);
  const before = corruptionOf(state, characterId);
  if (before === 0) throw new RuleError("EXTRA_RULE", "The remnant has no Corruption to clear.");
  const total = Math.max(0, before - d4);
  return { state: { ...state, marks: { ...state.marks, [characterId]: total } }, cleared: before - total, total };
}

/**
 * CB 295: "The ranger must take a new companion with two new Experiences."
 * Clears the lost remnant's track and its remnant mark (the new companion is
 * marked a remnant again if it is one).
 */
export function replaceLostCompanion(state: CorruptionState, characterId: string): CorruptionState {
  if (!companionLost(state, characterId)) throw new RuleError("EXTRA_RULE", "Only a lost companion is replaced.");
  const marks = { ...state.marks };
  delete marks[characterId];
  return { ...state, marks, remnant: state.remnant.filter((id) => id !== characterId) };
}

/**
 * Beast Feast (CB 278): "players can't choose downtime moves to clear Stress,
 * clear Hit Points, or gain Hope. Instead, they have a new downtime move:
 * Make a Feast." The frame's extra move on either rest.
 */
export const FEAST_MOVE: RestMove = "makeAFeast";

/** CB 278: the core moves that clear Stress, clear Hit Points or gain Hope, which Beast Feast players can't choose. */
export const FEAST_FORBIDDEN: readonly RestMove[] = ["tendToWounds", "tendToAllWounds", "clearStress", "clearAllStress", "prepare", "prepareTogether"];

/** HF 14, Favor: "You can use a downtime move to show tribute to your patron." */
export const TRIBUTE_MOVE: RestMove = "tribute";

export type RestMoveRules = {
  frameId: string;
  /** Andaluria's optional transformations rule is on. */
  transformations: boolean;
  /** The PC is a Warlock (class or multiclass) and the campaign offers the Warlock's features. */
  warlock: boolean;
  /** A resting PC of the party holds Martial Preparation (Call of the Slayer mastery, CB 48). */
  martialPreparation?: boolean;
};

/** CB 48, Martial Preparation: "Your party gains access to the Martial Preparation downtime move." */
export const MARTIAL_PREPARATION_MOVE: RestMove = "martialPreparation";

/**
 * The frame and class downtime moves of one PC, on either rest, and the core
 * moves the frame forbids:
 * - Beast Feast (CB 278): Make a Feast; no moves that clear Stress, clear Hit
 *   Points or gain Hope (Berry's Restaurant, CB 279, is not modelled).
 * - The Age of Umbra (CB 289): Keep Watch.
 * - Dark Heart of Andaluria with transformations on (HF 153): halt
 *   lycanthropy, offered to every PC (whether a PC carries the countdown is
 *   not checked; see TASK-D5-TI-b questions).
 * - A Warlock (HF 14): Tribute.
 * - Every PC while the party has a Slayer at mastery rank (CB 48; user
 *   2026-10-22, dcm-bxp.63): Martial Preparation, on short and long rests.
 */
export function frameRestMoves({ frameId, transformations, warlock, martialPreparation = false }: RestMoveRules): { extra: RestMove[]; forbidden: readonly RestMove[] } {
  const extra: RestMove[] = [];
  if (frameId === FRAME_IDS.beastFeast) extra.push(FEAST_MOVE);
  if (frameId === FRAME_IDS.ageOfUmbra) extra.push(KEEP_WATCH_MOVE);
  if (frameId === FRAME_IDS.andaluria && transformations) extra.push(HALT_LYCANTHROPY_MOVE);
  if (warlock) extra.push(TRIBUTE_MOVE);
  if (martialPreparation) extra.push(MARTIAL_PREPARATION_MOVE);
  return { extra, forbidden: frameId === FRAME_IDS.beastFeast ? FEAST_FORBIDDEN : [] };
}
