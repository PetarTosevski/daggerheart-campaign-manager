# TASK-CD-K5: End-to-end pass, docs and follow-ups

Status: Review. Plan: `.omc/plans/countdowns-advanced.yaml`, tracer K5 (wave 4), depends on K3 and K4. Bead: dcm-bxp.70 (the orchestrator closes it at merge).
Binding answers used here: U1, Q1 (c), Q2 (a), Q3 (Automatic / Reminder), Q4 (a), Q5 (a), Q-K3-1 (the table, not the book's "3 to 1" example), K4-Q1 (unarmed long-term does nothing on a long rest).

## Book rules exercised (quoted as K0-K4 re-checked them; printed pages)

- R2 (CB p.162): a standard countdown "ticks down every time a player makes an action roll, regardless of the result."
- R4 (CB p.163), progress / consequence per PC action roll: Failure with Fear 0 / 3; Failure with Hope 0 / 2; Success with Fear 1 / 1; Success with Hope 2 / 0; Critical Success 3 / 0.
- R6 (CB p.163): "After this type of countdown triggers and you apply its effects, it resets to its starting value and begins counting down again."
- R8 (CB p.163): "When a PC succeeds on an action roll, it ticks down their countdown, which is a progress countdown. When they fail on an action roll—or roll a success with Fear—it ticks down the other party's countdown, which is a consequence countdown."
- R9 (CB p.164): "During a long rest, you should generally tick down a relevant long-term countdown once."
- R10 (CB p.97): "A Tag Team Roll counts as a single action roll for the purposes of any countdowns or features that track action rolls."
- R11 (CB p.99): "Reaction rolls work similarly to action rolls, except they don't generate Hope, Fear, or additional GM moves."

## The flow spec: `tests/e2e/countdowns-flow.spec.ts`

One test, run at 1440x900 and 1024x768 (a fresh campaign each). The GM creates, through the dialogs: "Rockfall" (Standard, Loop 3, armed), "Climb the cliff" (Progress 6, armed), "Alarm" (Consequence 6, armed), "The dam breaks" (Standard 4, unarmed), "Invasion" (Long-term 4, armed, Automatic, a step at 3 and the final event) and a chase (d10, decent lead, PCs pursuing: the party 10, the thief 7). A player joins with a Bard; the GM makes a second PC for the Tag Team. Expected values are the spec's own copy of the R4 table; after every step the spec waits for the server (`expect.poll` on `countdowns.listByCampaign`) and checks the cards.

| Step | Rockfall | Climb | Alarm | Dam | Invasion | Party | Thief |
|---|---|---|---|---|---|---|---|
| start | 3 | 6 | 6 | 4 | 4 | 10 | 7 |
| success with Hope (no Difficulty, D3) | 2 | 4 | 6 | 4 | 4 | 8 | 7 |
| failure with Fear | 1 | 4 | 3 | 4 | 4 | 8 | 4 |
| critical: the loop triggers, back at 3, "Triggered 1 time", GM feed notice "Rockfall triggered: Stones rain down." (hidden) | 3 | 1 | 3 | 4 | 4 | 5 | 4 |
| reaction roll (R11) | = | = | = | = | = | = | = |
| Tag Team started (pending pick) | = | = | = | = | = | = | = |
| Tag Team applied, outcome X read back (success or critical) | 2 (once) | 0, completed | 3 - c(X) | 4 | 4 | 5 - p(X) | 4 - c(X) |
| GM: Tick countdowns on the first roll, Rockfall shown checked + disabled, Dam -1 | | | | 3 | | | |
| success with Fear, then the player's Undo | ticks and comes back | | | | | | |
| long rest finished (track highlights step 3, rest panel line) | = | = | = | = | 3 | = | = |

Player view (D12): badges Loop 3 / Triggered 1 time / Progress / Consequence / Long-term and the chase card; no Armed switch, no step text, no Edit steps, no notice rows, no "Tick countdowns" button; after the rest the player sees 3/4 with one ticked box and no step. No horizontal page scroll at either width.

Result: with the one-line G1 fix applied (see below) 2 passed, and 6/6 with `--repeat-each=3`. On this branch as committed, both runs fail at the single G1 assertion (no Undo on the rest's countdown notice); every earlier step passes.

## Rule-by-rule check

How each was checked: E2E = the flow spec above; T = existing Convex / unit tests (read and run: full vitest 165 files, 2075 tests green); C = code read.

| Rule | Verdict | Evidence |
|---|---|---|
| R1 reaching 0 ends and triggers | ok | E2E (Climb completes, "THE COUNTDOWN HAS STRUCK"); T countdown-advanced, countdown-ticks |
| R2 standard ticks on every action roll | ok | E2E (Rockfall ticks on success and failure) |
| R3 dynamic progress / consequence | ok, gap G4 | E2E; the dialog does not hint the book's typical 5-10 start |
| R4 advancement table | ok | E2E (five outcomes across Climb, Alarm, chase); T cell by cell |
| R5 randomized start | ok | T countdowns-modes; e2e countdowns-modes (1d6, Loop 1d4) |
| R6 loop | ok | E2E (trigger on a roll, back at 3) |
| R7 increasing / decreasing, major event | ok | T countdowns-modes, countdown-ticks (8 -> 9, past 20, decreasing to major event) |
| R8 chase | ok, gaps G2, G6 | E2E; T countdowns-chase (book example, Q-K3-1 table) |
| R9 long-term on a long rest | ok | E2E; T countdowns-long-term |
| R10 Tag Team counts once | ok | E2E (Rockfall 3 -> 2, not 1; pending pick moves nothing); T countdown-rolls |
| R11 reaction rolls never tick | ok | E2E; T countdown-rolls |
| D1 modes, absent = standard unarmed | ok | T countdown-ticks (legacy rows) |
| D2 counted rolls | ok | E2E (reaction, pending Tag Team); T (damage, GM rolls, undone) |
| D3 recorded outcome, no Difficulty = success | ok | E2E (all rolls but the failure have no Difficulty) |
| D4 armed, paused/completed/frame-owned never auto-tick, dialog + environment arm by default | ok | E2E (unarmed Dam untouched, completed Climb untouched); T; C `tickArmedCountdowns` |
| D5 one tick per (roll, countdown) | ok | E2E (already-ticked rows checked + disabled); T |
| D6 tick after the roll's effects, clamp at 0 | ok | E2E (Climb 1 - 2/3 stops at 0); C `duality` ticks after `logAction` |
| D7 trigger, reset, history, GM-only notice | ok, gap G3 | E2E (notice hidden, ordinal in T); a paused repeating countdown corrected to 0 un-pauses |
| D8 server rolls dice, reset reuses the roll | ok | T countdowns-modes |
| D9 chase pair, arm / visibility / cancel / pause pair-wide, ends at 0 | ok, gaps G2, G6 | E2E; T countdowns-chase; e2e countdowns-chase |
| D10 long-term track, steps GM-only | ok | E2E (player sees no step); T |
| D11 undo takes ticks back | ok | E2E (player's undo); T (rest undo, trigger revert, kept after a manual change) |
| D12 player redaction | ok | E2E; T countdowns, countdown-advanced |
| E1 applyCountdownAction rules | ok | T countdown-domain, countdown-validation, countdowns-modes (refusals unchanged) |
| E2 categories, MAX 20, presets, redaction | ok | T countdowns; createChase and dice capped at 20 (C) |
| E3 one history row per change | ok | T history; C (arming, steps and rest mode change no value, so no row, as the K2/K4 docs say) |
| E4 environment Start | ok | T environment-actions, countdowns-modes |
| E5 frame-tracker countdowns untouched | ok | T five-banners, rests, rest-frame-hooks |
| E6 rolls / undo shapes | ok | T rolls, rolls-session-features |
| E7 old countdowns look as today | ok with K2's recorded deviation | a GM's card of an old countdown shows the Armed switch (off); players see it as before |

## Gaps (each filed under dcm-bxp)

- **G1, dcm-bxp.72 (P2, bug):** after a long rest that ticked or reminds, the GM's feed row "Long rest: Invasion: 3 left - ..." (kind `countdown`, undoable, in the rest's group) shows an **Undo** button that always fails: `actionLog.undo` refuses rows of a rest group ("Undo a rest from the rest panel."). The row must stay undoable, because `rests.undo` → `undoEntry` refuses a group with a non-undoable row. Suggested fix (verified: with it the flow passes 6/6, and tests/convex feed, rests and countdowns-long-term pass):

  ```diff
  --- a/convex/feed.ts
  +++ b/convex/feed.ts
  @@ -64,7 +64,7 @@ export const list = campaignQuery({
  -        canUndo: row.undoable && row.kind !== "rest" && row.undoneAt === undefined && (isGm || row.actorId === ctx.user._id),
  +        canUndo: row.undoable && row.kind !== "rest" && row.kind !== "countdown" && row.undoneAt === undefined && (isGm || row.actorId === ctx.user._id),
  ```

  The flow spec asserts the fixed behaviour.
- **G2, dcm-bxp.73 (P3):** if both chase rows are at 1, a success with Fear takes both to 0; the card reports only the party's side. The book does not cover a simultaneous end: user question.
- **G3, dcm-bxp.74 (P3):** a downward correction to 0 on a paused loop / increasing / decreasing countdown triggers, resets and leaves it active (no longer paused). Deliberate in K2's tests, but the plan does not decide it: user question.
- **G4, dcm-bxp.75 (P3):** the New countdown dialog hints 4-12 for long-term (R9) but not the book's typical 5-10 for dynamic countdowns (R3).
- **G5, dcm-bxp.76 (P3):** `manualTickAmount` is written in `convex/countdowns.ts` and copied in `countdowns/card.tsx` (K2's recorded follow-up), against the plan's "no second copy of a rule".
- **G6, dcm-bxp.77 (P3):** the feed's "Tick countdowns" lists the two chase rows as separate checkboxes, so the GM can apply a roll to one side only, although R8 / D9 say one roll moves both. User question: tick the partner too, or show the pair as one entry.

## Follow-up beads

- **dcm-bxp.78 (P3):** Start buttons for adversary stat-block countdowns ("Countdown (Loop 1d6)", "Countdown (Decreasing 8)", "Countdown (1d12)").
- **dcm-bxp.79 (P2):** authz-matrix entries for every function this plan added or changed:
  - added: `countdowns.setArmed`, `countdowns.createChase`, `countdownRolls.preview`, `countdownRolls.applyRoll`, `countdownRolls.countedRows`, `countdownTracks.setStep`, `countdownTracks.setRestMode`, `countdownTracks.afterRest`, `countdownTracks.tickOnRest`;
  - changed: `countdowns.create`, `countdowns.listByCampaign`, `countdowns.operate`, `countdowns.setVisibility`, `environmentActions.startCountdown`, `rolls.actionRoll`, `rolls.manualRoll`, `rolls.tagTeamApply`, `rests.finish`, `rests.interrupt` (shared result gained `countdownLines`), `rests.undo` and `actionLog.undo` (take back ticks through `undoEntry`).

## Checks

`pnpm lint` (0), `pnpm typecheck` (0), `pnpm test` (165 files, 2075 tests), the flow spec as above, `pnpm tracer:guard .omc/plans/countdowns-advanced.yaml K5`.
