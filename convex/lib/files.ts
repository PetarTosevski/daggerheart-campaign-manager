import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type FileKind = Doc<"files">["kind"];

/** Whether anything (a map, codex entry or character) has recorded the file as its upload. */
export async function isClaimed(ctx: QueryCtx, storageId: Id<"_storage">): Promise<boolean> {
  const row = await ctx.db
    .query("files")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
  return row !== null;
}

/** Records an unclaimed file as belonging to `refId` (check `isClaimed` first). */
export async function claimFile(
  ctx: MutationCtx,
  file: { storageId: Id<"_storage">; campaignId: Id<"campaigns">; uploadedBy: Id<"users">; kind: FileKind; refId: string },
): Promise<void> {
  await ctx.db.insert("files", { ...file, createdAt: Date.now() });
}

/** The file's record when it was recorded for this kind and owner, else null (bad id, someone else's file). */
async function ownFile(ctx: QueryCtx, kind: FileKind, refId: string, storageId: string) {
  const id = ctx.db.system.normalizeId("_storage", storageId);
  if (id === null) return null;
  const row = await ctx.db
    .query("files")
    .withIndex("by_storage", (q) => q.eq("storageId", id))
    .first();
  return row !== null && row.kind === kind && row.refId === refId ? row : null;
}

/** URL of a file recorded for this kind and owner, or null (bad id, someone else's file, or gone). */
export async function ownFileUrl(ctx: QueryCtx, kind: FileKind, refId: string, storageId: string): Promise<string | null> {
  const row = await ownFile(ctx, kind, refId, storageId);
  if (row === null) return null;
  return ctx.storage.getUrl(row.storageId).catch(() => null);
}

/** Deletes a file and its record, only when it was recorded for this kind and owner. */
export async function deleteOwnFile(ctx: MutationCtx, kind: FileKind, refId: string, storageId: string): Promise<void> {
  const row = await ownFile(ctx, kind, refId, storageId);
  if (row === null) return;
  await ctx.db.delete(row._id);
  await ctx.storage.delete(row.storageId).catch(() => undefined);
}

/** Deletes every file recorded for this kind and owner (a deleted codex entry or character; at most a few each). */
export async function deleteFilesOf(ctx: MutationCtx, kind: FileKind, refId: string): Promise<void> {
  const rows = await ctx.db
    .query("files")
    .withIndex("by_ref", (q) => q.eq("kind", kind).eq("refId", refId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
    await ctx.storage.delete(row.storageId).catch(() => undefined);
  }
}
