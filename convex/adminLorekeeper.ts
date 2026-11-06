import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { recordAdminChange } from "./lib/adminAudit";
import { settingsFrom } from "./lib/appConfig";
import { appConfigRow } from "./lib/appOwner";
import { appOwnerMutation, appOwnerQuery } from "./lib/functions";
import { atLimitValidator } from "./lib/validators/admin";

/**
 * The owner's Lorekeeper budget (config AD6, Q20 a): the settings the meter in `lib/lorekeeper/caps.ts` reads, and
 * the month's use by campaign. Owner-only (`appOwner*` wrappers: FORBIDDEN for everyone else, the GMs included).
 */

/** Dollar limits stop here (a typo of a few zeros never opens the budget wide). */
export const MAX_MONTHLY_USD = 100_000;
/** Per-person daily counts stop here. */
export const MAX_DAILY_COUNT = 10_000;
/** Campaign rows read per month by `useByCampaign` (the app has at most `caps.campaignsApp` live campaigns). */
export const USE_BY_CAMPAIGN_MAX = 300;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** One Lorekeeper setting and its new value: a single-field intent (rule 12). */
const changeValidator = v.union(
  v.object({ field: v.literal("monthlyUsd"), value: v.number() }),
  v.object({ field: v.literal("campaignMonthlyUsd"), value: v.number() }),
  v.object({ field: v.literal("dailyQuestions"), value: v.number() }),
  v.object({ field: v.literal("dailyWebSearches"), value: v.number() }),
  v.object({ field: v.literal("atLimit"), value: atLimitValidator }),
  // The board's "Let GMs raise limits", re-labelled "Let GMs ask for higher limits · You approve each request" (N10).
  v.object({ field: v.literal("allowGmRequests"), value: v.boolean() }),
  // "Email me at 80%" (AD7's email; default on, Q32 a).
  v.object({ field: v.literal("emailAt80"), value: v.boolean() }),
);

/** A number setting checked and normalised: dollars to the cent, counts whole; INVALID outside the bounds. */
function checkedNumber(field: "monthlyUsd" | "campaignMonthlyUsd" | "dailyQuestions" | "dailyWebSearches", value: number): number {
  const dollars = field === "monthlyUsd" || field === "campaignMonthlyUsd";
  const max = dollars ? MAX_MONTHLY_USD : MAX_DAILY_COUNT;
  if (!Number.isFinite(value) || value < 0 || value > max) throw appError("INVALID");
  if (dollars) return Math.round(value * 100) / 100;
  if (!Number.isInteger(value)) throw appError("INVALID");
  return value;
}

/**
 * Sets one Lorekeeper setting (single-field intent), audited as `lorekeeper.set` with the effective value before
 * (the saved value, else the env var, else the default) and the new one. Takes effect on the next question.
 */
export const setLimit = appOwnerMutation({
  args: { change: changeValidator },
  returns: v.null(),
  handler: async (ctx, { change }) => {
    const row = await appConfigRow(ctx);
    const before = settingsFrom(row).lorekeeper;
    const value =
      change.field === "atLimit" || change.field === "allowGmRequests" || change.field === "emailAt80"
        ? change.value
        : checkedNumber(change.field, change.value);
    const lorekeeper = { ...row?.lorekeeper, [change.field]: value };
    const now = Date.now();
    if (row === null) await ctx.db.insert("appConfig", { key: "app", lorekeeper, updatedAt: now });
    else await ctx.db.patch("appConfig", row._id, { lorekeeper, updatedAt: now });
    await recordAdminChange(ctx, ctx.user._id, { action: "lorekeeper.set", field: change.field, from: before[change.field], to: value });
    return null;
  },
});

const campaignUseValidator = v.object({
  campaignId: v.id("campaigns"),
  /** Null once the campaign is purged (its counter goes with it, so this is rare). */
  name: v.union(v.string(), v.null()),
  /** In the bin (soft-deleted) or purged. */
  deleted: v.boolean(),
  questions: v.number(),
  /** US dollars × 1,000,000. */
  costMicros: v.number(),
});

/**
 * The Lorekeeper's use in one UTC month ("YYYY-MM"): the whole app's questions and spend (the deployment counter)
 * and each campaign's (its month counter, `by_kind_period`, bounded), joined to the campaign's name, most spent
 * first. `truncated` = more campaigns used it than were read.
 */
export const useByCampaign = appOwnerQuery({
  args: { month: v.string() },
  returns: v.object({
    month: v.string(),
    total: v.object({ questions: v.number(), costMicros: v.number() }),
    campaigns: v.array(campaignUseValidator),
    truncated: v.boolean(),
  }),
  handler: async (ctx, { month }) => {
    if (!MONTH.test(month)) throw appError("INVALID");
    const [deployment, rows] = await Promise.all([
      ctx.db
        .query("lorekeeperUsage")
        .withIndex("by_kind_period", (q) => q.eq("kind", "deployment").eq("period", month))
        .first(),
      ctx.db
        .query("lorekeeperUsage")
        .withIndex("by_kind_period", (q) => q.eq("kind", "campaign").eq("period", month))
        .take(USE_BY_CAMPAIGN_MAX + 1),
    ]);
    const read = rows.slice(0, USE_BY_CAMPAIGN_MAX).filter((row) => row.campaignId !== undefined);
    const campaigns = await Promise.all(
      read.map(async (row) => {
        const campaignId = row.campaignId!;
        const campaign = await ctx.db.get("campaigns", campaignId);
        return {
          campaignId,
          name: campaign?.name ?? null,
          deleted: campaign === null || campaign.deletedAt !== undefined,
          questions: row.questions,
          costMicros: row.costMicros,
        };
      }),
    );
    campaigns.sort((a, b) => b.costMicros - a.costMicros || b.questions - a.questions);
    return {
      month,
      total: { questions: deployment?.questions ?? 0, costMicros: deployment?.costMicros ?? 0 },
      campaigns,
      truncated: rows.length > USE_BY_CAMPAIGN_MAX,
    };
  },
});
