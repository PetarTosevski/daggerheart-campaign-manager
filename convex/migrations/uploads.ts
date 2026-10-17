import { internal } from "../_generated/api";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { migrations } from "../lib/migrations";

type NewFile = Omit<Doc<"files">, "_id" | "_creationTime">;

/** Inserts the file unless `files` already has its storage id (idempotent). */
async function copyOnce(ctx: MutationCtx, file: NewFile): Promise<void> {
  const existing = await ctx.db
    .query("files")
    .withIndex("by_storage", (q) => q.eq("storageId", file.storageId))
    .first();
  if (existing === null) await ctx.db.insert("files", file);
}

/** Copies `mapUploads` into `files` (kind "map"). */
export const moveMapUploads = migrations.define({
  table: "mapUploads",
  migrateOne: async (ctx, row) => {
    await copyOnce(ctx, { storageId: row.storageId, campaignId: row.campaignId, uploadedBy: row.uploadedBy, kind: "map", refId: row.campaignId, createdAt: row.createdAt });
  },
});

/** Copies `codexImages` into `files` (kind "codexImage"). */
export const moveCodexImages = migrations.define({
  table: "codexImages",
  migrateOne: async (ctx, row) => {
    await copyOnce(ctx, { storageId: row.storageId, campaignId: row.campaignId, uploadedBy: row.uploadedBy, kind: "codexImage", refId: row.entryId, createdAt: row.createdAt });
  },
});

/**
 * Copies `portraitUploads` into `files` (kind "portrait"). A portrait whose
 * character is gone is skipped, because its campaign is unknown.
 */
export const movePortraitUploads = migrations.define({
  table: "portraitUploads",
  migrateOne: async (ctx, row) => {
    const character = await ctx.db.get(row.characterId);
    if (character === null) return;
    await copyOnce(ctx, { storageId: row.storageId, campaignId: character.campaignId, uploadedBy: row.userId, kind: "portrait", refId: row.characterId, createdAt: row.createdAt });
  },
});

/**
 * Copies the deprecated upload tables (`mapUploads`, `codexImages`,
 * `portraitUploads`) into `files`, one table after another, in batches.
 * Idempotent: a file already in `files` is skipped, so `reset: true` is safe.
 * Run once per deployment (see `run.ts` for dry run and resume):
 *   npx convex run migrations/uploads:moveUploadsToFiles
 */
export const moveUploadsToFiles = migrations.runner([
  internal.migrations.uploads.moveMapUploads,
  internal.migrations.uploads.moveCodexImages,
  internal.migrations.uploads.movePortraitUploads,
]);
