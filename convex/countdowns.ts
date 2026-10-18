import { v, type Infer } from "convex/values";

import {
  applyCountdownAction,
  COUNTDOWN_CATEGORIES,
  COUNTDOWN_STATUSES,
  COUNTDOWN_VISIBILITY_PRESETS,
  countdownForPlayer,
  CountdownRangeError,
  CountdownRuleError,
  normaliseCountdownVisibility,
} from "../src/lib/domain/countdowns/index";
import { appError } from "../src/lib/errors/app-error";
import { countdownDetailsSchema } from "../src/lib/validation/countdowns";
import type { Doc } from "./_generated/dataModel";
import { campaignQuery, keyedGmMutation, keyedUserMutation } from "./lib/functions";
import { applyRule } from "./lib/mechanics";
import { atLeast, campaignAccess } from "./lib/permissions";
import { countdownVisibilityValidator } from "./tables/countdowns";
import { recordHistory } from "./tables/history";

/**
 * A dashboard countdown as the caller may see it. The GM gets everything; a player gets `null` for each
 * field the GM hid (CV1), and never receives a private countdown.
 */
const countdownView = v.object({
  _id: v.id("countdowns"),
  name: v.union(v.string(), v.null()),
  description: v.union(v.string(), v.null()),
  category: v.union(...COUNTDOWN_CATEGORIES.map((c) => v.literal(c)), v.null()),
  startingValue: v.union(v.number(), v.null()),
  currentValue: v.union(v.number(), v.null()),
  status: v.union(...COUNTDOWN_STATUSES.map((s) => v.literal(s))),
  consequence: v.union(v.string(), v.null()),
  completedAt: v.union(v.number(), v.null()),
  visibility: countdownVisibilityValidator,
});

export type CountdownView = Infer<typeof countdownView>;

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
  visibility: c.visibility ?? COUNTDOWN_VISIBILITY_PRESETS.public,
});

/**
 * The campaign's countdowns that are not cancelled, oldest first. Countdowns are core; players see them
 * read-only, without private countdowns and with hidden fields blanked here on the server.
 */
export const listByCampaign = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: v.array(countdownView),
  handler: async (ctx): Promise<CountdownView[]> => {
    // Frame-owned countdowns (objectives, Lycanthropy…) belong to their tracker panels, so
    // the index range reads only the dashboard's own (ownerKey unset); a campaign has few.
    const rows = await ctx.db
      .query("countdowns")
      .withIndex("by_campaign_owner", (q) => q.eq("campaignId", ctx.campaign._id).eq("ownerKey", undefined))
      .collect();
    const views = rows.filter((c) => c.status !== "cancelled").map(toClient);
    if (atLeast(ctx.permission, "owner")) return views;
    return views.flatMap((c) => countdownForPlayer(c, c.visibility) ?? []);
  },
});

export const create = keyedGmMutation({
  args: {
    name: v.string(),
    description: v.string(),
    category: v.union(...COUNTDOWN_CATEGORIES.map((c) => v.literal(c))),
    startingValue: v.number(),
    consequence: v.string(),
    /** Who sees it; absent = everything public. */
    visibility: v.optional(countdownVisibilityValidator),
  },
  handler: async (ctx, { visibility, ...raw }) => {
    const input = countdownDetailsSchema.parse(raw);
    const campaignId = ctx.campaign._id;
    const shown = visibility === undefined ? undefined : normaliseCountdownVisibility(visibility);
    return ctx.once("countdown_create", { ...input, visibility: shown }, async () => {
      const countdownId = await ctx.db.insert("countdowns", {
        ...input,
        campaignId,
        currentValue: input.startingValue,
        status: "active",
        createdAt: Date.now(),
        visibility: shown,
      });
      await recordHistory(ctx, ctx.user._id, {
        campaignId,
        kind: "countdown",
        action: "create",
        countdownId,
        before: null,
        after: { currentValue: input.startingValue, status: "active" },
      });
      return { countdownId };
    });
  },
});

/** Changes who sees a dashboard countdown (private / public with hidden fields / public). GM only. */
export const setVisibility = keyedGmMutation({
  args: { countdownId: v.id("countdowns"), visibility: countdownVisibilityValidator },
  returns: v.object({ visibility: countdownVisibilityValidator }),
  handler: async (ctx, { countdownId, visibility }) => {
    const countdown = await ctx.db.get("countdowns", countdownId);
    // Frame-owned countdowns keep their own `revealed` flag; another campaign's countdown is not found.
    if (countdown === null || countdown.campaignId !== ctx.campaign._id || countdown.ownerKey !== undefined) {
      throw appError("NOT_FOUND");
    }
    const next = normaliseCountdownVisibility(visibility);
    return ctx.once("countdown_visibility", { countdownId, visibility: next }, async () => {
      await ctx.db.patch("countdowns", countdownId, { visibility: next });
      return { visibility: next };
    });
  },
});

/**
 * advance / reverse / pause / resume / cancel, or a correction by `amount`,
 * following the legacy SQL rules in `applyCountdownAction`. GM only.
 * The client sends no `campaignId`, so the campaign comes from the countdown and
 * is authorized here through `campaignAccess` (permissionFor); the idempotency
 * key is scoped to the caller.
 */
export const operate = keyedUserMutation({
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
  },
  handler: async (ctx, { countdownId, action, amount }) => {
    const countdown = await ctx.db.get("countdowns", countdownId);
    // Frame-owned countdowns (objectives, Lycanthropy…) follow their tracker's rules.
    if (countdown === null || countdown.ownerKey !== undefined) throw appError("NOT_FOUND");
    const access = await campaignAccess(ctx, ctx.user, countdown.campaignId, "owner");
    if (access === null) throw appError("NOT_FOUND");
    if (!atLeast(access.permission, "owner")) throw appError("FORBIDDEN");
    if ((action === "correction") !== (amount !== undefined)) {
      throw appError("INVALID", "Only a correction takes an amount.");
    }
    return ctx.once("countdown_operate", { countdownId, action, amount }, async () => {
      // Both expected domain errors (a rule, or a value out of range) become COUNTDOWN_RULE.
      const next = applyRule("COUNTDOWN_RULE", CountdownRangeError, () =>
        applyRule("COUNTDOWN_RULE", CountdownRuleError, () => applyCountdownAction(countdown, action, amount ?? 0)),
      );
      await ctx.db.patch("countdowns", countdownId, {
        currentValue: next.currentValue,
        status: next.status,
        completedAt: next.completedNow ? Date.now() : next.reopened ? undefined : countdown.completedAt,
      });
      await recordHistory(ctx, ctx.user._id, {
        campaignId: countdown.campaignId,
        kind: "countdown",
        action,
        countdownId,
        before: { currentValue: countdown.currentValue, status: countdown.status },
        after: { currentValue: next.currentValue, status: next.status },
      });
      return { previousValue: countdown.currentValue, newValue: next.currentValue, status: next.status };
    });
  },
});
