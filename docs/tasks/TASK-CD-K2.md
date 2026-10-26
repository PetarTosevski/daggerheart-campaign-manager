# TASK-CD-K2: Dashboard types (mode, loop / increasing / decreasing, dice start and Armed in the dialog and the card; environment labels)

Status: Review. Plan: `.omc/plans/countdowns-advanced.yaml`, tracer K2 (wave 2, depends on K0). Bead: dcm-bxp.70.
Binding answers used here: U1, Q1 (c), Q2 (a), Q4 (a).

## Book rules implemented (quoted; printed pages re-checked 2026-10-21 with pdfjs-dist in the Core Book PDF: PDF page N = printed N-1)

- R1 (CB p.162): "When the countdown ticks down from 1 to 0 (which doesn't appear on the die), the countdown ends and triggers the event you were counting down to."
- R2 (CB p.162): a standard countdown "begins on a specific number (such as “Countdown 4”) and ticks down every time a player makes an action roll, regardless of the result. When the countdown die reaches 0, the countdown’s effect triggers immediately after the last action roll is resolved."
- R3 (CB p.162): "Typically, these countdowns have a starting value of 5–10." Progress (players work toward it) or consequence (players try to avoid it).
- R4 (CB p.163), Dynamic Countdown Advancement, progress / consequence: Failure with Fear "No advancement" / "Tick down 3"; Failure with Hope "No advancement" / "Tick down 2"; Success with Fear "Tick down 1" / "Tick down 1"; Success with Hope "Tick down 2" / "No advancement"; Critical Success "Tick down 3" / "No advancement". The dialog shows the table; the card's dynamic badge carries it as its tooltip.
- R5 (CB p.163): "a “Countdown (1d6)” means that you roll 1d6 and use the result as the countdown’s starting value."
- R6 (CB p.163): "After this type of countdown triggers and you apply its effects, it resets to its starting value and begins counting down again. For example, “Countdown (Loop 5)” resets after 5 ticks."
- R7 (CB p.163): "“Countdown (Increasing 8)” begins at 8, then after its effect triggers, the starting value resets to 9, then 10, and so on." / "“Countdown (Decreasing 8)” begins at 8, then resets to 7, then 6, and so on. Once a decreasing countdown reaches 0, a major event triggers".

## Server

- `countdowns.setArmed` (new, `keyedGmMutation { campaignId, countdownId, armed }`, returns `{ armed }`): GM only (anonymous UNAUTHENTICATED, outsider NOT_FOUND, player FORBIDDEN); NOT_FOUND for a frame-owned or another campaign's countdown; COUNTDOWN_RULE for a cancelled one; a chase row arms its partner too (D9). One patch, no history row (arming changes no value).
- `countdowns.operate`: the legacy rules (`applyCountdownAction`) still check every move first, so every refusal is the same as before (E1). Then a Tick -1, and a downward correction of an active countdown (or of a paused one that repeats), moves through K0's `applyTick` with source "advance" / "correction" and no entryId: a manual tick to 0 triggers, resets a repeating countdown, counts `triggerCount`, sets `lastTriggeredAt`, writes the history row ("trigger" when it reached 0) and the GM-only notice, exactly like a roll (D7, Q2). Borrowed Time, positive corrections, pause, resume and cancel keep today's path. Deliberate exception: a correction of a paused countdown that doesn't repeat keeps today's rules (completes at 0 with history action "correction", no notice), because `tests/convex/history.test.ts` asserts that row (E3). `operate` gained a `returns` validator (its result shape is unchanged).
- `environmentActions.startCountdown` builds the countdown from `parseCountdownLabel`: mode progress / consequence / longTerm (standard leaves `mode` absent), repeat loop / increasing / decreasing with `initialValue`, dice rolled on the server and kept as `startDice` (Q4), `armed: true` (D4). Name, description, category, Private and the `{ countdownId, name, startingValue }` result are unchanged (E4).

## Dashboard

- New countdown dialog (`countdowns/new-dialog.tsx`): Type (Standard / Progress / Consequence, each with one plain line; the R4 table under the two dynamic ones, the chosen column highlighted), Start (A number: today's 20..1 grid; Roll dice: 1-4 dice and a d4..d20, the server rolls), Repeats (No repeat / Loop / Increasing / Decreasing with the R6/R7 line), "Advance automatically on action rolls" (checked by default = armed). The submit button reads "Start at N" or "Roll 1d6". Name, consequence, category, notes and "Who can see this" are unchanged. Long-term and chase are not here (K3, K4).
- Card (`countdowns/card.tsx`): a badge row: "Progress" / "Consequence" (tooltip with the R4 amounts), "Loop 5", "Increasing 8 → 9", "Decreasing 8 → 7" ("Decreasing 1 → major event"), "Rolled 1d6: 4" (GM only, D12); "Triggered n time(s)" on a repeating countdown after a trigger; an Armed switch (`aria-pressed`, 44 px tall) for the GM. Players see the badges their visibility allows (mode / repeat / triggerCount go with progress) and never the switch or the dice.
- Optimistic updates: the Armed switch (and its chase partner) and every operate click (ticks, corrections, pause, resume, cancel) update `countdowns.listByCampaign` at once, computed with the domain's `applyCountdownAction` and `tickCountdown` (a loop resets on the card before the server answers).

## Deviations

- E7: a GM's card of an old countdown (no new fields) now shows the Armed switch row (off), since an unarmed countdown is armed from there. Players see old countdowns exactly as before.
- `manualTickAmount` (which manual moves go through the tick path) is written in `convex/countdowns.ts` and copied in `card.tsx` for the optimistic update, because the shared domain module belongs to K0. Follow-up: move it to `src/lib/domain/countdowns/advanced.ts` and import it in both.
- The environment Loop 1d4 case in the e2e starts through the API (`environmentActions.startCountdown`); the Start button itself is covered by `tests/e2e/environments.spec.ts`.
- The dialog shots are of the scrolling modal, so the tallest variants show its lower part at 1024 and 390.

## Tests

- `tests/convex/countdowns-modes.test.ts` (60 tests): setArmed per role, list and player null, NOT_FOUND (frame-owned, other campaign), COUNTDOWN_RULE (cancelled), chase partner; create of standard / progress / consequence / loop / increasing / decreasing with fixed and dice starts; operate per role; manual tick of a loop at 1 resets it with one notice and the 2nd-time notice; a correction to 0 loops, also while paused; decreasing at 1 ends with the major event; increasing goes past 20 (Borrowed Time bound to the cycle's start); a rolled loop resets to its first roll; a countdown that doesn't repeat completes once and reopens by Borrowed Time; refusals unchanged; startCountdown per role; every SRD environment countdown label (as the campaign sees them) creates the row its label describes; the result keeps its shape.
- `tests/e2e/countdowns-modes.spec.ts`: Countdown (Loop 2) armed, two manual ticks show "Triggered 1 time" and 2/2, disarm (server agrees); a progress 1d6 countdown shows 1-6 and "Rolled 1d6: n"; Chaos Realm's Countdown (Loop 1d4) shows its Loop and Rolled badges, armed; a player sees the public badge and trigger count, no Armed switch, no dice, no private countdown.
- `tests/e2e/visual/CD-K2.spec.ts` (@visual): `test-results/visual/CD-K2/` cards-gm, card-loop-gm, cards-player, dialog-progress-dice-loop and dialog-standard at 1440, 1024 and 390. Verdicts: cards (GM and player) pass at all widths, one column at 390, no horizontal scroll; dialog passes (Type and Repeats stack 1 / 2 columns at 390, the R4 table fits).
- Unchanged and passing: tests/convex/countdowns.test.ts, history.test.ts, environment-actions.test.ts, countdown-ticks.test.ts; e2e dashboard, environments, players, sessions-flow, session-wrap and visual CV1.
- `tests/convex/schema-guard.test.ts` fails in this worktree only because `countdowns:operate` now has a `returns` validator and must leave `RETURNS_PENDING` (a file K0 owns); the orchestrator removes that line at merge.
