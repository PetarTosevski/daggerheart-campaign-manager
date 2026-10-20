# TASK-D10-S9: D10 end-to-end pass, SS3 narrowing, docs and follow-ups

Status: Review. Plan: `.omc/plans/d10-sessions.yaml`, tracer S9 (wave 5, depends on S5, S7, S8). Bead: `dcm-bxp.9`
(D10), `dcm-bxp.48` (the orchestrator closes it once the dev backfill has run and this tracer is merged).

## Goal
A full GM-and-player session flow passes in the browser at desktop and tablet sizes, SS3 no longer reads log
summaries, the task docs are complete and the follow-ups are filed.

## What changed
- `tests/e2e/sessions-flow.spec.ts`: one two-browser flow, run at 1440x900 and 1024x768 (two tests). Steps:
  1. Seed (API): a Seraph (Seren) and a Bard (Ash), a Combat Map; a player joins through the Players dialog.
  2. Prep (B1, B3, Q1): '+ New session' opens Session 1 on Prep; title; a Combat and a Social scene; hooks; 'Create the
     session encounter' plus two Jagged Knife Bandits through D8's add dialog; the server has it (API poll), a reload
     keeps it. The player's Sessions list is empty (a planned session is GM-only, Q4).
  3. Start from the dashboard (B8): 'Start Session' opens the 'Start the session?' confirm; Cancel stays on the
     dashboard; confirming opens `/sessions?s=<Session 1>&stage=play`; the live card says 'Session in progress'; the
     session log holds 'Session started. Seren rolled Prayer Dice: x, y.' (B10, K3). The player's hero shows
     'Session 1 in progress' and no button.
  4. Play (B4, Q3, Q12): Seren tapped (Ash ringed as due); a log line (Enter); tally 0/0/0/0, then 'Fear 2 of 12' on
     the dashboard and the tally reads 2/0/0/0.
  5. Combat Map (B11, Q2): '＋ Session encounter' titled 'Session 1: 2× Standard' starts the encounter and places
     both Bandits ('Added Session 1's encounter.', '0 party · 2 enemies').
  6. End keeping Wither: a Wither token on Ash (API, Severe Withered damage); the live card's End dialog has
     'Turn Wither tokens into Fear (CB p.261)' ticked (witherPersists off); unticked, the dialog says the tokens stay;
     End switches to Wrap-up, the report says they stay on the sheets; the sheet keeps N tokens (API), Fear stays 2,
     the frozen tally still reads 2, the dashboard's Wither panel shows 'N on sheets'.
  7. Restart (B7): the played session's card shows the board copy; Start (confirm) puts it live again.
  8. End converting from the dashboard's Wither panel (B12, K4): 'End Session · convert N to Fear', the checkbox is
     ticked; the report 'N Wither token(s) → +N Fear.'; '0 on sheets · 20 in pool'; Fear = 2 + N (cap 12).
  9. Wrap-up (B5, Q5): recap (saved after a pause), loot, threads (on blur), checked through the API; the milestone's
     confirm 'Level up the party'; '2 characters can level up.'; 'Open Party to level up →' and both PCs show the
     level-up badge.
  10. The GM dashboard: 'Session 1', the Last Session card shows the recap (B9).
  11. The player: 'Session 1' without 'in progress', the recap on the dashboard; in the Sessions view (with no stage
      and with `stage=prep|play|wrap` in the URL) one Played session with title and recap, no tabs, no textboxes, no
      hooks / scene / encounter / log line / loot / threads text, no Spotlight / Session tally / Session log /
      Wrap-up / Live session regions (K10, Q4).
- `convex/levelUp.ts` (narrow, dcm-bxp.48): `SESSION_SCAN`, `isSessionBoundary` and the `actionLog` scan in
  `sessionBoundaryAfter` are gone; the boundary is only the live `campaignState.sessionStartedAt` or a `sessions` row
  started after / ended at or after the level-up (indexes `by_campaign_started`, `by_campaign_ended`).

## Migration (orchestrator, before or together with merging this tracer)
Run on the cloud dev deployment from the main checkout (and with `--prod` on production if it has been deployed with
D10). Dry run first:

```bash
npx convex run migrations/run:run '{fn: "migrations/sessions:backfillFromLog", dryRun: true}'
npx convex run migrations/sessions:backfillSessions '{dryRun: true}'
npx convex run migrations/sessions:backfillSessions
npx convex run --component migrations lib:getStatus
```

`backfillSessions` runs `backfillFromLog` then `backfillLive`; both must show `state: "success"`. Both are idempotent
(reset-safe). Until it has run on a deployment, pre-D10 sessions are not SS3 boundaries there (a player could undo a
level-up from an earlier pre-D10 session). Tried on this worktree's local e2e backend only (dry run, run, status:
both `success`).

## Rule checklist (B1-B12, K1-K10, E1-E7, Q1-Q12, user answers)
| Rule | Verdict | Evidence |
|---|---|---|
| B1 records, number, title, date, status, played toggle, delete twice, list, header line | OK | `tests/convex/session-records.test.ts` (create, setTitle, setDate, setPlayed, remove), `tests/e2e/session-records.spec.ts`; players' header line has no 'Next:' (S2 Q1, deliberate, Q4) |
| B2 three stage tabs; Start → Play, End → Wrap-up | OK | `tests/e2e/sessions-live.spec.ts`, `sessions-flow.spec.ts` steps 3, 6 |
| B3 Prep scenes, hooks, encounter builder | OK | `tests/convex/session-prep.test.ts`, `tests/e2e/session-prep.spec.ts`, flow step 2 |
| B4 Play spotlight, tally, log | OK | `tests/convex/session-play.test.ts`, `tests/e2e/session-play.spec.ts`, flow step 4 |
| B5 Wrap-up recap, loot, threads, milestone + link | OK | `tests/convex/session-wrap.test.ts`, `tests/e2e/session-wrap.spec.ts`, flow step 9 |
| B6 one live session; another start ends it first | OK | `sessions.test.ts` 'B6: …', `sessions-live.spec.ts` |
| B7 a played session starts again | OK | `sessions.test.ts` 'B7: …', flow step 7 |
| B8 dashboard Start Session (newest planned or new), opens Play | OK | `sessions.test.ts` 'B8: …', `dashboard.spec.ts` D10 S7, flow step 3 |
| B9 hero line, next session, Last Session card + fallbacks | OK | `session-wrap.test.ts` 'dashboard: …', `dashboard.spec.ts` D10 S7, flow steps 10-11 |
| B10 Start/End log stamps + party sync lines | OK | `sessions.test.ts` 'B10, K3: …', flow step 3 |
| B11 '+ Session encounter' (live else newest planned, titles, Solo 2 × 2) | OK | `tests/convex/session-encounter.test.ts`, `tests/e2e/session-encounter.spec.ts`, flow step 5 |
| B12 Witherwild Wither Tokens panel with End | OK | `wither.spec.ts`, `dashboard.spec.ts` D10 S7, flow step 8 |
| K1 Fear and Hope carry over | OK | `convex/sessions.ts` touches Fear only through the Wither gain; flow steps 6, 8 (Fear 2 kept, then 2 + N) |
| K2 once-per-session features refresh at the session boundary | OK | `sessions.test.ts` 'end clears session effects …', 'E2, E3: …' |
| K3 Rally / Prayer Dice (Spellcast trait) | OK | `sessions.test.ts` 'B10, K3: …', `sessions-live.spec.ts` (held Prayer d4s) |
| K4 Wither → Fear capped at 12, 'N Fear lost' | OK | `sessions.test.ts` 'end converts …', flow step 8 |
| K5 milestone flags the whole party | OK | `session-wrap.test.ts` 'callMilestone …', flow step 9 |
| K6 Battle Points from `budget.ts` only | OK | `convex/sessionPrep.ts` imports `src/lib/domain/encounters/budget.ts`; `session-prep.test.ts` 'createEncounter … counts Battle Points' |
| K7 spotlight rotation (due ringed) | OK | `session-play.test.ts` 'lists the active characters … due (Q12, K7)' |
| K8 loot on Wrap-up; countdowns untouched by Start/End | OK (code) | `convex/sessions.ts` writes no tracker; no test asserts it explicitly |
| K9 Horizon Doom Track reminder | OK, test gap | `sessions.test.ts` 'Q8, Q6: …' (reminder); the '(session N)' stamp in `trackers/horizon.tsx` is untested → dcm-bxp.60 |
| K10 players never see prep; Start/End GM only | OK | `session-prep.test.ts` 'get: … player FORBIDDEN (K10)', `sessions.test.ts` 'authorizes …', flow step 11 |
| E1 start idempotent, one undoable group, alreadyStarted | OK | `sessions.test.ts` 'start stamps the session once …' |
| E2 end effects; no-live End still clears effects | OK | `sessions.test.ts` 'end converts …', 'end is idempotent …', 'E2, E3: …' |
| E3 XC1 only while live | OK | `sessions.test.ts` 'XC1: …', `tests/convex/one-active.test.ts` |
| E4 SS3 within the session | OK, see note | `tests/convex/level-up.test.ts` SS3 block (17 tests pass unchanged after the narrowing); behaviour change for pre-D10 rows and no-live Ends → dcm-bxp.61 |
| E5 scene end is no boundary | OK | `level-up.test.ts` 'between sessions … an End scene is no boundary', `scenes.test.ts` |
| E6 undo of Start/End restores sheets and Fear | OK | `sessions.test.ts` 'Q7, E6: …', 'undoing the End restores …' |
| E7 existing arguments keep working | OK | `sessions.test.ts`, `one-active.test.ts`, `scenes.test.ts`, `class-features-core.test.ts`, `level-up.test.ts` pass (full vitest run) |
| Q1 one linked D8 encounter | OK | `session-prep.test.ts` createEncounter / linkEncounter |
| Q2 place starts a draft; another running refuses | OK | `session-encounter.test.ts`, `session-encounter.spec.ts` |
| Q3 automatic read-only tally; restart adds the window | OK | `session-play.test.ts` 'while live, counts …', `sessions.test.ts` 'B7: …', flow steps 4, 6 |
| Q4 players: read-only live / played list with recap | OK | `session-records.test.ts` 'list: …', flow steps 2, 11 |
| Q5 one-way milestone (+ confirm, user 2026-10-20) | OK | `session-wrap.test.ts`, `session-wrap.spec.ts` (Cancel then confirm), flow step 9 |
| Q6 Doom Track reminder + session stamp | OK, test gap | see K9 → dcm-bxp.60 |
| Q7 undo leaves status and times | OK | `sessions.test.ts` 'Q7, E6: …' |
| Q8 reminders only; automation follow-up | OK | `sessions.test.ts` 'Q8, Q6: …' (Lunar Phases not asserted → dcm-bxp.60); automation → dcm-bxp.58 |
| Q9 break refresh not in D10 | OK | follow-up dcm-bxp.59 (ask the user) |
| Q10 deleting a live session refused | OK | `session-records.test.ts` 'remove … refuses a live one' |
| Q11 backfill migration | OK | `tests/convex/sessions-migration.test.ts`; dev run pending (above) |
| Q12 spotlight lists active characters | OK | `session-play.test.ts` 'lists the active characters …' |
| User: manually played sessions keep dashes in the tally | OK | `session-play.test.ts` 'a planned session has no tally; a played one shows its stored counts' |
| User: automatic Start/End log lines can't be removed | OK | `convex/sessionPlay.ts` removeLog refuses `auto` (INVALID); `session-play.test.ts` 'addLog … removeLog'; UI hides × for auto rows |
| User: spotlight counts kept for dead / away characters | OK | rows per session and character (`sessionSpotlights`), only reset deletes them |
| User: milestone confirm | OK | `session-wrap.spec.ts`, flow step 9 |
| User: dashboard Start Session confirm | OK | `dashboard.spec.ts` D10 S7, flow step 3 (Cancel and confirm) |
| User: End keeps Wither (checkbox, preset by `witherPersists`, default off) | OK | `sessions.test.ts` 'keeps Wither on the sheets …', `wither.spec.ts`, flow steps 6 and 8 |

## Gaps and beads
- dcm-bxp.57 (P2): D12 authz-matrix entries for every D10 public function (follow-up the plan names).
- dcm-bxp.58 (P3): Q8 automation of Luckbringer, Slayer Dice, Know the Tide, Lunar Phases (follow-up the plan names).
- dcm-bxp.59 (P4): Q9 mid-session break refresh, ask the user first (follow-up the plan names).
- dcm-bxp.60 (P3): test gaps, the Horizon Doom Track '(session N)' stamp (Q6) and the Lunar Phases reminder (Q8).
- dcm-bxp.61 (P3): pin the narrowed SS3 behaviour in `tests/convex/level-up.test.ts` (outside S9's owns). After the
  narrowing, (1) a pre-D10 log row without a session row is no boundary (the backfill must have run), (2) an End
  pressed with no live session (the Wither panel's E2 path) is no boundary, because it writes no session row. (2) needs
  the user's confirmation. Proposed test (passes against this branch; reverted, not committed):

  ```ts
  it("dcm-bxp.48 narrowed (S9): a pre-D10 'Session started' log row without a session row is no boundary", async () => {
    const { t, gm, p1, campaignId, a, ids } = await leveled(1000);
    await t.run((ctx) => logAction(ctx, { campaignId, actorId: ids.gm, kind: "session", visibility: "public", summary: "Session started", undoable: true }));
    await t.run((ctx) => logAction(ctx, { campaignId, actorId: ids.gm, kind: "session", visibility: "public", summary: "Session ended.", undoable: true }));
    expect(await p1.query(api.levelUp.canUndo, { characterId: a })).toBe(true);
    // An End pressed with no session live writes no session row, so it is no boundary either.
    await gm.mutation(api.sessions.end, { campaignId, idempotencyKey: key() });
    expect(await p1.query(api.levelUp.canUndo, { characterId: a })).toBe(true);
  });
  ```
  (inserted before 'an older entry without `at` is GM only' in the SS3 block).
- No bug found by the flow; nothing is marked `test.fixme`.
- Not filed (deliberate choices recorded in earlier task docs): players' header line without 'Next:' (S2 Q1), Prep's
  'Open Adversaries' link without a deep link to the encounter (S4 Q2), one encounter linkable to two sessions (S4 Q4).

## Acceptance evidence
- `E2E_PORT=3102 E2E_CONVEX_PORT=3316 pnpm test:e2e tests/e2e/sessions-flow.spec.ts`: 2 passed (1440x900, 1024x768).
  Rerun with `level-up.spec.ts`, `sessions-live.spec.ts` and `dashboard.spec.ts`: 10 passed.
- `pnpm lint`: clean. `pnpm typecheck`: clean. `pnpm vitest run --maxWorkers=4 --testTimeout=60000`: 145 files,
  1687 tests pass (`tests/convex/level-up.test.ts` 17 unchanged).
- `pnpm tracer:guard .omc/plans/d10-sessions.yaml S9`: see the report.

## Visual comparison
None: S9 adds no UI. The flow runs at 1440x900 and 1024x768 without layout failures; region shots are in the
D10-S2 … S8 visual specs.
