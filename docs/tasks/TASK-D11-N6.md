# TASK-D11-N6: Sharing

Plan `.omc/plans/d11-notes.yaml`, tracer N6 (wave 3, depends on N2 and N3). Bead dcm-bxp.10. Status: Review (the
orchestrator's merge and wave e2e are still to run).

Title: Sharing - per-page visibility for GM and players, chosen recipients (one table for both), the Shared tabs,
read-only shared pages with the add row.

## Rules implemented (quoted from the plan)

- A3: "A player's page is private, shared with the other players only (hidden from the GM), or shared with everyone."
- A4: "The GM reads players' pages by default; per page a player can hide it from the GM or show it to players only. The
  owner always sees their page. The GM's pages are private by default and can be shared into 'Shared by GM'.
  Server-enforced."
- A5: "The GM can share a page with chosen players (one or more) besides everyone; only they see it in 'Shared by GM'.
  Recipients are their own indexed table (journalPageRecipients), never an array in the page (rule 6)."
- Q1: "Sharing is set per page (a page with its entries)."
- Q2: "The GM sees players' pages everywhere: in 'Shared by players' and by opening any player's journal, unless hidden
  from the GM." (N6 covers 'Shared by players'; the journal view is N8.)
- Q4: "Players can also share a page with chosen players, using the same recipients table as the GM."
- Q12 / D1: departed journals: "pages marked Private (hidden from everyone) stay private after departure"; every other
  value reads as everyone; "a departed player who rejoins gets their pages' previous visibility back". Departed pages
  are left out of the Shared tabs (they belong to Past journals, N8).
- Q14: "The sharing chip alone tells the owner who can read a page."
- D2: "A departed journal is frozen" (no visibility or recipient change: NOTE_JOURNAL_CLOSED).
- D4: "A player's 'chosen' page is hidden from the GM unless the player ticks the GM in the recipient picker."

## What landed

### convex/notesSharing.ts (all `campaignQuery` / `campaignMutation`, `need: "view"`)

Access goes only through N0's `resolvePage` / `findPage` / `assertAction` (pageAccess -> permissionFor, resource
`journalPage`, which applies N1's `canReadPage`). Every Shared row is checked with `permissionFor`; no second visibility
rule exists. Recipients are validated as campaign members (a `campaignMembers` row, or the GM on a player's page).

| Function | Args | Returns | Who |
|---|---|---|---|
| `setVisibility` | page ref, visibility | null | owner, journal present; N1 `isAllowedVisibility` else NOTE_VISIBILITY_INVALID; leaving 'chosen' deletes the recipient rows in the same mutation |
| `addRecipient` | page ref, userId | null | owner of a 'chosen' page; a member other than the owner (players for a GM page; the GM or other players for a player page, D4), else NOTE_RECIPIENT_INVALID; one row per (page, user), twice is a no-op |
| `removeRecipient` | page ref, userId | null | owner of a 'chosen' page; an unticked user is a no-op (any ticked user can be removed, also one who left) |
| `recipients` | page ref | `[{ userId, name, isGm, chosen }]` | owner (readers NOTE_FORBIDDEN_ACTION); GM first on a player's page; template ref before the journal: nobody chosen |
| `shared` | tab 'players' / 'gm' | `[{ pageId, title, kind, tape, createdAt, ownerName, ownerIsGm, own, visibility, chip }]` | every member; grant-only users NOT_FOUND |

`shared` reads: the caller's recipient rows (`journalPageRecipients.by_campaign_user`), and for 'players' the
`by_campaign_visibility_binned` ranges ('players' + 'everyone' for a player, 'gm' + 'everyone' for the GM), for 'gm'
the GM journal's live pages (`by_journal_binned`); all bounded `take`s (200 / MAX_PAGES). Own pages, torn-out pages and
departed journals are left out ('gm' tab: the GM gets their own 'everyone' / 'chosen' pages, chips naming recipients).
Sorted by owner name, then creation (the UI groups by owner).

### Role table (tests/convex/notes-sharing.test.ts; fixture: p1's page and the GM's page, both 'chosen' for p2)

| Function | anonymous | outsider | owner | GM (not owner) | chosen p2 | not chosen p3 |
|---|---|---|---|---|---|---|
| setVisibility (player page) | UNAUTHENTICATED | NOT_FOUND | ok | NOTE_PAGE_NOT_FOUND | NOTE_FORBIDDEN_ACTION | NOTE_PAGE_NOT_FOUND |
| setVisibility (GM page) | UNAUTHENTICATED | NOT_FOUND | ok (GM) | - | NOTE_FORBIDDEN_ACTION | NOTE_PAGE_NOT_FOUND (p1 too) |
| addRecipient (player / GM page) | UNAUTHENTICATED | NOT_FOUND | ok | NOTE_PAGE_NOT_FOUND | NOTE_FORBIDDEN_ACTION | NOTE_PAGE_NOT_FOUND |
| removeRecipient (player / GM page) | UNAUTHENTICATED | NOT_FOUND | ok | NOTE_PAGE_NOT_FOUND | NOTE_FORBIDDEN_ACTION | NOTE_PAGE_NOT_FOUND |
| recipients (player / GM page) | UNAUTHENTICATED | NOT_FOUND | ok | NOTE_PAGE_NOT_FOUND | NOTE_FORBIDDEN_ACTION | NOTE_PAGE_NOT_FOUND |
| shared (either tab) | UNAUTHENTICATED | NOT_FOUND | ok | ok | ok | ok |

Read matrix (same file, written by hand; checked on `notesEntries.entries` and on the Shared tab membership):

| Owner | Visibility | GM | p1 (owner) | p2 (chosen) | p3 | outsider / anon |
|---|---|---|---|---|---|---|
| p1 | gm | ok | ok | NF | NF | NOT_FOUND / UNAUTHENTICATED |
| p1 | private | NF | ok | NF | NF | same |
| p1 | players | NF | ok | ok | ok | same |
| p1 | everyone | ok | ok | ok | ok | same |
| p1 | chosen [p2] | NF | ok | ok | NF | same |
| p1 | chosen [p2, GM] | ok | ok | ok | NF | same |
| p1 | chosen [nobody] | NF | ok | NF | NF | same |
| GM | private | ok | NF | NF | NF | same |
| GM | everyone | ok | ok | ok | ok | same |
| GM | chosen [p2] | ok | NF | ok | NF | same |
| GM | chosen [p1, p2] | ok | ok | ok | NF | same |

NF = NOTE_PAGE_NOT_FOUND. Departed (D1, Q12): character dead or retired: every page but Private reads for every member,
Private owner-only, nothing in the Shared tabs, writes NOTE_JOURNAL_CLOSED, status back to 'active' restores the table;
'away' is not a departure. Player leaves or is removed: same for the others, the former owner gets NOT_FOUND; a rejoin
restores the visibility and the Shared tabs.

### UI

- `src/components/notes/sharing/`: `SharingChip` in N2's page toolbar ('Sharing: <label>', a chosen page names its
  readers, Q14) opening 'Share this page' (native `<dialog>` via `Modal`): the allowed options as radios with a hint
  each, and for 'Chosen players' one checkbox per eligible member. Optimistic: `src/lib/optimistic/notes-sharing.ts`
  (`notes.journal` visibility, `notesSharing.recipients` flags).
- `src/components/notes/shared/`: `SharedSection` (ARIA tabs 'Shared by players' / 'Shared by GM', rows with tape tab,
  title, owner group or chip, 'Nothing shared yet.'); `SharedPageView` ('<owner>’s page · read only' above the paper,
  tape, title, meta, sharing label, then N3's `Entries` with the reader's flags and the add row). A page that stops being
  shared shows 'This page isn't shared with you.' at once.

## Visual check (judged against the board's tokens; not on the board)

Shots: `test-results/visual/D11-N6/` (`dialog-gm`, `dialog-player`, `shared-players-gm`, `shared-gm-gm`,
`shared-gm-player`, `shared-page-gm`, `shared-page-player`, each -1440 and -390).

| Region | Verdict |
|---|---|
| Sharing dialog (GM, player) | Pass: card `--bj-card`, field `--bj-field`, accent border and radios on the chosen option, Cinzel heading, 44 px rows |
| Shared tabs | Pass: `bj-tabs`, rows like the index page buttons (tape tab, title, muted second line), owner groups |
| Shared page | Pass: paper, tape, Caveat title, chip, entries with the added colour; no horizontal scroll at 390 |

Deviations: the shared page repeats the title under the tape (as N2's own page does with its title input); the chip
on the shared page is a static label, not a button.

## Evidence

- `npx vitest run tests/convex/notes-sharing.test.ts`: 26 passed. Full `vitest run --maxWorkers=4`: 175 files, 2347
  tests passed.
- `pnpm lint`, `pnpm typecheck`: clean.
- `tests/e2e/notes-sharing.spec.ts` (GM + players A and B, three browsers, at 1440 and 390): 2 passed.
- `tests/e2e/visual/D11-N6.spec.ts` (E2E_VISUAL=1): 1 passed, 14 shots.

## Deviations and questions

- Player B in the e2e specs is `e2e-password@example.test` (the e2e allowlist in scripts/e2e-setup.mjs has only two
  non-GM accounts; notes-shell.spec.ts already signs it in by the test form). A dedicated `e2e-player-b@example.test`
  needs a one-line change to scripts/e2e-setup.mjs (outside N6's owns).
- `removeRecipient` does not require the user to still be a member, so the owner can untick someone who left (otherwise
  a rejoin would silently restore their access).
- Recipient and owner names: a player's newest live character name, else their account name (N1 `authorLabel`); the
  GM is 'GM' in the picker and 'Game Master' as an owner.
