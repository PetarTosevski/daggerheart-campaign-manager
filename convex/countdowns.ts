import { ConvexError, v } from "convex/values";

import { applyCountdownAction, COUNTDOWN_CATEGORIES } from "../src/lib/domain/countdowns/index";
import { countdownDetailsSchema } from "../src/lib/validation/countdowns";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireGm } from "./lib/auth";
import { loadOwnedCampaign, ruleError } from "./lib/mechanics";
import { campaignScope, withIdempotency, type ScopeKey } from "./lib/operations";

const toClient = (c: Doc<"countdowns">) => ({
  _id: c._id,
  name: c.name,
  description: c.description,
  category: c.category,
  startingValue: c.startingValue,
  currentValue: c.currentValue,
  status: c.status,
  consequence: c.consequence,
  completedAt: c.completedAt ?? null,
});

export type CountdownView = ReturnType<typeof toClient>;

/** The campaign's countdowns that are not cancelled, oldest first. Countdowns are core. */
export const listByCampaign = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireGm(ctx);
    await loadOwnedCampaign(ctx, user._id, campaignId);
    const rows = await ctx.db
      .query("countdowns")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .collect();
    return rows.filter((c) => c.status !== "cancelled").map(toClient);
  },
});

export const create = mutation({
  args: {
    campaignId: v.id("campaigns"),
    name: v.string(),
    description: v.string(),
    category: v.union(...COUNTDOWN_CATEGORIES.map((c) => v.literal(c))),
    startingValue: v.number(),
    consequence: v.string(),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { idempotencyKey, campaignId, ...raw }) => {
    const user = await requireGm(ctx);
    await loadOwnedCampaign(ctx, user._id, campaignId);
    const parsed = countdownDetailsSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConvexError({ code: "INVALID", message: parsed.error.issues[0]?.message });
    }
    const input = parsed.data;
    return withIdempotency(
      ctx,
      {
        scopeKey: campaignScope(campaignId),
        key: idempotencyKey,
        kind: "countdown_create",
        request: input,
        createdBy: user._id,
        campaignId,
      },
      async () => {
        const countdownId = await ctx.db.insert("countdowns", {
          ...input,
          campaignId,
          currentValue: input.startingValue,
          status: "active",
          createdAt: Date.now(),
        });
        return { countdownId };
      },
    );
  },
});

/**
 * advance / reverse / pause / resume / cancel, or a correction by `amount`,
 * following the legacy SQL rules in `applyCountdownAction`.
 */
export const operate = mutation({
  args: {
    countdownId: v.id("countdowns"),
    action: v.union(
      v.literal("advance"),
      v.literal("reverse"),
      v.literal("pause"),
      v.literal("resume"),
      v.literal("cancel"),
      v.literal("correction"),
    ),
    amount: v.optional(v.number()),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { countdownId, action, amount, idempotencyKey }) => {
    const user = await requireGm(ctx);
    const countdown = await ctx.db.get(countdownId);
    if (countdown === null) throw new ConvexError("NOT_FOUND");
    await loadOwnedCampaign(ctx, user._id, countdown.campaignId);
    if ((action === "correction") !== (amount !== undefined)) {
      throw new ConvexError({ code: "INVALID", message: "Only a correction takes an amount." });
    }
    return withIdempotency(
      ctx,
      {
        scopeKey: `countdown:${countdownId}` satisfies ScopeKey,
        key: idempotencyKey,
        kind: "countdown_operate",
        request: { action, amount },
        createdBy: user._id,
        campaignId: countdown.campaignId,
      },
      async () => {
        let next: ReturnType<typeof applyCountdownAction>;
        try {
          next = applyCountdownAction(countdown, action, amount ?? 0);
        } catch (error) {
          ruleError("COUNTDOWN_RULE", error);
        }
        await ctx.db.patch(countdownId, {
          currentValue: next.currentValue,
          status: next.status,
          completedAt: next.completedNow ? Date.now() : next.reopened ? undefined : countdown.completedAt,
        });
        return { previousValue: countdown.currentValue, newValue: next.currentValue, status: next.status };
      },
    );
  },
});
