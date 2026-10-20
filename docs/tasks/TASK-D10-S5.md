# TASK-D10-S5: Play - spotlight, live tally, session log

Status: Review. Plan: `.omc/plans/d10-sessions.yaml`, tracer S5 (wave 3, depends on S2). Bead: `dcm-bxp.9`.

## Goal
In Play the GM taps characters into the spotlight (due ones ringed), reads the tally that counts itself from Fear and
rests, and keeps a timestamped session log.

## Rules this tracer implements
- **B4** "Play: Spotlight (tap a character for each moment; the least-spotlit are ringed as due; 'Reset spotlight'; copy
  'Daggerheart has no initiative, so this helps you share the spotlight'), Session tally (Fear gained, Fear spent, Short
  rests, Long rests; see Q3), Session log (time + text, newest first, remove; Enter adds)."
- **K7** (CB p.176, 'Sharing the Spotlight'): "It's rare that every PC will organically have the same amount of spotlight
  time during a given session ... you can help ensure that the story's focus rotates between the PCs". Due = the lowest
  count among the listed characters (S1 `spotlight`).
- **Q3 (a)** "automatic and read-only: Fear gained / spent from the Fear history between the session's start and end
  (increases = gained, decreases = spent; an 'undo' row cancels the change it undoes), short / long rests from the
  FINISHED rests in that window ... Restarting a played session (B7) adds the new window to the stored counts." No
  steppers, no manual corrections.
- **Q12 (a)** "active characters only (extras allowed by XC1 included)": the spotlight lists characters with status
  `active`; XC1 extras are active characters, so they are in; dead, retired and away ones are out.
- **K10 / Q4**: the spotlight, the tally and the session log are GM-only; every function uses `gmQuery` /
  `gmMutation` / `keyedGmMutation` (players FORBIDDEN, outsiders NOT_FOUND, anonymous UNAUTHENTICATED).
- **B10** is S3's: its 'Session started.' / 'Session ended.' lines (`auto: true`) are listed and removable like the
  GM's own lines (the board shows them the same way).

## Public functions (`convex/sessionPlay.ts`)
| Function | Wrapper | Args (besides `campaignId`) | Returns |
|---|---|---|---|
| `spotlight` | `gmQuery` | `{ sessionId: string }` | `Array<{ characterId: Id<"characters">, name: string, count: number, due: boolean }>` (active characters, roster order) |
| `bumpSpotlight` | `keyedGmMutation` (`idempotencyKey`) | `{ sessionId: string, characterId: string }` | `{ count: number }` (inactive, foreign or malformed character: NOT_FOUND) |
| `resetSpotlight` | `gmMutation` | `{ sessionId: string }` | `null` (deletes the session's spotlight rows) |
| `tally` | `gmQuery` | `{ sessionId: string }` | `{ tally: { fearGained, fearSpent, shortRests, longRests } \| null, live: boolean, truncated: boolean }` |
| `log` | `gmQuery` | `{ sessionId: string }` | `Array<{ _id: Id<"sessionLog">, at: number, text: string, auto: boolean }>` newest first, `take(MAX_LOG_ENTRIES)` |
| `addLog` | `keyedGmMutation` (`idempotencyKey`) | `{ sessionId: string, text: string }` | `{ logId: Id<"sessionLog"> }` (trimmed, 1..300 else INVALID; SESSION_LOG_LIMIT at 500) |
| `removeLog` | `gmMutation` | `{ sessionId: string, logId: string }` | `null` (a line not in this session: SESSION_LOG_NOT_FOUND) |

`sessionId` goes through `loadSession` (SESSION_NOT_FOUND for a bad, foreign or deleted id). Every function has
`args` and `returns`; RETURNS_PENDING is unchanged. No new error code (all from S0's `src/lib/errors/sessions.ts`).
Reads are indexed and bounded: characters by `by_campaign` (`partyOf`, cap 50), spotlights by `by_session_character`
(cap 50), log by `by_session_at` (`take(500)`), tally rows by S0's `tallyRows` (`take(2000 + 1)`, `truncated`).

### Tally
- Never live (no stored tally, not live): `tally: null`, the card shows dashes.
- Live: the stored tally (earlier windows, B7) + `windowTally(tallyRows(from = startedAt))` (S1). No `Date.now()` in
  the query (CF10): the open window has no upper bound.
- Played / planned again: the stored tally as S3 froze it at end.

## UI (`src/components/sessions/play/`)
- `PlayStage` (export name and props unchanged): two columns as the board (spotlight + tally | log, 1fr / 1.3fr), one
  column at <= 720 px. Each card has its own error boundary and loading line (`role=status`).
- **Spotlight**: board copy, pills (name + Cinzel count) as buttons, due ones ringed in the accent (`data-due`), the
  accessible name 'Ash, 1 spotlight moment' / '..., due'; 'Reset spotlight'; empty copy 'No characters in the party
  yet.' Taps and reset update the cached query optimistically (counts and due recomputed with S1 `spotlight`).
- **Session tally**: the four rows of S1 `TALLY_ROWS` as a `<dl>`, Cinzel numbers, dashes before the first start, no
  steppers (Q3), and a line saying it counts Fear gained and spent on the dashboard and finished rests.
- **Session log**: labelled input 'New log entry' ('What just happened?') + Add in a form (Enter adds), rows of time
  (HH:MM, viewer's clock) + serif text + × ('Remove log entry: <text>'), newest first, board empty copy. Add and remove
  are optimistic (a pending line shows at once; its × is disabled until the server's row arrives); a failed add puts
  the text back into the empty input and shows the error in `role=alert`.

## Acceptance evidence
- `tests/convex/session-play.test.ts` (9 tests): spotlight lists active characters only (dead leaves the list, Q12),
  counts and due; bump retry-safe and per session; NOT_FOUND for retired / malformed / other-campaign characters,
  SESSION_NOT_FOUND for a foreign or bad session; reset deletes only this session's rows; tally null for planned,
  stored for played, live window counts set / adjust gains and spends after the start only and finished rests only
  (open, interrupted and earlier rests not), plus the stored counts of a restarted session (B7); log newest first with
  an auto line, trim, stamp, `by`, remove, SESSION_LOG_NOT_FOUND (gone, malformed, other session), addLog retry-safe,
  INVALID for blank and 301 characters, 300 accepted, SESSION_LOG_LIMIT at 500; access for all seven functions:
  anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM succeeds.
- `tests/e2e/session-play.spec.ts` (3 tests): two characters, both due; tapping Ash leaves Bryn the only due one;
  Bryn tapped twice survives a reload; Reset brings both to 0 and due; Enter and Add add log lines (newest first,
  HH:MM), remove one, reload keeps it; a planned session's tally shows four dashes and no buttons; after
  `sessions.start` and 'Fear 2 of 12' on the dashboard the tally reads 2 / 0 / 0 / 0. Phone 390 px: pill, input, Add
  and × >= 44 px, no horizontal scroll. No active characters: 'No characters in the party yet.'
  The live part of the spec relies on S3's `start` (no session id: the newest planned session goes live, B8). In this
  worktree it was verified with a temporary, uncommitted stand-in in `convex/sessions.ts` (start marks the newest
  planned session live, end marks it played), reverted before the commit; it must pass unchanged once S3 is merged.
- S0's `tests/e2e/sessions-shell.spec.ts` (5 tests incl. its visual) still passes (the stage keeps the region
  'Play stage').
- `pnpm lint` and `pnpm typecheck` clean; `pnpm vitest run --maxWorkers=4`: 141 files, 1628 tests passed.

## Visual comparison
App (`E2E_VISUAL=1`, `tests/e2e/visual/D10-S5.spec.ts`): `test-results/visual/D10-S5/play-{1440,1024,390}.png`,
`tally-live-1440.png`. Board (`node scripts/board-shots.mjs sessions:play`):
`test-results/visual/board/sessions-play-{1440,1024,390}.png`.

| Region | Verdict |
|---|---|
| Layout 1440 / 1024 | Matches: two columns (spotlight + tally left, log right, 1fr / 1.3fr), 18 px gaps, board cards. |
| Spotlight | Matches: heading, board copy, round pills with name + Cinzel count, the due one ringed in the accent on the hover background, 'Reset spotlight' ghost. |
| Session tally | Deviation (Q3): four rows with the Cinzel number only, no − / + steppers; rows are 44 px instead of the board's stepper height; dashes before the first start and an explanatory line below. Live shot: 3 / 1 / 0 / 0. |
| Session log | Matches: input 'What just happened?' + Add, rows of time (13 px muted), Garamond 18 px text and a 32 px ×; board empty copy. |
| 390 | One column (spotlight, tally, log), no horizontal scroll, × 44 px. The board has no phone layout (its 390 shot keeps two squeezed columns). |

## Deviations from the board (deliberate)
- Tally: no − / + steppers (Q3 a, read-only), dashes before the first start, an explanatory line under the rows.
- Spotlight lists active characters only (Q12), not the whole party.
- Pills' accessible name adds ', due' for the ringed ones, so the ring is not colour-only.
- The log's × is 44 px on phones (board 32 px) for the touch-target rule.

## QUESTIONS
1. The tally of a session marked played by hand (never live) has no stored counts, so it shows dashes like a planned
   one. Reversible: show zeros instead.
2. Automatic log lines (S3) can be removed like the GM's own (the board removes any line). If they should be kept,
   `removeLog` can refuse `auto` rows (no new code needed beyond INVALID or FORBIDDEN).
3. The spotlight keeps a character's count while it is dead / away / retired and shows it again if it comes back
   (rows are per session and character; reset clears them).
