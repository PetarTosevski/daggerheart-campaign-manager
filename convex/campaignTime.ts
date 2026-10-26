import { v } from "convex/values";

import {
  getNextCampaignTime,
  toCampaignCycleDay,
  withCycleDay,
  type CampaignTime,
} from "../src/lib/domain/campaign-time/index";
import type { Doc } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { campaignQuery, keyedGmMutation } from "./lib/functions";
import { applyRule, assertMechanicEnabled } from "./lib/mechanics";
import { recordHistory } from "./tables/history";

type TimeView = { week: number; cycle: "DAY" | "NIGHT"; cycleDay: number };

const timeView = v.object({
  week: v.number(),
  cycle: v.union(v.literal("DAY"), v.literal("NIGHT")),
  cycleDay: v.number(),
});

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
 * The campaign's time row after the Witherwild-frame check, or null for a
 * Witherwild campaign created before campaign time existed (D1); such a
 * campaign is at the initial time until its first change.
 */
async function findTime(ctx: QueryCtx, campaign: Doc<"campaigns">) {
  assertMechanicEnabled(campaign, "campaignTime");
  return ctx.db
    .query("campaignTime")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
    .unique();
}

/** For changes (the wrapper has already checked GM access). */
async function loadTime(ctx: MutationCtx, campaign: Doc<"campaigns">) {
  const row = await findTime(ctx, campaign);
  if (row !== null) return row;
  const id = await ctx.db.insert("campaignTime", { campaignId: campaign._id, ...INITIAL_TIME });
  return (await ctx.db.get("campaignTime", id))!;
}

/** Applies `next` and records the change in `history`. */
async function changeTime(
  ctx: MutationCtx & { user: Doc<"users"> },
  row: Doc<"campaignTime">,
  action: string,
  next: CampaignTime,
): Promise<TimeView> {
  const before = toView(toDomain(row));
  const after = toView(next);
  await ctx.db.patch("campaignTime", row._id, after);
  await recordHistory(ctx, ctx.user._id, { campaignId: row.campaignId, kind: "campaignTime", action, before, after });
  return after;
}

export const get = campaignQuery({
  need: "view",
  args: {},
  returns: timeView,
  handler: async (ctx): Promise<TimeView> => {
    const row = await findTime(ctx, ctx.campaign);
    return row ? toView(toDomain(row)) : INITIAL_TIME;
  },
});

/** One campaign day forward; after day 7 a new week starts in the other cycle. */
export const advance = keyedGmMutation({
  args: {},
  returns: timeView,
  handler: async (ctx): Promise<TimeView> => {
    const row = await loadTime(ctx, ctx.campaign);
    return ctx.once("campaign_time_advance", {}, async () =>
      changeTime(ctx, row, "advance", getNextCampaignTime(toDomain(row))),
    );
  },
});

/** Sets the day within the current week (the arc's icons). Must change the day. */
export const setDay = keyedGmMutation({
  args: { cycleDay: v.number() },
  returns: timeView,
  handler: async (ctx, { cycleDay }): Promise<TimeView> => {
    const row = await loadTime(ctx, ctx.campaign);
    return ctx.once("campaign_time_set_day", { cycleDay }, async () => {
      const next = applyRule("TIME_RULE", RangeError, () => withCycleDay(toDomain(row), cycleDay));
      return changeTime(ctx, row, "setDay", next);
    });
  },
});
