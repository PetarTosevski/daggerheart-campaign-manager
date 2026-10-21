# TASK-D11-N4: Open threads, search and 'Download my journal'

Plan `.omc/plans/d11-notes.yaml`, tracer N4 (wave 3, depends on N2 and N3). Bead dcm-bxp.10. Status: Review (the
orchestrator's merge and wave e2e are still to run).

Title: Open threads, search and 'Download my journal' - own journal only.

## Rules implemented (quoted from the plan)

- Q13: "Search and open threads cover your own journal only."
- Q9: "Download allowed. Assumed default: 'Download my journal' exports your own pages as one Markdown file, generated
  in the browser from data you can read; no server export of other people's pages."
- D5: "a journal's open threads include added entries on its own pages."
- B1: "'🧵 Open threads · N' (aria-pressed, accent fill when on)."
- B5: "Open thread = open task or unresolved Fear. Threads view (l.111-120): tape 'Open threads', 'Every unfinished
  task and every looming Fear, from all pages.', '<page title> →', 'Nothing dangling. Suspicious…'."
- B9: "Search (l.251, 283): case-insensitive substring over titles and entry text; matching rows highlighted."

## What landed

### convex/notesThreads.ts (all `campaignQuery`, `need: "view"`)

All three read the caller's current journal (N0 `currentJournal`, D3, from `ctx.user`); page ids never come from the
client, and only pages of that journal that are not torn out are read. The caller owns each of those pages (A4: the
owner always reads their page), so no per-page `permissionFor` call is made.

| Function | Args | Returns | Reads at the caps |
|---|---|---|---|
| `threads` | - | `ThreadRow[]`: _id, pageId, pageTitle, kind, state, star, text, added, authorLabel; in page then entry order | pages `by_journal_binned` (<= 200), entries `by_journal_open` open=true (take 500), one character + user per distinct added-entry author |
| `search` | text (1-80 after trimming, else INVALID) | own page ids in created order | pages (<= 200), `search_text` filtered by `journalId` (take 200), each hit confirmed with N1 `matches` |
| `exportPage` | cursor (null first) | `{ pages, entries, continueCursor }` (N1 `ExportPage` / `ExportEntry` shapes) | `.paginate` 10 pages, each page's entries `by_page_order` (<= 300), session point reads, authors |

Entries carry their page's `journalId` (N3), so the threads and the search of a journal include entries others added to
its pages (D5) and never the caller's own lines on someone else's page.

Role table (tests/convex/notes-threads.test.ts; every 'ok' answer holds the caller's own journal only):

| Function | anonymous | outsider | owner player P1 | other player P2 | player without a journal P3 | GM |
|---|---|---|---|---|---|---|
| threads | UNAUTHENTICATED | NOT_FOUND | ok (own) | ok (own) | ok ([]) | ok (own) |
| search | UNAUTHENTICATED | NOT_FOUND | ok (own) | ok (own) | ok ([]) | ok (own) |
| exportPage | UNAUTHENTICATED | NOT_FOUND | ok (own) | ok (own) | ok (empty) | ok (own) |

"Own only" checks: the GM reads P1's 'gm' page but its threads, search and export hold only the GM's journal; P1 and
P2 read the GM's 'everyone' page but never get it; P1's line on the GM's page is in the GM's threads / export
(labelled 'Ash'), the GM's line on P1's page in P1's (labelled 'GM'); torn-out pages are dropped from all three.

### UI

- `threads/index.tsx`: `ThreadsButton` ('🧵 Open threads · N' from N1 `threadsButtonLabel`, N = the thread count,
  `aria-pressed`, toggles `?view=threads`) and `ThreadsView` (violet `bj-tape-4` 'Open threads', intro, rows with the
  N1 bullet (glyph, colour, glow, tooltip / aria label), the text (no ★, as on the board) through the mentions slot `EntryText`, added
  entries in `bj-added` ending ' - <author>', and '<page title> →' opening the page; 'Nothing dangling. Suspicious…').
  The button and the view share one `notesThreads.threads` subscription.
- `threads/optimistic.ts`: the bullet click in the view sends N3's `cycle` with N3's `cycleUpdate` plus a threads
  updater that drops the row (and so lowers N) when its next state is no longer an open thread.
- `threads/threads.css`: the board's remaining inline styles of the thread rows and the 390 px layout.
- `search/index.tsx`: `JournalSearch` (unchanged input, now `maxLength` 80) and `useJournalSearch`: the trimmed text
  debounced 250 ms; `notesThreads.search` on the settled text (the last settled search keeps filtering while new typing
  settles; a blank box skips the query and clears the filter at once). The row highlight is N3's (`bj-hit`, live).
- `export/index.tsx` + `export/download.ts`: `DownloadJournalButton` fetches every `exportPage` chunk in its click
  handler (`useConvex().query`), builds the file with N1 `journalToMarkdown` (hero name from N2's `useJournal`), and saves
  it as '<whoName> journal.md' through a temporary object URL on an `<a download>` (a normal browser download).
  Before the first write the file lists the default pages without entries. Errors show in a `role=alert` line.

## Visual check

| Region | App shot | Board shot | Verdict |
|---|---|---|---|
| Threads view, 1440 | `test-results/visual/D11-N4/threads-1440.png` | `test-results/visual/board/notes-threads-1440.png` | Matches: violet tape, intro line, the same four rows in the same order, bullet glyphs and Fear colour / glow, '<page title> →' buttons right-aligned. Rows sit 37 px apart against the board's 40 px (N0's `bj-row` metrics). |
| Search 'ferry', 1440 | `test-results/visual/D11-N4/search-1440.png` | `test-results/visual/board/notes-search-1440.png` | Matches: only 'Session 1' left in the index, 'No matches.' under Collections and Future log, the two ferry lines highlighted. The other differences belong to other tracers (Shared / journals / bin sections, sharing chip, Session button, the mention as plain text until N5). |
| Threads view, 390 | `threads-390.png` | none (no phone board) | One column, no horizontal scroll; the page button wraps under the text; 44 px bullets and buttons. |
| Search, 390 | `search-390.png` | none | Index behind N2's 'Pages' disclosure ('Pages · Session 1'), highlighted lines on the page, no horizontal scroll. |

## Evidence

- `tests/convex/notes-threads.test.ts`: 10 tests (3 role-table rows x 6 roles; threads own-only incl. added entries both
  ways; a completed task leaves the threads and a torn-out page's entries drop; search by title and text, case-
  insensitive, own only; torn-out page and mention ids; INVALID for blank and 81 characters; export paginated over 12
  pages in 2 calls with added-entry authors, own only; export without a torn-out page).
- `tests/unit/notes-export-ui.test.tsx`: 1 test (two chunks, two pages of fake data -> one `text/markdown` blob saved
  as 'Ash journal.md', mention as plain name, struck resolved note, ' - GM' suffix).
- `tests/e2e/notes-threads.spec.ts`: 4 tests (threads list and completion, confirmed on the server with `expect.poll`
  through a Convex client; search narrows the index and highlights; the download saves a .md file with the page
  titles; 390 px). `tests/e2e/visual/D11-N4.spec.ts`: 1 @visual test.

## Deviations and questions

1. Search uses the `search_text` full-text index as the plan says, so entry text is found by whole words and by a
   prefix of the last word ('ferry' finds 'ferryman'), not by any substring ('erry' finds nothing) as B9's
   "substring" reads. Page titles do match by substring. A substring search over entry text would mean reading up to
   5000 entries per keystroke. Is word / prefix matching acceptable?
2. The threads optimistic updater lives in `src/components/notes/threads/optimistic.ts`, not
   `src/lib/optimistic/notes-threads.ts` (outside N4's `owns`). The orchestrator may move it.
3. The thread rows cycle the bullet as on the board (l.117 `e.cycle`); the plan's acceptance did not ask for it.
4. `tests/unit/wizard-steps.test.tsx` timed out once in the full `pnpm test` run while e2e ran beside it; it passes
   alone (6/6). It is not an N4 file.
