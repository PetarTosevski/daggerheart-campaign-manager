import { ConvexError } from "convex/values";

import { MAX_FEAR } from "../../src/lib/domain/fear/index";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/**
 * Adds Fear to the campaign's GM Fear, clamped at 12 (the rules' maximum).
 * Returns how much was gained and how much was lost to the cap.
 */
export async function gainFear(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  amount: number,
): Promise<{ previousValue: number; newValue: number; gained: number; lost: number }> {
  const state = await ctx.db
    .query("campaignState")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .unique();
  if (state === null) throw new ConvexError("NOT_FOUND");
  const newValue = Math.min(MAX_FEAR, state.fear + Math.max(0, amount));
  if (newValue !== state.fear) await ctx.db.patch(state._id, { fear: newValue });
  return { previousValue: state.fear, newValue, gained: newValue - state.fear, lost: Math.max(0, amount) - (newValue - state.fear) };
}
