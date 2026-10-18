/**
 * Frame rest hooks (D5): each campaign frame's own rest rule, run by
 * `rests.finish` and `rests.interrupt` (convex/rests.ts) after the core moves,
 * before the sheets are saved and logged. Empty in T3; T3b adds Age of Umbra,
 * Colossus, Horizon, Beast Feast, Andaluria and Motherboard, each behind its
 * frame and option checks.
 *
 * Contract:
 * - A hook may replace entries of `sheets` (the resting PCs' sheets, after the
 *   core moves and expiry); those changes are saved, logged and undone with
 *   the rest. Anything else it changes (a tracker, a countdown) keeps its own
 *   history and controls (plan note 11): rest undo does not revert it.
 * - It returns feed lines for the rest's campaign row (or none).
 * - `extraMoves` lists the frame's extra downtime moves for a rest kind (Make
 *   a Feast); `rests.choose` accepts them on top of the core moves.
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
import type { RestKind, RestMove } from "../../src/lib/domain/rest/index";
import type { Rng } from "../../src/lib/domain/class-features/types";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

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

/** Every frame's rest hook, in order (T3b fills it). */
export const REST_HOOKS: readonly RestHook[] = [];

/** Runs every hook; returns their feed lines. */
export async function runRestHooks(ctx: MutationCtx, input: RestHookInput): Promise<string[]> {
  const lines: string[] = [];
  for (const hook of REST_HOOKS) lines.push(...(await hook(ctx, input)));
  return lines;
}

/** The frame's extra downtime moves for this rest kind (none in core). */
export function extraMoves(campaign: Doc<"campaigns">, kind: RestKind): RestMove[] {
  void campaign;
  void kind;
  return [];
}
