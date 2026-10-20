# TASK-D10-S3: Live session - start and end per session, party sync, log stamps, tally freeze, SS3 boundaries, backfill migration

Status: Review. Plan: `.omc/plans/d10-sessions.yaml`, tracer S3 (wave 3, depends on S2). Beads: `dcm-bxp.9`, `dcm-bxp.48`.

## Goal
The GM starts and ends a chosen session from its live card; the party sync (Prayer Dice, Rally, session effects, Wither
to Fear, XC1) runs as today, the session log gets the board's stamps, the tally is frozen at the end, and level-up undo
reads the sessions table instead of log summaries.

## Rules this tracer implements
- **B2** "Starting a session switches to Play, ending it to Wrap-up." -> `LiveCard` calls `onStage`.
- **B6** "One live session per campaign. Starting another session while one is live ends the live one first, with its
  end effects (board copy: 'Session N is still running. Starting this one ends it.')."
- **B7** "A played session can be started again; its start effects run again (board copy: 'This session has been
  played. Starting it again re-rolls Prayer Dice and refreshes Rally.')."
- **B8** "starts the newest planned session, creating one when there is none" -> `start` without `sessionId`.
- **B10** "Start and end stamp the session log: 'Session started.' / 'Session ended.' plus what the party sync did
  (Prayer Dice rolled, unspent dice lost)."
- **Q3 (a)** "Restarting a played session (B7) adds the new window to the stored counts." -> `end` freezes the window.
- **Q6 (a)** "the End report reminds the GM ('Mark a Doom Track box (Tier ≤ N)') with a link to the tracker, and every
  box marked is stamped with the live session's number, else the last played one's".
- **Q7 (a)** "sheets and Fear revert, the session's status and times stay".
- **Q8 (a)** "the Start/End reports list a reminder per PC who has one".
- **Q11 (a)** "a migration creates them as untitled Played sessions numbered in order".
- **E1-E7** kept; every existing test in `tests/convex/{sessions,one-active,scenes,class-features-core,level-up}.test.ts`
  passes (one assertion in `sessions.test.ts` extended, see QUESTIONS 1).

## Book pages (re-checked in `.reference-private/` with pdfjs-dist; printed pages)
- **CB p.28** (Rally): "At the end of each session, clear all unspent Rally Dice." -> end line 'lost N unspent dice'.
- **CB p.44** (Prayer Dice): "At the end of each session, clear all unspent Prayer Dice." (rolled from the Spellcast
  trait per the decision and `seraph.ts`, never the board's Strength).
- **CB p.105**: "Some features say you can use them “once per session.” These features don’t refresh during rests, but
  instead are available again at the start of your next Daggerheart session." -> `expire(sheet, "session")` (unchanged).
- **CB p.154**: "Fear carries over between sessions, so note how many Fear you have at the end of each session" -> start
  and end never reset Fear.
- **CB p.261**: "At the end of each session, clear all Wither tokens from the PCs’ sheets and gain an equal amount of
  Fear." (unchanged, capped at 12).
- **HF p.177** (Doom Track): "At the end of each session, mark a box in the party’s tier or below." -> Q6 reminder.
- Q8: **CB p.64** Luckbringer "At the start of each session, everyone in your party gains a Hope."; **CB p.48** Slayer
  "At the end of each session, clear any unspent Slayer Dice on this card and gain a Hope per die cleared."; **CB p.77**
  Know the Tide "At the end of each session, clear all unspent tokens."; **HF p.17** Lunar Phases "At the beginning of
  each session, roll a d6 and place it on this card."

## Public functions (`convex/sessions.ts`)
| Function | Wrapper | Change |
|---|---|---|
| `start` | `keyedGmMutation` | new optional arg `sessionId: string` (`loadSession`: SESSION_NOT_FOUND). Returns `{ startedAt, alreadyStarted }` plus, when it started one, `sessionId`, `n`, `notes` (Prayer Dice), `reminders` (Q8) and `ended` (the End report of the session it ended first, B6). The alreadyStarted result keeps its old shape. |
| `end` | `keyedGmMutation` | args unchanged. Returns the old fields plus optional `sessionId`, `n`, `lostDice`, `reminders` (Q8), `doomTier` (Journey to Horizon, Q6). |
| `current` | `campaignQuery` | returns also optional `sessionId`, `n` of the live session (E7). |
| `allowExtraCharacters` | `keyedGmMutation` | unchanged (E3). |

`start` / `end` write `sessions.status/startedAt/endedAt/tally`, `campaignState.sessionStartedAt/liveSessionId/extraCharactersSession`
and the `sessionLog` auto line in the same mutation as the unchanged actionLog group. A full log (500) gets no stamp; a
line past 300 characters is shortened. `end` with no live session row still clears session effects (E2) and touches no
session. A pre-D10 running session (state stamped, no row) still ends. RETURNS_PENDING unchanged.

## Internal functions / migrations (`convex/migrations/sessions.ts`)
- `backfillFromLog` (table `actionLog`): a 'Session started' campaign row -> untitled Played session (`startedAt` = row
  time, `createdAt` too, numbered highest + 1, so in order); 'Session ended…' -> `endedAt` on the latest open one; an End
  with nothing open changes nothing; scene ends and character rows are skipped (E5). Rows the D10 code wrote are skipped
  (at or after the campaign's first `sessionLog` row: every D10 start stamps the log).
- `backfillLive` (table `campaignState`): `sessionStartedAt` without `liveSessionId` -> the matching backfilled row goes
  Live (or a new one), `liveSessionId` set.
- `backfillSessions`: runner of both, log first.
  Dry run: `npx convex run migrations/run:run '{fn: "migrations/sessions:backfillFromLog", dryRun: true}'`; run:
  `npx convex run migrations/sessions:backfillSessions`. Idempotent (reset-safe).

## SS3 (`convex/levelUp.ts`, dcm-bxp.48)
`sessionBoundaryAfter`: live -> unchanged (`sessionStartedAt > at`); else a session with `startedAt > at`
(`by_campaign_started`) or `endedAt >= at` (`by_campaign_ended`); only then the old log-summary scan as the fallback
for unmigrated campaigns (S9 removes it). A restarted session carries its latest start, so it is a boundary.

## UI
- `src/components/sessions/live/` (`LiveCard`, `live.css`): dot, 'Session in progress' / 'Not running', the board's
  three texts and the red 'Session N is still running. Starting this one ends it.' (also for a pre-D10 running session),
  '▶ Start session' (green) / '■ End session' (red) pills, confirm dialogs 'Start the session?' / 'End the session?'
  (brand `Modal`, buttons 'Start session' / 'End session', the played / other-live notes in the Start dialog), the report
  in a `role=status` region (start line with Prayer Dice, the End report as on the dashboard card, journey ends, Q8
  reminders, Horizon 'Mark a Doom Track box (Tier ≤ N). Open the Doom Track' -> `/campaigns/<id>#tr-doom-track`), the XC1
  switch while live (optimistic). GM only; an id that is not in `sessionRecords.list` (S0's placeholder) renders nothing.
- `trackers/horizon.tsx`: a Doom Track mark sends `session` = the live session's number, else the last played one's
  (S1 `liveSession` / `lastPlayedSession` over `sessionRecords.list`); the box shows '(session N)'.

## Acceptance evidence
- `tests/convex/sessions.test.ts` 18 tests (8 existing + 10 new): start by id (status, state, log, current), E1 no-op,
  B8 newest planned / create, B6 end-first with Wither -> Fear and both log lines, B10 Prayer Dice notes and end line,
  B7 restart re-rolls and adds the tally (Fear gained / spent, finished long rest counted, interrupted short not), Q7 undo
  of Start and End leaves status and times, E2/E3, Q8 reminders and Q6 `doomTier`, full log, SESSION_NOT_FOUND and authz
  (anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM ok) for `start` with `sessionId`.
- `tests/convex/level-up.test.ts` 17 tests (15 existing unchanged + 2): restarted played session is a boundary, a
  level-up inside the restarted session may be undone; table-only boundaries (end before / same millisecond / start after).
- `tests/convex/sessions-migration.test.ts` 4 tests: backfill in order + Live + `current`; reset run changes nothing;
  dry run commits nothing; live without a start row; D10-written rows (incl. a B7 restart) skipped.
- `tests/e2e/sessions-live.spec.ts` (1 test): Session 1 started from its card (Play opens, Prayer Dice in the report =
  the log line, on the sheet 'Prayer d4: n' ×2), Session 2 started (warning, 'Session 1 ended first.', 'Seren lost 2
  unspent dice.', Session 1 Played), Wither token, End (Wrap-up opens, 'Session ended. N Wither token → +N Fear.', Fear N
  on the dashboard), 390 px 44 px button, no horizontal scroll. S0's `sessions-shell.spec.ts` (5) and S2's
  `session-records.spec.ts` (2) still pass.
- Counts and lint / typecheck: see the tracer report.

## Visual comparison
App (`E2E_VISUAL=1`, `tests/e2e/visual/D10-S3.spec.ts`): `test-results/visual/D10-S3/{idle,live,detail-live,other-live,played}-{1440,1024,390}.png`,
`start-dialog-1440.png`. Board (`node scripts/board-shots.mjs sessions:live`): `test-results/visual/board/sessions-live-{1440,1024,390}.png`.

| Region | Verdict |
|---|---|
| Live card, live | Matches: green border, glowing dot, Cinzel 'SESSION IN PROGRESS', 'Live since HH:MM. Party sheets know the session is running.', red '■ End session' pill right. Additions: the XC1 switch and the report line under the row (board has neither). |
| Live card, not running | Matches the grey dot, 'NOT RUNNING', the board's planned / played texts, green '▶ Start session'. |
| Other session live | Matches the board's red line under the text. |
| Dialogs | Not on the board (the board starts at once); the plan asks for them. Brand modal as the dashboard card's. |
| 1024 | Same row as 1440. |
| 390 | Text then a full-width button; dot top-aligned; 44 px+ targets; no horizontal scroll. The board has no phone layout. |

## QUESTIONS
1. E7 says the existing tests pass unchanged, but the acceptance adds `sessionId` / `n` to `current`; the one
   `toEqual` on `current` while live in `sessions.test.ts` ("start stamps the session once") now lists them too
   (stricter, not weaker). Every other existing assertion is untouched.
2. Backfilled numbering: a campaign that already has S2-created sessions gets its backfilled past sessions numbered
   after them (insertSession: highest + 1). Renumbering would be irreversible, so it was not done.
3. The session log is shown by S5; until it merges, the e2e checks the log's text through the start / end report (the
   same line) and the Convex tests check the `sessionLog` rows.
4. The migration's start matching tolerates 2 s between a pre-D10 `sessionStartedAt` and its log row (`SAME_START_MS`);
   real Convex freezes `Date.now()` per mutation so they should be equal.
5. The Q8 reminders live in `convex/sessions.ts` (`sessionReminders`), not in S1's domain module (not in this tracer's
   owns). Shapeshifter forms are not checked for Luckbringer.

## Notes for S7-S9
- S7: `start` without `sessionId` is B8; the returned `sessionId` is what to open on Play. `endReportLines` is exported
  from `src/components/sessions/live` for the dashboard's Wither panel End report. The dashboard card's tests
  (wither / class-features) still pass because its calls are unchanged.
- S9: run `migrations/sessions:backfillSessions` (dry run first) on dev / prod, then delete the log fallback in
  `sessionBoundaryAfter` and `isSessionBoundary`. After narrowing, an End pressed with no session live is no longer an
  SS3 boundary (it has no session row).
- Follow-up bead candidates: Q8 automation; Q9 break refresh.
