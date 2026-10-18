import { ConvexError } from "convex/values";

import { legacyCount, saveSummary, storedEntry } from "../lib/codex";
import { migrations } from "../lib/migrations";

/**
 * Moves the long text (`pdesc`, `gmn`) of every version 1 codex entry into
 * `codexEntryText` and stores its summary as version 2 (`schemaVersion: 2`).
 * An entry reads the same before and after. Idempotent: a version 2 row is
 * skipped, so `reset: true` is safe. A row that fails to read is left as it
 * is (and logged) for a manual repair. Run once per deployment (see `run.ts`):
 *   npx convex run migrations/run:run '{fn: "migrations/codex:splitText", dryRun: true}'
 *   npx convex run migrations/run:run '{fn: "migrations/codex:splitText"}'
 * Afterwards `codexEntries.data` can narrow to the version 2 validator.
 */
export const splitText = migrations.define({
  table: "codexEntries",
  migrateOne: async (ctx, row) => {
    try {
      const { summary, legacyText } = storedEntry(row.data);
      if (legacyText !== null) await saveSummary(ctx, row, summary);
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      console.warn(`Codex entry ${row._id} has unreadable data; left unmigrated.`);
    }
  },
});

/**
 * Gives every campaign from before the counter its `codexCounters` row: its
 * entry count, and seeded when the old `codex:seed` operation ran or it has
 * entries (so `codex.seed` never adds the starting characters twice).
 * Idempotent: a campaign with a counter is skipped.
 *   npx convex run migrations/run:run '{fn: "migrations/codex:countEntries"}'
 */
export const countEntries = migrations.define({
  table: "campaigns",
  migrateOne: async (ctx, campaign) => {
    const existing = await ctx.db
      .query("codexCounters")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
      .unique();
    if (existing !== null) return;
    await ctx.db.insert("codexCounters", { campaignId: campaign._id, ...(await legacyCount(ctx, campaign._id)) });
  },
});
