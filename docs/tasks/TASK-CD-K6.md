# TASK-CD-K6: K5 gaps (GM decides a double-zero chase, paused stays paused, feed rolls tick both chase sides, start hint, one manualTickAmount)

Status: Review. Plan: `.omc/plans/countdowns-advanced.yaml`, tracer K6 (wave 5), depends on K5. Beads: dcm-bxp.73, .74, .75, .76, .77 (the orchestrator closes them at merge).

Binding answers used here (plan K6 header, 2026-10-21): G2 "gm decides"; G3 "stay paused until unpause"; G6 "let GM do whatever he wants with the countdown, rolls tick both sides". Orchestrator's choice for G3 (asked during the run): nothing triggers while paused. A paused countdown corrected to 0 stays paused at 0, with no trigger, reset or completion. On Resume, a repeating countdown triggers (notice, triggerCount +1) and resets to its next start, active; a countdown that doesn't repeat completes (completedAt set, no trigger notice).

## Book rules (printed pages, as K0-K5 quoted them)

- R3 (CB p.162): dynamic countdowns: "Typically, these countdowns have a starting value of 5-10".
- R8 (CB p.163): "Regardless of whether the PCs are pursuing or escaping, their action rolls advance both countdowns, as shown on the earlier Dynamic Countdown Advancement table." The book doesn't say what it means when both countdowns reach 0 on the same roll, so the GM decides (user answer G2).

## What changed

### G2, dcm-bxp.73: the GM decides a double-zero chase
- `convex/tables/countdowns.ts`: new optional field `chaseResult: "caught" | "escaped"` (widen only, no migration). It is set on both rows of a pair.
- `src/lib/domain/countdowns/advanced.ts`: `CHASE_RESULTS` and `chaseNeedsDecision(pair)`, which is true when both sides are at 0 and neither is cancelled.
- `convex/countdowns.ts` `decideChase` (new, `keyedGmMutation { campaignId, countdownId, result }`, returns `{ result }`):
  - Errors: NOT_FOUND for a frame-owned countdown or one from another campaign; COUNTDOWN_RULE for a row outside a chase, or a chase that isn't at 0 on both sides.
  - Writes both rows, plus one history row `decide` per row (the values don't change). The GM may change the call.
  - There is no undo path, the same as for the other manual countdown operations.
- `chaseResult` is cleared on both rows when a side moves back above 0:
  - Borrowed Time or an upward correction (`operate`);
  - an undone roll (`revertTicks` → `clearChaseResult` in `convex/lib/countdownTicks.ts`).
- `listByCampaign` view gains `chaseResult` (null when absent). For players it travels with "progress" (`COUNTDOWN_PROGRESS_FIELDS`), so it is blanked when the GM hides the progress.
- Card (`countdowns/chase.tsx`):
  - When both sides are at 0 and nothing is stored, `chaseOutcome` returns `{ deciding: true }`. The GM sees "Both sides reached 0", "The book doesn't say who wins. Your call:" and two 44 px buttons, "Caught!" and "Got away!" (optimistic on both rows).
  - Players see "The GM is deciding how the chase ends." with no buttons.
  - Once stored, the usual banner shows ("Caught!" / "The party caught The thief.").

### G3, dcm-bxp.74: a paused countdown stays paused
- `applyCountdownAction` (`src/lib/domain/countdowns/index.ts`):
  - A correction of a paused countdown leaves it paused, at 0 too, with no completion.
  - Resume of a paused countdown at 0 returns `completed` with `completedNow`.
- `resumeAtZero(state)` (advanced.ts): resuming at 0 triggers and resets a repeating countdown (loop, increasing, or the decreasing major event). A countdown that doesn't repeat completes without a trigger.
- `applyTick(..., { resume: true })` (source `resume`) runs it, so a trigger writes its `trigger` history row and its GM notice like any other. A completion writes a `resume` history row (paused 0 → completed 0).
- `operate` uses it for Resume at 0, also for a chase partner paused at 0.
- `manualTickAmount` no longer sends paused corrections through the tick path, and `whilePaused` is no longer used by `operate` (the domain option stays).
- Tests changed to the new rule:
  - `tests/convex/countdowns-modes.test.ts`: K2's opposite test is replaced, and two tests are added (one for a countdown that doesn't repeat, one for the decreasing major event on Resume).
  - `tests/convex/history.test.ts` line 72: the paused correction to 0 now ends `paused`.
  - `tests/unit/countdown-actions.test.ts`: the paused correction to 0 stays paused, and a new line checks that Resume at 0 completes.

### G4, dcm-bxp.75: start hint
- `countdowns/new-dialog.tsx`: under "Start", Progress and Consequence show "Dynamic countdowns typically start at 5-10." (`data-testid="dynamic-start-hint"`). Standard and Long-term don't; Long-term keeps its 4-12 line.

### G5, dcm-bxp.76: one manualTickAmount
- `manualTickAmount(countdown, action, amount)` now lives only in `src/lib/domain/countdowns/advanced.ts`. `convex/countdowns.ts` and `countdowns/card.tsx` import it; the card's copy is deleted.
- The card's `operatedView` also uses `resumeAtZero` for Resume at 0.

### G6, dcm-bxp.77: the feed ticks both chase sides
- `countdownRolls.preview`: a chase pair is ONE row, on the party's side. It has a new optional `partner` field `{ countdownId, name, currentValue, amount, ticked }`, which is the rivals' side with its own chaseTicks amount (widened `returns`). The pair is listed while either side is active.
- `countdownRolls.applyRoll`:
  - Choosing either side also ticks its partner, by chaseTicks, under the same roll row. Undoing the roll takes both back (one undo).
  - A partner the roll doesn't move (amount 0) writes nothing.
  - Ticking a pair a second time is still refused (COUNTDOWN_RULE, D5).
  - Arguments are unchanged. The result lists the partner too.
- `tick-countdowns.tsx`:
  - The pair is one checkbox, labelled "Chase: The party and The thief", with "Chase · both sides move" and each side's "−n".
  - The pair counts as ticked when either side was.
  - The optimistic update adds the partner, as the server does.
- The GM's manual Tick −1 and Borrowed Time per side on the card are unchanged.

## Public functions

- Added: `countdowns.decideChase`.
- Changed:
  - `countdowns.listByCampaign` (returns gains `chaseResult`);
  - `countdowns.operate` (paused corrections and Resume at 0; args and returns unchanged);
  - `countdownRolls.preview` (returns gains optional `partner`);
  - `countdownRolls.applyRoll` (ticks the chase partner; args and returns unchanged).

## Tests

- `tests/unit/countdown-advanced.test.ts`: manualTickAmount; resumeAtZero (loop, increasing, decreasing, a countdown that doesn't repeat, refusals); chaseNeedsDecision; chaseResult redaction.
- `tests/convex/countdowns-chase.test.ts`, decideChase:
  - each role: anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN, GM ok;
  - both rows and history; players see null until the call;
  - COUNTDOWN_RULE when only one side is at 0, or for a countdown outside a chase;
  - hidden progress blanks the call;
  - undo and Borrowed Time clear it.
- `tests/convex/countdowns-modes.test.ts`: see G3.
- `tests/convex/countdown-rolls.test.ts`: a pair is one preview row with `partner`; applying the rivals' side ticks both (feed ticks), a second apply is refused, and undo restores both; a side the roll doesn't move stays.
- e2e:
  - `tests/e2e/countdowns-chase.spec.ts`, new test: d4 with a small lead, ticked by hand to 1/1; a success with Fear; the GM's card asks while the player's says "The GM is deciding"; the GM picks "Caught!"; the server stores `caught` on both rows (`expect.poll`) and the player sees "Caught!".
  - `tests/e2e/countdown-rolls.spec.ts`, new test: the 5-10 hint for Progress and Consequence, not for Standard or Long-term; an unarmed chase is one row in Tick countdowns, Apply moves 6/3 to 5/2 (server polled), the row shows it ticked after a reload, and the player's undo restores 6/3.

## Screenshots (`test-results/visual/CD-K6/`, not committed)

- `double-zero-1440.png`, `double-zero-390.png`: the GM's double-zero card with the two buttons. Pass: one column at 390, no horizontal page scroll, buttons 44 px.
- `double-zero-player-1440.png`: the player's card, "The GM is deciding". Pass.
- `double-zero-decided-1440.png`: after "Caught!". Pass.
- `feed-chase-row-1440.png`, `feed-chase-row-390.png`: Tick countdowns with the chase as one row. Pass.
- Deliberate deviation: the double-zero panel reuses the ended-chase banner's palette (no board design exists for it).

## QUESTIONS

- G3 Resume semantics (the orchestrator's choice, see above): nothing triggers while paused, and the trigger or completion happens on Resume.
- Undo of Resume: manual countdown operations have no undo path (only history rows; `countdownTicks` covers roll, feed and rest rows only), so Resume is recorded in history like the other manual operations, with no new undo path. The same goes for `decideChase`.
