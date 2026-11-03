# TASK-JOURNAL-JH: Journal header actions

Status: Review. Plan: `.omc/plans/journal.yaml`, tracer JH (wave 2, batch B, depends on J1). Bead: `dcm-z9rz.10`.
Briefs and user answers: `.omc/plans/journal-briefs.md`. Design: `reference/designs/journal/journal_views.jpg`
(header right of each panel).

## Goal
The Journal header's right side: the live-session chip with End / Start, the tome button and 'Open threads N'.

## What landed
- `src/components/journal/header/index.tsx` fills J1's `JournalHeaderActions` stub (same name and props):
  - **Live chip** (green dot, 'Session N · live'; a session running from before the Sessions board reads 'Session ·
    live'). GM: an 'End session' pill inside the chip opens the End dialog (`endDialogText`, `WitherChoiceField`,
    the extras sentence) and runs `sessions.end` with the Wither choice. GM: a '⋯' 'Session options' button
    (disclosure, Escape and an outside click close it) holds the 'Allow extra characters this session' switch
    (`sessions.allowExtraCharacters`, the same optimistic update as the old Live card; Q10 default). Players: the
    chip only, no buttons.
  - **Nothing live (GM)**: 'Start session N' (brand `pill` button). Target: the selected session when it is planned,
    else the newest planned; with none, the server creates the next one (`sessions.start` without `sessionId`;
    N = highest + 1, and the dialog says so). After the Start the page opens that session's Log & recap
    (`onOpenSession(id, "log")`). Players see nothing here.
  - **Report**: the Start report (`startReportLines`) and the End report (`endReportLines`, the Doom Track line and
    link on Journey to Horizon) in a polite `role="status"` under the actions, with a 'Dismiss' button.
  - **Tome** (everyone): a round gold-ringed button, 'Open the Campaign Tome', `useOpenTome()("overview")`, as the
    dashboard's 'Open the Tome'.
  - **Open threads N** (everyone, Q1): the violet pill with a spool icon and the count of `notesThreads.threads`
    (the caller's open tasks and unresolved Fear); it switches to `?tab=notes&view=threads` (`onNotesView`).
  - The live control and Open threads each sit in their own `SlotBoundary`; loading lines use `role="status"`.
- `src/components/journal/header/header.css`: the `jh-*` styles (44 px targets, focus rings, the phone layout
  left-aligned under the title). Motion: none of its own (J1's reduced-motion rule covers the page).
- The helpers are imported from `src/components/sessions/live` (`endReportLines`, `startReportLines`,
  `useWitherChoice`, `WitherChoiceField`, `endDialogText`), not copied; JX2 moves them.

## Out-of-owns edit
- `src/components/sessions/live/index.tsx`: `startReportLines` gained `export` (one word) so JH can import it instead
  of copying it. The orchestrator agreed.

## Tests
- `tests/unit/journal/header.test.tsx`: the start target and number; GM live (chip, End dialog with the Wither choice,
  `sessions.end` args, report and Dismiss); the extras switch in the menu (Q10) and Escape; GM idle (selected planned,
  newest planned when the selected one was played, no planned session -> no `sessionId`, opens Log & recap); players
  (read-only chip, no Start); the tome; Open threads; the loading lines.
- `tests/e2e/journal-header.spec.ts`: player (read-only chip, tome dialog, Open threads -> Notes threads view) and GM
  (extras switch, End with the Wither box unticked, report, 'Start session 7' -> Log & recap of session 7, Dismiss),
  axe and no sideways scroll at 1440x900 and 390x844.
- `tests/e2e/visual/JOURNAL-JH.spec.ts` (`E2E_VISUAL=1`): the shots below.

## Design states matched (shots)
Shots: `test-results/visual/JOURNAL-JH/`, copied to `C:\Users\Petar\Downloads\dcm-screens\journal-jh\`:
`gm-live-{1440,390}`, `gm-menu-1440`, `end-dialog-1440`, `player-live-{1440,390}`, `gm-ended-report-{1440,390}`,
`gm-idle-{1440,390}`. Compare `gm-live-1440` with the design's header crop (panel 1, top right): dark pill with the
green dot, 'Session 6 · live' and the inner 'End session' pill, the round gold-ringed tome, the violet 'Open threads'
pill with its lilac count. Differences: the GM's '⋯' menu button inside the chip (Q10, not on the board) and the
spool icon (the board's glyph is too small to read).

## Data gaps
None: every number comes from existing queries (`sessionRecords.list`, `sessions.current`, `notesThreads.threads`).

## Questions (default taken)
1. Q10 (unconfirmed default): 'Allow extra characters this session' sits in a '⋯' menu on the live chip.
2. Open threads count = `notesThreads.threads` length for the caller (Q1 answer). JD6's `journalThreads` is the
   session's 'Threads raised' (JTh), not this count, so JH does not wait for it.
3. After End the page stays on the session that ended (the board shows no rule); the report stays until dismissed or
   the next Start / End. Default: keep it so.
4. Start on a played session is not offered from the header (the target is always planned); re-starting a played
   session stays a later Sessions feature (old Live card until JX2). Default: planned only, as the acceptance says.

## Merge-time actions
None: no Convex file changed, no codegen needed. Accept the one-word export in `sessions/live/index.tsx`.

## Checks
- `pnpm lint`: clean. `pnpm typecheck`: clean.
- `vitest run --maxWorkers=1 --testTimeout=120000`: 497 files, 10762 passed, 1 expected fail.
- `E2E_VISUAL=1 E2E_PORT=3777 E2E_CONVEX_PORT=3877 E2E_REUSE_SERVERS=1 pnpm exec playwright test
  tests/e2e/journal-header.spec.ts tests/e2e/visual/JOURNAL-JH.spec.ts --workers=1`: 3 passed (servers started by
  hand; the managed build timed out at 240 s on the loaded host). While the full vitest suite ran beside it, the
  seed's sign-in once missed its 5 s wait (`tests/e2e/live.ts`); a quiet rerun passed.
- `node scripts/tracer-guard.mjs .omc/plans/journal.yaml JH`: flags only `src/components/sessions/live/index.tsx`
  (the agreed one-word export).
