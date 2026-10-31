import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { PHOTO_TYPES } from "../../src/lib/import/draft";
import type { Doc, Id } from "../_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx, type QueryCtx } from "../_generated/server";
import { fileKindValidator } from "../tables/files";
import { readSheet, saveSheet } from "./characterSheet";
import { saveSummary, storedEntry } from "./codex";
import { saveScalars, writableMap } from "./maps";

export type FileKind = Doc<"files">["kind"];

/** Image types an upload may have. Not `image/*`: an SVG can carry script. */
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

/** Whether an uploaded file's recorded type is an allowed image type and it is at most `maxBytes`. */
export function isAllowedImage(meta: { contentType?: string; size: number }, maxBytes: number): boolean {
  return meta.contentType !== undefined && IMAGE_TYPES.has(meta.contentType) && meta.size <= maxBytes;
}

/** How many leading bytes `sniffImageType` reads. */
export const SNIFF_BYTES = 12;

const startsWith = (head: Uint8Array, bytes: readonly number[], at = 0) => bytes.every((b, i) => head[at + i] === b);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** The image type a file's first bytes (magic number) show: png, jpeg, webp or gif, else null (an SVG, HTML, text...). */
export function sniffImageType(head: Uint8Array): string | null {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(head, ascii("GIF87a")) || startsWith(head, ascii("GIF89a"))) return "image/gif";
  if (startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8)) return "image/webp";
  return null;
}

// Typed references by name, so this file needs no regenerated `_generated/api` (the module is `lib/files`).
type CheckArgs = { fileId: Id<"files">; storageId: Id<"_storage">; contentType?: string; kind?: FileKind };
const checkBytesRef = makeFunctionReference<"action", CheckArgs, null>("lib/files:checkUploadBytes");
const rejectRef = makeFunctionReference<"mutation", { fileId: Id<"files">; storageId: Id<"_storage">; found: string | null }, null>(
  "lib/files:rejectUpload",
);
const retypeRef = makeFunctionReference<
  "mutation",
  { fileId: Id<"files">; storageId: Id<"_storage">; contentType: string; restored?: Id<"_storage"> },
  null
>("lib/files:retypeUpload");

/**
 * The byte check of every upload (CF16, bead dcm-bxp.93), scheduled by `claimFile`. Mutations cannot read a file's
 * bytes, so after the attaching mutation has checked size and recorded type, this action reads the first bytes:
 * - not a PNG, JPEG, WebP or GIF (an SVG or HTML body sent as image/png): `rejectUpload` takes the file off whatever it
 *   was attached to, deletes it and leaves the uploader a notice;
 * - a real image of another type than the recorded one (a PNG sent as image/jpeg, dcm-vqs0): kept; `retypeUpload`
 *   records the type the bytes show on the `files` row. A photo-import photo, whose blob type `photoImport.read` sends
 *   to the Messages API, is stored again under the right type (only its `files` row refers to it); one whose bytes are
 *   a GIF is rejected, as `photoImport.claim` refuses a GIF.
 * A file already gone is left alone. `contentType` is absent only for a server-made copy (`combatMaps.copyImage`); its
 * bytes must still be an allowed type. `kind` is the file's kind (absent in checks scheduled before dcm-vqs0).
 */
export const checkUploadBytes = internalAction({
  args: { fileId: v.id("files"), storageId: v.id("_storage"), contentType: v.optional(v.string()), kind: v.optional(fileKindValidator) },
  returns: v.null(),
  handler: async (ctx, { fileId, storageId, contentType, kind }) => {
    const blob = await ctx.storage.get(storageId);
    if (blob === null) return null;
    const found = sniffImageType(new Uint8Array(await blob.slice(0, SNIFF_BYTES).arrayBuffer()));
    if (found !== null && (contentType === undefined || found === contentType)) return null;
    const photo = kind === "photoImport";
    if (found === null || (photo && !PHOTO_TYPES.includes(found))) {
      await ctx.runMutation(rejectRef, { fileId, storageId, found });
      return null;
    }
    const restored = photo ? await ctx.storage.store(new Blob([await blob.arrayBuffer()], { type: found })) : undefined;
    await ctx.runMutation(retypeRef, { fileId, storageId, contentType: found, ...(restored === undefined ? {} : { restored }) });
    return null;
  },
});

/**
 * Takes a file that failed the byte check off its owner, then deletes its record and blob. The image just disappears:
 * the campaign map goes back to none (or the frame's art), a codex image leaves its entry, the portrait goes back to
 * none, a combat map keeps its squares and tokens without an image, an uploaded sprite is removed (objects that used it
 * fall back to their Classic kind), a photo-import photo is dropped. The uploader gets a notice (`uploadNotices`,
 * dcm-vqs0) that their upload screen shows. Returns normally, so the deletes stand (CF16).
 */
export const rejectUpload = internalMutation({
  args: { fileId: v.id("files"), storageId: v.id("_storage"), found: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { fileId, storageId, found }) => {
    const file = await ctx.db.get("files", fileId);
    if (file === null || file.storageId !== storageId) return null;
    console.warn(`Upload ${storageId} (${file.kind}) failed the byte check (bytes: ${found ?? "no allowed image type"}); removed.`);
    const scope = await noticeScope(ctx, file);
    await detachFile(ctx, file);
    await deleteOwnFile(ctx, file.kind, file.refId, file.storageId);
    await addUploadNotice(ctx, { userId: file.uploadedBy, kind: file.kind, scope });
    return null;
  },
});

/**
 * Keeps a real image whose bytes are another type than the upload recorded (dcm-vqs0): records the type on its `files`
 * row and, for a photo-import photo stored again under that type (`restored`), moves the row onto the new blob and
 * deletes the old one. A file already replaced or removed is left alone (and `restored` deleted).
 */
export const retypeUpload = internalMutation({
  args: { fileId: v.id("files"), storageId: v.id("_storage"), contentType: v.string(), restored: v.optional(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, { fileId, storageId, contentType, restored }) => {
    const file = await ctx.db.get("files", fileId);
    if (file === null || file.storageId !== storageId) {
      if (restored !== undefined) await deleteBlob(ctx, restored);
      return null;
    }
    await ctx.db.patch("files", fileId, { contentType, ...(restored === undefined ? {} : { storageId: restored }) });
    if (restored !== undefined) await deleteBlob(ctx, storageId);
    return null;
  },
});

/** At most this many upload notices per user; the oldest goes when another is written. */
export const MAX_UPLOAD_NOTICES = 10;

/** The id the upload screen knows (`uploadNotices.scope`). Read before the file is detached: a rejected sprite's row goes. */
async function noticeScope(ctx: MutationCtx, file: Doc<"files">): Promise<string> {
  switch (file.kind) {
    case "portrait":
    case "codexImage":
    case "combatMap":
      return file.refId;
    case "sprite": {
      const id = ctx.db.normalizeId("spritePackSprites", file.refId);
      const sprite = id === null ? null : await ctx.db.get("spritePackSprites", id);
      return sprite?.packId ?? file.campaignId;
    }
    case "map":
    case "photoImport":
      return file.campaignId;
  }
}

/** Writes an upload notice and drops the user's oldest beyond `MAX_UPLOAD_NOTICES`. */
async function addUploadNotice(ctx: MutationCtx, notice: { userId: Id<"users">; kind: FileKind; scope: string }): Promise<void> {
  await ctx.db.insert("uploadNotices", { ...notice, createdAt: Date.now() });
  const newest = await ctx.db
    .query("uploadNotices")
    .withIndex("by_user", (q) => q.eq("userId", notice.userId))
    .order("desc")
    .take(MAX_UPLOAD_NOTICES + 1);
  for (const row of newest.slice(MAX_UPLOAD_NOTICES)) await ctx.db.delete("uploadNotices", row._id);
}

/** Removes a file's reference from the record it was attached to (the caller deletes the `files` row and blob). */
async function detachFile(ctx: MutationCtx, file: Doc<"files">): Promise<void> {
  switch (file.kind) {
    case "map": {
      const campaign = await ctx.db.get("campaigns", file.campaignId);
      if (campaign === null) return;
      const map = await writableMap(ctx, campaign);
      if (map.scalars.customMap?.storageId !== file.storageId) return;
      const next = { ...map.scalars };
      delete next.customMap;
      await saveScalars(ctx, campaign._id, map, next);
      return;
    }
    case "codexImage": {
      const id = ctx.db.normalizeId("codexEntries", file.refId);
      const entry = id === null ? null : await ctx.db.get("codexEntries", id);
      if (entry === null) return;
      const { summary } = storedEntry(entry.data);
      if (!summary.images.some((g) => g.storageId === file.storageId)) return;
      // As `codex.removeImage`.
      await saveSummary(ctx, entry, {
        ...summary,
        images: summary.images.filter((g) => g.storageId !== file.storageId),
        cover: summary.cover === file.storageId ? null : summary.cover,
      });
      return;
    }
    case "portrait": {
      const id = ctx.db.normalizeId("characters", file.refId);
      const character = id === null ? null : await ctx.db.get("characters", id);
      if (character === null) return;
      const sheet = readSheet(character.sheet);
      if (sheet.portrait?.kind !== "upload" || sheet.portrait.storageId !== file.storageId) return;
      const next = { ...sheet };
      delete next.portrait;
      await saveSheet(ctx, character._id, next);
      return;
    }
    case "combatMap": {
      const id = ctx.db.normalizeId("combatMaps", file.refId);
      const map = id === null ? null : await ctx.db.get("combatMaps", id);
      // As a duplicate whose image copy failed: the map keeps its size and tokens and shows no image.
      if (map?.image?.fileId === file._id) await ctx.db.patch("combatMaps", map._id, { image: undefined, updatedAt: Date.now() });
      return;
    }
    case "sprite": {
      const id = ctx.db.normalizeId("spritePackSprites", file.refId);
      const sprite = id === null ? null : await ctx.db.get("spritePackSprites", id);
      if (sprite === null || sprite.fileId !== file._id) return;
      // As `spritePacks.removeSprite`.
      await ctx.db.delete("spritePackSprites", sprite._id);
      await ctx.db.patch("spritePacks", sprite.packId, { updatedAt: Date.now() });
      return;
    }
    case "photoImport":
      return; // only its `files` row refers to a photo
  }
}

/** Deletes a file whose record is already gone. A failure is logged, not thrown: the blob is then unreferenced. */
async function deleteBlob(ctx: MutationCtx, storageId: Id<"_storage">): Promise<void> {
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
