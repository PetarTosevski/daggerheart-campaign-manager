# TASK-CD-K0: Countdown foundation (fields, tick table, pure rules, server tick path with undo, dashboard split)

Status: Review. Plan: `.omc/plans/countdowns-advanced.yaml`, tracer K0 (wave 1, foundation). Bead: dcm-bxp.70.
Binding answers used here: U1, Q1 (c), Q2 (a), Q3 (field only: `restMode`), Q4 (a), Q5 (a).

## Book rules implemented (quoted, printed pages re-checked in core.txt, "PAGE N" block = printed N-1)

- R1 (CB p.162): "Each time the countdown ticks down, turn the die to reduce its value by one. When the countdown ticks down from 1 to 0 (which doesn't appear on the die), the countdown ends and triggers the event you were counting down to."
- R2 (CB p.162): a standard countdown "ticks down every time a player makes an action roll, regardless of the result. When the countdown die reaches 0, the countdown's effect triggers immediately after the last action roll is resolved."
- R3 (CB p.162): dynamic countdowns are "either a progress countdown (if players are working toward a desired outcome) or a consequence countdown (if players are trying to avoid a dreaded outcome)."
- R4 (CB p.163), Dynamic Countdown Advancement, progress / consequence: Failure with Fear "No advancement" / "Tick down 3"; Failure with Hope "No advancement" / "Tick down 2"; Success with Fear "Tick down 1" / "Tick down 1"; Success with Hope "Tick down 2" / "No advancement"; Critical Success "Tick down 3" / "No advancement".
- R5 (CB p.163): "a “Countdown (1d6)” means that you roll 1d6 and use the result as the countdown’s starting value."
- R6 (CB p.163): "After this type of countdown triggers and you apply its effects, it resets to its starting value and begins counting down again."
- R7 (CB p.163): "“Countdown (Increasing 8)” begins at 8, then after its effect triggers, the starting value resets to 9, then 10, and so on." / "“Countdown (Decreasing 8)” begins at 8, then resets to 7, then 6, and so on. Once a decreasing countdown reaches 0, a major event triggers".
- R8 (CB p.163): "set that die at a lower value to reflect how much of a lead they have (1 lower for a small lead, 3 lower for a decent lead, 5 lower for a substantial lead)" / "When a PC succeeds on an action roll, it ticks down their countdown, which is a progress countdown. When they fail on an action roll—or roll a success with Fear—it ticks down the other party’s countdown, which is a consequence countdown." Example: the PCs' d6 at 6, the thief at 3; success with Hope "from 6 to 4", failure with Fear "from 3 to 1".
- R9 (CB p.164): "decide how far out the event should be (usually between 4 and 12 ticks) and, on a piece of paper, create small boxes for each tick" / "During a long rest, you should generally tick down a relevant long-term countdown once."
- R10 (CB p.97): "A Tag Team Roll counts as a single action roll for the purposes of any countdowns or features that track action rolls."
- R11 (CB p.99): "Reaction rolls work similarly to action rolls, except they don’t generate Hope, Fear, or additional GM moves."

## Data model (widen only, every field optional, no migration)

- `countdowns` (`convex/tables/countdowns.ts`) gains `mode` (standard | progress | consequence | longTerm), `armed`, `repeat` (loop | increasing | decreasing), `initialValue`, `startDice` ({ count, sides 4|6|8|10|12|20 }), `triggerCount`, `lastTriggeredAt`, `chase` ({ partnerId, side party|rivals, party pursuing|escaping }), `steps` ([{ value, text, news? }], at most 21), `restMode` (auto | remind; Q3, absent = auto), and the index `by_campaign_armed [campaignId, armed]`.
- New table `countdownTicks`: { campaignId, countdownId, entryId (actionLog), source roll|feed|rest, amount, before, after (each { currentValue, startingValue, status, triggerCount, completedAt?, lastTriggeredAt? }), noticeId?, revertedAt?, at }. Indexes `by_entry_countdown [entryId, countdownId]` and `by_campaign_at [campaignId, at]`. Deviation: the plan's separate `by_entry` index is left out, because it would be a field-prefix duplicate of `by_entry_countdown` (CD15, schema-guard); `eq("entryId")` on `by_entry_countdown` serves it. `before/after` also carry `completedAt` and `lastTriggeredAt` so an undo restores them exactly. Campaign-scoped: purged in `convex/cleanup.ts`, no TTL.
- `history.countdownValue` gains `startingValue?` (written when a reset or its undo moves the start).
- `actionKindValidator` gains `"countdown"` (the GM-only trigger notice).

## Pure domain

- `src/lib/domain/countdowns/advanced.ts`: `rollTicks`, `DYNAMIC_ADVANCEMENT`, `tickCountdown` (D6 clamp, D7 trigger and resets, R7 major event, D8/Q4 start reuse, `whilePaused` for corrections), `nextCycleStart`, `countdownNoticeText`, `chaseEnded`, `chaseTicks`, `chaseStart`, `chaseRowValues`, `chaseLeadTicks`, `countsAsActionRoll`, `validateSteps`, `startFromDice`, and the constants (modes, repeats, rest modes, dice sides, `MAX_REPEAT_START` 100, step limits, `CHASE_LEADS`).
- `src/lib/domain/countdowns/labels.ts`: `parseCountdownLabel` for every label the SRD environments name, plus "Increasing", "Decreasing", "(1d6)" and "(Long-Term 4)".
- `index.ts` keeps every export. `countdownForPlayer` now also blanks mode, repeat, initialValue, triggerCount and lastTriggeredAt with hidden progress, and always nulls armed, startDice, steps and restMode (D12). Fields the input lacks stay absent.
- `src/lib/validation/countdowns.ts`: `countdownDetailsSchema` takes the optional mode, repeat, startDice, armed, steps and restMode, and needs exactly one of `startingValue` or `startDice`. A long-term countdown has no repeat and no dice (a track needs a known start); steps and restMode are allowed for long-term countdowns only. Steps sit within 0..start, one per value, 1-200 characters.

## Server

- `convex/lib/countdownTicks.ts` is the one tick path; its header holds the contract. `applyTick(ctx, countdown, amount, { source, entryId?, actorId }, { whilePaused? })` refuses frame-owned rows (NOT_FOUND), a second tick of a (row, countdown) pair (COUNTDOWN_RULE), and a countdown that isn't active (COUNTDOWN_RULE, as a RuleError the wrappers convert). It patches the row, writes one history row (the source, or `"trigger"`), on a trigger logs one GM-only, non-undoable notice row without a groupId, and records `countdownTicks` when given an entryId. A tick of 0 writes nothing. `revertTicks(ctx, entryIds, actorId)` reverts newest first where the countdown still equals `after`, and returns `{ reverted, kept }`.
- `undoEntry` (`convex/lib/actionLog.ts`) calls `revertTicks` for every row of the undone group. Its result is unchanged.
- `countdowns.create` takes the new args (dice rolled on the server and capped 1..20, `initialValue` set when it repeats, steps normalised by `validateSteps`) and gained a `returns` validator; it left the schema guard's RETURNS_PENDING. `listByCampaign` returns the new fields (GM defaults: mode standard, armed false, triggerCount 0; steps and restMode set for long-term countdowns only), redacted for players.

## Dashboard split

`countdowns.tsx` is now `countdowns/index.tsx` (the list), `card.tsx`, `new-dialog.tsx`, `visibility.tsx` and `shared.ts` (the button class and category labels, so the UI tracers own disjoint files). Nothing visible or behavioural changed.

## Tests

- `tests/unit/countdown-advanced.test.ts` (45 tests): the R4 table cell by cell, standard and long-term ticks, clamping, loop / increasing / decreasing, the major event, dice start reuse, the book's chase example, leads, countsAsActionRoll, every SRD environment label, validateSteps, the schema rules and D12 redaction.
- `tests/convex/countdown-ticks.test.ts` (22 tests): create with each new field for anonymous, outsider, player and GM; the GM list; INVALID shapes; player redaction; applyTick (standard, a 0 tick, 3 on 2 left, loop, increasing 8 -> 9, decreasing to the major event, dice reuse, double tick, paused and frame-owned refusals); reverts through `actionLog.undo` (a trigger, a completion, skipped after a manual change, several ticks newest first); legacy rows list and operate as before.
- `tests/convex/schema-guard.test.ts` and `tests/convex/cleanup.test.ts` are edited at the orchestrator's request: `countdownTicks` is campaign-scoped and seeded.
