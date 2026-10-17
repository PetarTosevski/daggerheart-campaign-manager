import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Reads a frame tracker's state, or null when it was never written. */
export async function readTracker<T>(ctx: QueryCtx, campaignId: Id<"campaigns">, key: string): Promise<T | null> {
  const row = await ctx.db
    .query("frameTrackers")
    .withIndex("by_campaign_key", (q) => q.eq("campaignId", campaignId).eq("key", key))
    .unique();
  return row ? (row.data as T) : null;
}

/** Replaces a frame tracker's state (validated by the caller). */
export async function writeTracker<T>(ctx: MutationCtx, campaignId: Id<"campaigns">, key: string, data: T): Promise<void> {
  const row = await ctx.db
    .query("frameTrackers")
    .withIndex("by_campaign_key", (q) => q.eq("campaignId", campaignId).eq("key", key))
    .unique();
  if (row) await ctx.db.patch(row._id, { data, updatedAt: Date.now() });
  else await ctx.db.insert("frameTrackers", { campaignId, key, data, updatedAt: Date.now() });
}
