# TASK-JOURNAL-JTh: Threads raised with 'In Notes'

Status: Review. Plan: `.omc/plans/journal.yaml`, tracer JTh (wave 3, batch B; depends on J1, JD6, JN). Bead:
`dcm-z9rz.18`. Design: `reference/designs/journal/journal_views.jpg`, panel 2 (Log & recap), right column, 'THREADS
RAISED'.

## What landed
- **`src/components/journal/threads/index.tsx`**: `ThreadsRaised` (J1's slot, same name and props). A `kind="label"`
  `Card` 'Threads raised' over `journalThreads.raised({ sessionId })` (JD6): the caller's open threads (open tasks and
  unresolved Fears) on their own Notes pages linked to the session, in the server's order (page, then entry). Each row:
  - the bullet glyph from `glyphFor` (task '•', Fear '☠'), decorative (`aria-hidden`); a screen-reader prefix 'Open
    task:' / 'Looming Fear:' says what it is. The bullet does not cycle here; that stays in Notes.
  - the text with `EntryText` (Notes' mentions: a Codex link for an entry the viewer can see, else the stored name).
  - 'In Notes' (`BrandButton` pill, sm, notebook icon; accessible name 'In Notes: <page title>'), which calls
    `onOpenPage(pageId)`. The page turns that into `?tab=notes&page=<pageId>` (J1's `navigate`, `view` cleared).
  - Loading: `role="status"` 'Loading threads…'. Empty: 'No threads raised on this session's pages.' (Q2).
  - Exports `THREADS_RAISED_COPY` and `threadKindLabel` for the tests.
- **`src/components/journal/threads/threads.css`** (`jrth-*`): the row grid (bullet, text, button), the Fear's violet
  glow on the dark card (BULLETS' Fear colour is ink for paper), gold mentions, the button at 40 px (44 px on tablets
  and coarse pointers, as `jr-ghost`).
- Players see the card too (J1's default): the server keeps it per viewer, so a player sees their own pages only.

## Tests
- `tests/unit/journal/threads.test.tsx` (7): query args, heading, glyphs and kinds in order, EntryText link (no raw
  token), 'In Notes' names and `onOpenPage(pageId)`, the player view, loading and empty states.
- `tests/e2e/journal-threads.spec.ts`:
  - GM: the session 6 page's open task and Fear show; a done task, a page with no session and the player's page do
    not; a task added by the server shows live; axe on the card and no sideways scroll at 1440x900 and 390x844;
    'In Notes' opens `?tab=notes&page=<id>` with the Notes tab selected and the page's line on the paper.
  - Player: only their own page's task; axe; 'In Notes' opens their page.
  - Empty state on Session 5.
  - `@visual` (E2E_VISUAL=1): gm-threads, player-threads, gm-empty at 1440 / 390, gm-log-columns at 1440.

## Design states matched (shots)
`test-results/visual/JOURNAL-JTh/{gm-threads,player-threads,gm-empty}-{1440,390}.png` and `gm-log-columns-1440.png`,
copied to `C:\Users\Petar\Downloads\dcm-screens\journal-jth\`. Compare with panel 2's right column ('THREADS RAISED'
under Spotlight). Matches: the small-caps label card, one row per thread with its bullet and text, 'In Notes' on the
right. Differs: 'In Notes' is a brand pill button (the brief asks for the existing brand buttons; the design draws a
small underlined gold link), so rows are taller.

## Data gaps
None: JD6 returns everything the row needs.

## Out-of-owns edits
None.

## Found, not fixed (not in owns)
- **JR contrast.** The empty recap line ('No recap yet. Anyone at the table can write it.', `.jrr-text.jrr-empty`,
  `--jr-paper-muted` #8a6d3b on the parchment) fails axe color-contrast (serious) on Log & recap. My spec scans only
  its card (`include: ".jrth"`) for that reason. Fix in `src/components/journal/recap/recap.css` (a darker muted ink,
  e.g. #6f5630), then the spec can scan the whole page.

## Questions (default taken)
1. **Players see Threads raised** (J1's default, not yet confirmed): kept; a player sees the threads on their own pages
   linked to the session.
2. **Bullet click** in the card: not a control (read only); cycling stays in Notes, so the card needs no optimistic
   update of `journalThreads.raised`.
3. **'In Notes' style**: a brand pill button rather than the design's text link (brief: existing brand buttons).

## Merge-time actions
None: no Convex file changed.

## Checks
- `pnpm lint`: clean. `pnpm typecheck`: clean.
- vitest full (`--maxWorkers=1 --testTimeout=120000`): 515 files, 10969 passed, 1 expected fail.
- `E2E_VISUAL=1 E2E_PORT=3809 E2E_CONVEX_PORT=3909 pnpm test:e2e tests/e2e/journal-threads.spec.ts --workers=1`:
  4 passed. An earlier run, beside the full vitest suite (load ~17), failed on a seed mutation with Convex's "Function
  execution timed out (1s)"; it passed on rerun.
- `node scripts/tracer-guard.mjs .omc/plans/journal.yaml JTh`: OK.
