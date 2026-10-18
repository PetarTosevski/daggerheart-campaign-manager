/**
 * Frame rest hooks (D5): each campaign frame's own rest rule, run by
 * `rests.finish` and `rests.interrupt` (convex/rests.ts) after the core moves,
 * before the sheets are saved and logged. T3b fills it: Horizon, Age of
 * Umbra, Colossus and Andaluria live next to their trackers in
 * convex/trackers/; Beast Feast and Motherboard (no tracker module of their
 * own) live here. Each checks its frame (and option) first. Book passages:
 * docs/tasks/TASK-D5-T3b.md.
 *
 * Contract:
 * - A hook may replace entries of `sheets` (the resting PCs' sheets, after the
 *   core moves and expiry); those changes are saved, logged and undone with
 *   the rest. Anything else it changes (a tracker, a countdown) keeps its own
 *   history and controls (plan note 11): rest undo does not revert it.
 * - It returns feed lines for the rest's campaign row (or none). That row is
 *   public, so GM-only tracker results (Siphoning, Lurking Darkness rolls)
 *   stay in their tracker's log.
 * - It may throw `REST_RULE` to refuse the rest (Horizon: a long rest outside
 *   a sanctuary); it runs first so nothing is written before a refusal.
 * - `restMovesFor` lists a PC's frame and class downtime moves (Make a Feast,
 *   Keep Watch, halt lycanthropy, Tribute) and the core moves the frame
 *   forbids (Beast Feast); `rests.choose` checks picks against it.
 *
 * ```ts
 * const colossus: RestHook = async (ctx, { campaign, kind }) => {
 *   if (campaign.frameId !== "colossus") return [];
 *   await addSiphoning(ctx, campaign._id, kind === "long" ? 2 : 1);
 *   return ["Siphoning rises"];
 * };
 * export const REST_HOOKS: readonly RestHook[] = [colossus];
 * ```
 */
import type { Rng } from "../../src/lib/domain/class-features/types";
import {
  CORRUPTION_TRACKER_KEY,
  corruptionStateSchema,
  FEAST_MOVE,
  FRAME_IDS,
  frameRestMoves,
  INITIAL_CORRUPTION,
  rollCorruption,
} from "../../src/lib/domain/rest/frame-hooks/index";
import { classFeaturesAvailable } from "../../src/lib/domain/class-features/index";
import type { RestKind, RestMove } from "../../src/lib/domain/rest/index";
import { BEASTBOUND_SUBCLASS_ID } from "../../src/lib/frames/extras/common";
import { resolveOptions } from "../../src/lib/frames/options";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { ageOfUmbraRestHook } from "../trackers/ageOfUmbra";
import { andaluriaRestHook } from "../trackers/andaluria";
import { colossusRestHook } from "../trackers/colossus";
import { horizonRestHook } from "../trackers/horizon";
import { readTracker, TRACKER_SCHEMA_VERSION, writeTracker } from "./trackers";

export type RestHookInput = {
  campaign: Doc<"campaigns">;
  rest: Doc<"rests">;
  /** The rest's effect: an interrupted long rest runs as `short` (CB 105). */
  kind: RestKind;
  interrupted: boolean;
  actorId: Id<"users">;
  choices: readonly Doc<"restChoices">[];
  /** The resting PCs' sheets by id; a hook may replace entries. */
  sheets: Map<Id<"characters">, CharacterSheet>;
  rng: Rng;
};

export type RestHook = (ctx: MutationCtx, input: RestHookInput) => Promise<string[]>;

/**
 * Beast Feast (CB 278, "Making a Feast!"): the PCs who choose Make a Feast
 * cook together. Which ingredients go in, the discards and how each PC splits
 * the Meal Rating among Hit Points, Stress and Hope are the players' choices,
 * so the hook names the cooks and leaves the meal to the cookbook and the
 * sheets (T3b questions). An interrupted long rest drops the move (CB 105).
 */
const beastFeastRestHook: RestHook = async (_ctx, { campaign, interrupted, choices, sheets }) => {
  if (campaign.frameId !== FRAME_IDS.beastFeast || interrupted) return [];
  const cooks = choices.filter((c) => sheets.has(c.characterId) && c.moves.some((m) => m.move === FEAST_MOVE)).map((c) => sheets.get(c.characterId)!.name);
  if (cooks.length === 0) return [];
  return [`Make a Feast: ${cooks.join(", ")} cook; record the dish and split its Meal Rating among HP, Stress and Hope`];
};

/**
 * Motherboard, optional Corruption Track (CB 295): "At the beginning of
 * downtime, the ranger rolls their Fear Die. If it lands on a 1, they must
 * mark a Corruption". With `remnantCorruption` on, every resting Beastbound
 * ranger's Fear Die is rolled; marks and rolls are kept in the
 * `motherboard.corruption` tracker (own history, not undone with the rest).
 */
const motherboardRestHook: RestHook = async (ctx, { campaign, sheets, rng }) => {
  if (campaign.frameId !== FRAME_IDS.motherboard || !resolveOptions(campaign.frameId, campaign.options).remnantCorruption) return [];
  const rangers = [...sheets].filter(([, sheet]) => sheet.subclassId === BEASTBOUND_SUBCLASS_ID);
  if (rangers.length === 0) return [];
  let state = (await readTracker(ctx, campaign._id, CORRUPTION_TRACKER_KEY, corruptionStateSchema)) ?? INITIAL_CORRUPTION;
  const lines: string[] = [];
  for (const [id, sheet] of rangers) {
    const rolled = rollCorruption(state, id, rng(12), Date.now());
    state = rolled.state;
    if (rolled.marked) lines.push(`${sheet.name}'s remnant companion glitches: Corruption ${rolled.total}`);
  }
  await writeTracker(ctx, campaign._id, CORRUPTION_TRACKER_KEY, state, TRACKER_SCHEMA_VERSION);
  return lines;
};

/** Every frame's rest hook, in order; Horizon first, since it may refuse the rest. */
export const REST_HOOKS: readonly RestHook[] = [horizonRestHook, ageOfUmbraRestHook, colossusRestHook, beastFeastRestHook, andaluriaRestHook, motherboardRestHook];

/** Runs every hook; returns their feed lines. */
export async function runRestHooks(ctx: MutationCtx, input: RestHookInput): Promise<string[]> {
  const lines: string[] = [];
  for (const hook of REST_HOOKS) lines.push(...(await hook(ctx, input)));
  return lines;
}

/**
 * One PC's frame and class downtime moves (on either rest) and the core moves
 * the frame forbids (`frameRestMoves`): Make a Feast and the Beast Feast
 * restriction (CB 278), Keep Watch (CB 289), halting lycanthropy (HF 153,
 * transformations on), Tribute for a Warlock while its features are offered
 * (HF 14). `rests.choose` checks picks against it and `rests.current` lists it.
 */
export function restMovesFor(campaign: Doc<"campaigns">, sheet: Pick<CharacterSheet, "classId" | "multiclass">): { extra: RestMove[]; forbidden: readonly RestMove[] } {
  const options = resolveOptions(campaign.frameId, campaign.options);
  const warlock = [sheet.classId, sheet.multiclass?.classId].includes("warlock") && classFeaturesAvailable("warlock", options.hopeAndFear);
  return frameRestMoves({ frameId: campaign.frameId, transformations: options.transformations, warlock });
}
