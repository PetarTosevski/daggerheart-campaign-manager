"use node";

import type { FunctionHandle } from "convex/server";
import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { chunkBook } from "../src/lib/lorekeeper/chunk";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { INGEST_BATCH } from "./lorekeeperLibrary";
import { ingestTargetRef, type IngestTarget } from "./lib/pdf/books";
import {
  PDF_CONTENT_TYPE,
  PDF_MAX_BYTES,
  PDF_MAX_FIRST_PAGE,
  PDF_MAX_PAGES,
  pdfIngestResultValidator,
  type PdfIngestResult,
} from "./lib/pdf/config";
import { readPdfPages } from "./lib/pdf/extract";
import { enoughText, isPdfHeader, PDF_SNIFF_BYTES, pageTaggedText, printedPage } from "./lib/pdf/pages";

/**
 * The PDF book ingest pipeline (config plan PDF0; Q23 b, N5 a, N6 b, N8 a). One internal Node action turns an uploaded
 * PDF into a Lorekeeper book's chunks; the owner's library upload (AD8) and GM campaign books (LB1) schedule it after
 * their own access-checked, rate-limited upload mutations have checked the recorded type and size (rule 10).
 *
 * | Function    | Kind           | Args                                               | Result                              |
 * |-------------|----------------|----------------------------------------------------|-------------------------------------|
 * | `ingestPdf` | internalAction | storageId, bookId, firstPrintedPage, onDone?       | { ok, pages, chunks } / { ok, code } |
 *
 * Steps, each refusal a result code (never a throw, so the file delete always happens):
 * 1. The book row must exist (LOREKEEPER_BOOK_NOT_FOUND) and the file at most 20 MB with a recorded type of
 *    application/pdf, when one is recorded (BOOK_TOO_LARGE / BOOK_NOT_PDF).
 * 2. The bytes must start with "%PDF-" (BOOK_NOT_PDF); unpdf must open it (BOOK_PARSE_FAILED) and it must have at most
 *    300 pages (BOOK_TOO_LARGE); at least half its pages must have text, so a scanned book fails (BOOK_PARSE_FAILED).
 * 3. PDF page i is printed page firstPrintedPage + i (N8 a); the page-tagged text goes through the Lorekeeper chunker
 *    (src/lib/lorekeeper/chunk.ts), and only when that produced chunks are they written, through the existing internal
 *    `ingestBook` (re-registers the book unchanged, sets `pages`, resets `chunkCount`), `clearChunks` (until done) and
 *    `ingestChunks` (batches of 100). A failed parse therefore never clears a replaced book's old text.
 * 4. The uploaded file is deleted whatever happened (it is never served back; the text lives only in chunks, which no
 *    public function returns whole).
 * 5. The result is returned and, when the caller passed `onDone` (a function handle from `createFunctionHandle` of an
 *    internal mutation taking `{ bookId, result }`), handed to it, so the caller records it where its UI reads it.
 *
 * `firstPrintedPage` outside 0..9999 is a caller bug: the file is deleted and INVALID thrown. An unexpected error after
 * the checks (a programming error) is reported to `onDone` as BOOK_PARSE_FAILED and then rethrown.
 */

export type PdfIngestDone = { bookId: Id<"lorekeeperBooks">; result: PdfIngestResult };

export const ingestPdf = internalAction({
  args: {
    storageId: v.id("_storage"),
    bookId: v.id("lorekeeperBooks"),
    /** The printed page number of the PDF's first page, typed by the uploader (N8 a). */
    firstPrintedPage: v.number(),
    /** A function handle to an internal mutation `{ bookId, result }` that records the outcome. */
    onDone: v.optional(v.string()),
  },
  returns: pdfIngestResultValidator,
  handler: async (ctx, { storageId, bookId, firstPrintedPage, onDone }): Promise<PdfIngestResult> => {
    const target = await ctx.runQuery(ingestTargetRef, { bookId, storageId });
    const deleteFile = async () => {
      if (target.file !== null) await ctx.storage.delete(storageId);
    };
    if (!Number.isInteger(firstPrintedPage) || firstPrintedPage < 0 || firstPrintedPage > PDF_MAX_FIRST_PAGE) {
      await deleteFile();
      throw appError("INVALID", `The first page number is a whole number from 0 to ${PDF_MAX_FIRST_PAGE}.`);
    }
    let result: PdfIngestResult;
    let failure: unknown = null;
    try {
      result = await ingest(ctx, { storageId, bookId, firstPrintedPage, target });
    } catch (error) {
      failure = error;
      result = { ok: false, code: "BOOK_PARSE_FAILED" };
    } finally {
      await deleteFile();
    }
    if (onDone !== undefined) {
      const done: PdfIngestDone = { bookId, result };
      await ctx.runMutation(onDone as FunctionHandle<"mutation", PdfIngestDone>, done);
    }
    if (failure !== null) throw failure;
    return result;
  },
});

type IngestArgs = {
  storageId: Id<"_storage">;
  bookId: Id<"lorekeeperBooks">;
  firstPrintedPage: number;
  target: IngestTarget;
};

async function ingest(ctx: ActionCtx, { storageId, bookId, firstPrintedPage, target }: IngestArgs): Promise<PdfIngestResult> {
  const { book, file } = target;
  if (book === null) return { ok: false, code: "LOREKEEPER_BOOK_NOT_FOUND" };
  if (file === null) return { ok: false, code: "BOOK_PARSE_FAILED" };
  if (file.size > PDF_MAX_BYTES) return { ok: false, code: "BOOK_TOO_LARGE" };
  if (file.contentType !== undefined && file.contentType !== PDF_CONTENT_TYPE) return { ok: false, code: "BOOK_NOT_PDF" };

  const blob = await ctx.storage.get(storageId);
  if (blob === null) return { ok: false, code: "BOOK_PARSE_FAILED" };
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length > PDF_MAX_BYTES) return { ok: false, code: "BOOK_TOO_LARGE" };
  if (!isPdfHeader(bytes.subarray(0, PDF_SNIFF_BYTES))) return { ok: false, code: "BOOK_NOT_PDF" };

  const read = await readPdfPages(bytes, PDF_MAX_PAGES);
  if (read.kind === "tooManyPages") return { ok: false, code: "BOOK_TOO_LARGE" };
  if (read.kind === "unreadable") return { ok: false, code: "BOOK_PARSE_FAILED" };
  const { pages } = read;
  if (!enoughText(pages)) return { ok: false, code: "BOOK_PARSE_FAILED" };

  const chunks = chunkBook(pageTaggedText(pages, firstPrintedPage));
  if (chunks.length === 0) return { ok: false, code: "BOOK_PARSE_FAILED" };

  await ctx.runMutation(internal.lorekeeperLibrary.ingestBook, {
    bookKey: book.key,
    title: book.title,
    subtitle: book.subtitle,
    cover: book.cover,
    pages: pages.length,
  });
  for (;;) {
    const { done } = await ctx.runMutation(internal.lorekeeperLibrary.clearChunks, { bookId });
    if (done) break;
  }
  for (let at = 0; at < chunks.length; at += INGEST_BATCH) {
    await ctx.runMutation(internal.lorekeeperLibrary.ingestChunks, {
      bookId,
      chunks: chunks.slice(at, at + INGEST_BATCH).map(({ page, section, text, ord }) => ({ page, section, text, ord })),
    });
  }
  return {
    ok: true,
    pages: pages.length,
    chunks: chunks.length,
    firstPage: firstPrintedPage,
    lastPage: printedPage(pages.length - 1, firstPrintedPage),
  };
}
