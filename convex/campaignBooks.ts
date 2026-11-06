import { createFunctionHandle, makeFunctionReference } from "convex/server";
import { v, type Infer } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { INGEST_STALE_MS, TITLE_MAX } from "./adminLibrary";
import { gmMutation, gmQuery } from "./lib/functions";
import { MAX_CAMPAIGN_BOOKS } from "./lib/lorekeeper/retrieve";
import { PDF_CONTENT_TYPE, PDF_MAX_BYTES, PDF_MAX_FIRST_PAGE, type PdfIngestResult } from "./lib/pdf/config";
import { campaignBookKey, campaignBookNumber, CHUNK_SCHEMA_VERSION } from "./lib/validators/lorekeeper";
import { bookDefaults } from "./lorekeeperLibrary";
import type { PdfIngestDone } from "./pdfIngest";

/**
 * A campaign's own books (config LB1; Q24 b, N6 b, N7 a, N8 a; docs/tasks/TASK-CONFIG-LB1.md). The campaign's GM and
 * co-GMs (`gm*` wrappers: `permissionFor` owner) upload a PDF for their campaign; PDF0's internal action
 * `pdfIngest.ingestPdf` reads it into a `lorekeeperBooks` row that carries the campaign's id, and only that campaign's
 * library and Lorekeeper search show it (`lib/lorekeeper/retrieve.ts`). No book-count limit (N6 b): only 20 MB and
 * 300 pages per file; `lorekeeperCampaignLimits.bookCount` / `bookPages` stay unenforced.
 *
 * | Function    | Kind              | Args                                   | Errors / refusals                                  |
 * |-------------|-------------------|----------------------------------------|----------------------------------------------------|
 * | `list`      | gmQuery           | -                                      | -                                                  |
 * | `uploadUrl` | gmMutation        | - (rate-limited `uploadUrl`)           | RATE_LIMITED                                       |
 * | `add`       | gmMutation        | storageId, title, firstPrintedPage     | INVALID, NOT_FOUND (thrown); { ok: false, code } BOOK_NOT_PDF, BOOK_TOO_LARGE (file deleted) |
 * | `remove`    | gmMutation        | bookId                                 | LOREKEEPER_BOOK_NOT_FOUND, BOOK_INGEST_RUNNING     |
 * | `deleteChunks` | internalMutation | bookId                               | - (batched, reschedules itself)                    |
 *
 * Common: anonymous UNAUTHENTICATED, outsider NOT_FOUND, players FORBIDDEN (the wrappers); archived campaigns and the
 * owner's read-only view refuse the mutations (the wrappers).
 *
 * Rule 10 (CF16, CF17): upload URLs come only from the GM-checked, rate-limited `uploadUrl`. `add` refuses a storage
 * id that is any `files` row (someone's recorded image) or that an ingest is already reading (NOT_FOUND, the file is
 * kept), then checks the recorded type is exactly application/pdf and the size at most 20 MB; a refused file is
 * deleted and the refusal *returned* (a throw would roll the delete back). PDF0 checks the `%PDF-` magic bytes and the
 * 300 pages, and deletes the file whatever happens.
 *
 * Status: each upload is a new book (key `campaign:<campaignId>:<n>`) with a `lorekeeperIngests` row (AD8's table)
 * that `adminLibrary.recordIngest` (PDF0's `onDone`) finishes; a failed read removes the empty book and keeps the
 * failure on the status row, which the next upload prunes. `remove` deletes the book row, its switches and status
 * rows at once and its chunks in scheduled batches (the book row going first makes them unreachable).
 */

/** Chunks `deleteChunks` deletes per run. */
export const CHUNK_DELETE_BATCH = 500;
/** Failed uploads `list` shows and `add` prunes per call. */
export const FAILURES_MAX = 20;

// Typed references by name, so this file needs no regenerated `_generated/api` (PDF0's action, AD8's `onDone`, ours).
type IngestPdfArgs = { storageId: Id<"_storage">; bookId: Id<"lorekeeperBooks">; firstPrintedPage: number; onDone?: string };
const ingestPdfRef = makeFunctionReference<"action", IngestPdfArgs, PdfIngestResult>("pdfIngest:ingestPdf");
const recordIngestRef = makeFunctionReference<"mutation", PdfIngestDone, null>("adminLibrary:recordIngest");
const deleteChunksRef = makeFunctionReference<"mutation", { bookId: Id<"lorekeeperBooks"> }, null>("campaignBooks:deleteChunks");

// ---------------------------------------------------------------- reads

async function ownBooks(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"lorekeeperBooks">[]> {
  return ctx.db
    .query("lorekeeperBooks")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(MAX_CAMPAIGN_BOOKS);
}

async function ingestRowOf(ctx: QueryCtx, bookId: Id<"lorekeeperBooks">): Promise<Doc<"lorekeeperIngests"> | null> {
  return ctx.db
    .query("lorekeeperIngests")
    .withIndex("by_book", (q) => q.eq("bookId", bookId))
    .first();
}

function isRunning(row: Doc<"lorekeeperIngests"> | null, now: number): boolean {
  return row !== null && row.status === "running" && now - row.startedAt <= INGEST_STALE_MS;
}

const bookStatusValidator = v.union(v.literal("reading"), v.literal("ready"), v.literal("failed"));

const campaignBookValidator = v.object({
  bookId: v.id("lorekeeperBooks"),
  title: v.string(),
  /** "reading" while PDF0 runs; "failed" when a read stopped without reporting (the GM removes it). */
  status: bookStatusValidator,
  /** Printed pages indexed. */
  pages: v.number(),
  chunkCount: v.number(),
  /** The PDF's size in bytes. */
  sizeBytes: v.number(),
  /** The printed page number the uploader gave the PDF's first page (N8 a); null when unknown. */
  firstPrintedPage: v.union(v.number(), v.null()),
  uploadedAt: v.number(),
});
export type CampaignBookRow = Infer<typeof campaignBookValidator>;

const failureValidator = v.object({
  title: v.string(),
  finishedAt: v.number(),
  code: v.string(),
});

const campaignBooksValidator = v.object({
  /** This campaign's own books, oldest first. */
  books: v.array(campaignBookValidator),
  /** Uploads whose PDF could not be read since the last upload (their empty book is gone), newest first. */
  failures: v.array(failureValidator),
});
export type CampaignBooks = Infer<typeof campaignBooksValidator>;

/** The campaign's own books with their read status, and the latest failed uploads. GM and co-GMs. Never any text. */
export const list = gmQuery({
  args: {},
  returns: campaignBooksValidator,
  handler: async (ctx): Promise<CampaignBooks> => {
    const now = Date.now();
    const books: CampaignBookRow[] = [];
    for (const book of await ownBooks(ctx, ctx.campaign._id)) {
      const row = await ingestRowOf(ctx, book._id);
      const status = isRunning(row, now) ? "reading" : book.chunkCount === 0 ? "failed" : "ready";
      books.push({
        bookId: book._id,
        title: row?.status === "running" ? row.title : book.title,
        status,
        pages: book.pages,
        chunkCount: book.chunkCount,
        sizeBytes: book.sizeBytes ?? 0,
        firstPrintedPage: row?.firstPrintedPage ?? null,
        uploadedAt: book._creationTime,
      });
    }
    const failed = await ctx.db
      .query("lorekeeperIngests")
      .withIndex("by_campaign", (q) => q.eq("campaignId", ctx.campaign._id))
      .order("desc")
      .take(MAX_CAMPAIGN_BOOKS + FAILURES_MAX);
    const failures = [];
    for (const row of failed) {
      if (row.status !== "failed" || failures.length >= FAILURES_MAX) continue;
      if ((await ctx.db.get("lorekeeperBooks", row.bookId)) !== null) continue;
      failures.push({
        title: row.title,
        finishedAt: row.finishedAt ?? row.startedAt,
        code: row.result?.ok === false ? row.result.code : "BOOK_PARSE_FAILED",
      });
    }
    return { books, failures };
  },
});

// ---------------------------------------------------------------- upload

/** An upload URL for a book PDF. GM and co-GMs (N7 a); rate-limited (`uploadUrl`, CF15, rule 10). */
export const uploadUrl = gmMutation({
  rateLimit: "uploadUrl",
  args: {},
  returns: v.string(),
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

const addRefusalValidator = v.union(v.literal("BOOK_NOT_PDF"), v.literal("BOOK_TOO_LARGE"));

const addResultValidator = v.union(
  v.object({ ok: v.literal(true), bookId: v.id("lorekeeperBooks") }),
  v.object({ ok: v.literal(false), code: addRefusalValidator }),
);
export type AddResult = Infer<typeof addResultValidator>;

/** The next key's `n` in this campaign: past every book and status row it still has, so no key is reused. */
async function nextNumber(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<number> {
  const book = await ctx.db
    .query("lorekeeperBooks")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .order("desc")
    .first();
  const row = await ctx.db
    .query("lorekeeperIngests")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .order("desc")
    .first();
  return Math.max(book ? campaignBookNumber(book.key) : 0, row ? campaignBookNumber(row.bookKey) : 0) + 1;
}

/** Deletes the campaign's failed status rows whose empty book is already gone (the previous uploads' failures). */
async function pruneFailures(ctx: MutationCtx, campaignId: Id<"campaigns">): Promise<void> {
  const rows = await ctx.db
    .query("lorekeeperIngests")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(MAX_CAMPAIGN_BOOKS + FAILURES_MAX);
  for (const row of rows) {
    if (row.status !== "failed") continue;
    if ((await ctx.db.get("lorekeeperBooks", row.bookId)) === null) await ctx.db.delete("lorekeeperIngests", row._id);
  }
}

/**
 * Starts reading an uploaded PDF into a new book of this campaign. Checks the arguments (INVALID), that the file
 * exists, is no recorded file and is not already being read (NOT_FOUND, kept), then its recorded type and size (refused
 * files are deleted and the refusal returned). Then creates the book row (with `campaignId`), writes the `running`
 * status row and schedules PDF0's `ingestPdf` with `adminLibrary.recordIngest` as `onDone`.
 */
export const add = gmMutation({
  args: {
    storageId: v.id("_storage"),
    /** The book's title (1-120 characters after trimming). */
    title: v.string(),
    /** The printed page number of the PDF's first page (N8 a), 0-9999. */
    firstPrintedPage: v.number(),
  },
  returns: addResultValidator,
  handler: async (ctx, { storageId, title, firstPrintedPage }): Promise<AddResult> => {
    const bookTitle = title.trim();
    if (bookTitle.length === 0 || bookTitle.length > TITLE_MAX) throw appError("INVALID", `A title is 1 to ${TITLE_MAX} characters.`);
    if (!Number.isInteger(firstPrintedPage) || firstPrintedPage < 0 || firstPrintedPage > PDF_MAX_FIRST_PAGE) {
      throw appError("INVALID", `The first page number is a whole number from 0 to ${PDF_MAX_FIRST_PAGE}.`);
    }

    // CF17: a storage id proves nothing. A recorded file, or one an ingest is reading, is refused and never deleted here.
    const meta = await ctx.db.system.get("_storage", storageId);
    if (meta === null) throw appError("NOT_FOUND");
    const recorded = await ctx.db
      .query("files")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first();
    if (recorded !== null) throw appError("NOT_FOUND");
    const reading = await ctx.db
      .query("lorekeeperIngests")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first();
    if (reading !== null) throw appError("NOT_FOUND");

    // CF16: the recorded type is exactly application/pdf (a missing type too is refused), at most 20 MB.
    const refuse = async (code: Infer<typeof addRefusalValidator>): Promise<AddResult> => {
      await ctx.storage.delete(storageId);
      return { ok: false, code };
    };
    if (meta.contentType !== PDF_CONTENT_TYPE) return refuse("BOOK_NOT_PDF");
    if (meta.size > PDF_MAX_BYTES) return refuse("BOOK_TOO_LARGE");

    const campaignId = ctx.campaign._id;
    await pruneFailures(ctx, campaignId);
    const bookKey = campaignBookKey(campaignId, await nextNumber(ctx, campaignId));
    const defaults = bookDefaults(bookKey)!;
    const now = Date.now();
    const bookId = await ctx.db.insert("lorekeeperBooks", {
      key: bookKey,
      title: bookTitle,
      subtitle: defaults.subtitle,
      cover: defaults.cover,
      pages: 0,
      chunkCount: 0,
      ingestedAt: now,
      schemaVersion: CHUNK_SCHEMA_VERSION,
      campaignId,
      uploadedBy: ctx.user._id,
      sizeBytes: meta.size,
    });
    await ctx.db.insert("lorekeeperIngests", {
      bookKey,
      bookId,
      status: "running",
      startedAt: now,
      startedBy: ctx.user._id,
      firstPrintedPage,
      title: bookTitle,
      newBook: true,
      campaignId,
      storageId,
    });
    const onDone = await createFunctionHandle(recordIngestRef);
    await ctx.scheduler.runAfter(0, ingestPdfRef, { storageId, bookId, firstPrintedPage, onDone });
    return { ok: true, bookId };
  },
});

// ---------------------------------------------------------------- remove

/**
 * Removes one of this campaign's books: the book row, this campaign's switch for it and its status rows now, its
 * chunks in scheduled batches (`deleteChunks`). A book of another campaign, or a shared one, is
 * LOREKEEPER_BOOK_NOT_FOUND; a book still being read is BOOK_INGEST_RUNNING (a stale read no longer blocks).
 */
export const remove = gmMutation({
  args: { bookId: v.id("lorekeeperBooks") },
  returns: v.null(),
  handler: async (ctx, { bookId }) => {
    const book = await ctx.db.get("lorekeeperBooks", bookId);
    if (book === null || book.campaignId !== ctx.campaign._id) throw appError("LOREKEEPER_BOOK_NOT_FOUND");
    const rows = await ctx.db
      .query("lorekeeperIngests")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .take(10);
    const now = Date.now();
    if (rows.some((row) => isRunning(row, now))) throw appError("BOOK_INGEST_RUNNING");
    for (const row of rows) await ctx.db.delete("lorekeeperIngests", row._id);
    const switches = await ctx.db
      .query("lorekeeperLibrary")
      .withIndex("by_campaign_book", (q) => q.eq("campaignId", ctx.campaign._id).eq("bookId", bookId))
      .take(10);
    for (const row of switches) await ctx.db.delete("lorekeeperLibrary", row._id);
    await ctx.db.delete("lorekeeperBooks", bookId);
    await ctx.scheduler.runAfter(0, deleteChunksRef, { bookId });
    return null;
  },
});

/** Deletes up to `CHUNK_DELETE_BATCH` chunks of a removed book and reschedules itself while a full batch went. */
export const deleteChunks = internalMutation({
  args: { bookId: v.id("lorekeeperBooks") },
  returns: v.null(),
  handler: async (ctx, { bookId }) => {
    const rows = await ctx.db
      .query("lorekeeperChunks")
      .withIndex("by_book_page", (q) => q.eq("bookId", bookId))
      .take(CHUNK_DELETE_BATCH);
    for (const row of rows) await ctx.db.delete("lorekeeperChunks", row._id);
    if (rows.length === CHUNK_DELETE_BATCH) await ctx.scheduler.runAfter(0, deleteChunksRef, { bookId });
    return null;
  },
});
