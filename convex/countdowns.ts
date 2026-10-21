import { v, type Infer } from "convex/values";

import {
  applyCountdownAction,
  COUNTDOWN_CATEGORIES,
  COUNTDOWN_STATUSES,
  COUNTDOWN_VISIBILITY_PRESETS,
  countdownForPlayer,
  CountdownRangeError,
  CountdownRuleError,
  MAX_COUNTDOWN_START,
  normaliseCountdownVisibility,
} from "../src/lib/domain/countdowns/index";
import { COUNTDOWN_MODES, COUNTDOWN_REPEATS, COUNTDOWN_REST_MODES, startFromDice, validateSteps } from "../src/lib/domain/countdowns/advanced";
import { appError } from "../src/lib/errors/app-error";
import { countdownDetailsSchema } from "../src/lib/validation/countdowns";
import type { Doc } from "./_generated/dataModel";
import { campaignQuery, keyedGmMutation, keyedUserMutation } from "./lib/functions";
import { rollDice } from "./lib/dice";
import { applyRule } from "./lib/mechanics";
import { atLeast, campaignAccess } from "./lib/permissions";
import {
  countdownChaseValidator,
  countdownModeValidator,
  countdownRepeatValidator,
  countdownRestModeValidator,
  countdownStartDiceValidator,
  countdownStepValidator,
  countdownVisibilityValidator,
} from "./tables/countdowns";
import { recordHistory } from "./tables/history";

const orNull = <T extends Parameters<typeof v.union>[number]>(validator: T) => v.union(validator, v.null());

/**
 * A dashboard countdown as the caller may see it. The GM gets everything; a player gets `null` for each
 * field the GM hid (CV1), and never receives a private countdown.
 * Advanced fields (countdowns-advanced D12): mode, repeat, initialValue, triggerCount and lastTriggeredAt travel with
 * "progress"; armed, startDice, steps and restMode are GM-only (null for players); chase links a pair's rows.
 * For the GM: mode defaults to "standard", armed to false, triggerCount to 0; steps and restMode are set for longTerm only.
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
  mode: orNull(v.union(...COUNTDOWN_MODES.map((m) => v.literal(m)))),
  armed: orNull(v.boolean()),
  repeat: orNull(v.union(...COUNTDOWN_REPEATS.map((r) => v.literal(r)))),
  initialValue: orNull(v.number()),
  startDice: orNull(countdownStartDiceValidator),
  triggerCount: orNull(v.number()),
  lastTriggeredAt: orNull(v.number()),
  chase: orNull(countdownChaseValidator),
  steps: orNull(v.array(countdownStepValidator)),
  restMode: orNull(v.union(...COUNTDOWN_REST_MODES.map((r) => v.literal(r)))),
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
  mode: c.mode ?? "standard",
  armed: c.armed ?? false,
  repeat: c.repeat ?? null,
  initialValue: c.initialValue ?? null,
  startDice: c.startDice ?? null,
  triggerCount: c.triggerCount ?? 0,
  lastTriggeredAt: c.lastTriggeredAt ?? null,
  chase: c.chase ?? null,
  steps: c.mode === "longTerm" ? (c.steps ?? []) : null,
  restMode: c.mode === "longTerm" ? (c.restMode ?? "auto") : null,
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

/**
 * Creates a dashboard countdown. GM only. Without the advanced args this is today's countdown (unarmed standard, D4).
 * `startDice` instead of `startingValue` is rolled here (R5, D8), capped 1..MAX_COUNTDOWN_START, and kept as the
 * start every reset reuses (Q4); `repeat` keeps the first start as `initialValue`; `steps` and `restMode` belong to a
 * longTerm countdown (D10, Q3). Shape errors are INVALID (countdownDetailsSchema).
 */
export const create = keyedGmMutation({
  args: {
    name: v.string(),
    description: v.string(),
    category: v.union(...COUNTDOWN_CATEGORIES.map((c) => v.literal(c))),
    /** Exactly one of startingValue and startDice. */
    startingValue: v.optional(v.number()),
    consequence: v.string(),
    /** Who sees it; absent = everything public. */
    visibility: v.optional(countdownVisibilityValidator),
    mode: v.optional(countdownModeValidator),
    repeat: v.optional(countdownRepeatValidator),
    startDice: v.optional(countdownStartDiceValidator),
    /** Ticks by itself on counted rolls (long rests for longTerm); absent = unarmed. */
    armed: v.optional(v.boolean()),
    steps: v.optional(v.array(countdownStepValidator)),
    restMode: v.optional(countdownRestModeValidator),
  },
  returns: v.object({ countdownId: v.id("countdowns") }),
  handler: async (ctx, { visibility, ...raw }) => {
    const { startingValue: fixed, startDice, steps, ...input } = countdownDetailsSchema.parse(raw);
    const campaignId = ctx.campaign._id;
    const shown = visibility === undefined ? undefined : normaliseCountdownVisibility(visibility);
    return ctx.once("countdown_create", { ...input, startingValue: fixed, startDice, steps, visibility: shown }, async () => {
      // The schema guarantees exactly one of the two; the server rolls every die.
      const startingValue = fixed ?? startFromDice(rollDice(startDice?.count ?? 1, startDice?.sides ?? 6), MAX_COUNTDOWN_START);
      const track = steps === undefined ? undefined : applyRule("INVALID", CountdownRuleError, () => validateSteps(startingValue, steps));
      const countdownId = await ctx.db.insert("countdowns", {
        ...input,
        campaignId,
        startingValue,
        currentValue: startingValue,
        status: "active",
        createdAt: Date.now(),
        visibility: shown,
        ...(startDice !== undefined ? { startDice } : {}),
        ...(input.repeat !== undefined ? { initialValue: startingValue } : {}),
        ...(track !== undefined ? { steps: track } : {}),
      });
      await recordHistory(ctx, ctx.user._id, {
        campaignId,
        kind: "countdown",
        action: "create",
        countdownId,
        before: null,
        after: { currentValue: startingValue, status: "active" },
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
