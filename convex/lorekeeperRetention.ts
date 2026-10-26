import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { settle } from "./lib/lorekeeper/caps";

/**
 * Retention of the Lorekeeper's tables (CD17), run by `crons.ts`. Conversations and their messages are kept until
 * their asker deletes them (Q10), so nothing here deletes them. Each job is internal, handles at most `BATCH` rows
 * per run and reschedules itself while a full batch was handled.
 */

export const BATCH = 200;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** Usage counters are kept for 13 months (a year of history plus the current month). */
export const USAGE_TTL_MS = 395 * DAY;
/**
 * An answer still pending or streaming after this long is stuck (its action died without its watchdog firing):
 * past the 120 s call timeout and the 3-minute watchdog L3 schedules per answer.
 */
export const STALE_RUN_MS = 10 * MINUTE;

/** Deletes usage counters not touched for `USAGE_TTL_MS`, oldest first. */
export const expireUsage = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - USAGE_TTL_MS;
    const rows = await ctx.db
      .query("lorekeeperUsage")
      .withIndex("by_updated", (q) => q.lt("updatedAt", cutoff))
      .take(BATCH);
    for (const row of rows) await ctx.db.delete("lorekeeperUsage", row._id);
    if (rows.length === BATCH) await ctx.scheduler.runAfter(0, internal.lorekeeperRetention.expireUsage, {});
    return null;
  },
});

/**
 * Ends answers stuck in pending or streaming for over `STALE_RUN_MS` as `error` (LOREKEEPER_TIMEOUT), keeping the
 * text so far, and settles their reservation to the usage recorded (0 when none), so a stuck row never blocks its
 * asker (LOREKEEPER_BUSY) or holds budget. A backstop for L3's per-answer watchdog.
 */
export const expireStaleRuns = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const cutoff = now - STALE_RUN_MS;
    let handled = 0;
    for (const status of ["pending", "streaming"] as const) {
      const rows = await ctx.db
        .query("lorekeeperMessages")
        .withIndex("by_status_updated", (q) => q.eq("status", status).lt("updatedAt", cutoff))
        .take(BATCH - handled);
      for (const row of rows) {
        await ctx.db.patch("lorekeeperMessages", row._id, { status: "error", errorCode: "LOREKEEPER_TIMEOUT", updatedAt: now });
        if (row.reserved) {
          const scopes = { userId: row.userId, campaignId: row.campaignId, day: row.reserved.day, month: row.reserved.month };
          await settle(ctx, scopes, row.reserved.micros, row.usage?.costMicros ?? 0);
        }
      }
      handled += rows.length;
      if (handled >= BATCH) break;
    }
    if (handled >= BATCH) await ctx.scheduler.runAfter(0, internal.lorekeeperRetention.expireStaleRuns, {});
    return null;
  },
});
