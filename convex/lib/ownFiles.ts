/**
 * A file recorded for a kind and owner, and its URL. Split out of `./files` (dcm-uh6r) so the queries that show a portrait
 * do not load the upload actions, the codex and the map writers with it; `./files` re-exports `ownFileUrl`.
 */
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** The kinds of recorded files (`files.kind`). */
type FileKind = Doc<"files">["kind"];

/** The file's record when it was recorded for this kind and owner, else null (bad id, someone else's file). */
export async function ownFile(ctx: QueryCtx, kind: FileKind, refId: string, storageId: string) {
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
