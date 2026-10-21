# TASK-CD-K1: Rolls tick countdowns

Status: Review. Plan: `.omc/plans/countdowns-advanced.yaml`, tracer K1 (wave 2), depends on K0. Bead: dcm-bxp.70.
Title: Rolls tick countdowns - armed countdowns on every counted PC action roll, Tag Team once, the feed's Tick countdowns button.
Binding answers used here: Q1 (c), Q2 (a), Q5 (a).

## Book rules implemented (quoted; printed pages re-checked in the Core Book PDF, PDF page N = printed N-1)

- R2 (CB p.162): a standard countdown "ticks down every time a player makes an action roll, regardless of the result. When the countdown die reaches 0, the countdown's effect triggers immediately after the last action roll is resolved."
- R4 (CB p.163), Dynamic Countdown Advancement, progress / consequence: Failure with Fear 0 / 3; Failure with Hope 0 / 2; Success with Fear 1 / 1; Success with Hope 2 / 0; Critical Success 3 / 0.
- R8 (CB p.163): "When a PC succeeds on an action roll, it ticks down their countdown, which is a progress countdown. When they fail on an action roll—or roll a success with Fear—it ticks down the other party's countdown, which is a consequence countdown."
- R10 (CB p.97): "A Tag Team Roll counts as a single action roll for the purposes of any countdowns or features that track action rolls."
- R11 (CB p.99): "Reaction rolls work similarly to action rolls, except they don't generate Hope, Fear, or additional GM moves." They are not action rolls, so they never tick a countdown.

## Server

- `convex/countdownRolls.ts`
  - `tickArmedCountdowns(ctx, { campaignId, entryId, outcome, actorId })` (helper, not a function): reads armed countdowns through `by_campaign_armed` (bounded take), skips frame-owned, inactive and long-term ones (D4), works out every amount first (`rollTicks`, or `chaseTicks` from the pair as it stood, D9) and then ticks each through K0's `applyTick` with source `"roll"` and the roll row as entryId (D5, D6).
  - `preview` (gmQuery `{ entryId }`): `{ outcome, countdowns: [{ countdownId, name, mode, armed, currentValue, amount, ticked }] }` for each active dashboard countdown that is not long-term. NOT_FOUND for another campaign's (or removed) row; INVALID for a row that is not a counted roll or is undone.
  - `applyRoll` (keyedGmMutation, rate limit `roll`, `{ entryId, countdownIds }`): ticks each chosen countdown with source `"feed"`, armed or not; all or nothing. NOT_FOUND for a row or countdown of another campaign or a frame-owned countdown; INVALID for no ids, an undone or not counted row; COUNTDOWN_RULE for a pair already ticked (by the roll or the feed), a countdown that isn't active (paused, completed) and a long-term countdown. Returns `[{ countdownId, currentValue, triggered }]`.
  - `countedRows` (gmQuery `{ entryIds }`, at most 100): which of the given rows are counted rolls, so the feed knows where to show the button. Added beyond the plan's two functions: the feed rows do not say whether a roll row is a pending Tag Team roll, a picked one, or the result that counts.
  - Counted rows (D2, D3, through `countsAsActionRoll`): a plain row of kind `roll` with an action roll (outcome as recorded); in a Tag Team group (2-4 action-roll rows) only the first result row (the third row in log order, once applied). Reaction, damage, GM free rolls, pending or picked-from Tag Team rolls, the second result row and undone rows never count.
- `convex/rolls.ts`: `duality` (actionRoll, manualRoll) calls `tickArmedCountdowns` after logging the row when `countsAsActionRoll` says so (never a reaction roll); `tagTeamApply` keeps the first result row's id and ticks once with the chosen roll's outcome (R10). Arguments and results of every rolls function are unchanged (E6). A failing manual roll (unused dice) still rolls the whole mutation back, ticks included.
- Undo: `actionLog.undo` takes the ticks back through K0's `undoEntry` hook (D11, Q5); a Tag Team's tick sits on its first result row, which is in the undone group.

## UI

- `src/components/party/dice/roll-feed.tsx`: for the GM, one `countedRows` query over the loaded, not undone action-roll rows; counted rows get a "Tick countdowns" button (aria-label "Tick countdowns: <summary>") next to Undo / Reveal. Players never see it (the query is skipped and the server refuses it).
- `src/components/party/dice/tick-countdowns.tsx`: the button opens the shared `Modal` ("Tick countdowns"), whose list sits in a `DiceBoundary` and loads with a `role=status` line. It names the roll's outcome, then a checkbox per countdown with its value left and "−n" (or "no tick"); countdowns this roll already ticked are checked, disabled and marked "ticked"; a 0 tick is disabled. Apply calls `applyRoll` with an optimistic update of `countdowns.listByCampaign` (computed with `rollTicks` / `chaseTicks` and `tickCountdown`, no second copy of a rule) and of the preview's `ticked` flags. Errors show in an `aria-live` line. Touch targets are 44 px rows and 40 px buttons as in the rest of the feed.
- Trigger notices are K0's GM-only `countdown` log rows, so they appear in the GM's feed without UI changes here.

## Tests

- `tests/convex/countdown-rolls.test.ts` (18 tests): preview, applyRoll and countedRows for anonymous (UNAUTHENTICATED), outsider (NOT_FOUND), player (FORBIDDEN) and GM; standard ticks on each outcome with history and tick rows; progress and consequence by R4 cell by cell; a roll without a Difficulty counts as a success (manual and server-rolled); reaction, damage and GM rolls tick nothing; paused, completed, unarmed, long-term and frame-owned countdowns are not auto-ticked; a dynamic 3 on 2 left clamps and triggers with one GM-only notice; a loop resets and keeps counting; a Tag Team ticks once, keyed on the first result row, and its pending rolls tick nothing; a chase pair follows the book's example (party 6, thief 3: success with Hope moves the party 6 -> 4, success with Fear moves both, failure with Fear moves the thief 2 -> 0) and stops once one side is at 0; undo takes back roll and feed ticks (a trigger included, its notice marked undone); preview lists amounts and ticked flags; feed apply refusals (already ticked automatically or by the feed, undone, reaction, pending Tag Team, foreign campaign, frame-owned, paused, long-term, empty) leave nothing moved; countedRows names only plain action rolls and a Tag Team's first result row.
- `tests/convex/rolls.test.ts` and `rolls-session-features.test.ts` pass unchanged.
- `tests/e2e/countdown-rolls.spec.ts`: the GM creates "Countdown 4" in the existing dialog (unarmed); the player's manual action roll with Hope leaves it at 4; the GM opens "Tick countdowns" on the row and applies it (card 3/4); after a reload the row's list shows it checked, disabled and "ticked"; the player sees no button, undoes the roll within the minute, and the GM's card is back at 4/4.
- `tests/e2e/visual/CD-K1.spec.ts` (@visual): the feed row with the button and the open list (a pickable countdown, one already ticked by the auto-tick, a progress countdown the failure doesn't move) at 1440, 1024 and 390.

## Deviations and notes

- `countedRows` is a third public function (see above).
- `liveTick` in `convex/lib/countdownTicks.ts` takes a `MutationCtx`; the preview is a query, so `countdownRolls.ts` reads `by_entry_countdown` itself (`tickedBy`), same rule (a tick not reverted).
- applyRoll refuses long-term countdowns with COUNTDOWN_RULE (they tick on long rests, R9); the plan left this open.
- A chase row whose partner is unarmed still ticks by `chaseTicks` (the pair's own arm switch is K3's).

## Visual shots (test-results/visual/CD-K1/, not committed)

- `feed-row-{1440,1024,390}.png`: the row with Undo and "Tick countdowns" (hourglass icon) in the feed's button style; at 390 the buttons wrap under the dice, no horizontal scroll. Verdict: matches the feed's look.
- `tick-list-{1440,1024,390}.png`: the "Tick countdowns" modal in the dashboard's dialog look: the outcome line, a 44 px row per countdown (a picked "−1", an auto-ticked one checked, disabled and "ticked", a progress countdown with "no tick"), Apply and Close. Verdict: good; deliberate deviation: no board design exists for this dialog, so it reuses the New countdown dialog's palette.
