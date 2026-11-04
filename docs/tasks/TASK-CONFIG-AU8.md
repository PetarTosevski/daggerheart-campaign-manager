# TASK-CONFIG-AU8: GM campaign books in Campaign settings > Lorekeeper (UI)

Plan `.omc/plans/config.yaml`, tracer AU8 (bead dcm-jh6d.58), Part B. Server: LB1's `convex/campaignBooks.ts`
(docs/tasks/TASK-CONFIG-LB1.md). User answers: Q24 b, N6 b (no book-count limit; 20 MB and 300 pages per file), N7 a
(GM and co-GMs upload), N8 a (the uploader types the printed page number of the PDF's first page).

## What the GM sees

Under 'Sources it may search' (`LorekeeperCampaignBooks`, `src/components/config/sections/lorekeeper/books.tsx`):

- One row per own book, the board's 'Your Witherwild notes · Uploaded by you' style: the title, 'Uploaded by you ·
  <pages> pages · This campaign only', the Indexed / Off pill and its switch (`lorekeeperLibrary.setEnabled`, the same
  optimistic update as the shared books). While the server reads the PDF: 'Reading the book…' (role status), no
  switch, Remove disabled (the server refuses `BOOK_INGEST_RUNNING`). A read that stopped: 'Couldn't be read · Remove it
  and upload the PDF again.'
- Remove (glass `danger`) opens a confirm group ('Remove <title>?', danger Remove, cancel). The removal is optimistic:
  the book leaves `campaignBooks.list` and `lorekeeperLibrary.list` at once.
- `list.failures` (uploads whose PDF could not be read since the last upload): '<title> couldn't be read' and the code's
  message.
- 'Upload a book', 'PDF · Up to 20 MB and 300 pages' and '<N> books uploaded · No limit on the number of books'.
  The form (`books/upload-form.tsx`): PDF file (the title is suggested from the file name), title (1-120), printed
  page number of the first page (0-9999, default 1). It reuses AU3's `fileProblem` and `uploadWithProgress`
  (`src/components/admin/lorekeeper/upload.ts`) and `codeText` / `wholeNumber` (`admin/lorekeeper/text.ts`):
  client checks, the rate-limited `uploadUrl`, a progress bar, then `add`; a returned refusal (`BOOK_NOT_PDF`,
  `BOOK_TOO_LARGE`) or a thrown error shows inline. The server checks everything again (rule 10).
- Its own `SlotBoundary` (rule 11). While `campaignBooks.list` loads it renders nothing (the section's shared list
  already shows 'Loading …').

## Outside edit (minimal)

`src/components/config/sections/lorekeeper/index.tsx` (U4): the shared 'Sources it may search' rows leave out campaign
books (`isCampaignBookKey`), since they have their own rows here; otherwise each would show twice.

## Tests

- `tests/unit/config/campaign-books.test.tsx`: the rows and states, the switch intent, the remove confirm and its
  optimistic update, the upload checks and calls, a refusal inline, and no duplicate in the shared list.
- `tests/e2e/config-campaign-books.spec.ts` (written, not run in this tracer: the machine is shared): upload the
  fixture PDF, 'Indexed', a citation `📖 Harbour Almanac · p.N` from this campaign's Lorekeeper, none from a second
  campaign, Remove, axe and 390 px.

## Open questions (recommended defaults taken)

- The acceptance's 'N of M books used' and the link to 'Ask for higher limits' predate N6 b. With no count limit there
  is no M, so the row says '<N> books uploaded · No limit on the number of books' and links nothing (AU3's limits
  section already hides book numbers when they are not set).
- A failed upload shows under the books until the next upload (LB1 prunes it then); there is no Dismiss.
- The uploader's name is not shown ('Uploaded by you' for the GM and co-GMs alike, as the board says).
