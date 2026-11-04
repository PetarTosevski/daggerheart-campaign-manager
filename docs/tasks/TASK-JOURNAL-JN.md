# TASK-JOURNAL-JN: Notes sub-tab

Status: Review. Plan: `.omc/plans/journal.yaml`, tracer JN (wave 2, batch B, depends on J1). Bead: `dcm-z9rz.11`.
Briefs and user answers: `.omc/plans/journal-briefs.md`. Design: `reference/designs/journal/journal_views.jpg`, panel 3
(Notes).

## Goal
The Journal's Notes sub-tab shows the existing Notes UI without its own hero. The old `/notes` page renders the same
body and keeps working (mode add: JX1 / JX2 switch the nav and delete the old route).

## What landed
- **`src/components/notes/notes-body.tsx`**: `NotesBody`, moved out of `notes/page.tsx` with no change in behaviour.
  Also moved: `SlotBoundary`, `PaperColumn`, the Caveat font (`notesFontClass`) and the URL state (`?view`, `?page`,
  `?journal`; every other param, such as the Journal's `?tab` / `?s` / `?sv`, is kept). Prop `chrome`:
  - `'page'` (needs `campaignName`): today's hero (campaign line, '<who>’s Journal', Open threads, Download).
  - `'journal'`: no hero, because the Journal header holds the H1 and Open threads (JH). 'Download my journal' sits
    at the bottom of the index column, under Quick keys.
- **`src/components/notes/notes.css`**: moved from the route; `NotesBody` imports it. Added rules:
  - `.bj-root[data-chrome="journal"]`: transparent, so the Journal band paints the background; no min-height.
  - `.bj-main[data-chrome="journal"]`: 26 px top padding, like the Sessions columns.
  - `.bj-index-download`.
- **`notes/page.tsx`**: the shell only (root div with the font class, title, boundary, Suspense,
  `<NotesBody chrome="page" …/>`).
- **`notes/notes.css`**: a one-line `@import` shim of the moved file. It stays because `notes/error.tsx` (not in owns)
  imports `./notes.css`.
- **`src/components/journal/notes-tab/index.tsx`**: `NotesTab` renders
  `<div class="bj-root {font}" data-chrome="journal"><NotesBody chrome="journal"/></div>`. The page's SlotBoundary
  and Suspense wrap it.
- Quick keys are unchanged (Q13 default). Writing-as chips and group names are left to JN2.

## Tests
- `tests/e2e/journal-notes.spec.ts` (seed: `tests/e2e/journal/helpers.ts`), two tests:
  - GM:
    - the tab has a single H1 'Journal', no notes hero and no hero threads button;
    - the index column, Quick keys text and 'Download my journal' show;
    - the `--font-caveat` variable is set;
    - `?page=` survives a reload;
    - add a task and cycle it to done;
    - @mention a Codex NPC with the picker (link to `/codex?entry=`);
    - the threads view at `?tab=notes&view=threads` lists the open mention task;
    - back to the page from the index keeps `tab=notes`;
    - '🔗 Session' links the page to Session 5 (meta and server checked);
    - `?view=journal&journal=…` works and a bad view falls back;
    - axe and no sideways scroll at 1440x900 and 390x844.
  - Player:
    - the same chrome, without 'Players’ journals';
    - axe at both sizes;
    - the 390 px 'Pages' disclosure.
- `tests/e2e/visual/JOURNAL-JN.spec.ts` (`@visual`): writes the design's lines on the GM's Session 1 page and shoots
  gm-notes, gm-threads and player-notes at 1440 and 390.

## Design states matched (shots)
`test-results/visual/JOURNAL-JN/{gm-notes,gm-threads,player-notes}-{1440,390}.png`, copied to
`C:\Users\Petar\Downloads\dcm-screens\journal-jn\` with the design crop `design-notes-panel.png` (panel 3).

Matches the design:
- Journal header and sub-tabs (Notes selected) over the band;
- search, page groups with the + buttons, Quick keys card;
- the parchment page with the washi tape, the bullets (task, event, note, idea, Fear in violet), the @mention
  highlight and the 'Write a new line' input;
- Migrate open tasks on the page.

Differs (as planned):
- no Writing-as chips (JN2, Q12);
- groups and Quick keys keep today's names (Q13 default, JN2);
- the extra Shared / journals / torn-out sections, the page toolbar (Tape, Session, Private, Tear out) and the key
  legend are today's Notes UI;
- the page meta reads 'session log · Nov 2, 2025' rather than 'Linked to Session 6 · written by the GM'.

## Out-of-owns edits (orchestrator approved)
- `tests/unit/journal/j1-shell.test.tsx`: one `vi.mock("@/components/journal/notes-tab", () => ({ NotesTab: () => null }))`.
  The real `NotesTab` imports `next/font/google`, which does not load under jsdom, so the J1 shell test file failed at
  import. The test treats the sub-tab as a stub slot.
- `src/app/(gm)/campaigns/[campaignId]/notes/notes.css` is in owns, but it stays as an `@import` shim for
  `notes/error.tsx`. **JX2 should delete the shim** together with the old route.

## Questions (default taken)
1. The acceptance asks the e2e test to open the threads view "from the Journal header's button". That button is JH's
   and is built in parallel, so it is not on this branch. The spec opens `?tab=notes&view=threads`, which is the URL
   that button's `onNotesView('threads')` produces. Default: after JH merges, JX1 or JH replaces the `goto` with a
   click.
2. Where 'Download my journal' goes in the journal chrome: the design does not show it. Default: the bottom of the
   index column, under Quick keys, with the existing button and label unchanged.

## Merge-time actions
None: no Convex file changed.

## Checks
- `pnpm lint`: clean. `pnpm typecheck`: clean.
- vitest full (`--maxWorkers=1 --testTimeout=120000`): 496 files, 10739 passed, 1 expected fail.
- `E2E_VISUAL=1 E2E_PORT=3781 E2E_CONVEX_PORT=3881 E2E_REUSE_SERVERS=1 pnpm exec playwright test tests/e2e/journal-notes.spec.ts tests/e2e/visual/JOURNAL-JN.spec.ts --workers=1`:
  3 passed.
- Existing `tests/e2e/notes-*.spec.ts`, `live-notes.spec.ts`, `journal-shell.spec.ts` on the same servers: all 32
  pass. The first run had 4 failures, all from load (load average about 21): sign-in timeouts, a Convex "Function
  execution timed out (1s)", and the J1 title check. They passed on rerun.
- `node scripts/tracer-guard.mjs .omc/plans/journal.yaml JN`: OK, except the approved
  `tests/unit/journal/j1-shell.test.tsx`.
