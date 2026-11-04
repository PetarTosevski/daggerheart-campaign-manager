# TASK-JOURNAL-JN2: Notes sub-tab, 'Writing as' chips and page groups

Status: Review. Plan: `.omc/plans/journal.yaml`, tracer JN2 (wave 3, batch B, depends on JN). Bead: `dcm-z9rz.19`.
Briefs and user answers: `.omc/plans/journal-briefs.md`. Design: `reference/designs/journal/journal_views.jpg`, panel 3
(Notes).

## Goal
The GM switches between their own journal and each PC's journal with 'Writing as' chips. A player sees only their own
chip. The page groups keep the labels the user picks (Q13).

## How Notes authorship works (checked before building)
- An entry's author is always the caller (`notesEntries.add`: `authorId = ctx.user`, plus `authorCharacterId` for a
  player with a character). Nobody can write as somebody else: the GM cannot write as an NPC and a player cannot pick a
  character. A player's lines are labelled with their character's name; the GM's lines say 'GM' (D11 Q3).
- The GM reads every present player journal (`notesJournals.playerJournals` / `journalView`, the pages the sharing
  rules allow) and may add lines there. Those lines show in the added colour, ending ' - GM'.
- So the Q12 default needs **no server change**: 'Writing as <PC>' is the GM opening that PC's journal in the existing
  journal view. The lines stay the GM's.

## What landed
- **`src/components/notes/header/index.tsx`**: `WritingAs`, a `role="group"` labelled 'Writing as' with one brand pill
  (`BrandButton variant="pill" size="sm"`, 40 px tall, 44 px at ≤1100 px through the brand sizes) per journal,
  `aria-pressed` on the chip whose journal is on the paper:
  - GM: 'Game Master' (own journal: `onPage(null, 'page')`, the first own page), then one chip per
    `notesJournals.playerJournals` row (`onView('journal', id)`, the existing journal view). The own chip is pressed
    on every own view (page, threads, shared, bin).
  - Player: one chip, their own (`notes.journal` whoName). `playerJournals` is skipped.
  - Portraits are initials discs ('GM' in violet, as on the design; PCs: first and last initial). Exported
    `chipInitials`.
  - A `role="status"` loading line until both queries answer.
- **`src/components/notes/header/header.css`**: the row (right-aligned over the paper at ≥720 px, left-aligned and
  wrapping at 390 px), the pressed gold edge, the discs. The body's top padding shrinks under the row.
- `JournalHeading`'s comment no longer says 'No Writing as switcher (A2)'.
- **Q13 (still unanswered): default (a) taken.** Group labels ('Session logs / Collections / Future log') and Quick keys
  ('+ Hope · ^ Fear') are unchanged; `src/lib/domain/notes/defaults.ts` is untouched.
- The 'Players’ journals' list in the index column stays (labels unchanged). The chips are a second way in.

## Out-of-owns edit (orchestrator approved)
- `src/components/notes/notes-body.tsx`: imports `WritingAs` and renders it in its own `SlotBoundary` (label 'Writing
  as') above `<main className="bj-main">`, only in the `'journal'` chrome. None of the owned folders renders above the
  paper in that chrome. The old `/notes` page (`'page'` chrome) is unchanged: `notes-shell.spec.ts` still asserts no
  'Writing as' there. **JX1**, which moves the notes specs to the Journal, must drop or flip that assertion
  (`tests/e2e/notes-shell.spec.ts:63`).

## Tests
- `tests/unit/notes-journal-view.test.tsx` (+5 tests; the `convex/react` mock now answers per function name):
  - the GM's chips and the pressed state;
  - picking a PC opens `journal`, and 'Game Master' goes back to `page`;
  - a player gets one chip and never queries `playerJournals`;
  - the loading line;
  - initials.
- `tests/e2e/journal-writing-as.spec.ts` (seed: `tests/e2e/journal/helpers.ts`; Moss, the e2e player, writes a line
  first so their journal exists):
  - GM: chips 'Game Master' (pressed) and 'Moss', Quick keys unchanged;
  - Moss's chip opens Moss's journal (`view=journal`, `tab=notes` kept) with Moss's line;
  - the GM adds a line, which reads ' - GM' and which the server stores with author label 'GM';
  - 'Game Master' goes back to Session 1;
  - player: one chip 'Moss', no 'Game Master' chip, and the GM's line on their page;
  - axe and no sideways scroll at 1440x900 and 390x844 in every state; shots go to `test-results/visual/JOURNAL-JN2/`.

## Design states matched (shots)
Shots: `test-results/visual/JOURNAL-JN2/{gm-own,gm-moss,player}-{1440,390}.png`. They are copied to
`C:\Users\Petar\Downloads\dcm-screens\journal-jn2\` with the design crop `design-notes-panel.png`.

Matches the design:
- the 'WRITING AS' small-caps label;
- round pills with a portrait disc, 'Game Master' with a violet 'GM' disc and a gold edge when pressed;
- one chip per PC, right-aligned over the paper.

Differs:
- The design puts the chips in the Journal header row, beside the sub-tabs. Here they are the first row of the Notes
  body, right-aligned over the paper, because the Journal header is JH's.
- Only PCs with a player and a journal get a chip (`playerJournals`). In the seed only Moss has a player, so Brannoc,
  Vex and Oriel (GM-held characters) have none.
- Initials, not portraits: `playerJournals` returns no portrait (see Questions).

## Data gaps
- No portrait in `notesJournals.playerJournals`. Adding one is a widen (optional field) in `convex/notesJournals.ts`,
  which is not in JN2's owns.

## Questions (default taken)
1. **Q13** (page groups and Quick keys) is still unanswered. Default (a): keep today's groups, names and keys. Another
   answer only changes the labels in `src/lib/domain/notes/defaults.ts`.
2. Chip portraits: should the chips show the character portraits (a server widen of `playerJournals`)? Default:
   initials discs now.
3. Should a PC held by the GM (no player, so no journal) get a chip? Default: no. A journal belongs to a player
   account, so there is nothing to open.
4. In a PC's journal the view still says 'read only' while the GM may add lines (label unchanged, as the brief says).
   Default: keep it.
5. Should the 'Players’ journals' index list go now that the chips exist? Default: keep it (labels unchanged).

## Merge-time actions
None: no Convex file changed.

## Checks
- `pnpm lint`: clean. `pnpm typecheck`: clean.
- vitest full (`--maxWorkers=1 --testTimeout=120000`): 514 files, 10967 passed, 1 expected fail.
- e2e on hand-started servers (`E2E_PORT=3813 E2E_CONVEX_PORT=3913 E2E_REUSE_SERVERS=1`, `--workers=1`).
  The managed build failed with the broken Google-font cache (docs/testing.md); `.next-e2e-3813` was deleted and the
  build rerun.
  - Run 1: `journal-writing-as`, every `notes-*.spec.ts`, `live-notes`, `journal-notes`. 30 passed and 3 failed, all
    from load (load average about 20, with vitest running alongside):
    - the new GM test hit the default 30 s timeout. It now sets 120 s; the player test sets 90 s.
    - `live-notes` 390 and `notes-bin` 1440 failed at sign-in.
  - Rerun of those three files: 8 passed.
- `node scripts/tracer-guard.mjs .omc/plans/journal.yaml JN2`: OK, except the approved `notes-body.tsx`.
