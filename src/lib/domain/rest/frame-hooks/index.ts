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
 * Keep Watch (CB 289): "you roll your Hope Die". The move has no id in
 * `restMoveValidator` yet (convex/lib/validators/rests.ts is T0's), so a
 * choice is matched by this string; until the id exists nobody can pick it.
 */
export const KEEP_WATCH_MOVE = "keepWatch";
/** HF 153: "a downtime move to halt their lycanthropy's progression"; same caveat as Keep Watch. */
export const HALT_LYCANTHROPY_MOVE = "haltLycanthropy";

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
 * A short rest the GM forced past the third in a row (`gmOverride`) passes no
 * day (plan acceptance; see the T3b questions), nor does an interrupted long
 * rest or a long rest ("multiple days", no number given).
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

/**
 * The marked Corruption per Beastbound ranger (character id → marks) and the
 * latest rolls. The book's track is a printed graphic with no slot count in
 * the text, so marks are not capped here (T3b questions).
 */
export const corruptionStateSchema = z.object({
  marks: z.record(z.string(), z.number().int().min(0).max(100)),
  log: z
    .array(z.object({ characterId: z.string(), fearDie: z.number().int().min(1).max(12), marked: z.boolean(), at: z.number() }))
    .max(CORRUPTION_LOG_SIZE),
});
export type CorruptionState = z.infer<typeof corruptionStateSchema>;
export const INITIAL_CORRUPTION: CorruptionState = { marks: {}, log: [] };

/** Records one ranger's downtime Corruption roll. */
export function rollCorruption(state: CorruptionState, characterId: string, fearDie: number, at: number): { state: CorruptionState; marked: boolean; total: number } {
  const marked = corruptionMarked(fearDie);
  const total = (state.marks[characterId] ?? 0) + (marked ? 1 : 0);
  return {
    state: {
      marks: marked ? { ...state.marks, [characterId]: total } : state.marks,
      log: [{ characterId, fearDie, marked, at }, ...state.log].slice(0, CORRUPTION_LOG_SIZE),
    },
    marked,
    total,
  };
}

/**
 * Beast Feast (CB 278): "players can't choose downtime moves to clear Stress,
 * clear Hit Points, or gain Hope. Instead, they have a new downtime move:
 * Make a Feast." The frame's extra move on either rest.
 */
export const FEAST_MOVE: RestMove = "makeAFeast";
