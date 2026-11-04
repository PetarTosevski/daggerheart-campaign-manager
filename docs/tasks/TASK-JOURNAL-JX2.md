# TASK-JOURNAL-JX2: Cut-over 2 (delete the old Sessions UI, move the End helpers, move the sessions specs)

Status: Review. Plan: `.omc/plans/journal.yaml`, tracer JX2 (wave 4, batch B, the last tracer). Bead: `dcm-z9rz.21`.
Briefs and user answers: `.omc/plans/journal-briefs.md` (Removal list, User answers 2026-11-03).

## Goal
`src/components/sessions` keeps only `session-chip.tsx`. The Start / End helpers live in
`src/components/journal/end-session`. Every old sessions spec drives the Journal, or is deleted with its Journal
coverage named. No table, field or row is removed.

## Removal list, per file
| File (old) | Fate |
|---|---|
| `src/components/sessions/slots.ts` | deleted (contract lives in `src/components/journal/slots.ts`, J1) |
| `sessions/list/index.tsx`, `list.css` | deleted (`journal/session-list`, JS; header line dropped) |
| `sessions/detail/index.tsx`, `detail.css` | deleted (`SessionHeaderCard` → `journal/session-head`; `PlayerSessionView` → Journal list + heading + recap + log; `NoSessionSelected` → J1 empty state) |
| `sessions/live/index.tsx`, `live.css` | deleted. `LiveCard` → JH's live chip / Start / End. `endReportLines`, `useWitherChoice`, `WitherChoiceField`, `endDialogText`, `startReportLines` **moved** to `src/components/journal/end-session/index.tsx` (with `end-session.css`, class `.jr-wither` instead of `.ss-live-wither`) |
| `sessions/prep/scenes.tsx`, `encounter.tsx`, `index.tsx`, `prep.css` | deleted (JP1 scene cards and GM prep, JP2 encounter card and Battle Points) |
| `sessions/play/index.tsx`, `play.css` | deleted (JT tally and spotlight, JL log; tap +1 dropped, Q9) |
| `sessions/play/encounter-card.tsx` | deleted with its `/sessions?…&stage=prep` link (nothing kept links to `/sessions` any more) |
| `sessions/wrap/index.tsx`, `wrap.css` | deleted (JR recap and loot; threads textarea and milestone button dropped) |
| `sessions/session-chip.tsx` | **kept** (tracker chip, Combat Map chip, `encounterTrackerHref`, `sessionPlayHref`) |
| `src/app/(gm)/campaigns/[campaignId]/notes/notes.css` | deleted (the `@import` shim; nothing imported it; `notes/error.tsx` is already gone, JX1) |
| `src/app/(gm)/campaigns/[campaignId]/wither-panel.tsx` | kept; imports the helpers from `@/components/journal/end-session` |
| `src/components/journal/header/index.tsx`, `header.css` | import path moved; `.jh-dialog .ss-live-wither` → `.jh-dialog .jr-wither` |

`grep -rn "components/sessions/(list|detail|live|prep|play|wrap|slots)"` over `src` and `tests` finds nothing.

## Spec mapping
| Old spec | Fate | Journal coverage |
|---|---|---|
| `session-encounter` | kept unchanged (Combat Map '＋ Session encounter'; never used the old page) | — |
| `session-play` | rewritten: a live session with no characters ('No active characters in the party yet.'), six tally tiles, Log & recap fits 390 px | spotlight `journal-tally`, log `journal-log`, tally `journal-tally` (taps dropped, Q9) |
| `session-prep` | deleted | `journal-plan` (scenes, states, GM prep, reload), `journal-encounter` (create / link / unlink, Battle Points), `journal-shell` (player: no Plan) |
| `session-records` | deleted | `journal-sessions` (plan → rename → date → played → delete; player sees live / played only, read-only heading; axe + 390 px) |
| `session-wrap` | deleted | `journal-recap` (recap for everyone Q4, loot, level-ups read-only); milestone button dropped (Party tab keeps 'Party levels up') |
| `sessions-flow` | rewritten as the Journal flow at 1440 and 1024: plan in the Journal (title, Combat + Social scenes, GM prep, scene encounter), start from the dashboard → Log & recap, log line, Fear tally, '＋ Session encounter' plays the scene (Q7), End from the live chip keeping Wither, recap + loot, Last Session card, the player's read-only Journal (Q5) | B7 restart: `tests/convex/sessions.test.ts` ('B7: a played session starts again') |
| `sessions-hub` | rewritten: tracker chip and Combat Map live chip ('Session 1[, live]: open it in the Journal') open Log & recap; Adversaries tab URL test kept | nav order `journal-redirects`; the Play-stage encounter card is gone (Plan's encounter card, `journal-encounter`) |
| `sessions-live` | rewritten: select Session 1, 'Start session 1' → Log & recap, Prayer Dice report, Live in the list, End with Wither → Fear, 'Start session 2', 44 px at 390 | B6 (start while another runs) is not offered by the header; server path in `tests/convex/sessions.test.ts` |
| `sessions-shell` | deleted | `journal-shell` (header, sub-tabs, Plan / Log & recap, URL state, player), `journal-redirects` (nav) |
| `live-sessions` | deleted → new `live-journal.spec.ts` (same two-browser case: dashboard chip, Prayer Dice on the sheet, plus the player's Journal live chip; End from the GM's Journal chip) | — |
| `session-features-flow` | Start / End from the Journal header; the start notes checked in the Journal's session log | — |
| `class-features` | Start / End from the Journal header | — |
| `wither` | Start from the Journal header; End from the dashboard's Wither panel (the dashboard End still works) | End dialog Wither choice in the header: `journal-header` |
| `players` (XC1) | Start / End from the Journal header; the extras switch in the live chip's 'Session options' menu | — |
| `visual/D10-S2..S6` | deleted | `visual/JOURNAL-JS`, `-JH`, `-JP1`, `-JP2`, `-JT`, `-JL`, `-JR` |
| `visual/helpers.ts` | `openSessions` now opens `/journal` (H1 'Journal'); new `journalLiveChip`, `journalReport`, `startFromJournal`, `endFromJournal` | used by `dice-followups`, `session-features-dice`, `SF-F2` unchanged |

## Server functions left without a UI (follow-up bead; not deleted)
`sessionPlay.bumpSpotlight` (tap +1, Q9), `sessionPlay.log` and `sessionPlay.tally` (old Play cards; JL / JT read
their own queries), `sessionPrep.createEncounter` / `linkEncounter` / `unlinkEncounter` (session-level encounter; the
Journal links per scene), `sessionWrap.callMilestone` (Party tab has its own level-up), `sessionWrap.setThreads`
(Q2: field kept, UI dropped).

## Out-of-owns edits (accepted by the orchestrator)
- `tests/e2e/session-features-boundary.spec.ts`, `tests/e2e/visual/SF-F1.spec.ts`: Start / End from the Journal header.
- `tests/e2e/journal-tally.spec.ts`, `tests/e2e/journal-threads.spec.ts`: axe on the whole page again (ccd41063).
- `src/lib/domain/sessions/summary.ts`: the Last Session fallbacks say "the Journal's Log & recap" (Q4: everyone
  writes the recap); exact-text asserts follow in `tests/unit/sessions-domain.test.ts`,
  `tests/convex/session-wrap.test.ts`, `tests/e2e/dashboard.spec.ts`.
- `tests/e2e/navigation-perf.spec.ts`: 8 nav tabs, not 9 (JX1's nav; failed on rebuild too).
- `tests/e2e/journal-plan.spec.ts`: counts scene cards by name (`/^Scene \d+$/`); the Combat scene's nested
  encounter-chip list items made the plain listitem count 8 instead of 4 (failed on rebuild too).

## Checks
- `pnpm lint`, `pnpm typecheck`: clean. `pnpm build`: OK.
- vitest full (`--maxWorkers=1 --testTimeout=120000`): 516 files, 10997 passed, 1 expected fail.
- e2e full, managed, `E2E_PORT=3833 E2E_CONVEX_PORT=3933 --workers=2`: 412 passed, 10 failed, 1 skipped, 1 did not
  run. `--last-failed --workers=1`: 8 passed; the 2 still failing (`journal-plan`, `navigation-perf`) are fixed above
  and pass (5 passed). The other 8 were load flakes (combat, dice, lorekeeper, live-dashboard, sessions-flow 1024).

## Questions (default taken)
1. The header offers no 'Start' while a session is live, so B6 (start one while another runs) and B7 (restart a played
   one without 'Mark as not played') have no UI path now. Default: leave it; the server keeps both.
