# TASK-CONFIG-AD8: shared book library upload (server)

Plan `.omc/plans/config.yaml`, tracer AD8 (bead dcm-jh6d.42), Part B. The app owner uploads a new shared book, or
replaces one, as a PDF from the admin page. PDF0's internal action `pdfIngest.ingestPdf` parses, chunks and ingests it
and deletes the file. GMs keep switching books per campaign (`lorekeeperLibrary.setEnabled`). Server only; the admin UI
is a later tracer.

User answers: Q23 b (upload a PDF, parse on the server), N6 b (no book-count limit; 20 MB and 300 pages per file),
N8 a (`unpdf`; the uploader types the printed page number of the PDF's first page).

## API (`convex/adminLibrary.ts`)

| Function       | Kind             | Args                                         | Returns / errors |
|----------------|------------------|----------------------------------------------|------------------|
| `list`         | appOwnerQuery    | -                                            | `{ books: [{ bookId, key, title, subtitle, pages, chunkCount, ingestedAt }], available: [{ key, title }] }` |
| `ingestStatus` | appOwnerQuery    | `bookKey`                                    | the status row (below) or null |
| `uploadUrl`    | appOwnerMutation | - (rate limit `uploadUrl`, 20 per hour)      | upload URL; RATE_LIMITED |
| `ingest`       | appOwnerMutation | `storageId`, `bookKey`, `title?`, `firstPrintedPage` | `{ ok: true, bookId }` or `{ ok: false, code }`; throws INVALID, NOT_FOUND |
| `recordIngest` | internalMutation | `bookId`, `result` (PDF0's `onDone`)         | null |

Everyone but the app owner: UNAUTHENTICATED signed out, FORBIDDEN otherwise (the campaign's GM included).

`list` returns the shared books (never the house-rules pseudo-book, never text). Once LB1 adds `campaignId` to
`lorekeeperBooks`, books with a `campaignId` are left out. `available` lists the keys that have no book yet.

## `ingest`, in order

1. `bookKey` must be a key the library knows (`bookDefaults`: `core`, `hopeFear`, `frame:<published frame id>`). It may
   not be `houseRules`, whose text is the GM's Notes. `firstPrintedPage` must be a whole number from 0 to 9999. `title`
   is trimmed and may be at most 120 characters; an empty or missing title keeps the current title (for a new book,
   the key's default). Any other value throws INVALID.
2. Rule 10 / CF17: a storage id is never proof of access. A missing file, or one that any `files` row records (someone's
   image), throws NOT_FOUND, and that file is not deleted.
3. Rule 10 / CF16: the recorded content type must be exactly `application/pdf` (a missing type is refused too), else
   the result is `BOOK_NOT_PDF`. A file over 20 MB is `BOOK_TOO_LARGE`. If an ingest of this book is already running,
   the result is `BOOK_INGEST_RUNNING`. Each of these refusals deletes the file and is *returned*, because a throw would
   roll back the delete. PDF0 then checks the `%PDF-` magic bytes and the 300-page limit.
4. A new key gets its `lorekeeperBooks` row now, because the action needs a book id. The status row is set to
   `running`, PDF0's `ingestPdf` is scheduled with `onDone = createFunctionHandle(adminLibrary.recordIngest)`, and the
   change is audited: `library.upload` for a new book (or one with no chunks), `library.replace` otherwise. The audit
   row has `field: bookKey`, `from` (the old title, if it changed), `to` (the title) and `target` (the book id).

## Status row: `lorekeeperIngests` (new table, `convex/tables/lorekeeper.ts`)

There is one row per book key, rewritten by each upload, so the table never grows past the number of books. It holds
no text. Fields: `bookKey`, `bookId`, `status` (`running` | `done` | `failed`), `startedAt`, `startedBy`,
`firstPrintedPage`, `title`, `newBook`, `finishedAt?` and `result?` (PDF0's `pdfIngestResultValidator`). Indexes:
`by_key` and `by_book`. LB1 can use the same table for campaign books.

- **One running ingest per book.** A second `ingest` of a book whose row is `running` gets `BOOK_INGEST_RUNNING`.
  Two ingests at once would interleave their chunks.
- **Stale runs.** A `running` row older than `INGEST_STALE_MS` (15 minutes, while an action stops after 10) means the
  action was killed before `onDone`. It no longer blocks, and `ingestStatus` reports it as `failed` with
  `BOOK_PARSE_FAILED`.
- **`recordIngest`.** This writes `done` or `failed`, `finishedAt` and the result. On success the book takes the
  uploaded title, so a replaced book keeps its old title and text until the new PDF is read. If the first upload of a
  new book fails, the empty book row is deleted, so it does not show up in every campaign's library; the status row
  keeps the failure. A result for a book with no running row is ignored.

## Outside edits (minimal)

- `convex/tables/lorekeeper.ts`: the `lorekeeperIngests` table.
- `convex/adminExport.ts`: `lorekeeperIngests` added to `EXPORTED_TABLES`, because every table must be exported or
  excluded. It holds no text.
- `src/lib/errors/admin.ts`: the `BOOK_INGEST_RUNNING` code.

## Tests

- `tests/convex/admin-library.test.ts` (Node environment, because the scheduled PDF0 action runs `unpdf`). It covers:
  owner only, the upload URL rate limit, a new upload end to end (printed pages, file deleted, audit), a replace (title
  and text change only after the read), a failed replace keeping the old text, a failed first upload removing the
  empty book, the recorded-type and size refusals deleting the file, one running ingest per book plus the stale case,
  a recorded file's storage id refused and kept, INVALID arguments, and `recordIngest` ignoring a result that has no
  running row.
- `tests/convex/authz/admin-library.{entries,test}.ts`: all four public functions are in the `appOwner` class.

## Not covered

- After a failed first upload, a GM's per-campaign switch row for the deleted book can remain. It is harmless:
  libraries read books first, then switches. `lorekeeperLibrary` has no `by_book` index for deleting these rows.
- A run that a stale row has already superseded, but that is still alive, would report onto the newer run's row
  (`onDone` carries only `bookId`). The 15-minute stale window is longer than the 10-minute action limit, so this can
  only happen when a scheduled action waits more than 5 minutes before it starts.
