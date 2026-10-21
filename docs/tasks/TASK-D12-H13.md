# TASK-D12-H13: Authz matrix - notes (notes, notesBin, notesEntries, notesJournals, notesSharing, notesThreads)

Plan `.omc/plans/d12-hardening.yaml`, tracer H13 (depends on H0). Harness API: `docs/tasks/TASK-D12-H0.md`. Bead
dcm-bxp.100 (fold the notes role tables into the matrix).

## What landed

| File | Change |
|---|---|
| `tests/convex/authz/notes.entries.ts` | 27 entries (5 notes, 3 notesBin, 8 notesEntries, 3 notesJournals, 5 notesSharing, 3 notesThreads); `pending` is empty. |
| `tests/convex/authz/notes.test.ts` | Unchanged (`runMatrix(area)`). |

## Access (read from the code)

All 27 are campaign wrappers with `need: "view"`, so the class is `view` (anon UNAUTHENTICATED, outsider NOT_FOUND
by the wrapper). Past the wrapper, `pageAccess` (convex/lib/notes.ts, permissionFor on the `journalPage` resource)
decides, and it answers NOTE_* codes: NOTE_PAGE_NOT_FOUND for a page the caller cannot read (NOTE_ENTRY_NOT_FOUND for
an entry on one), NOTE_FORBIDDEN_ACTION for a reader trying an owner's or author's action.

`Outcome` in harness.ts names only the generic codes. The harness compares any other expected outcome to
`ConvexError.data.code` verbatim, so the entries file states the NOTE_* refusals through a typed helper
(`note("NOTE_PAGE_NOT_FOUND")`, a cast to `Outcome`). H24 or a later harness change could widen `Outcome` to
`string` codes and drop the cast.

## World

Area setup on every world: playerA's first write creates their journal (`notes.createPage`, a session log), the page
is shared with `players` and gets one open task by playerA. Synthesis picks that page, entry and journal
(`w.use`); `nameHints.sessionId → null` (setSession unlinks; the world has no session). Entry setups: the sharing
writes put the page on `chosen` with playerB ticked; `restorePage` tears the page out (as playerA) first.

## Rows

| Functions | player (owner) | otherPlayer | grantee | gm |
|---|---|---|---|---|
| `notes:journal`, `createPage`; `notesBin:bin`; `notesJournals:pastJournals`; `notesSharing:shared`; `notesThreads:threads`, `search`, `exportPage` (own journal) | ok | ok | ok | ok |
| `notesEntries:entries`, `add` (readers read and add, Q3) | ok | ok | ok | NOTE_PAGE_NOT_FOUND |
| `notes:renamePage`, `cycleTape`, `setSession`; `notesBin:binPage`; `notesEntries:migrateOpen`; `notesSharing:setVisibility` | ok | NOTE_FORBIDDEN_ACTION | NOTE_FORBIDDEN_ACTION | NOTE_PAGE_NOT_FOUND |
| `notesEntries:setText`, `cycle`, `toggleStar`, `moveUp`, `remove` | ok | NOTE_FORBIDDEN_ACTION | NOTE_FORBIDDEN_ACTION | NOTE_ENTRY_NOT_FOUND |
| `notesSharing:recipients` | ok | NOTE_FORBIDDEN_ACTION | NOTE_FORBIDDEN_ACTION | NOTE_PAGE_NOT_FOUND |
| `notesSharing:addRecipient`, `removeRecipient` (chosen page, playerB ticked) | ok | NOTE_FORBIDDEN_ACTION | NOTE_PAGE_NOT_FOUND | NOTE_PAGE_NOT_FOUND |
| `notesBin:restorePage` (torn out by playerA) | ok | NOTE_PAGE_NOT_FOUND | NOTE_PAGE_NOT_FOUND | NOTE_PAGE_NOT_FOUND |
| `notesJournals:playerJournals` | empty | empty | (not run) | ok |
| `notesJournals:journalView` (playerA's journal) | ok | ok | ok | ok (without the `players` page) |

Every row also has anon UNAUTHENTICATED and outsider NOT_FOUND.

What these rows prove: the GM is not the owner of a player's page and reads it only when its visibility lets them (a
`players` page answers NOTE_PAGE_NOT_FOUND to the GM); the grantee's `edit` grant on the campaign gives nothing in
the notes (journal pages take no grants), so the grantee gets what the other player gets; a torn-out page is only
the binner's. The full visibility matrix (gm / private / players / everyone / chosen, departed journals, the bin, the
GM's tear-out of a departed page) stays in the notes feature tests (`tests/convex/notes-*.test.ts`), as the plan
asks.

## Known bugs

None found: every access row matched the documented code on the first run (the one first-run failure was the
synthesizer looking for a `sessions` row for `setSession`, fixed with the name hint).

## Checks

- `pnpm vitest run tests/convex/authz/notes.test.ts tests/convex/authz-matrix.test.ts --maxWorkers=4 --testTimeout=60000`:
  170 passed (notes 161 rows, guard 9).
- Area runtime: `notes.test.ts` alone 12.3 s of tests (18.3 s wall with module loading) at load average about 28.
- `pnpm typecheck` clean; `pnpm exec eslint` on both files clean.
- `pnpm tracer:guard .omc/plans/d12-hardening.yaml H13`: passes.
