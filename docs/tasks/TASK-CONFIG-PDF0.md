# TASK-CONFIG-PDF0: PDF book ingest pipeline

Plan `.omc/plans/config.yaml`, tracer PDF0 (bead dcm-jh6d.35), Part B. Server only: one internal Node action turns
an uploaded PDF into a Lorekeeper book's chunks. No public function and no UI. The owner's library upload (AD8) and
GM campaign books (LB1) call it after their own upload mutations.

User answers: Q23 b (parse PDFs on the server), N5 a (a PDF reader dependency is OK), N6 b (no book-count limit, only
20 MB and 300 pages per file), N8 a (`unpdf`; the uploader types the printed page number of the PDF's first page, and
citations use printed pages).

## Dependency

`unpdf` **1.9.1** (dependency, exact pin), published 2026-10-19, so it satisfies pnpm's `minimumReleaseAge` with no
exclusion. It has no dependencies (it bundles Mozilla's PDF.js serverless build, which polyfills
`Promise.withResolvers`); its optional `@napi-rs/canvas` peer is only for rendering and is not installed. 2.x needs
Node 24 and is younger than two weeks. The bundled build uses no `eval` / `new Function`.

## API (`convex/pdfIngest.ts`, `"use node"`)

| Function | Kind | Args | Returns |
|---|---|---|---|
| `pdfIngest.ingestPdf` | `internalAction` | `storageId`, `bookId`, `firstPrintedPage` (0-9999), `onDone?` | `{ ok: true, pages, chunks, firstPage, lastPage }` or `{ ok: false, code }` |

`code` is one of `BOOK_TOO_LARGE`, `BOOK_NOT_PDF`, `BOOK_PARSE_FAILED` (src/lib/errors/admin.ts, AD0) or
`LOREKEEPER_BOOK_NOT_FOUND`. The validator is `pdfIngestResultValidator` in `convex/lib/pdf/config.ts`.

Steps:

1. One internal query (`lib/pdf/books:ingestTarget`) reads the book row and the file's `_storage` metadata. No book:
   `LOREKEEPER_BOOK_NOT_FOUND`. Over 20 MB: `BOOK_TOO_LARGE`. A recorded type that is not `application/pdf`:
   `BOOK_NOT_PDF`. These are checked before the file is downloaded.
2. The bytes must start with `%PDF-` (strict, offset 0: a PNG / PDF polyglot is refused): `BOOK_NOT_PDF`.
3. `unpdf` opens it (`stopAtErrors`); a damaged or password-protected PDF is `BOOK_PARSE_FAILED`. More than 300 pages
   is `BOOK_TOO_LARGE`, checked before any text is read. Fewer than half the pages with text (a page has text with at
   least 20 non-space characters, so a scanned page has none) is `BOOK_PARSE_FAILED`.
4. PDF page *i* (0-based) is printed page `firstPrintedPage + i`. The pages become the chunker's page-tagged text
   (`===== PAGE <printed + 1> =====` blocks, `src/lib/lorekeeper/chunk.ts`; lines in the PDF that look like a marker
   are dropped) and `chunkBook` chunks them, as the ingest script does. A footer page number within 3 of that still
   wins and names the chapter, as for text files. No chunks: `BOOK_PARSE_FAILED`.
5. Only now is anything written, through the existing internal mutations: `ingestBook` with the row's own key, title,
   subtitle and cover (so it re-registers the book unchanged, sets `pages` to the PDF page count and resets
   `chunkCount`), `clearChunks` until done, `ingestChunks` in batches of 100. A refused or failed parse never clears a
   replaced book's old text.
6. The uploaded file is deleted whatever happened (success, refusal, error). It is never served back (no `getUrl`);
   the text exists only as chunks, which no public function returns whole.
7. The result is returned and, if `onDone` was given, passed to it (below). A refusal is a result, not a throw.
   `firstPrintedPage` outside 0-9999 or not a whole number is a caller bug: the file is deleted and `INVALID` thrown.
   An unexpected error after the checks (a programming error, for example `ingestBook` refusing an unknown key) is
   reported to `onDone` as `BOOK_PARSE_FAILED`, then rethrown.

## Recording the result: `onDone`

PDF0 owns no table, so the caller says where the result goes. `onDone` is a function handle
(`createFunctionHandle(internal.<module>.<fn>)`) to the caller's own **internal mutation** with args
`{ bookId: v.id("lorekeeperBooks"), result: pdfIngestResultValidator }` (type `PdfIngestDone` in
`convex/pdfIngest.ts`). AD8 / LB1 write it onto whatever row their `ingestStatus` / list reads.

Caller sketch (AD8 / LB1):

```ts
// in the access-checked, rate-limited mutation, after the recorded type and size check (rule 10, CF16):
const onDone = await createFunctionHandle(internal.adminLibrary.recordIngest);
await ctx.scheduler.runAfter(0, internal.pdfIngest.ingestPdf, { storageId, bookId, firstPrintedPage, onDone });
```

The callers create (or pick) the `lorekeeperBooks` row first. `ingestBook` accepts only keys `bookDefaults` knows
(`core`, `hopeFear`, `houseRules`, `frame:<id>`): LB1's `campaign:<campaignId>:<n>` keys need LB1's widening of
`bookDefaults` in `convex/lorekeeperLibrary.ts`.

## Shared limits (`convex/lib/pdf/config.ts`)

`PDF_CONTENT_TYPE`, `PDF_MAX_BYTES` (20 MB), `PDF_MAX_PAGES` (300), `PDF_MIN_PAGE_CHARS` (20), `PDF_MAX_FIRST_PAGE`
(9999): framework-free, for the upload mutations and the upload UI (CH5).

## Files

- `convex/pdfIngest.ts`: the action.
- `convex/lib/pdf/config.ts`: limits and the result validator.
- `convex/lib/pdf/pages.ts`: pure helpers (magic bytes, text threshold, page-tagged text).
- `convex/lib/pdf/extract.ts` (`"use node"`): the `unpdf` reader.
- `convex/lib/pdf/books.ts`: the internal query `ingestTarget` and its typed reference.
- `tests/convex/pdf-ingest.test.ts` (runs in Node: `// @vitest-environment node`), `tests/fixtures/pdf/make-pdf.ts`
  (a tiny PDF writer) and `tests/fixtures/pdf/sample.pdf` (three pages of invented text; never rulebook text).

## Not covered here

- convex-test records no content type for stored files, so the recorded-type refusal is covered by the callers' tests
  (AD8, LB1), where it is their mutation's check anyway.
- Two ingests of the same book at once would interleave their chunks; the callers should allow one running ingest per
  book (their status row).
