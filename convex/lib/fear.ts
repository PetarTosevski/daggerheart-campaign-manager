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
