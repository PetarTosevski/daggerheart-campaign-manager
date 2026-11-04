import { createFunctionHandle, makeFunctionReference } from "convex/server";
import { v, type Infer } from "convex/values";

import { PUBLISHED_FRAME_IDS } from "../src/lib/frames/index";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { recordAdminChange } from "./lib/adminAudit";
import { appOwnerMutation, appOwnerQuery } from "./lib/functions";
import { PDF_CONTENT_TYPE, PDF_MAX_BYTES, PDF_MAX_FIRST_PAGE, pdfIngestResultValidator, type PdfIngestResult } from "./lib/pdf/config";
import { BOOK_KEY_CORE, BOOK_KEY_HOPE_FEAR, BOOK_KEY_HOUSE_RULES, CHUNK_SCHEMA_VERSION } from "./lib/validators/lorekeeper";
import { bookDefaults } from "./lorekeeperLibrary";
import type { PdfIngestDone } from "./pdfIngest";

/**
 * The shared book library in the admin page (config AD8; Q23 b, N6 b, N8 a; docs/tasks/TASK-CONFIG-AD8.md). The app
 * owner uploads a new shared book, or replaces one, as a PDF; PDF0's internal action `pdfIngest.ingestPdf` parses,
 * chunks and ingests it and deletes the file. GMs keep switching books per campaign (`lorekeeperLibrary.setEnabled`).
 * Owner only (`appOwner*` wrappers: FORBIDDEN for everyone else, the GMs included).
 *
 * | Function       | Kind              | Args                                            | Errors / refusals                              |
 * |----------------|-------------------|-------------------------------------------------|------------------------------------------------|
 * | `list`         | appOwnerQuery     | -                                               | -                                              |
 * | `ingestStatus` | appOwnerQuery     | bookKey                                         | - (null: never uploaded)                       |
 * | `uploadUrl`    | appOwnerMutation  | - (rate-limited `uploadUrl`)                    | RATE_LIMITED                                   |
 * | `ingest`       | appOwnerMutation  | storageId, bookKey, title?, firstPrintedPage    | INVALID, NOT_FOUND (thrown); { ok: false, code } BOOK_NOT_PDF, BOOK_TOO_LARGE, BOOK_INGEST_RUNNING (file deleted) |
 * | `recordIngest` | internalMutation  | bookId, result (PDF0's `onDone`)                | -                                              |
 *
 * Rule 10 (CF16, CF17): the upload URL comes only from the owner-checked, rate-limited `uploadUrl`. `ingest` refuses a
 * storage id that is any `files` row (someone's recorded image: never proof of access, and never deleted here), then
 * checks the recorded type is exactly application/pdf and the size at most 20 MB; a refused file is deleted and the
 * refusal *returned* (a throw would roll the delete back). PDF0 checks the `%PDF-` magic bytes and 300 pages. This
 * path and LB1's are the only exceptions to the image allowlist.
 *
 * Status (`lorekeeperIngests`, one row per book key): `ingest` writes `running` and schedules the action with an
 * `onDone` handle to `recordIngest`, which writes `done` / `failed` with PDF0's result. One running ingest per book: a
 * second upload while one runs is BOOK_INGEST_RUNNING (two at once would interleave their chunks). A `running` row
 * older than `INGEST_STALE_MS` (the action was killed before `onDone`) no longer blocks and reads as failed.
 *
 * Book keys: only the keys the library knows (`bookDefaults`: `core`, `hopeFear`, `frame:<published frame id>`); not
 * `houseRules`, whose text is the GM's Notes. A new book's row is created before the action runs (it needs a book id)
 * and removed again if that first ingest fails, so a failed upload never leaves an empty book in every campaign. A
 * replaced book keeps its title and text until the new PDF is ingested (PDF0 never clears old text on a refusal).
 */

/** Books `list` reads (the shared library is a handful of rows: core, Hope & Fear, the frames). */
export const LIST_MAX_BOOKS = 100;
/** Longest title the owner may type (`ingestBook` cuts at the same length). */
export const TITLE_MAX = 120;
/** A `running` row older than this was killed before it reported (actions stop after 10 minutes). */
export const INGEST_STALE_MS = 15 * 60 * 1000;

/** The book keys the owner may upload, in the order the admin shows them. */
export function uploadableKeys(): string[] {
  return [BOOK_KEY_CORE, BOOK_KEY_HOPE_FEAR, ...PUBLISHED_FRAME_IDS.map((id) => `frame:${id}`)];
}

function isUploadable(key: string): boolean {
  return key !== BOOK_KEY_HOUSE_RULES && bookDefaults(key) !== null;
}

// ---------------------------------------------------------------- status

const ingestStatusValidator = v.object({
  bookKey: v.string(),
  bookId: v.id("lorekeeperBooks"),
  status: v.union(v.literal("running"), v.literal("done"), v.literal("failed")),
  startedAt: v.number(),
  finishedAt: v.union(v.number(), v.null()),
  firstPrintedPage: v.number(),
  title: v.string(),
  result: v.union(pdfIngestResultValidator, v.null()),
});
export type IngestStatus = Infer<typeof ingestStatusValidator>;

const STALE_RESULT: PdfIngestResult = { ok: false, code: "BOOK_PARSE_FAILED" };

function isStale(row: Doc<"lorekeeperIngests">, now: number): boolean {
  return row.status === "running" && now - row.startedAt > INGEST_STALE_MS;
}

function statusOf(row: Doc<"lorekeeperIngests">, now: number): IngestStatus {
  const stale = isStale(row, now);
  return {
    bookKey: row.bookKey,
    bookId: row.bookId,
    status: stale ? "failed" : row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt ?? null,
    firstPrintedPage: row.firstPrintedPage,
    title: row.title,
    result: stale ? STALE_RESULT : (row.result ?? null),
  };
}

async function ingestRow(ctx: QueryCtx, bookKey: string): Promise<Doc<"lorekeeperIngests"> | null> {
  return ctx.db
    .query("lorekeeperIngests")
    .withIndex("by_key", (q) => q.eq("bookKey", bookKey))
    .unique();
}

async function bookByKey(ctx: QueryCtx, bookKey: string): Promise<Doc<"lorekeeperBooks"> | null> {
  return ctx.db
    .query("lorekeeperBooks")
    .withIndex("by_key", (q) => q.eq("key", bookKey))
    .first();
}

// ---------------------------------------------------------------- public: the library

const libraryBookValidator = v.object({
  bookId: v.id("lorekeeperBooks"),
  key: v.string(),
  title: v.string(),
  subtitle: v.string(),
  /** Printed pages covered. */
  pages: v.number(),
  chunkCount: v.number(),
  ingestedAt: v.number(),
});

const adminLibraryValidator = v.object({
  /** The shared books (not the house-rules pseudo-book), in `uploadableKeys` order, then any other key. */
  books: v.array(libraryBookValidator),
  /** Keys the owner may still upload as a new book, with the title it gets by default. */
  available: v.array(v.object({ key: v.string(), title: v.string() })),
});
export type AdminLibrary = Infer<typeof adminLibraryValidator>;

/** The shared library: each book's pages, chunks and ingested date, never any text; and the keys still free. */
export const list = appOwnerQuery({
  args: {},
  returns: adminLibraryValidator,
  handler: async (ctx): Promise<AdminLibrary> => {
    const rows = await ctx.db.query("lorekeeperBooks").take(LIST_MAX_BOOKS);
    // Shared books only: LB1's campaign books will carry a `campaignId`.
    const shared = rows.filter((book) => book.key !== BOOK_KEY_HOUSE_RULES && (book as { campaignId?: unknown }).campaignId === undefined);
    const order = uploadableKeys();
    const rank = (key: string) => (order.includes(key) ? order.indexOf(key) : order.length);
    shared.sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key));
    const present = new Set(shared.map((book) => book.key));
    return {
      books: shared.map((book) => ({
        bookId: book._id,
        key: book.key,
        title: book.title,
        subtitle: book.subtitle,
        pages: book.pages,
        chunkCount: book.chunkCount,
        ingestedAt: book.ingestedAt,
      })),
      available: order.filter((key) => !present.has(key)).map((key) => ({ key, title: bookDefaults(key)!.title })),
    };
  },
});

/** The progress row of a book's last upload, or null when it was never uploaded from the admin. */
export const ingestStatus = appOwnerQuery({
  args: { bookKey: v.string() },
  returns: v.union(ingestStatusValidator, v.null()),
  handler: async (ctx, { bookKey }): Promise<IngestStatus | null> => {
    const row = await ingestRow(ctx, bookKey);
    return row === null ? null : statusOf(row, Date.now());
  },
});

/** An upload URL for a book PDF. Rate-limited (`uploadUrl`, CF15). */
export const uploadUrl = appOwnerMutation({
  rateLimit: "uploadUrl",
  args: {},
  returns: v.string(),
  handler: async (ctx) => ctx.storage.generateUploadUrl(),
});

const ingestRefusalValidator = v.union(v.literal("BOOK_NOT_PDF"), v.literal("BOOK_TOO_LARGE"), v.literal("BOOK_INGEST_RUNNING"));

const ingestResultValidator = v.union(
  v.object({ ok: v.literal(true), bookId: v.id("lorekeeperBooks") }),
  v.object({ ok: v.literal(false), code: ingestRefusalValidator }),
);
export type IngestStart = Infer<typeof ingestResultValidator>;

// Typed reference by name, so this file needs no regenerated `_generated/api` (the PDF0 action and our `onDone`).
type IngestPdfArgs = { storageId: Id<"_storage">; bookId: Id<"lorekeeperBooks">; firstPrintedPage: number; onDone?: string };
const ingestPdfRef = makeFunctionReference<"action", IngestPdfArgs, PdfIngestResult>("pdfIngest:ingestPdf");
const recordIngestRef = makeFunctionReference<"mutation", PdfIngestDone, null>("adminLibrary:recordIngest");

/** The trimmed title, at most `TITLE_MAX`; empty means the key's default. */
function cleanTitle(title: string | undefined, fallback: string): string {
  const trimmed = (title ?? "").trim();
  if (trimmed.length > TITLE_MAX) throw appError("INVALID", `A title is at most ${TITLE_MAX} characters.`);
  return trimmed === "" ? fallback : trimmed;
}

/**
 * Starts reading an uploaded PDF into a shared book: a new one (`library.upload`) or a replacement
 * (`library.replace`), audited. Checks the arguments (INVALID), that the file exists and is no recorded file
 * (NOT_FOUND), then the recorded type and size and that no ingest of this book is running; those refusals delete the
 * file and are returned. Then writes the `running` status row and schedules PDF0's `ingestPdf`.
 */
export const ingest = appOwnerMutation({
  args: {
    storageId: v.id("_storage"),
    bookKey: v.string(),
    /** The book's title; empty or absent keeps the current one (a new book: the key's default). */
    title: v.optional(v.string()),
    /** The printed page number of the PDF's first page (N8 a), 0-9999. */
    firstPrintedPage: v.number(),
  },
  returns: ingestResultValidator,
  handler: async (ctx, { storageId, bookKey, title, firstPrintedPage }): Promise<IngestStart> => {
    if (!isUploadable(bookKey)) throw appError("INVALID", "That book can't be uploaded.");
    if (!Number.isInteger(firstPrintedPage) || firstPrintedPage < 0 || firstPrintedPage > PDF_MAX_FIRST_PAGE) {
      throw appError("INVALID", `The first page number is a whole number from 0 to ${PDF_MAX_FIRST_PAGE}.`);
    }
    const existing = await bookByKey(ctx, bookKey);
    const bookTitle = cleanTitle(title, existing?.title ?? bookDefaults(bookKey)!.title);

    // CF17: a storage id proves nothing. One that is any recorded file is refused, and never deleted here.
    const meta = await ctx.db.system.get("_storage", storageId);
    if (meta === null) throw appError("NOT_FOUND");
    const recorded = await ctx.db
      .query("files")
      .withIndex("by_storage", (q) => q.eq("storageId", storageId))
      .first();
    if (recorded !== null) throw appError("NOT_FOUND");

    const refuse = async (code: Infer<typeof ingestRefusalValidator>): Promise<IngestStart> => {
      await ctx.storage.delete(storageId);
      return { ok: false, code };
    };
    if (meta.contentType !== PDF_CONTENT_TYPE) return refuse("BOOK_NOT_PDF");
    if (meta.size > PDF_MAX_BYTES) return refuse("BOOK_TOO_LARGE");
    const now = Date.now();
    const row = await ingestRow(ctx, bookKey);
    if (row !== null && row.status === "running" && !isStale(row, now)) return refuse("BOOK_INGEST_RUNNING");

    // A book with no text yet (a new key, or an earlier first upload that never finished) counts as new.
    const newBook = existing === null || existing.chunkCount === 0;
    const bookId = existing?._id ?? (await insertBook(ctx, bookKey, bookTitle, now));
    const status = {
      bookKey,
      bookId,
      status: "running" as const,
      startedAt: now,
      startedBy: ctx.user._id,
      firstPrintedPage,
      title: bookTitle,
      newBook,
    };
    if (row === null) await ctx.db.insert("lorekeeperIngests", status);
    else await ctx.db.replace("lorekeeperIngests", row._id, status);

    const onDone = await createFunctionHandle(recordIngestRef);
    await ctx.scheduler.runAfter(0, ingestPdfRef, { storageId, bookId, firstPrintedPage, onDone });
    await recordAdminChange(ctx, ctx.user._id, {
      action: newBook ? "library.upload" : "library.replace",
      field: bookKey,
      ...(!newBook && existing.title !== bookTitle ? { from: existing.title } : {}),
      to: bookTitle,
      target: bookId,
    });
    return { ok: true, bookId };
  },
});

/** A new shared book's row, empty until the ingest writes its pages and chunks. */
async function insertBook(ctx: MutationCtx, bookKey: string, title: string, now: number): Promise<Id<"lorekeeperBooks">> {
  const defaults = bookDefaults(bookKey)!;
  return ctx.db.insert("lorekeeperBooks", {
    key: bookKey,
    title,
    subtitle: defaults.subtitle,
    cover: defaults.cover,
    pages: 0,
    chunkCount: 0,
    ingestedAt: now,
    schemaVersion: CHUNK_SCHEMA_VERSION,
  });
}

// ---------------------------------------------------------------- internal: PDF0's onDone

/**
 * Records PDF0's result on the book's running status row (`onDone`). On success the book takes the uploaded title; a
 * failed first upload of a new book removes the empty book row again (the status row keeps the failure). A row that is
 * not running for this book (a stale one already replaced) is left alone.
 */
export const recordIngest = internalMutation({
  args: { bookId: v.id("lorekeeperBooks"), result: pdfIngestResultValidator },
  returns: v.null(),
  handler: async (ctx, { bookId, result }) => {
    const row = await ctx.db
      .query("lorekeeperIngests")
      .withIndex("by_book", (q) => q.eq("bookId", bookId))
      .first();
    if (row === null || row.status !== "running") return null;
    await ctx.db.patch("lorekeeperIngests", row._id, { status: result.ok ? "done" : "failed", finishedAt: Date.now(), result });
    const book = await ctx.db.get("lorekeeperBooks", bookId);
    if (book === null) return null;
    if (result.ok) {
      if (book.title !== row.title) await ctx.db.patch("lorekeeperBooks", bookId, { title: row.title });
    } else if (row.newBook && book.chunkCount === 0) {
      await ctx.db.delete("lorekeeperBooks", bookId);
    }
    return null;
  },
});
