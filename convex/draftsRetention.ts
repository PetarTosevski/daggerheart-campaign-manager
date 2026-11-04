import { v } from "convex/values";

import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

/**
 * Retention of `userDrafts` (config P2, rule 8), run daily by `crons.ts`: a draft nobody saved for `DRAFT_TTL_MS` is
 * abandoned. Internal, at most `BATCH` rows per run, and it reschedules itself while a full batch was deleted.
 */

export const BATCH = 200;

const DAY = 24 * 60 * 60 * 1000;

/** A draft not saved for 90 days expires. */
export const DRAFT_TTL_MS = 90 * DAY;

/** Deletes drafts whose last save is older than `DRAFT_TTL_MS`, oldest first. */
export const expire = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - DRAFT_TTL_MS;
    const rows = await ctx.db
      .query("userDrafts")
      .withIndex("by_updated", (q) => q.lt("updatedAt", cutoff))
      .take(BATCH);
    for (const row of rows) await ctx.db.delete("userDrafts", row._id);
    if (rows.length === BATCH) await ctx.scheduler.runAfter(0, internal.draftsRetention.expire, {});
    return null;
  },
});
