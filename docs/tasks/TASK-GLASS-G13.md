# TASK-GLASS-G13: Notes buttons on the dark frame are glass buttons

Plan `.omc/plans/glass-buttons.yaml`, tracer G13; briefs `.omc/plans/glass-buttons-briefs.md`; bead dcm-q861.14.
Built on G0 (`docs/tasks/TASK-GLASS-G0.md`) and the briefs' default answers (Q1-Q9 = a). Q5 (a): the paper page keeps
its ink-on-paper buttons. The Notes UI lives in `src/components/notes/**` and renders in the Journal's Notes sub-tab
(`/journal?tab=notes`); `/notes` is a 307 route handler with no buttons (`notes/route.ts`, unchanged).

## Buttons per file

Dark frame (the index column, the Writing-as row, dialogs, the toast): glass. Paper page: unchanged (Q5 a).

| File | Button | Role | Notes |
|---|---|---|---|
| `notes-body.tsx` | Slot boundary "Try again" | neutral, sm | recovery action, no side |
| `notes-body.tsx` | "Pages" index disclosure (≤ 720 px) | neutral | keeps `bj-index-toggle` (layout only: hidden on wide screens, full width, left aligned) |
| `index-column/index.tsx` | "＋" New session log / New collection / New future page | confirm, sm, icon | the goal's "New page = confirm"; one per group header, not side by side |
| `index-column/index.tsx` | "Pages" own-pages disclosure | neutral | never shown inside `.bj-index` since N9 (`.bj-index .bj-pages-toggle { display: none }`); keeps `bj-pages-toggle` for that rule |
| `threads/index.tsx` | "Open threads" (`chrome="page"` only) | neutral + `aria-pressed` | a switch; the Journal tab does not mount it |
| `export/index.tsx` | "Download my journal" | neutral | |
| `header/index.tsx` | "Writing as" chips | neutral, sm + `aria-pressed` | was `variant="pill"` (already neutral via G0); now explicit; the pressed one glows gold |
| `bin/index.tsx` | Toast "Undo" | cancel | the toast portal is wrapped in `<ViewerScope>` |
| `bin/index.tsx` | Torn-out list "Restore" (index column) | neutral, sm | `flex-none` keeps it from shrinking in the row |
| `page/session-picker.tsx` | "Cancel" | cancel | native `<dialog>` (Modal) |
| `page/session-picker.tsx` | "Add the page" / "Link session" (submit) | confirm | |
| `sharing/index.tsx` | "Done" | cancel | each option saves on click, so Done only closes the dialog |

### Left alone, and why

| File | Button | Why |
|---|---|---|
| `page/index.tsx` | "🎀 Tape", "🔗 Session" (`bj-ghost bj-paper-btn`) | paper toolbar (Q5 a) |
| `entries/index.tsx` | "➜ Migrate open tasks" (`bj-paper-btn`), bullet-kind radios (`bj-chip`) | paper (Q5 a) |
| `sharing/index.tsx` | Sharing chip (`bj-chip bj-share-chip`) | paper toolbar (Q5 a) |
| `bin/index.tsx` | "Tear out page" (`bj-tear-btn`, ink danger) and the torn-out page's "Restore" (`bj-paper-btn`) | paper (Q5 a); the two-tap stays a two-tap |
| `entries/row.tsx` | bullet (`bj-bul`), ★ ✎ ↑ × (`bj-ib`) | on the paper (Q5 a); the bullet is a status glyph like a pip |
| `threads/index.tsx` | thread bullet, "<page> →" (`bj-thread-page`) | paper; the second is a link to a page |
| `index-column/index.tsx` | page rows (`bj-page-btn`) | list rows that open something |
| `journals/index.tsx` | journal rows (`bj-jl-btn`), journal page rows (`bj-jv-page`) | list rows that open something |
| `shared/index.tsx` | shared rows (`bj-shared-btn`); Players / GM tabs (`role="tab"`) | rows; page tabs stay (Q6 a) |
| `bin/index.tsx` | torn-out rows (`bj-bin-open`) | list rows that open something |
| `mentions/index.tsx` | @-mention options | listbox options, not buttons |

`bj-act` is the hover-revealed wrapper of the row's `bj-ib` icons on the paper; it stays.

## CSS deleted

| File | Rules |
|---|---|
| `notes.css` | `.bj-threads` (+ `[aria-pressed]`, `:disabled`, `:focus-visible`), `.bj-plus`, `.bj-danger` (unused), `.bj-threads` / `.bj-plus` in the touch rule |
| `index-column/index-column.css` | the desktop `.bj-group-head .bj-plus` size |
| `bin/bin.css` | `.bj-toast-undo` (+ `:focus-visible`), `.bj-bin-restore` (+ its touch rule) |
| `page/page.css` | `.bj-picker-confirm` (+ `:disabled`, `:focus-visible`), `.bj-picker .bj-ghost` |
| `header/header.css` | `.bj-wa-chip` padding / gap and its pressed gold overrides (the glass `aria-pressed` look replaces them) |

`.bj-ghost` and `.bj-paper-btn` stay: the paper buttons use them.

## Shots

`tests/e2e/visual/GLASS-G13.spec.ts` (`E2E_VISUAL=1`) writes to `test-results/visual/GLASS-G13/`, copied to
`/mnt/c/Users/Petar/Downloads/dcm-screens/glass-g13/`:

- `notes-{gm,player}-{1440,1024,390}` (+ `-full`): the Notes sub-tab with a log page and a torn-out page.
- `index-{gm,player}-hover-confirm`, `index-{gm,player}-focus-restore`: a hovered "＋" confirm, a keyboard-focused
  Restore (axe clean in both states).
- `paper-{gm,player}-hover-tape`: a hovered paper button (axe clean).
- `picker-{gm,player}-hover-confirm`, `sharing-{gm,player}`, `toast-{gm,player}`, `writing-as-gm`.

The spec also asserts the roles, the viewer colours (the GM's confirm has the Fear rim and the cancel the Hope rim;
a player the other way round, the toast included) and 44 px at ≤ 1100 px.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean. `pnpm tracer:guard .omc/plans/glass-buttons.yaml G13`: OK.
- vitest (`--maxWorkers=1 --testTimeout=120000`): `tests/unit/notes-*`, `tests/unit/brand`, `tests/unit/journal`
  16 files, 238 passed; the full suite 519 files, 11051 passed, 1 expected fail.
- e2e, servers started by hand on 3861 / 3961, `E2E_REUSE_SERVERS=1`, `--workers=1`:
  - notes-a11y, notes-bin, notes-entries, notes-flow, notes-journals, notes-mentions, notes-pages, notes-sharing,
    notes-shell, notes-threads, live-notes, journal-notes: 32 tests. 28 passed in the first run; the 4 failures were
    load (load average ~20): a sign-in that stayed on /signin (3) and a Convex "Function execution timed out" during
    seeding (1). The 4 (6 tests with their viewports) passed on rerun.
  - visual D11-N2 to D11-N9: 8 passed. GLASS-G13: 1 passed.
