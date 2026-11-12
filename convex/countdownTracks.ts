/**
 * Long-term tracks (plan countdowns-advanced, K4; CB p.164) and countdown rest ticks (plan rest-ticks, RT1; bead
 * dcm-674k): the track of steps, the rest settings' rolls and ticks when a rest ends, the GM's rest panel and the
 * Reminder's one-click tick.
 *
 * Core Book p.164: "decide how far out the event should be (usually between 4 and 12 ticks) and ... create small boxes
 * for each tick. ... During a long rest, you should generally tick down a relevant long-term countdown once."
 * User decisions 2026-11-12 (rest-ticks): every dashboard countdown type has "On long rest" (a FINISHED long rest) and
 * "On short rest" (a short rest, and an interrupted long rest, Q1), each a fixed N, the PCs who took part, a die or a
 * die plus those PCs, Automatic or Reminder (`src/lib/domain/countdowns/rest-ticks.ts`). The rest rolls every setting
 * once when it ends and stores the results on the rest row (`rests.restTicks`), so a Reminder ticks exactly the rolled
 * amount and a reload never rerolls. A chase pair rolls once and both rows move by that amount; one Reminder per pair.
 *
 * Every rest tick goes through K0's `applyTick` with source "rest" and the rest's campaign row as entryId, so
 * `rests.undo` (undoEntry -> revertTicks) takes it back (D11, Q5). The roll and the tick in the feed follow the
 * countdown's visibility (Public -> everyone; Private / Partly hidden -> GM only); a Reminder's roll stays GM-only until
 * the GM ticks it (Q2). Step text is GM-only (D12): never in a public row.
 *
 * The names `afterRest` / `tickOnRest` / `setRestMode` stay for installed phone builds.
 */
import { v, type Infer } from "convex/values";

import { tickCountdown, validateSteps, type CountdownStep } from "../src/lib/domain/countdowns/advanced";
import { CountdownRuleError } from "../src/lib/domain/countdowns/index";
import {
  LEGACY_LONG_TERM_AMOUNT,
  restTickAmount,
  restTickFeedAudience,
  restTickRestFor,
  restTickRollText,
  restTicksOf,
  restTickText,
  type RestTickResult,
  type RestTickRest,
} from "../src/lib/domain/countdowns/rest-ticks";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { logAction } from "./lib/actionLog";
import { applyTick, liveTick } from "./lib/countdownTicks";
import { rollDie } from "./lib/dice";
import { gmQuery, keyedGmMutation } from "./lib/functions";
import { applyRule } from "./lib/mechanics";
import { countdownRestModeValidator, countdownStepValidator } from "./tables/countdowns";
import type { restTickResultValidator } from "./tables/rests";

/** A campaign has few dashboard countdowns (the rest reads at most this many; `rests.restTicks` is bounded by it). */
const DASHBOARD_SCAN = 100;
/** One rest's log group holds at most this many rows (`GROUP_MAX`, convex/lib/actionLog.ts). */
const UNDO_GROUP_MAX = 50;
/** Rests read back to find the latest one. */
const REST_SCAN = 1;

export type StoredRestTick = Infer<typeof restTickResultValidator>;

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

/** A long-term countdown's GM line after a rest tick: its track line, plus the roll when the amount was not fixed. */
function longTermLine(countdown: Doc<"countdowns">, value: number, result: RestTickResult): string {
  const line = trackLine(countdown.name, value, stepAt(countdown.steps, value));
  return restTickRollText(result) === null ? line : `${line} (ticked ${restTickText(result)})`;
}

/** The name a rest tick shows: a chase pair is "<rivals' name> chase"; any other countdown its name. */
function tickName(countdown: Doc<"countdowns">, partner: Doc<"countdowns"> | null): string {
  if (countdown.chase === undefined) return countdown.name;
  const rivals = countdown.chase.side === "rivals" ? countdown : partner;
  return `${rivals?.name ?? countdown.name} chase`;
}

/** What the stored roll gives back as a result (for the texts). */
function resultOf(stored: StoredRestTick): RestTickResult {
  return { amount: stored.amount, ...(stored.pcs !== undefined ? { pcs: stored.pcs } : {}), ...(stored.die !== undefined ? { die: stored.die } : {}) };
}

/** The feed label of an ended rest's rest ticks. */
export function restTickLabel(rest: Pick<Doc<"rests">, "kind" | "status">): string {
  if (rest.status === "interrupted") return "Interrupted long rest";
  return rest.kind === "long" ? "Long rest" : "Short rest";
}

/** A chase row's partner when it is a dashboard countdown of the same campaign, else null. */
async function partnerOf(ctx: QueryCtx, countdown: Doc<"countdowns">): Promise<Doc<"countdowns"> | null> {
  if (countdown.chase === undefined) return null;
  const partner = await ctx.db.get("countdowns", countdown.chase.partnerId);
  if (partner === null || partner.campaignId !== countdown.campaignId || partner.ownerKey !== undefined) return null;
  return partner;
}

export type RestTickOutcome = {
  /** Every setting's roll, for `rests.restTicks` (one entry per row; a chase pair's two rows share the roll). */
  restTicks: StoredRestTick[];
  /** Automatic ticks of Public countdowns ("Storm ticks 5 (1d6 3 + 2 PCs)"), for one public feed row. */
  publicItems: string[];
  /** Automatic ticks of Private / Partly hidden countdowns, long-term step lines and the reminders, for one GM row. */
  gmItems: string[];
  /** The GM's lines of what ticked (the finish result's `countdownLines`). */
  countdownLines: string[];
};

/**
 * The ended rest's part (called by convex/rests.ts after the rest's own effects and its campaign row): each active
 * dashboard countdown with the setting `rest` names ("long" for a finished long rest, "short" for a short rest or an
 * interrupted long rest) is rolled once (a chase pair once), with `pcs` the resting PCs; Automatic ones tick through
 * applyTick (source "rest", the campaign row as entryId), Reminder ones are only stored. An amount of 0 writes nothing.
 * Paused, completed and cancelled rows are skipped; the K1 rule switch (rolls only) does not apply.
 */
export async function tickCountdownsOnRest(
  ctx: MutationCtx,
  args: { campaignId: Id<"campaigns">; rest: RestTickRest; entryId: Id<"actionLog">; actorId: Id<"users">; pcs: number },
): Promise<RestTickOutcome> {
  const rows = await ctx.db
    .query("countdowns")
    .withIndex("by_campaign_owner", (q) => q.eq("campaignId", args.campaignId).eq("ownerKey", undefined))
    .take(DASHBOARD_SCAN);
  const byId = new Map<string, Doc<"countdowns">>(rows.map((r) => [r._id, r]));
  const out: RestTickOutcome = { restTicks: [], publicItems: [], gmItems: [], countdownLines: [] };
  const done = new Set<string>();
  for (const row of rows) {
    if (done.has(row._id)) continue;
    const setting = restTicksOf(row)[args.rest];
    if (row.status !== "active" || setting === null) continue;
    const partner = row.chase === undefined ? null : (byId.get(row.chase.partnerId) ?? null);
    done.add(row._id);
    if (partner !== null) done.add(partner._id);
    // A chase pair moves together (one roll); a side that already ended stays where it is.
    const pair = partner !== null && partner.status === "active" ? [row, partner] : [row];
    const result = restTickAmount(setting.amount, args.pcs, rollDie);
    for (const c of pair) {
      out.restTicks.push({
        countdownId: c._id,
        mode: setting.mode,
        amount: result.amount,
        ...(result.pcs !== undefined ? { pcs: result.pcs } : {}),
        ...(result.die !== undefined ? { die: result.die } : {}),
      });
    }
    if (result.amount === 0) continue;
    const name = tickName(row, partner);
    const text = restTickText(result);
    if (setting.mode === "remind") {
      out.gmItems.push(`Reminder: tick ${name} ${text}?`);
      continue;
    }
    let ticked = false;
    for (const c of pair) {
      const tick = await applyTick(ctx, c, result.amount, { source: "rest", entryId: args.entryId, actorId: args.actorId });
      if (!tick.changed) continue;
      ticked = true;
      if (c.mode === "longTerm") {
        const line = longTermLine(c, tick.after.currentValue, result);
        out.gmItems.push(line);
        out.countdownLines.push(line);
      }
    }
    if (!ticked) continue;
    const line = `${name} ticks ${text}`;
    if (restTickFeedAudience(row.visibility) === "public") out.publicItems.push(line);
    else if (row.mode !== "longTerm") out.gmItems.push(line);
    if (row.mode !== "longTerm") out.countdownLines.push(line);
  }
  return out;
}

/** A dashboard countdown of this campaign, or NOT_FOUND. */
async function loadDashboard(ctx: QueryCtx, campaignId: Id<"campaigns">, countdownId: Id<"countdowns">): Promise<Doc<"countdowns">> {
  const countdown = await ctx.db.get("countdowns", countdownId);
  if (countdown === null || countdown.campaignId !== campaignId || countdown.ownerKey !== undefined) throw appError("NOT_FOUND");
  return countdown;
}

/** A dashboard long-term countdown of this campaign, or NOT_FOUND / COUNTDOWN_RULE. */
async function loadLongTerm(ctx: QueryCtx, campaignId: Id<"campaigns">, countdownId: Id<"countdowns">): Promise<Doc<"countdowns">> {
  const countdown = await loadDashboard(ctx, campaignId, countdownId);
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

/**
 * Compatibility shim for installed phone builds (rest-ticks RT1; goes at the narrow step, `countdowns.setRestTick`
 * replaces it): "On long rest: Automatic / Reminder" (Q3) of a long-term countdown sets the mode of its `onLongRest`,
 * creating a fixed-1 setting when it has none; only `onLongRest` is written (the legacy `armed` / `restMode` unset).
 * GM only; NOT_FOUND / COUNTDOWN_RULE as setStep.
 */
export const setRestMode = keyedGmMutation({
  args: { countdownId: v.id("countdowns"), restMode: countdownRestModeValidator },
  returns: v.object({ restMode: countdownRestModeValidator }),
  handler: async (ctx, { countdownId, restMode }) => {
    const countdown = await loadLongTerm(ctx, ctx.campaign._id, countdownId);
    if (countdown.status === "cancelled") throw appError("COUNTDOWN_RULE", "A cancelled countdown can't be edited.");
    return ctx.once("countdown_rest_mode", { countdownId, restMode }, async () => {
      const amount = restTicksOf(countdown).long?.amount ?? LEGACY_LONG_TERM_AMOUNT;
      await ctx.db.patch("countdowns", countdownId, { onLongRest: { amount, mode: restMode }, armed: undefined, restMode: undefined });
      return { restMode };
    });
  },
});

type EndedRest = { rest: Doc<"rests">; fires: RestTickRest; entryId: Id<"actionLog">; groupId: string; groupRows: number };

/**
 * The campaign's latest rest when it ended with benefits (a finished rest, or an interrupted long rest) and its campaign
 * row (the ticks' entryId) is live, else null.
 */
async function latestEndedRest(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<EndedRest | null> {
  const [rest] = await ctx.db
    .query("rests")
    .withIndex("by_campaign_started", (q) => q.eq("campaignId", campaignId))
    .order("desc")
    .take(REST_SCAN);
  if (rest === undefined || rest.groupId === undefined) return null;
  const kind = restTickRestFor(rest);
  if (kind === null) return null;
  const groupId = rest.groupId;
  const group = await ctx.db
    .query("actionLog")
    .withIndex("by_campaign_group", (q) => q.eq("campaignId", campaignId).eq("groupId", groupId))
    .take(UNDO_GROUP_MAX);
  const row = group.find((r) => r.kind === "rest" && r.characterId === undefined && r.undoneAt === undefined);
  return row === undefined ? null : { rest, fires: kind, entryId: row._id, groupId, groupRows: group.length };
}

const lineView = v.object({
  countdownId: v.id("countdowns"),
  name: v.string(),
  currentValue: v.number(),
  line: v.string(),
});
/** A Reminder not ticked yet: the pre-rolled amount and what it came from ("1d6 3 + 2 PCs"; null for a fixed amount). */
const reminderView = v.object({
  countdownId: v.id("countdowns"),
  name: v.string(),
  currentValue: v.number(),
  amount: v.number(),
  rollText: v.union(v.string(), v.null()),
});

/**
 * What the latest ended rest did to dashboard countdowns, for the GM's rest panel: `kind` the setting it fired ("long"
 * for a finished long rest, "short" for a short rest or an interrupted long rest), the ticks it made (long-term with the
 * step each landed on) and the Reminders it has not ticked yet, each with its pre-rolled amount (one per chase pair).
 * null when the latest rest did not end with benefits or nothing applies. GM only (step text, D12; Reminder rolls, Q2).
 */
export const afterRest = gmQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      restId: v.id("rests"),
      kind: v.union(v.literal("long"), v.literal("short")),
      lines: v.array(lineView),
      reminders: v.array(reminderView),
    }),
  ),
  handler: async (ctx) => {
    const found = await latestEndedRest(ctx, ctx.campaign._id);
    if (found === null) return null;
    const stored = found.rest.restTicks ?? [];
    const ticks = await ctx.db
      .query("countdownTicks")
      .withIndex("by_entry_countdown", (q) => q.eq("entryId", found.entryId))
      .take(DASHBOARD_SCAN);
    const lines: Infer<typeof lineView>[] = [];
    const ticked = new Set<string>();
    for (const tick of ticks) {
      if (tick.revertedAt !== undefined || tick.source !== "rest") continue;
      const countdown = await ctx.db.get("countdowns", tick.countdownId);
      if (countdown === null) continue;
      ticked.add(countdown._id);
      const value = tick.after.currentValue;
      const entry = stored.find((s) => s.countdownId === countdown._id);
      const result: RestTickResult = entry !== undefined ? resultOf(entry) : { amount: tick.amount };
      const line = countdown.mode === "longTerm" ? longTermLine(countdown, value, result) : `${countdown.name} ticks ${restTickText(result)}`;
      lines.push({ countdownId: countdown._id, name: countdown.name, currentValue: value, line });
    }
    const reminders: Infer<typeof reminderView>[] = [];
    const shown = new Set<string>();
    for (const entry of stored) {
      if (entry.mode !== "remind" || entry.amount === 0 || ticked.has(entry.countdownId) || shown.has(entry.countdownId)) continue;
      const countdown = await ctx.db.get("countdowns", entry.countdownId);
      if (countdown === null || countdown.campaignId !== ctx.campaign._id || countdown.status !== "active") continue;
      const partner = await partnerOf(ctx, countdown);
      shown.add(countdown._id);
      if (partner !== null) shown.add(partner._id);
      reminders.push({
        countdownId: countdown._id,
        name: tickName(countdown, partner),
        currentValue: countdown.currentValue,
        amount: entry.amount,
        rollText: restTickRollText(resultOf(entry)),
      });
    }
    if (lines.length === 0 && reminders.length === 0) return null;
    return { restId: found.rest._id, kind: found.fires, lines, reminders };
  },
});

/**
 * The Reminder's one-click tick ("Tick <name>?"): ticks a dashboard countdown of any type by exactly the amount the
 * latest ended rest rolled for it (both rows of a chase pair), keyed on the rest's campaign row like an Automatic tick,
 * so undoing the rest takes it back. Writes the tick with its roll into the feed, public or GM-only by the countdown's
 * visibility, in the rest's undo group while it has room. GM only. NOT_FOUND for another campaign's or a frame-owned
 * countdown, or another campaign's rest; COUNTDOWN_RULE when the rest is not the latest ended rest, it stored no Reminder
 * for the countdown, the countdown is not active, or it was already ticked (a second click).
 */
export const tickOnRest = keyedGmMutation({
  args: { restId: v.id("rests"), countdownId: v.id("countdowns") },
  returns: v.object({ currentValue: v.number(), status: v.union(v.literal("active"), v.literal("paused"), v.literal("completed"), v.literal("cancelled")), line: v.string() }),
  handler: async (ctx, { restId, countdownId }) => {
    const rest = await ctx.db.get("rests", restId);
    if (rest === null || rest.campaignId !== ctx.campaign._id) throw appError("NOT_FOUND");
    const countdown = await loadDashboard(ctx, ctx.campaign._id, countdownId);
    return ctx.once("countdown_rest_tick", { restId, countdownId }, async () => {
      const found = await latestEndedRest(ctx, ctx.campaign._id);
      if (found === null || found.rest._id !== restId) throw appError("COUNTDOWN_RULE", "Only the latest rest's reminders tick countdowns.");
      const stored = found.rest.restTicks ?? [];
      const entry = stored.find((s) => s.countdownId === countdownId && s.mode === "remind");
      if (entry === undefined || entry.amount === 0) throw appError("COUNTDOWN_RULE", "That rest has no reminder for this countdown.");
      // Checks the move first so a refusal is COUNTDOWN_RULE without writing anything.
      applyRule("COUNTDOWN_RULE", CountdownRuleError, () => tickCountdown(countdown, entry.amount));
      if ((await liveTick(ctx, found.entryId, countdownId)) !== null) throw appError("COUNTDOWN_RULE", "That rest already ticked this countdown.");

      const cause = { source: "rest" as const, entryId: found.entryId, actorId: ctx.user._id };
      const ticked = await applyTick(ctx, countdown, entry.amount, cause);
      // A chase pair ticks both rows by the same stored amount (its partner's own entry), when the partner is still open.
      const partner = await partnerOf(ctx, countdown);
      const partnerEntry = partner === null ? undefined : stored.find((s) => s.countdownId === partner._id && s.mode === "remind");
      if (partner !== null && partnerEntry !== undefined && partner.status === "active" && (await liveTick(ctx, found.entryId, partner._id)) === null) {
        await applyTick(ctx, partner, partnerEntry.amount, cause);
      }

      const value = ticked.after.currentValue;
      const result = resultOf(entry);
      const audience = restTickFeedAudience(countdown.visibility);
      const item =
        audience === "gm" && countdown.mode === "longTerm" ? longTermLine(countdown, value, result) : `${tickName(countdown, partner)} ticks ${restTickText(result)}`;
      // The rest's undo group must still hold the row (undo refuses a partial group); the tick itself is undone either way.
      if (ticked.changed && found.groupRows < UNDO_GROUP_MAX) {
        await logAction(ctx, {
          campaignId: ctx.campaign._id,
          actorId: ctx.user._id,
          kind: "countdown",
          visibility: audience,
          summary: `${restTickLabel(found.rest)}: ${item}`,
          groupId: found.groupId,
          undoable: true,
        });
      }
      return { currentValue: value, status: ticked.after.status, line: trackLine(countdown.name, value, stepAt(countdown.steps, value)) };
    });
  },
});
