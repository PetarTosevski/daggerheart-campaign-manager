import { v, type Infer } from "convex/values";

import { inWindows, type LiveWindow } from "../src/lib/domain/journal/windows";
import { addTally, EMPTY_TALLY, windowTally, type SessionTally } from "../src/lib/domain/sessions";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { MAX_ENCOUNTERS, MAX_INSTANCES } from "./lib/encounters";
import { gmQuery } from "./lib/functions";
import { liveWindows, loadSession, MAX_SESSION_CHARACTER_STATS, tallyRows } from "./lib/sessions";

/**
 * The Journal's session tally (plan `.omc/plans/journal.yaml`, tracer JD3a; board "Log & recap"): the six numbers the
 * design shows. GM only (user Q5: players see the list, heading, recap and log, not the tally). Read-only.
 *
 * Every "during the session" read uses J0's `liveWindows` (a played session can start again, D10 B7):
 * - Fear gained / spent: the stored `sessions.tally` of the finished windows (S3 adds each at End, as
 *   `sessionPlay.tally`) plus the open window counted from the Fear history (`tallyRows` / `windowTally`). A session
 *   with finished windows but no stored tally (played before the tally existed) counts those windows from history.
 *   Rests are no longer shown (design) but stay in the stored tally.
 * - Critical successes: `actionLog` rows in the windows whose roll came out `critical`, not undone (a row the GM
 *   removed from the feed still counts: removal is display only).
 * - Adversaries defeated: defeated instances of the encounters started in the windows; a Minion group counts its
 *   defeated Minions (one HP each, CB p.201: its marked HP, the whole group when defeated).
 * - Hope spent / HP marked: the sum of the session's `sessionCharacterStats` rows (JD3b writes them, user Q8).
 */

/** The most action-log rows the criticals read across all windows; more marks the result `truncated`. */
export const MAX_TALLY_FEED_ROWS = 1000;

const count = v.union(v.number(), v.null());

export const journalTallyValidator = v.object({
  /** Each count is null before the session was ever live (the tiles show '-'); all six are null or none is. */
  fearGained: count,
  fearSpent: count,
  hopeSpent: count,
  hpMarked: count,
  adversariesDefeated: count,
  criticals: count,
  /** The session is live: its open window counts up to now. */
  live: v.boolean(),
  /** A read hit its cap (Fear history, rests or the action log): the counts are a floor. */
  truncated: v.boolean(),
});
export type JournalTally = Infer<typeof journalTallyValidator>;

/** Fear gained / spent over the windows: the stored tally for finished windows (else history), history for the open one. */
async function fearOf(ctx: QueryCtx, campaignId: Id<"campaigns">, session: Doc<"sessions">, windows: readonly LiveWindow[]) {
  let tally: SessionTally = session.tally ?? EMPTY_TALLY;
  let truncated = false;
  for (const w of windows) {
    if (!w.open && session.tally !== undefined) continue;
    const rows = await tallyRows(ctx, campaignId, w.from, w.open ? undefined : w.to);
    tally = addTally(tally, windowTally(rows.fear, rows.rests, w.open ? { from: w.from } : { from: w.from, to: w.to }));
    truncated ||= rows.truncated;
  }
  return { fearGained: tally.fearGained, fearSpent: tally.fearSpent, truncated };
}

/**
 * The index range's upper end for one window. The open window of a live session ends at the `Date.now()` the query ran
 * at, so bounding by it would leave later rows outside the read range and the tally would not update live (Convex
 * re-runs a query only when a write lands in a range it read). Closed windows end at their `to`. Same rule as `upTo`
 * in `convex/journalLog.ts`.
 */
function upTo<Q extends { lte: (field: "at", value: number) => unknown }>(q: Q, w: LiveWindow): Q {
  return w.open ? q : (q.lte("at", w.to) as Q);
}

/** Critical rolls in the windows, not undone; at most MAX_TALLY_FEED_ROWS rows read in all. */
async function criticalsOf(ctx: QueryCtx, campaignId: Id<"campaigns">, windows: readonly LiveWindow[]) {
  let left = MAX_TALLY_FEED_ROWS;
  let criticals = 0;
  let truncated = false;
  for (const w of windows) {
    if (left <= 0) {
      truncated = true;
      break;
    }
    const rows = await ctx.db
      .query("actionLog")
      .withIndex("by_campaign_at", (q) => upTo(q.eq("campaignId", campaignId).gte("at", w.from), w))
      .take(left + 1);
    if (rows.length > left) truncated = true;
    for (const row of rows.slice(0, left)) if (row.roll?.outcome === "critical" && row.undoneAt === undefined) criticals += 1;
    left -= Math.min(rows.length, left);
  }
  return { criticals, truncated };
}

/** Adversaries one instance counts as defeated: a Minion group its defeated Minions, anyone else 1 when defeated. */
function defeatedIn(instance: Doc<"encounterAdversaries">): number {
  if (instance.minionCount === undefined) return instance.defeated ? 1 : 0;
  return instance.defeated ? instance.stats.hpMax : Math.max(0, Math.min(instance.hp, instance.stats.hpMax));
}

/** Defeated adversaries of the campaign's encounters started in the windows (encounters and instances are capped). */
async function defeatsOf(ctx: QueryCtx, campaignId: Id<"campaigns">, windows: readonly LiveWindow[]) {
  const encounters = await ctx.db
    .query("encounters")
    .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", campaignId))
    .take(MAX_ENCOUNTERS);
  let defeated = 0;
  for (const encounter of encounters) {
    if (encounter.startedAt === undefined || !inWindows(windows, encounter.startedAt)) continue;
    const instances = await ctx.db
      .query("encounterAdversaries")
      .withIndex("by_encounter_order", (q) => q.eq("encounterId", encounter._id))
      .take(MAX_INSTANCES);
    for (const instance of instances) defeated += defeatedIn(instance);
  }
  return defeated;
}

/** The session's per-PC Hope spent and HP marked, summed (one row per PC, so the character cap bounds it). */
async function characterStatsOf(ctx: QueryCtx, sessionId: Id<"sessions">) {
  const rows = await ctx.db
    .query("sessionCharacterStats")
    .withIndex("by_session_character", (q) => q.eq("sessionId", sessionId))
    .take(MAX_SESSION_CHARACTER_STATS);
  return rows.reduce((sum, r) => ({ hopeSpent: sum.hopeSpent + r.hopeSpent, hpMarked: sum.hpMarked + r.hpMarked }), { hopeSpent: 0, hpMarked: 0 });
}

/** The six tally numbers of one session (JD3a); null counts before the session was ever live. */
export const tally = gmQuery({
  args: { sessionId: v.string() },
  returns: journalTallyValidator,
  handler: async (ctx, { sessionId }): Promise<JournalTally> => {
    const session = await loadSession(ctx, ctx.campaign._id, sessionId);
    const live = session.status === "live";
    const windows = await liveWindows(ctx, session);
    if (windows.length === 0) {
      return { fearGained: null, fearSpent: null, hopeSpent: null, hpMarked: null, adversariesDefeated: null, criticals: null, live, truncated: false };
    }
    const fear = await fearOf(ctx, ctx.campaign._id, session, windows);
    const rolls = await criticalsOf(ctx, ctx.campaign._id, windows);
    const adversariesDefeated = await defeatsOf(ctx, ctx.campaign._id, windows);
    const stats = await characterStatsOf(ctx, session._id);
    return {
      fearGained: fear.fearGained,
      fearSpent: fear.fearSpent,
      hopeSpent: stats.hopeSpent,
      hpMarked: stats.hpMarked,
      adversariesDefeated,
      criticals: rolls.criticals,
      live,
      truncated: fear.truncated || rolls.truncated,
    };
  },
});
