import { makeFunctionReference } from "convex/server";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { ownFile } from "./ownFiles";

// The upload helpers every upload path calls (moved from ./files by dcm-uh6r; ./files re-exports them). ./files also
// registers the byte check's internal functions and imports what they detach (sheets, codex entries, maps), so a
// function module that imported a helper from there loaded all of that, and built their zod schemas, on every call.

export type FileKind = Doc<"files">["kind"];

/** Image types an upload may have. Not `image/*`: an SVG can carry script. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Whether an uploaded file's recorded type is an allowed image type and it is at most `maxBytes`. */
export function isAllowedImage(meta: { contentType?: string; size: number }, maxBytes: number): boolean {
  return meta.contentType !== undefined && IMAGE_TYPES.has(meta.contentType) && meta.size <= maxBytes;
}

// The byte check `claimFile` schedules, by name (./files registers it as `lib/files:checkUploadBytes`).
type CheckArgs = { fileId: Id<"files">; storageId: Id<"_storage">; contentType?: string; kind?: FileKind };
const checkBytesRef = makeFunctionReference<"action", CheckArgs, null>("lib/files:checkUploadBytes");

/** Deletes a stored blob; a failure is logged (the blob is then unreferenced), never thrown. */
export async function deleteBlob(ctx: MutationCtx, storageId: Id<"_storage">): Promise<void> {
  try {
    await ctx.storage.delete(storageId);
  } catch (error) {
    console.error(`Couldn't delete file ${storageId}; it is now unreferenced.`, error);
  }
}

/** Whether anything (a map, codex entry or character) has recorded the file as its upload. */
export async function isClaimed(ctx: QueryCtx, storageId: Id<"_storage">): Promise<boolean> {
  const row = await ctx.db
    .query("files")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
  return row !== null;
}

/**
 * Records an unclaimed file as belonging to `refId` (check `isClaimed` first) and returns the new `files` row's id
 * (an uploaded sprite stores it as `spritePackSprites.fileId`, sprite packs P8). Every upload path calls it last,
 * after its size and recorded-type check (`isAllowedImage`); it schedules the byte check (`checkUploadBytes`, CF16),
 * which takes the file off its owner and deletes it when the bytes are not the recorded image type.
 */
export async function claimFile(
  ctx: MutationCtx,
  file: { storageId: Id<"_storage">; campaignId: Id<"campaigns">; uploadedBy: Id<"users">; kind: FileKind; refId: string },
): Promise<Id<"files">> {
  const meta = await ctx.db.system.get("_storage", file.storageId);
  const fileId = await ctx.db.insert("files", { ...file, createdAt: Date.now() });
  const contentType = meta?.contentType;
  await ctx.scheduler.runAfter(0, checkBytesRef, { fileId, storageId: file.storageId, kind: file.kind, ...(contentType === undefined ? {} : { contentType }) });
  return fileId;
}

/** Deletes a file and its record, only when it was recorded for this kind and owner. */
export async function deleteOwnFile(ctx: MutationCtx, kind: FileKind, refId: string, storageId: string): Promise<void> {
  const row = await ownFile(ctx, kind, refId, storageId);
  if (row === null) return;
  await ctx.db.delete(row._id);
  await deleteBlob(ctx, row.storageId);
}

/** Deletes every file recorded for this kind and owner (a deleted codex entry or character; at most a few each). */
export async function deleteFilesOf(ctx: MutationCtx, kind: FileKind, refId: string): Promise<void> {
  const rows = await ctx.db
    .query("files")
    .withIndex("by_ref", (q) => q.eq("kind", kind).eq("refId", refId))
    .collect();
  for (const row of rows) {
    await ctx.db.delete(row._id);
    await deleteBlob(ctx, row.storageId);
  }
}
