# TASK-JOURNAL-JS: All sessions list, '+ Plan session N', Campaign so far, session heading

Status: Review. Plan: `.omc/plans/journal.yaml`, tracer JS (wave 3, batch A; depends on J1, JD5). Bead: `dcm-z9rz.12`.
Briefs and user answers: `.omc/plans/journal-briefs.md`. Design: `reference/designs/journal/journal_views.jpg`, panel 1
(left column and session heading; panel 2 has the same).

## What landed
- `src/components/journal/session-list/index.tsx` (the J1 stubs filled; names and props unchanged):
  - `useSessionList`: `sessionRecords.list`, as before.
  - `SessionList`: one button per session, newest first. Each shows:
    - a number badge (gold serif)
    - the title ('Untitled session' when blank, cut off with an ellipsis)
    - the short date, 'Sun 2 Nov' with no year; the full date is in the tooltip
    - a chip: Planned (gold) or Live (green dot). A played session has no chip, as in the design.

    The selected session has `aria-current` and a gold ring. Spoken name: 'Session 7: The chapel in the briar,
    Sun 9 Nov, Planned'. Players get live and played sessions only; the server filters them (Q5). Empty states
    differ for the GM and for players.
  - `PlanSessionButton` (GM only): '+ Plan session N', where N is the highest number + 1.
    - It calls `sessionRecords.create` through `useIntent`, so each click gets a fresh idempotency key and the button
      is disabled while the call runs.
    - Then `onCreated` runs, and the page opens the new session on Plan.
    - It is the brand `outline` button with a dashed border. An error shows as an alert.
  - `CampaignSoFar` (everyone): 'Sessions played', 'Hours at the table', 'Party level' and 'Open threads'.
    - The first three come from `sessionRecords.summary` (JD5). Hours are rounded to whole hours.
    - 'Open threads' is the length of `notesThreads.threads`, the caller's own threads (Q1).
- `src/components/journal/session-list/format.ts`: the pure helpers `shortSessionDate`, `startTime`, `headingLine`,
  `nextSessionNumber`, `wholeHours`, plus `patchListed`, the optimistic patch of the cached list.
- `src/components/journal/session-head/index.tsx`: `SessionHeading`.
  - The top line reads 'Session 6 · Sun 2 Nov · 19:10'. The time is the start time; only the GM's list carries
    `startedAt`, so players see no time.
  - Below it: the title as a serif h2, and a status chip (Live, Planned or Played).
  - GM (Q11 default):
    - Clicking the title or the date turns it into an input with focus.
      - Enter or blur saves; Escape cancels.
      - An unchanged value sends nothing; an empty date clears it.
      - `setTitle` and `setDate` are optimistic on the cached list, like the old header card.
    - A '⋯' menu ('Session menu') holds 'Mark as played' / 'Mark as not played' and 'Delete session'.
      - Delete asks twice: the button changes to 'Click again to delete'.
      - Closing the menu with Escape or a click outside cancels a pending delete.
      - Both actions are disabled while the session is live, with the note 'End the session first…'.
      - Mark as played is optimistic. After a delete, `onDeleted` runs and the page drops `?s`.
  - Players: the heading is read only.
  - A bad, deleted or (for a player) planned id shows 'That session isn't …', not an error.
- CSS: `session-list/session-list.css` and `session-head/session-head.css` use the `--jr-*` tokens. Targets are
  44 px on tablets and coarse pointers. Motion follows the page's reduced-motion rule.

## Tests
- `tests/unit/journal/session-list.test.tsx` (17 tests):
  - the format helpers
  - the list's names, chips, current row, select, and its loading and empty states
  - Plan session (the next number, the create call, `onCreated`; nothing for players)
  - Campaign so far, including its loading state
  - the heading: rename (Enter, Escape, unchanged), date change and clear, the menu (mark played and not played,
    delete twice, Escape cancels, error alert), the live session disabled, the player read only, an unknown id,
    loading
- `tests/e2e/journal-sessions.spec.ts`:
  - GM: the list order and chips, Campaign so far, the live heading with its disabled menu. Then plan session 8,
    rename it, check that Escape cancels, set the date, reload, mark it played and not played (the played count
    follows), and delete it twice (back to the live session).
  - Player: 5 sessions, no planned one, no Plan button, a read-only heading, selecting session 5.
  - Axe and no sideways scroll at 1440x900 and 390x844.
- `tests/e2e/visual/JOURNAL-JS.spec.ts` (`E2E_VISUAL=1`) takes these shots:
  - GM: the band, the list and the heading at 1440 and 390
  - the menu on the live and on a planned session
  - a rename in progress
  - the player's band

## Design states matched (shots)
- Shots are in `test-results/visual/JOURNAL-JS/` and copied to `C:\Users\Petar\Downloads\dcm-screens\journal-js\`.
- Compare them with the design crop of panel 1:
  - the left column: x 0-250, y 90-614 of `journal_views.jpg`
  - the heading: x 240-733, y 90-210
- Matched:
  - 'ALL SESSIONS' label; rows with a number badge, bold title, muted date, and a Planned / Live chip on the right
  - the ringed live row
  - the dashed '+ Plan session 8'
  - the 'CAMPAIGN SO FAR' card with four right-aligned numbers
  - the heading line 'Session 6 · <date> · <time>', the serif title and the green Live chip
- Differences:
  - The design's dates have no comma ('Sun 2 Nov'). The app formats them in the runtime locale, as every other
    session date does, so en-US shows 'Sun, Nov 2'.
  - The '⋯' menu is not in the design (Q11 default).
  - The seed's hours are about 0. Sessions 2-5 are marked played by hand, so they have no live time.

## Data gaps
- Players get no `startedAt` from `sessionRecords.list`, so their heading has no time.
- Hours do not tick while a session is live. The panel shows `hoursAtTable` as the query last returned it; JD5 allows
  adding `Date.now() - asOf`, but doing that in render is impure and a timer is not worth it for whole hours.

## Questions (defaults taken)
1. Loading states: the page already shows 'Loading sessions…' (`role="status"`) in the session area. The list's own
   loading line and the Campaign so far placeholders ('…' with `aria-busy`) are not a second live region. The J1 shell
   test also expects one status line. Default: no second status.
2. Played sessions show no chip in the list, as in the design. The heading shows a 'Played' chip, so the GM can see
   the state the menu toggles.
3. Date edit: a native date input that replaces the date text. It saves on Enter or blur, not on every change, so a
   half-typed date is never sent.
4. '+ Plan session N' shows the server's next number, the highest existing number + 1 (`insertSession`). Deleting the
   newest session therefore frees its number again; gaps lower down are kept. The label follows the server's rule.

## Out-of-owns edits
None.

## Merge-time actions
None: no Convex file changed.

## Checks
- `pnpm lint` (the changed files) and `pnpm typecheck`: clean.
- `vitest run --maxWorkers=1 --testTimeout=120000`: 509 files, 10904 passed, 1 expected fail.
- `E2E_PORT=3785 E2E_CONVEX_PORT=3885 E2E_REUSE_SERVERS=1 playwright test tests/e2e/journal-sessions.spec.ts
  --workers=1`: 2 passed.
- With `E2E_VISUAL=1`: `tests/e2e/visual/JOURNAL-JS.spec.ts` passed, and `tests/e2e/journal-shell.spec.ts` passed
  (3 tests) when run alone.
  - In one run together with the other specs, the shell spec's `toHaveTitle` check timed out once. The machine was
    loaded and J1's assertion has a 5 s limit, so this looks like a flake.
- `node scripts/tracer-guard.mjs .omc/plans/journal.yaml JS`: OK.
