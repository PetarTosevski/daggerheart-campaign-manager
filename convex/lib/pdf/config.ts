import { v, type Infer } from "convex/values";

/**
 * PDF book ingest limits and result shape (config plan PDF0; user answers N6 b, N8 a). Framework-free, so the upload
 * mutations (AD8, LB1) and the upload UI (AU8) can import the same numbers (CH5).
 */

/** The only content type a book upload may have (the one exception to rule 10's image allowlist). */
export const PDF_CONTENT_TYPE = "application/pdf";
/** Largest book file: 20 MB (N6 b). */
export const PDF_MAX_BYTES = 20 * 1024 * 1024;
/** Most PDF pages in one book (N6 b). */
export const PDF_MAX_PAGES = 300;
/** A page "has text" when it holds at least this many non-space characters; a scan holds none. */
export const PDF_MIN_PAGE_CHARS = 20;
/** Highest printed page number the uploader may give for the PDF's first page (N8 a). */
export const PDF_MAX_FIRST_PAGE = 9999;

/** Codes a finished ingest can report (src/lib/errors/admin.ts and lorekeeper.ts). */
export const pdfIngestCodeValidator = v.union(
  v.literal("BOOK_TOO_LARGE"),
  v.literal("BOOK_NOT_PDF"),
  v.literal("BOOK_PARSE_FAILED"),
  v.literal("LOREKEEPER_BOOK_NOT_FOUND"),
);
export type PdfIngestCode = Infer<typeof pdfIngestCodeValidator>;

/** What `pdfIngest.ingestPdf` returns, and passes to the caller's `onDone` mutation. */
export const pdfIngestResultValidator = v.union(
  v.object({
    ok: v.literal(true),
    /** PDF pages read (the book's `pages`). */
    pages: v.number(),
    /** Chunks written. */
    chunks: v.number(),
    /** Printed page numbers covered: firstPrintedPage .. firstPrintedPage + pages - 1. */
    firstPage: v.number(),
    lastPage: v.number(),
  }),
  v.object({ ok: v.literal(false), code: pdfIngestCodeValidator }),
);
export type PdfIngestResult = Infer<typeof pdfIngestResultValidator>;
