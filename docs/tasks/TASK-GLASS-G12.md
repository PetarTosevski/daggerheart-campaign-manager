# TASK-GLASS-G12: the Journal's buttons are glass buttons

Plan `.omc/plans/glass-buttons.yaml`, tracer G12; briefs `.omc/plans/glass-buttons-briefs.md`; bead dcm-q861.13.
Built on G0 (9926a1bb) and the briefs' default answers (Q1-Q9 = a). A restyle: labels, accessible names, test ids,
`type`, disabled logic and handlers are unchanged; a two-tap delete stays a two-tap delete.

## Buttons per file

| File | Button | Was | Now |
|---|---|---|---|
| `header/index.tsx` | Start session N | `pill` + `jh-start` | confirm |
| | End session (live chip, GM) | `jh-end` | danger |
| | Session options ⋯ | `jh-menu-btn` | neutral, icon, round |
| | End / Start dialog: Cancel | `outline` | cancel |
| | End dialog: End session | `dangerSolid` | danger |
| | Start dialog: Start session | `solid` | confirm |
| | Open the Campaign Tome | `jh-tome` | neutral, icon, round |
| | Open threads N | `jh-threads` | neutral (the count badge `jh-count` stays) |
| | Dismiss the session report ✕ | `jh-dismiss` | cancel, icon, round (Close ✕ of a panel) |
| `session-list/index.tsx` | Plan session N | `outline` + `js-plan` | confirm, full width |
| `session-head/index.tsx` | Session menu ⋯ | `js-menu-btn` | neutral, icon, round |
| | Mark as played / not played | `js-menu-item` | neutral, small, full width |
| | Delete session / Click again to delete | `js-menu-item js-danger` | danger, small, full width |
| `plan/scenes.tsx` | Scene N options ⋯ | `jp-menu-btn` | neutral, icon, round |
| | Play this scene, Mark done, Back to planned | `jp-item` | neutral, small, full width |
| | Type: Exploration / Social / Combat / Downtime | `jp-item` + `aria-pressed` | neutral, small, `aria-pressed` (switched on = gold glow); `jp-type-opt` keeps only the ✓ |
| | Remove scene | `jp-item jp-danger` | danger, small, full width |
| | Add scene | `pill` | neutral, small |
| `plan/encounter.tsx` | Open map, Edit in Adversaries (links) | `pill` + padding utilities | neutral, small (`brandButton`) |
| | Unlink | `jr-ghost` | neutral, small (removes only the link; nothing saved is deleted) |
| | Create encounter | `solid` | confirm |
| | Link | `outline` | neutral |
| `log/index.tsx` | Show / Hide N hidden | `jl-show` + `aria-pressed` | neutral, small, `aria-pressed` |
| | Unhide | `jl-unhide` | neutral, small (`jl-unhide` stays as a marker for the row grid's `:has()`) |
| | ✕ Delete log line (GM's own line) | `jl-x` | danger, small, icon |
| | ✕ Hide log line (an automatic line) | `jl-x` | neutral, small, icon |
| | Add | `pill` + `jl-add-btn` | neutral (44 px, as tall as the field) |
| `tally/index.tsx` | Reset | `pill` + `jt-reset` | neutral, small |
| `threads/index.tsx` | Open (a thread in Notes) | `pill` + `jrth-open` | neutral, small |
| `ui/index.tsx` (SlotBoundary) | Try again | `jr-ghost` | neutral, small |
| `journal/error.tsx` | Try again | `jr-ghost` | neutral, small |
| `journal/page.tsx` | Play on the Combat Map (link) | `solid` + `jr-play` | confirm; `jr-play` is now layout only (fills the row on phones) |
| `recap/index.tsx` | Save recap / Cancel / Write the recap, Edit recap | `solid` / `outline` / `pill` + `jrr-btn` (glass since G0) | **ink on paper** (Q5 a): `jrr-btn`, Save recap `jrr-btn-main` (filled ink) |

Per role: confirm 6 (Start session, Start dialog, Plan session, Create encounter, Play on the Combat Map; the GM sees
them in Fear), cancel 2 (dialog Cancel, report ✕), danger 5 (End session ×2, Delete session, Remove scene, Delete log
line), neutral 22, ink on paper 3.

## Left alone, and why

- Page tabs (Sessions / Notes) and the Plan / Log & recap switch: `role="tab"` (G0 notes: tabs stay).
- Session list rows (`js-item`): rows that open something.
- Click-to-edit text: the session title and date (`js-head-edit`), a log line's title (`jl-title-btn`), the loot value
  (`jrr-inline`). They read as the text itself, not as buttons.
- GM prep's Edit (`jp-prep-edit`) on the GM prep parchment: ink on paper (Q5 a).
- The Allow-extra-characters switch in the header menu is a checkbox.

## CSS deleted

- `header.css`: `.jh-end`, `.jh-menu-btn` (+ svg), `.jh-start`, `.jh-tome` (+ hover, svg), `.jh-threads` (+ hover,
  svg), `.jh-dismiss` (+ hover, svg), their focus rules.
- `session-head.css`: `.js-menu-btn` (+ hover, focus, svg, touch), `.js-menu-item` (+ states), `.js-danger`.
- `plan.css`: `.jp-menu-btn` (+ states, touch), `.jp-item` (+ states, touch), `.jp-danger`; `.jp-type-opt` keeps the ✓.
- `log.css`: `.jl-x` (+ states, touch), `.jl-unhide` / `.jl-show` (+ states, touch), `.jl-add-btn`.
- `journal.css`: `.jr-ghost` (+ states, touch), the shape part of `.jr-play`.
- `session-list.css`: `.js-plan`. `tally.css`: `.jt-reset`. `threads.css`: `.jrth-open`.
- `recap.css`: the `jrr-btn` touch rule became the ink-on-paper `.jrr-btn` / `.jrr-btn-main` (the ink #6b5328 is GM
  prep's, which passes 4.5:1 on the parchment; the filled button's paper text on ink is about 7:1).

Menu panels (`js-menu-panel`, `jp-menu-panel`, `jp-types`) got a 6 px gap between the glass items.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- vitest: `tests/unit/journal` + `tests/unit/brand` 144 passed; the full suite (`--maxWorkers=1 --testTimeout=120000`)
  519 files, 11051 passed, 1 expected fail.
- e2e (servers started by hand on 3857 / 3957, `E2E_REUSE_SERVERS=1`, `--workers=1`, `E2E_VISUAL=1`):
  `journal-*` (shell, sessions, header, plan, encounter, log, recap, tally, threads, notes, writing-as, redirects),
  `live-journal` and `visual/JOURNAL-*`, 40 tests. Each run had 2 different load flakes that passed on an isolated
  rerun (run 1: a seed mutation in journal-log, the page title in journal-shell; run 2: a live spotlight update in
  journal-tally, a sign-in redirect in JOURNAL-JL), none of them at a Journal button.
- `visual/GLASS-G12`: 2 passed (roles asserted, 44 px on 1024 / 390, axe clean with a hovered confirm and a focused
  button).

## Shots

`tests/e2e/visual/GLASS-G12.spec.ts` (E2E_VISUAL=1) writes to `test-results/visual/GLASS-G12/`, copied to
`/mnt/c/Users/Petar/Downloads/dcm-screens/glass-g12/`:

- `gm-plan-{1440,1024,390}`, `gm-scene-menu-{…}`, `gm-log-{…}`: the GM's Plan, the scene menu, Log & recap (the recap
  parchment with ink buttons).
- `gm-end-dialog-1440`: Cancel (Hope for the GM) and End session (ember).
- `gm-hover-confirm-1440` (Plan session, Fear fill) and `gm-focus-add-scene-1440` (keyboard focus); axe clean in both.
- `player-{1440,1024,390}`, `player-hover-confirm-1440` (Play on the Combat Map, Hope fill; axe clean).
- At 1024 and 390 every visible glass button in the Journal is at least 44 × 44 px (asserted).
