import type { Doc } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";

/**
 * Copies the deprecated upload tables (`mapUploads`, `codexImages`,
 * `portraitUploads`) into `files`. Idempotent: a file already in `files` is
 * skipped, so it can be run again. A portrait whose character is gone is
 * skipped (its campaign is unknown). The old tables are one-off, dev-sized
 * data, so they are read whole. Run once per deployment:
 * `npx convex run migrations:moveUploadsToFiles`.
 */
export const moveUploadsToFiles = internalMutation({
  args: {},
  handler: async (ctx) => {
    const counts = { copied: 0, alreadyMoved: 0, skipped: 0 };
    const copy = async (file: Omit<Doc<"files">, "_id" | "_creationTime">) => {
      const existing = await ctx.db
        .query("files")
        .withIndex("by_storage", (q) => q.eq("storageId", file.storageId))
        .first();
      if (existing) counts.alreadyMoved++;
      else {
        await ctx.db.insert("files", file);
        counts.copied++;
      }
    };
    for (const row of await ctx.db.query("mapUploads").collect()) {
      await copy({ storageId: row.storageId, campaignId: row.campaignId, uploadedBy: row.uploadedBy, kind: "map", refId: row.campaignId, createdAt: row.createdAt });
    }
    for (const row of await ctx.db.query("codexImages").collect()) {
      await copy({ storageId: row.storageId, campaignId: row.campaignId, uploadedBy: row.uploadedBy, kind: "codexImage", refId: row.entryId, createdAt: row.createdAt });
    }
    for (const row of await ctx.db.query("portraitUploads").collect()) {
      const character = await ctx.db.get(row.characterId);
      if (character === null) {
        counts.skipped++;
        continue;
      }
      await copy({ storageId: row.storageId, campaignId: character.campaignId, uploadedBy: row.userId, kind: "portrait", refId: row.characterId, createdAt: row.createdAt });
    }
    return counts;
  },
});
