/**
 * Long-term countdowns (plan countdowns-advanced, K4; CB p.164): the track of steps, the "On long rest" switch and the
 * tick on a finished long rest.
 *
 * Core Book p.164: "decide how far out the event should be (usually between 4 and 12 ticks) and ... create small boxes
 * for each tick. Starting from the first and working towards the last, write some events that may occur along the way
 * that foreshadow the final event ... During a long rest, you should generally tick down a relevant long-term countdown
 * once."
 * User answer Q3: each long-term countdown has a switch "On long rest: Automatic / Reminder" (`restMode`, absent =
 * auto). Automatic ticks it once when a long rest FINISHES (an interrupted rest does not count); Reminder only reminds
 * the GM ("Tick <name>?" with a one-click tick, `tickOnRest`). Either way only while it is armed and active (D4, D10).
 *
 * Every rest tick goes through K0's `applyTick` with source "rest" and the rest's campaign row as entryId, so
 * `rests.undo` (undoEntry -> revertTicks) takes it back (D11, Q5). Step text is GM-only (D12): it appears in the GM's
 * finish result, the GM-only notice row and `afterRest`, never in a public row.
 */
import { v } from "convex/values";

import { tickCountdown, validateSteps, type CountdownStep } from "../src/lib/domain/countdowns/advanced";
import { CountdownRuleError } from "../src/lib/domain/countdowns/index";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { applyTick } from "./lib/countdownTicks";
import { gmQuery, keyedGmMutation } from "./lib/functions";
import { applyRule } from "./lib/mechanics";
import { countdownRestModeValidator, countdownStepValidator } from "./tables/countdowns";

/** A campaign has few dashboard countdowns; armed ones fewer still. */
const ARMED_SCAN = 100;
/** One rest's log group: one row per resting PC, the campaign row and the GM's countdown notice. */
const GROUP_SCAN = 52;
/** Rests read back to find the latest one. */
const REST_SCAN = 1;

/** The step written on `value`, or null. */
export function stepAt(steps: readonly CountdownStep[] | undefined, value: number): CountdownStep | null {
  return steps?.find((s) => s.value === value) ?? null;
}

/** "Invasion: 5 left - The theocracy's troops gather at the border" / "Invasion: final event - The city falls" (GM only). */
export function trackLine(name: string, value: number, step: CountdownStep | null): string {
  const head = value === 0 ? `${name}: final event` : `${name}: ${value} left`;
  if (step === null) return head;
  return `${head} - ${step.text}${step.news === true ? " (news reaches the party)" : ""}`;
}

/** The campaign's armed, active long-term dashboard countdowns, oldest first. */
async function armedLongTerm(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"countdowns">[]> {
  const rows = await ctx.db
    .query("countdowns")
    .withIndex("by_campaign_armed", (q) => q.eq("campaignId", campaignId).eq("armed", true))
    .take(ARMED_SCAN);
  return rows.filter((c) => c.ownerKey === undefined && c.mode === "longTerm" && c.status === "active");
}

/**
 * The finished long rest's part (called by convex/rests.ts after the rest's own effects and its campaign row): each
 * armed, active long-term countdown set to Automatic ticks once (source "rest", the campaign row as entryId). Returns
 * the GM's lines and the names of those set to Reminder.
 */
export async function tickLongTermOnRest(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  entryId: Id<"actionLog">,
  actorId: Id<"users">,
): Promise<{ lines: string[]; reminders: string[] }> {
  const lines: string[] = [];
  const reminders: string[] = [];
  for (const countdown of await armedLongTerm(ctx, campaignId)) {
    if (countdown.restMode === "remind") {
      reminders.push(countdown.name);
      continue;
    }
    const ticked = await applyTick(ctx, countdown, 1, { source: "rest", entryId, actorId });
    if (!ticked.changed) continue;
    const value = ticked.after.currentValue;
    lines.push(trackLine(countdown.name, value, stepAt(countdown.steps, value)));
  }
  return { lines, reminders };
}

/** A dashboard long-term countdown of this campaign, or NOT_FOUND / COUNTDOWN_RULE. */
async function loadLongTerm(ctx: QueryCtx, campaignId: Id<"campaigns">, countdownId: Id<"countdowns">): Promise<Doc<"countdowns">> {
  const countdown = await ctx.db.get("countdowns", countdownId);
  if (countdown === null || countdown.campaignId !== campaignId || countdown.ownerKey !== undefined) throw appError("NOT_FOUND");
  if (countdown.mode !== "longTerm") throw appError("COUNTDOWN_RULE", "Only a long-term countdown has a track.");
  return countdown;
}

/**
 * Writes one step of a long-term countdown's track (D10): the text on `value` (0 = the final event), whether news reaches
 * the party; empty text removes the step. GM only. NOT_FOUND for a frame-owned or another campaign's countdown;
 * COUNTDOWN_RULE for a countdown that is not long-term, a cancelled one, or a value outside 0..start.
 */
export const setStep = keyedGmMutation({
  args: { countdownId: v.id("countdowns"), value: v.number(), text: v.string(), news: v.optional(v.boolean()) },
  returns: v.object({ steps: v.array(countdownStepValidator) }),
  handler: async (ctx, { countdownId, value, text, news }) => {
    const countdown = await loadLongTerm(ctx, ctx.campaign._id, countdownId);
    if (countdown.status === "cancelled") throw appError("COUNTDOWN_RULE", "A cancelled countdown can't be edited.");
    return ctx.once("countdown_step", { countdownId, value, text, news: news === true }, async () => {
      const others = (countdown.steps ?? []).filter((s) => s.value !== value);
      const written = text.trim() === "" ? others : [...others, { value, text, ...(news === true ? { news: true } : {}) }];
      const steps = applyRule("COUNTDOWN_RULE", CountdownRuleError, () => validateSteps(countdown.startingValue, written));
      await ctx.db.patch("countdowns", countdownId, { steps });
      return { steps };
    });
  },
});

/** Sets "On long rest: Automatic / Reminder" (Q3). GM only; NOT_FOUND / COUNTDOWN_RULE as setStep. */
export const setRestMode = keyedGmMutation({
  args: { countdownId: v.id("countdowns"), restMode: countdownRestModeValidator },
  returns: v.object({ restMode: countdownRestModeValidator }),
  handler: async (ctx, { countdownId, restMode }) => {
    const countdown = await loadLongTerm(ctx, ctx.campaign._id, countdownId);
    if (countdown.status === "cancelled") throw appError("COUNTDOWN_RULE", "A cancelled countdown can't be edited.");
    return ctx.once("countdown_rest_mode", { countdownId, restMode }, async () => {
      await ctx.db.patch("countdowns", countdownId, { restMode });
      return { restMode };
    });
  },
});

/** The campaign's latest rest when it is a finished long rest, with its campaign row (the ticks' entryId), else null. */
async function finishedLongRest(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<{ rest: Doc<"rests">; entryId: Id<"actionLog"> } | null> {
  const [rest] = await ctx.db
    .query("rests")
    .withIndex("by_campaign_started", (q) => q.eq("campaignId", campaignId))
    .order("desc")
    .take(REST_SCAN);
  if (rest === undefined || rest.kind !== "long" || rest.status !== "finished" || rest.groupId === undefined) return null;
  const groupId = rest.groupId;
  const group = await ctx.db
    .query("actionLog")
    .withIndex("by_campaign_group", (q) => q.eq("campaignId", campaignId).eq("groupId", groupId))
    .take(GROUP_SCAN);
  const row = group.find((r) => r.kind === "rest" && r.characterId === undefined && r.undoneAt === undefined);
  return row === undefined ? null : { rest, entryId: row._id };
}

const lineView = v.object({
  countdownId: v.id("countdowns"),
  name: v.string(),
  currentValue: v.number(),
  line: v.string(),
});
const reminderView = v.object({ countdownId: v.id("countdowns"), name: v.string(), currentValue: v.number() });

/**
 * What the latest finished long rest did to long-term countdowns, for the GM's rest panel: the ticks it made (with the
 * step each landed on) and the countdowns set to Reminder that it has not ticked yet. null when the latest rest is not a
 * finished long rest. GM only (step text, D12).
 */
export const afterRest = gmQuery({
  args: {},
  returns: v.union(v.null(), v.object({ restId: v.id("rests"), lines: v.array(lineView), reminders: v.array(reminderView) })),
  handler: async (ctx) => {
    const found = await finishedLongRest(ctx, ctx.campaign._id);
    if (found === null) return null;
    const ticks = await ctx.db
      .query("countdownTicks")
      .withIndex("by_entry_countdown", (q) => q.eq("entryId", found.entryId))
      .take(ARMED_SCAN);
    const lines: { countdownId: Id<"countdowns">; name: string; currentValue: number; line: string }[] = [];
    const ticked = new Set<string>();
    for (const tick of ticks) {
      if (tick.revertedAt !== undefined || tick.source !== "rest") continue;
      const countdown = await ctx.db.get("countdowns", tick.countdownId);
      if (countdown === null) continue;
      ticked.add(countdown._id);
      const value = tick.after.currentValue;
      lines.push({ countdownId: countdown._id, name: countdown.name, currentValue: value, line: trackLine(countdown.name, value, stepAt(countdown.steps, value)) });
    }
    const reminders = (await armedLongTerm(ctx, ctx.campaign._id))
      .filter((c) => c.restMode === "remind" && !ticked.has(c._id))
      .map((c) => ({ countdownId: c._id, name: c.name, currentValue: c.currentValue }));
    return { restId: found.rest._id, lines, reminders };
  },
});

/**
 * The reminder's one-click tick (Q3 "Tick <name>?"): ticks a long-term countdown once for the latest finished long rest,
 * keyed on its campaign row like an automatic tick, so undoing the rest takes it back. GM only. NOT_FOUND for another
 * campaign's or frame-owned countdown or rest; COUNTDOWN_RULE when the rest is not the latest finished long rest, the
 * countdown is not long-term or not active, or this rest already ticked it.
 */
export const tickOnRest = keyedGmMutation({
  args: { restId: v.id("rests"), countdownId: v.id("countdowns") },
  returns: v.object({ currentValue: v.number(), status: v.union(v.literal("active"), v.literal("paused"), v.literal("completed"), v.literal("cancelled")), line: v.string() }),
  handler: async (ctx, { restId, countdownId }) => {
    const rest = await ctx.db.get("rests", restId);
    if (rest === null || rest.campaignId !== ctx.campaign._id) throw appError("NOT_FOUND");
    const countdown = await loadLongTerm(ctx, ctx.campaign._id, countdownId);
    return ctx.once("countdown_rest_tick", { restId, countdownId }, async () => {
      const found = await finishedLongRest(ctx, ctx.campaign._id);
      if (found === null || found.rest._id !== restId) throw appError("COUNTDOWN_RULE", "Only the latest finished long rest ticks long-term countdowns.");
      // Checks the move first so a refusal is COUNTDOWN_RULE without writing anything.
      applyRule("COUNTDOWN_RULE", CountdownRuleError, () => tickCountdown(countdown, 1));
      const ticked = await applyTick(ctx, countdown, 1, { source: "rest", entryId: found.entryId, actorId: ctx.user._id });
      const value = ticked.after.currentValue;
      return { currentValue: value, status: ticked.after.status, line: trackLine(countdown.name, value, stepAt(countdown.steps, value)) };
    });
  },
});
