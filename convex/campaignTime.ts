import { v } from "convex/values";

import {
  getNextCampaignTime,
  toCampaignCycleDay,
  withCycleDay,
  type CampaignTime,
} from "../src/lib/domain/campaign-time/index";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireGm } from "./lib/auth";
import { assertMechanicEnabled, loadOwnedCampaign, ruleError } from "./lib/mechanics";
import { campaignScope, withIdempotency } from "./lib/operations";

type TimeView = { week: number; cycle: "DAY" | "NIGHT"; cycleDay: number };

const toDomain = (row: Doc<"campaignTime">): CampaignTime => ({
  currentWeek: row.week,
  currentCycle: row.cycle,
  currentCycleDay: toCampaignCycleDay(row.cycleDay),
});

const toView = (t: CampaignTime): TimeView => ({
  week: t.currentWeek,
  cycle: t.currentCycle,
  cycleDay: t.currentCycleDay,
});

const INITIAL_TIME: TimeView = { week: 1, cycle: "DAY", cycleDay: 1 };

/**
 * The campaign's time row after the owner and Witherwild-frame checks, or null
 * for a Witherwild campaign created before campaign time existed (D1); such a
 * campaign is at the initial time until its first change.
 */
async function findTime(ctx: QueryCtx, ownerId: Id<"users">, campaignId: Id<"campaigns">) {
  const campaign = await loadOwnedCampaign(ctx, ownerId, campaignId);
  assertMechanicEnabled(campaign, "campaignTime");
  return ctx.db
    .query("campaignTime")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .unique();
}

async function loadTime(ctx: MutationCtx, ownerId: Id<"users">, campaignId: Id<"campaigns">) {
  const row = await findTime(ctx, ownerId, campaignId);
  if (row !== null) return row;
  const id = await ctx.db.insert("campaignTime", { campaignId, ...INITIAL_TIME });
  return (await ctx.db.get(id))!;
}

export const get = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }): Promise<TimeView> => {
    const user = await requireGm(ctx);
    const row = await findTime(ctx, user._id, campaignId);
    return row ? toView(toDomain(row)) : INITIAL_TIME;
  },
});

/** One campaign day forward; after day 7 a new week starts in the other cycle. */
export const advance = mutation({
  args: { campaignId: v.id("campaigns"), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, idempotencyKey }): Promise<TimeView> => {
    const user = await requireGm(ctx);
    const row = await loadTime(ctx, user._id, campaignId);
    return withIdempotency(
      ctx,
      {
        scopeKey: campaignScope(campaignId),
        key: idempotencyKey,
        kind: "campaign_time_advance",
        request: {},
        createdBy: user._id,
        campaignId,
      },
      async () => {
        const next = getNextCampaignTime(toDomain(row));
        await ctx.db.patch(row._id, toView(next));
        return toView(next);
      },
    );
  },
});

/** Sets the day within the current week (the arc's icons). Must change the day. */
export const setDay = mutation({
  args: { campaignId: v.id("campaigns"), cycleDay: v.number(), idempotencyKey: v.string() },
  handler: async (ctx, { campaignId, cycleDay, idempotencyKey }): Promise<TimeView> => {
    const user = await requireGm(ctx);
    const row = await loadTime(ctx, user._id, campaignId);
    return withIdempotency(
      ctx,
      {
        scopeKey: campaignScope(campaignId),
        key: idempotencyKey,
        kind: "campaign_time_set_day",
        request: { cycleDay },
        createdBy: user._id,
        campaignId,
      },
      async () => {
        let next: CampaignTime;
        try {
          next = withCycleDay(toDomain(row), cycleDay);
        } catch (error) {
          ruleError("TIME_RULE", error);
        }
        await ctx.db.patch(row._id, toView(next));
        return toView(next);
      },
    );
  },
});
