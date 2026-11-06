# TASK-CONFIG-LB1: GM campaign books (server)

Plan `.omc/plans/config.yaml`, tracer LB1 (bead dcm-jh6d.54), Part B. The campaign's GM and co-GMs upload a book PDF
for their campaign; PDF0's `pdfIngest.ingestPdf` reads it; only that campaign's library and Lorekeeper show and search
it; the GM can remove it, and it goes with the campaign's purge. Server only (AU8 builds the UI).

User answers: Q24 b, N6 b (changed: **no book-count limit**, only 20 MB and 300 pages per file), N7 a (GM and
co-GMs), N8 a (`unpdf`; the uploader types the printed page number of the PDF's first page). So the acceptance's
`BOOK_ALLOWANCE` is not used, and `lorekeeperCampaignLimits.bookCount` / `bookPages` (AD12) stay stored but unenforced.

## Data

- `lorekeeperBooks` widened (rule 7, optional fields): `campaignId?`, `uploadedBy?`, `sizeBytes?`, index `by_campaign`.
  No `campaignId` = a shared book. A campaign book's key is `campaign:<campaignId>:<n>`; `n` counts up past every
  book and status row the campaign still has, so a key is never shared by two live rows.
- `lorekeeperIngests` (AD8's status table) widened: `campaignId?`, `storageId?`, indexes `by_campaign` and
  `by_storage`. One row per upload; AD8's `adminLibrary.recordIngest` is the `onDone` for campaign books too.
- `bookDefaults` (lorekeeperLibrary.ts) knows campaign keys (title "Campaign book", subtitle "Uploaded by the GM",
  cover `frame`), so PDF0's `ingestBook` call accepts them. `ingestBook` never *creates* a campaign book: a missing one
  (removed or purged during the read) is LOREKEEPER_BOOK_NOT_FOUND, because a recreated row would have no `campaignId`
  and so be shared.

## API (`convex/campaignBooks.ts`)

| Function | Wrapper (authz class) | Args | Returns / errors |
|---|---|---|---|
| `list` | `gmQuery` (`gm`) | `campaignId` | `{ books: [{ bookId, title, status: reading/ready/failed, pages, chunkCount, sizeBytes, firstPrintedPage, uploadedAt }], failures: [{ title, finishedAt, code }] }`; never text |
| `uploadUrl` | `gmMutation` (`gm`), rate limit `uploadUrl` (20/h per user) | `campaignId` | upload URL; RATE_LIMITED |
| `add` | `gmMutation` (`gm`) | `campaignId`, `storageId`, `title` (1-120 after trim), `firstPrintedPage` (whole, 0-9999) | `{ ok: true, bookId }` or `{ ok: false, code: BOOK_NOT_PDF / BOOK_TOO_LARGE }`; throws INVALID, NOT_FOUND |
| `remove` | `gmMutation` (`gm`) | `campaignId`, `bookId` | null; LOREKEEPER_BOOK_NOT_FOUND (shared or another campaign's), BOOK_INGEST_RUNNING |
| `deleteChunks` | internalMutation | `bookId` | batched (500), reschedules itself |

`add`, in order: INVALID arguments; NOT_FOUND (file kept) for a missing file, a storage id any `files` row records, or
one an ingest row is already reading (CF17); then the recorded type must be exactly `application/pdf` (missing too)
and the size at most 20 MB, else the file is deleted and the refusal returned (CF16; a throw would roll back the
delete). Then the campaign's earlier failed status rows (book gone) are pruned, the book row is created with
`campaignId`, the `running` status row written and `ingestPdf` scheduled. PDF0 checks `%PDF-` and 300 pages and
deletes the file whatever happens. A failed read removes the empty book (AD8's `recordIngest`); `list` shows it under
`failures` until the next upload.

`remove` deletes the book row, this campaign's switch and the status rows at once (so it leaves every library and
search immediately) and schedules `deleteChunks`. A read in progress (not stale, AD8's 15 minutes) blocks it.

## Search and library (`convex/lib/lorekeeper/retrieve.ts`)

`campaignBooks(ctx, campaign)` reads the shared books (`by_campaign` = undefined, at most 50) and this campaign's own
(`by_campaign` = campaign, at most `MAX_CAMPAIGN_BOOKS` 200, a read bound only). `bookVisibleTo` / `enabledByDefault`
take the book: a book with a `campaignId` is visible (and on by default) only in that campaign, so `lorekeeperLibrary`
`list` / `setEnabled` / `pageText` and `retrieve` never reach another campaign's book, even through a stray switch
row. Questions answered from campaign books count as normal questions (no change to caps). `lib/lorekeeper/context.ts`
needed no change: it reads only the house-rules switch.

## Purge (`convex/cleanup.ts`)

New purge steps before the library switches: the campaign's books (each book's chunks first, within the budget, then
the book), then its `lorekeeperIngests` rows. The export (AD11) already leaves chunks out.

## Outside edits (minimal)

- `convex/lib/lorekeeper/retrieve.ts`: the campaign filter and the indexed reads above (the search lives here, not in
  `context.ts`).
- `convex/adminLibrary.ts`: `list` reads shared books by `by_campaign` (the table now grows with campaign books), and
  `ingest` refuses campaign keys (INVALID), since `bookDefaults` now knows them.
- `tests/convex/schema-guard.test.ts`: `lorekeeperBooks` moves from BOUNDED to CAMPAIGN_SCOPED and
  `lorekeeperIngests` (unclassified since AD8) joins it.

## Tests

`tests/convex/campaign-books.test.ts` (Node: the PDF0 action runs): an end-to-end upload on printed pages; the second
campaign never sees, searches, switches or opens the book (even with a stray switch row); the owner's library leaves it
out; a co-GM upload; no count limit with a stored `bookCount`; keys never reused; type and size refusals delete the
file; recorded and in-flight storage ids are NOT_FOUND and kept; INVALID arguments; a failed read and its pruning; a
book removed during its read never becomes shared; campaign keys refused in the admin library; `remove` (batched
chunks, switches, status rows; other campaign / shared / running refused); the purge. `tests/convex/cleanup.test.ts`
seeds a campaign book, chunk and status row. Matrix: `tests/convex/authz/config-books.{entries,test}.ts`.

## Open questions (recommended defaults taken)

- No count limit means no refusal at all; reads stop at 200 own books per campaign (far above real use). Past that a
  book would not be listed or searched.
- Each upload is a new book; there is no "replace this campaign book" (remove and upload again).
- No audit row for GM uploads (the admin audit log is for owner changes).
- Spine colour reuses the frame book's `frame` cover until AU8 designs one.
