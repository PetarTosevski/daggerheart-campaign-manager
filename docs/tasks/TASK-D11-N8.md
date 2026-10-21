# TASK-D11-N8: Journals

Plan `.omc/plans/d11-notes.yaml`, tracer N8 (wave 4, depends on N6 and N7). Bead dcm-bxp.10. Status: Review (the
orchestrator's merge and wave e2e are still to run).

Title: Journals - the GM opens any player's journal, Past journals of departed characters, departure and rejoin end to
end.

## Rules implemented (quoted from the plan)

- Q2: "The GM sees players' pages everywhere: in 'Shared by players' and by opening any player's journal, unless hidden
  from the GM."
- Q3: "Only the owner edits a page. The GM and any player who can read a page can ADD entries to it."
- Q8: "'<active character>’s Journal' / 'Player journal · <class>' (fallback account name / 'Player')".
- Q12: "When the player leaves or is removed, or the character dies or is retired, the journal is kept, its pages become
  readable by everyone in the campaign and the GM can delete them; a 'Past journals' list in the Shared section names
  them after the character. Assumed defaults: pages marked Private (hidden from everyone) stay private after
  departure; ... a departed player who rejoins gets their pages' previous visibility back."
- D1: "Departure is computed at read time, never stored ... 'away' ... is not a departure. A rejoin or a status set
  back to 'active' restores the previous visibility by itself. No D11 tracer edits convex/members.ts or
  convex/characters.ts."
- D2: "A departed journal is frozen: nobody adds or edits entries, not even its owner (who still reads it while a
  member); the GM may tear out its non-private pages into the bin (restorable by the GM, purged after 30 days)."
- D4: "A player's 'chosen' page is hidden from the GM unless the player ticks the GM in the recipient picker."

## What landed

### convex/notesJournals.ts (all `campaignQuery`, `need: "view"`, `returns` validators)

Every page passes `permissionFor` (resource `journalPage`, CF2); the journal view's flags come from N0's `pageAccess`
(N1's action table). Departure is N0's `departed()`. Nothing decides visibility a second time.

| Function | Args | Returns | Who |
|---|---|---|---|
| `playerJournals` | - | `[{ journalId, name, sub, pageCount }]` | the GM: every present player journal (not departed), named after its character (Q8), with the pages the GM reads; a player: `[]` (Q2) |
| `pastJournals` | - | `[{ journalId, name, pageCount }]` | every member: every departed journal, '<character>’s journal' (account name when unattached), with the pages the caller reads |
| `journalView` | `journalId` (string, `normalizeId`) | `{ journalId, title, ownerName, ownerIsGm, own, departed, pages: [{ _id, title, kind, tape, createdAt, entryCount, openCount, chip, canAdd, canBin }] }` | every member: the journal's live pages the caller can read; unknown, malformed or another campaign's journal NOT_FOUND |

Reads: `journals.by_campaign_user` (campaign prefix, take 200), `journalPages.by_journal_binned` (binnedAt undefined,
take MAX_PAGES), then the point reads of `permissionFor` / `departed` / the owner's character and user. No `Date.now()`.

### Role table (tests/convex/notes-journals.test.ts)

| Function | anonymous | outsider | owner P1 | GM | other player P2 | departed owner (removed) | departed owner (character dead) |
|---|---|---|---|---|---|---|---|
| playerJournals | UNAUTHENTICATED | NOT_FOUND | ok (`[]`) | ok | ok (`[]`) | NOT_FOUND | - |
| pastJournals | UNAUTHENTICATED | NOT_FOUND | ok | ok | ok | NOT_FOUND | - |
| journalView (P1's journal) | UNAUTHENTICATED | NOT_FOUND | ok (6 pages) | ok (3 pages) | ok (4 pages) | NOT_FOUND | ok (own, 6 pages) |

Read matrix (P1's pages titled after their visibility; the GM view also checked with `canAdd`):

| Page | GM (present) | P2 (present) | everyone else after departure | P1 after departure (still a member) |
|---|---|---|---|---|
| gm | yes | no | yes | yes |
| private | no | no | no | yes |
| players | no | yes | yes | yes |
| everyone | yes | yes | yes | yes |
| chosen [GM, P2] | yes | yes | yes | yes |
| chosen [P2] (D4) | no | yes | yes | yes |

Departure scenarios (each one: Past journals for GM and P2 with 5 pages, chip 'Everyone', no `canAdd`, `canBin` for
the GM only; Players’ journals without Ash; adds NOTE_JOURNAL_CLOSED, for P1 too): `members.removePlayer` then
`joinByCode`; `characters.setStatus` 'dead' then 'active'; 'retired' then 'active'; 'away' is not a departure. The GM
tears out a retired journal's 'players' page (its 'private' page NOTE_PAGE_NOT_FOUND, P2 NOTE_FORBIDDEN_ACTION), the
page leaves every view, and after 'active' the remaining pages read with their previous visibility.

### UI (src/components/notes/journals/)

- `JournalsList` (index column): 'Players’ journals' (GM only; name, 'Player journal · <class> · N pages'; empty 'No
  player has written yet.') and 'Past journals' (everyone; '<character>’s journal', 'N pages'; empty 'No past
  journals.'). A row opens `?view=journal&journal=<id>`; the open one has `aria-current`.
- `JournalView` (paper column): '<character>’s Journal' with 'read only' or 'Past journal · read only', a strip of the
  readable pages (tape tab, title, 'N open' / entry count; `?page=` picks one, else the first, so a stale `?page=` from
  another journal never shows 'Missing page'), then the paper: tape, title, meta, the effective sharing chip, N7's
  `TearOutButton` when `canBin` (the GM on a past journal's page), and N3's `Entries` with the viewer's flags (the add
  row only where the server allows it; none on past journals). A journal with nothing readable says 'No page of this
  journal is shared with you.'
- `journals.css`: rows like the index column's page buttons, 44 px targets, wrap at 390.

## Visual check (judged against the board's tokens; not on the board)

Shots: `test-results/visual/D11-N8/` (`players-journals`, `journal-view`, `past-journals`, `past-journal-view`, each
-1440 and -390).

| Region | Verdict |
|---|---|
| Players’ journals | Pass: `bj-lbl` heading, row like the index page buttons (accent mark, 15 px name, muted 12 px sub), 44 px |
| Journal view | Pass: Cinzel heading with muted 'read only', page strip in `--bj-card` with tape tabs and accent on the open page, paper, Caveat title, chip, added entry colour ' - GM', add row |
| Past journals | Pass: as Players’ journals, muted mark; the open journal outlined in the accent |
| Past journal view | Pass: 'Past journal · read only', chip 'Everyone', 'Tear out page' for the GM, no add row; one column, no horizontal scroll at 390 |

Deviations: the page meta shows the page's creation date, not a linked session's date (the journal view does not
read sessions); the chip is a static label (as on N6's shared page).

## Evidence

- `npx vitest run tests/convex/notes-journals.test.ts`: 16 passed. Full `vitest run --maxWorkers=4`: 183 files, 2445
  tests passed.
- `pnpm lint`, `pnpm typecheck`: clean.
- `tests/e2e/notes-journals.spec.ts` (GM + players A and B in three browsers, 1440 and 390): 2 passed. The GM opens
  Ash's journal and sees neither the 'players' nor the 'private' page, adds an entry ' - GM'; retired: GM, B and A find
  'Ash’s journal' under Past journals ('Party secrets' for all, 'True name' only for A, no add row, Tear out only for
  the GM); the GM tears 'Party secrets' out (it shows under Torn-out pages 'from Ash’s journal'); 'active': Past
  journals empty, A's journal has 'Session 1' (gm), 'True name' (private), 'My goals' (gm); dead then active; removed
  (A's queries NOT_FOUND, past journal for those who stay) then rejoined by a fresh code. Each step checked on the
  server with expect.poll.
- `tests/e2e/visual/D11-N8.spec.ts` (E2E_VISUAL=1): 1 passed, 8 shots.

## QUESTIONS

1. `pastJournals` lists every departed journal, also one with no page the caller can read (all Private, or all torn
   out by the GM), as 'N pages' = 0. Hide those? (Literal acceptance kept: "every departed journal".)
2. A player can open another present player's journal by URL (`?view=journal&journal=<id>`) and sees the pages they
   could read anyway ('players', 'everyone', chosen); only the GM gets the list (Q2). Fine?
