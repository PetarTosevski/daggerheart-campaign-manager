import { getAuthUserId } from "@convex-dev/auth/server";

import { MAX_FEAR } from "../../src/lib/domain/fear/index";
import { appError } from "../../src/lib/errors/app-error";
import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { recordHistory } from "../tables/history";

/** The campaign's state row, which holds GM Fear (created with the campaign). */
export async function campaignFearState(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"campaignState">> {
  const state = await ctx.db
    .query("campaignState")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .unique();
  if (state === null) throw appError("NOT_FOUND");
  return state;
}

/**
 * Adds Fear to the campaign's GM Fear, clamped at 12 (the rules' maximum).
 * Returns how much was gained and how much was lost to the cap. A change is
 * recorded in `history` (action "gain"), with the signed-in caller as `by`.
 */
export async function gainFear(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  amount: number,
): Promise<{ previousValue: number; newValue: number; gained: number; lost: number }> {
  const state = await campaignFearState(ctx, campaignId);
  const newValue = Math.min(MAX_FEAR, state.fear + Math.max(0, amount));
  if (newValue !== state.fear) {
    await ctx.db.patch("campaignState", state._id, { fear: newValue });
    await recordHistory(ctx, await getAuthUserId(ctx), { campaignId, kind: "fear", action: "gain", before: state.fear, after: newValue });
  }
  return { previousValue: state.fear, newValue, gained: newValue - state.fear, lost: Math.max(0, amount) - (newValue - state.fear) };
}

/**
 * Takes back Fear an undone action gained (D5 undo): subtracts `amount`
 * (a negative amount gives Fear back), kept within 0–12, and records the
 * change in `history` with action "undo". Returns how much actually changed.
 *
 * ```ts
 * await revertFear(ctx, campaignId, row.fearDelta ?? 0); // a Fear roll gained 1 → GM Fear −1, never below 0
 * ```
 */
export async function revertFear(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  amount: number,
): Promise<{ previousValue: number; newValue: number; reverted: number }> {
  const state = await campaignFearState(ctx, campaignId);
  const newValue = Math.max(0, Math.min(MAX_FEAR, state.fear - amount));
  if (newValue !== state.fear) {
    await ctx.db.patch("campaignState", state._id, { fear: newValue });
    await recordHistory(ctx, await getAuthUserId(ctx), { campaignId, kind: "fear", action: "undo", before: state.fear, after: newValue });
  }
  return { previousValue: state.fear, newValue, reverted: state.fear - newValue };
}

/** Why the GM spends Fear (CB p.154): an interrupt, an additional GM move, a Fear Feature, or an adversary's Experience. */
export const FEAR_SPEND_REASONS = ["interrupt", "move", "feature", "experience"] as const;
export type FearSpendReason = (typeof FEAR_SPEND_REASONS)[number];

/**
 * Spends `amount` (a whole number 1–12, else FEAR_RANGE) of the campaign's GM Fear for `reason` (CB p.154). Refuses with
 * FEAR_EMPTY when the GM holds less than `amount`, and records the change in `history` (action "spend"),
 * with the signed-in caller as `by`. The history row has no reason field; the reason is returned for the
 * caller's own log.
 *
 * ```ts
 * await spendFear(ctx, ctx.campaign._id, 1, "move"); // GM Fear 3 → 2
 * ```
 */
export async function spendFear(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  amount: number,
  reason: FearSpendReason,
): Promise<{ previousValue: number; newValue: number; reason: FearSpendReason }> {
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_FEAR) {
    throw appError("FEAR_RANGE", `Fear to spend must be a whole number from 1 to ${MAX_FEAR}.`);
  }
  const state = await campaignFearState(ctx, campaignId);
  if (state.fear < amount) throw appError("FEAR_EMPTY");
  const newValue = state.fear - amount;
  await ctx.db.patch("campaignState", state._id, { fear: newValue });
  await recordHistory(ctx, await getAuthUserId(ctx), { campaignId, kind: "fear", action: "spend", before: state.fear, after: newValue });
  return { previousValue: state.fear, newValue, reason };
}
