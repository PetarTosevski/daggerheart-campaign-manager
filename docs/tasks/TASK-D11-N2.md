# TASK-D11-N2: Own journal and pages

Status: Review. Plan `.omc/plans/d11-notes.yaml`, tracer N2 (wave 2; depends on N0, N1). Bead dcm-bxp.10.

## Goal

Each person opens their current journal (the GM's account journal, a player's character journal) with the board's
default pages, creates pages (session logs linked to a real session), renames and re-tapes them, and sees the hero and
the index column with counts.

## Rules implemented (quoted from the plan)

- B1: "Header (l.66-74): '<whoName>’s Journal', sub '<whoSub> · <N> pages · <M> entries' ... Dropped: 'Writing as'
  switcher (A2) and PIN controls (A1)."
- B2: "Index (l.91-107): ... groups 'Session logs' / 'Collections' / 'Future log' with '＋' ('New session log', 'New
  collection', 'New future page'); page button = tape tab, title, count ('N open' / entry count / nothing); 'Nothing here
  yet.' / 'No matches.'; Quick keys card copy."
- B3 (N2's part): "tape label; title input; meta '<session log | collection | future log> · <date>'; '🎀 Tape' (6 tapes)".
- B7: "'New collection', 'Future log <n>', session logs per D6; tape = page count mod 6. Default pages ... New and default
  pages get the default visibility (A4)."
- Q5: "Session log pages are named after the real D10 session with its date; a new session log page links to the
  current or a chosen session."
- Q8: "'<active character>’s Journal' / 'Player journal · <class>' (fallback account name / 'Player'); GM 'Game Master’s
  Journal' / 'GM journal · private to the GM'."
- Q12: "a new character gets a new journal".
- D3: "The current journal is the active character's, else the newest non-departed character's, else an unattached one
  (created on first write)."
- D6: "title set at creation ('Session N', plus ': <session title>' when there is one), editable; the meta shows the
  linked session's date live ('No date set'); players link only live / played sessions (D10 Q4), the GM any; a deleted
  session leaves the page unlinked; the picker preselects the live session, else the newest visible one".

## What landed

### Convex (convex/notes.ts)

| Function     | Wrapper (need)          | Args                        | Returns                       |
|--------------|-------------------------|-----------------------------|-------------------------------|
| `journal`    | campaignQuery (view)    | -                           | `journalViewValidator` (union) |
| `createPage` | campaignMutation (view) | kind, sessionId?            | page id                       |
| `renamePage` | campaignMutation (view) | page ref, title             | null                          |
| `cycleTape`  | campaignMutation (view) | page ref                    | null                          |
| `setSession` | campaignMutation (view) | page ref, sessionId or null | null                          |

- `journal`: `{ isGm, whoName, whoSub, journal: { _id, pageCount, entryCount, openCount }, pages }` or, before the first
  write, `{ isGm, whoName, whoSub, journal: null, templates }`. Page item: `_id`, `template?` (its default-page index,
  numbered as N0's `templatePageId` does, torn-out pages included), kind, title, tape, visibility, `sessionId` +
  `session { n, title?, date?, status }` only while the session exists and the caller can see it (players: live /
  played), createdAt, entryCount, openCount; torn-out pages left out; created order. Templates carry the session
  'Session 1' will link (D6). whoName / whoSub from N1 `journalWho` with the current journal's character (`readSheet`
  name, SRD class name; a corrupt sheet falls back to the account name).
- `createPage`: `ensureJournal` (creates the journal and its default pages on the first write), then `insertPage` with
  N1 `sessionLogTitle` (linked log) or `newPageTitle`, `newPageTape` over the listed pages, `defaultVisibility`.
- `renamePage` / `cycleTape` / `setSession`: `resolvePage` (a template ref creates the journal first, CL6) +
  `assertAction(access, "editPage")` (owner of a present journal). Title: N1 `isValidTitle`, stored trimmed.
  `setSession` keeps the title (D6).
- Session ids arrive as strings and are normalised; anything the caller may not link is NOTE_SESSION_INVALID (also a
  session on a page that is not a log).

Role table (tests/convex/notes-pages.test.ts; p1's page with the default 'gm' visibility):

| Function   | anonymous       | outsider  | owner (p1) | other player (p2)   | GM                    |
|------------|-----------------|-----------|------------|---------------------|-----------------------|
| journal    | UNAUTHENTICATED | NOT_FOUND | ok         | ok                  | ok                    |
| createPage | UNAUTHENTICATED | NOT_FOUND | ok         | ok                  | ok                    |
| renamePage | UNAUTHENTICATED | NOT_FOUND | ok         | NOTE_PAGE_NOT_FOUND | NOTE_FORBIDDEN_ACTION |
| cycleTape  | UNAUTHENTICATED | NOT_FOUND | ok         | NOTE_PAGE_NOT_FOUND | NOTE_FORBIDDEN_ACTION |
| setSession | UNAUTHENTICATED | NOT_FOUND | ok         | NOTE_PAGE_NOT_FOUND | NOTE_FORBIDDEN_ACTION |

Plus: an 'everyone' page and a chosen recipient (readers) get NOTE_FORBIDDEN_ACTION; a 'private' / unchosen page
NOTE_PAGE_NOT_FOUND; writes on a departed journal NOTE_JOURNAL_CLOSED (owner and GM); a player linking a planned session
NOTE_SESSION_INVALID.

### UI

- `header/`: `JournalHeading` — H1 `journalTitle(whoName)`, sub `subLine(whoSub, counts)` (template count before the
  first write).
- `index-column/`: `PageGroups` — the three groups (`PAGE_GROUPS`) with '＋', page buttons (tape tab, title, visibility
  mark: a lucide icon with `visibilityLabel` as tooltip and screen-reader text, `pageCountLabel`), `aria-current`,
  'Nothing here yet.' / 'No matches.'; while searching, N4's `matchingPageIds` filters (a default page before the first
  write matches by title). '＋ New session log' opens the session picker. At ≤ 720 px a 'Pages' disclosure button
  (`aria-expanded`, shows the current page) hides the groups; picking a page closes it.
- `page/`: `JournalPage` — tape label (`bj-tape-<n>`), title input (draft only while focused; Enter / blur save,
  Escape reverts, `maxLength` 80), meta `pageMeta(page, session)`, '🎀 Tape', '🔗 Session' on log pages (relink with the
  picker), toolbar slots `MigrateButton`, `SharingChip`, `TearOutButton`, then `Entries`. The toolbar slots and
  `Entries` receive the page's effective `?page=` value (the first page when the URL has none), so later slots never
  choose a default. `session-picker.tsx`: native `<dialog>` (`Modal`) over `sessionRecords.list` (GM: every session;
  player: live / played), radio list + 'No session', preselect live → newest → none (D6). `use-journal.ts`: the shared
  query hook and page-ref helpers.
- `src/lib/optimistic/notes-pages.ts`: `renamePageLocally`, `cycleTapeLocally` (on `notes.journal`, for real pages and
  templates). createPage and setSession wait for the server (new id / session data come from it).

## Visual check

Board shots: `node scripts/board-shots.mjs notes:empty notes:player` → `test-results/visual/board/notes-empty-1440.png`,
`notes-player-1440.png`. App shots: `test-results/visual/D11-N2/{journal,hero,index,page,picker}-{1440,390}.png`,
`index-open-390.png`.

| Region | Verdict |
|---|---|
| Hero (`hero-*`) | Matches: campaign line, Cinzel 44 px '<whoName>’s Journal', sub line with counts. Deviations: no banner / nav (the campaign shell owns it, N0), no 'Writing as' row and no PIN (A1, A2). |
| Index (`index-*`) | Matches: 300 px column, group labels, small '＋', page buttons with tape tab and current-page accent border. Added: a muted visibility icon per page (not on the board). |
| Empty page (`page-*`) | Matches: tape, Cinzel title input with underline, Caveat meta, '🎀 Tape', empty line, KEY. Deviation: the toolbar wraps to a second row because '🔗 Session' (Q5) and the sharing chip (N6) are added to the board's row. |
| Session picker (`picker-*`) | Not on the board: board tokens (dark card, gold accent, 48 px radio rows). |
| 390 (`*-390`, `index-open-390`) | One column, no horizontal scroll, 44 px page buttons and '＋', the 'Pages' disclosure. |

## Evidence

- `pnpm vitest run tests/convex/notes-pages.test.ts --maxWorkers=4 --testTimeout=60000`: 13 passed (role table 5 + 8).
- `pnpm vitest run --maxWorkers=4 --testTimeout=60000`: 168 files, 2195 tests passed.
- `pnpm lint`, `pnpm typecheck`: clean.
- `E2E_PORT=3132 E2E_CONVEX_PORT=3376 pnpm test:e2e tests/e2e/notes-pages.spec.ts`: 3 passed (GM defaults + live session
  log + collection rename / tape + reload; player defaults under 'Liriel’s Journal' + template-ref rename; 390
  disclosure and picker). Optimistic writes are confirmed with `expect.poll` through a Convex client.
- `E2E_VISUAL=1 ... tests/e2e/visual/D11-N2.spec.ts`: 1 passed.

## Notes for later tracers and the orchestrator

- `tests/e2e/notes-shell.spec.ts` (N0) expects the player heading 'Your Journal' (N0 stub). With N2 the heading is Q8's
  '<whoName>’s Journal'; that test's player has no character and no account name, so it is 'Player’s Journal'. The
  one-line change belongs to the orchestrator (the file is N0's).
- The 'Pages' disclosure covers only the own pages (this slot); search, Shared, journals, bin and Quick keys stay
  visible at 390 px because they are other slots in N0's page. N9 may move the whole index behind it.
