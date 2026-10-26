# TASK-F8-I3: Notes small fixes

Plan `.omc/plans/followups-8.yaml`, tracer I3. Beads dcm-bxp.81, .110, .113, .105. Status: Review (the orchestrator's
merge and wave e2e are still to run).

## dcm-bxp.81: the owner restores a page the GM tore out of a departed journal

The bead's proposal: "let the page owner restore pages torn out of their journal by someone else."

- `convex/lib/notes.ts` `pageAccess`: `canRestore` is N1's flag (whoever tore it out, while they can read it) or
  `binned && isOwner && !departed`. `permissionFor` already gives the owner a torn-out page, so no permission change.
- Not while the journal is still departed (character dead / retired, owner still a member): the journal is frozen (D2),
  the GM's tear-out stands and only the GM restores it. Once the journal is present again (rejoin, status back to
  'active') the owner restores it; the GM too as long as the GM still reads the page (an 'everyone' page), never once
  the page is hidden from the GM (a 'players' page).
- `convex/notesBin.ts` `bin`: the caller's own journals list every torn-out page (not only their own tear-outs);
  `canRestore` filters, so the owner of a still-departed journal sees nothing and the owner of a present one sees the
  GM's tear-out (`from: null`). `restorePage` is unchanged (it asserts `restore`). Doc tables updated.
- N1's `src/lib/domain/notes/actions.ts` `canRestore` (not owned by I3) still says "whoever binned it"; the server
  rule lives in `pageAccess`. No client code reads that domain flag.

Tests (`tests/convex/notes-bin.test.ts`): the 'dead character' scenario now ends with P1 seeing the page in their bin
and restoring it (page back with its visibility, counters right, P2 reads it again); new 'removed player who rejoins':
the GM tears out P1's 'everyone' page, P1 rejoins, both P1's and the GM's bins list it, P2 / P3 get
NOTE_PAGE_NOT_FOUND, outsider NOT_FOUND, anonymous UNAUTHENTICATED, P1 restores it, the GM's restore then answers
NOTE_NOT_BINNED. The role-table row 'restorePage (P1 tore it out)' is unchanged.

## dcm-bxp.110: the journal view shows the linked session's date

- `notesJournals.journalView`: each page carries `session?: { n, date? }` when it links a session the caller may see
  (D10 Q4, the rule `notes.journal` uses: any for the GM, live / played for a player; same campaign; a deleted session
  is left out). Each session is read once per view. The return validator is widened with an optional field.
- `src/components/notes/journals/index.tsx`: `pageMeta(page, selected.session ?? null)`, so a session log shows the
  session's date ('No date set' without one), an unlinked page its creation date.

Tests: `tests/convex/notes-journals.test.ts` 'journalView: the linked session's number and date' (GM sees planned too;
P1 in their own journal and P2 in the past journal see played only; deleted session gone);
`tests/unit/notes-journal-view.test.tsx` (meta for a dated, an undated and an unlinked page).

## dcm-bxp.113: entry row pitch

The board's `.bj-row { min-height: 34px; padding: 3px 6px }` is content-box (40 px rows, 41 px apart with the 1 px
gap); the app's preflight makes it border-box (36 px, 37 px apart). `src/components/notes/entries/entries.css`:
`.bj-rows .bj-row { min-height: 40px }` (the threads list, which also uses `.bj-row`, is not under `.bj-rows`).
`tests/e2e/visual/D11-N9.spec.ts` asserts a 41 px pitch for the first three rows at 1440.

## dcm-bxp.105: optimistic updaters moved

`src/components/notes/bin/optimistic.ts` -> `src/lib/optimistic/notes-bin.ts`,
`src/components/notes/threads/optimistic.ts` -> `src/lib/optimistic/notes-threads.ts` (git mv, imports and comments
only; no behaviour change).

## Evidence

Run in the worktree on 2026-10-23 (ports 3115 / 3342 from `pnpm worktree:setup`):

- `pnpm lint`: clean, no warnings. `pnpm typecheck`: clean.
- `pnpm vitest run --maxWorkers=4 --testTimeout=60000`: 287 files, 7720 passed, 1 expected fail.
- `pnpm tracer:guard .omc/plans/followups-8.yaml I3`: OK after the commit.
- `E2E_VISUAL=1 pnpm test:e2e tests/e2e/notes-*.spec.ts tests/e2e/live-notes.spec.ts tests/e2e/visual/D11-*.spec.ts`:
  37 passed, 2 failed: `visual/D11-N7` (the 'Torn-out pages' region is not found) and `visual/D11-N8` (the 'Players’
  journals' region is not found). Both fail the same way on the base commit cb31cfc with this diff stashed, so they
  predate I3; D11-N9 (with the new 41 px pitch assertion) passes.
- `tsconfig.json`: the e2e build (`.next-e2e-3115`) added its type paths; reverted (not owned by I3).
