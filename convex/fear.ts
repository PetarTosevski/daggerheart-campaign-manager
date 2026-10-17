import { ConvexError, v } from "convex/values";

import {
  amountForFearDirection,
  assertFearValue,
  calculateFearAfterAdjustment,
} from "../src/lib/domain/fear/index";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx } from "./_generated/server";
import { requireGm } from "./lib/auth";
import { loadOwnedCampaign, ruleError } from "./lib/mechanics";
import { campaignScope, withIdempotency } from "./lib/operations";

export type FearChange = { previousValue: number; newValue: number };

async function loadState(ctx: MutationCtx, campaignId: Id<"campaigns">) {
  const state = await ctx.db
    .query("campaignState")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .unique();
  if (state === null) throw new ConvexError("NOT_FOUND");
  return state;
}

/** Raises or lowers GM Fear by one (0–12). Fear is core: every frame has it. */
export const adjust = mutation({
  args: {
    campaignId: v.id("campaigns"),
    direction: v.union(v.literal("increase"), v.literal("decrease")),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { campaignId, direction, idempotencyKey }): Promise<FearChange> => {
    const user = await requireGm(ctx);
    await loadOwnedCampaign(ctx, user._id, campaignId);
    return withIdempotency(
      ctx,
      {
        scopeKey: campaignScope(campaignId),
        key: idempotencyKey,
        kind: "fear_adjust",
        request: { direction },
        createdBy: user._id,
        campaignId,
      },
      async () => {
        const state = await loadState(ctx, campaignId);
        let newValue: number;
        try {
          newValue = calculateFearAfterAdjustment(state.fear, amountForFearDirection(direction));
        } catch (error) {
          ruleError("FEAR_RANGE", error);
        }
        await ctx.db.patch(state._id, { fear: newValue });
        return { previousValue: state.fear, newValue };
      },
    );
  },
});

/** Sets GM Fear to a value 0–12 (the dashboard's tokens). */
export const set = mutation({
  args: { campaignId: v.id("campaigns"), value: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, value, idempotencyKey }): Promise<FearChange> => {
    const user = await requireGm(ctx);
    await loadOwnedCampaign(ctx, user._id, campaignId);
    try {
      assertFearValue(value);
    } catch (error) {
      ruleError("FEAR_RANGE", error);
    }
    return withIdempotency(
      ctx,
      {
        scopeKey: campaignScope(campaignId),
        key: idempotencyKey,
        kind: "fear_set",
        request: { value },
        createdBy: user._id,
        campaignId,
      },
      async () => {
        const state = await loadState(ctx, campaignId);
        if (state.fear !== value) await ctx.db.patch(state._id, { fear: value });
        return { previousValue: state.fear, newValue: value };
      },
    );
  },
});
