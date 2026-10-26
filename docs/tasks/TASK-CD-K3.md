# TASK-CD-K3: Chase countdowns (New chase, the linked pair card, pair-wide arm, visibility and cancel)

Status: Review. Plan: `.omc/plans/countdowns-advanced.yaml`, tracer K3 (wave 3), depends on K1 and K2. Bead: dcm-bxp.70.
Binding answers used here: U1, Q1 (c), Q5 (a); user decisions: arming is pair-wide; visibility, pause and cancel act on both sides; the pair card says "Caught!" or "Got away!" when it ends.

## Book rule implemented (quoted; printed page re-checked 2026-10-21 with pdfjs-dist in the Core Book PDF, PDF page 164 = printed p.163)

- R8 CHASE COUNTDOWNS (CB p.163): "When the chase begins, set two countdowns: one for the pursuing party and one for the escaping party. First pick a die for the pursuers' countdown—the more time you want the chase to take, the higher the starting value should be—then set that die at its highest value. Next, select another die with the same starting value for the escapee's countdown, but set that die at a lower value to reflect how much of a lead they have (1 lower for a small lead, 3 lower for a decent lead, 5 lower for a substantial lead)." / "each tick of the countdown could represent one range band (Very Close to Close, Close to Far, Far to Very Far, etc.)" / "Regardless of whether the PCs are pursuing or escaping, their action rolls advance both countdowns, as shown on the earlier Dynamic Countdown Advancement table. When a PC succeeds on an action roll, it ticks down their countdown, which is a progress countdown. When they fail on an action roll—or roll a success with Fear—it ticks down the other party's countdown, which is a consequence countdown."
- R4 (CB p.163), used through K0's `chaseTicks`: progress / consequence per roll: Failure with Fear 0 / 3; Failure with Hope 0 / 2; Success with Fear 1 / 1; Success with Hope 2 / 0; Critical Success 3 / 0.

## Server (`convex/countdowns.ts`)

- `createChase` (new, `keyedGmMutation { campaignId, name, description, startingValue, lead: "small" | "decent" | "substantial" | number, party: "pursuing" | "escaping", visibility?, armed? }`, returns `{ partyId, rivalsId }`): `name` is the rivals ("The thief"). Inserts both rows in one mutation with K0's `chaseRowValues` (pursuers N, escapee N - lead); the party's row is named "The party" (`CHASE_PARTY_NAME`), mode progress, the rivals' row mode consequence, each with `chase { partnerId, side, party }`; same start, description, visibility and armed (absent = unarmed, as `create`); category "threat"; never repeats. Each row's consequence says what its 0 means ("The party catches The thief" / "The thief gets away"; escaping: "The party gets away" / "The thief catches the party"), so the GM's trigger notice reads right. Two history "create" rows. INVALID (zod / `chaseStart` RuleError): start outside 2..20, a lead below 1, not whole or not below N, an empty name.
- `setVisibility` on a chase row changes its partner too (D9, D12).
- `setArmed` already armed the partner (K2); unchanged.
- `operate`: `pause` / `resume` on a chase row also moves the partner when its own state allows it (a side already at 0 stays completed), one history row each. `cancel` on a chase row cancels both rows, also when one side is completed (an ended chase leaves the board in one click), one history row each; COUNTDOWN_RULE if the clicked row is already cancelled. Manual ticks (advance, reverse, correction) stay per side. Non-chase rows keep every existing rule (E1).
- Rolls: no change here. K1's `tickArmedCountdowns` already ticks a pair by `chaseTicks` and stops once `chaseEnded`; Borrowed Time on the completed side reopens it, and undo of the ending roll reopens it (K0's revert).

## Dashboard

- `countdowns/index.tsx`: a "+ New chase" button beside "+ New countdown" (GM only); `listItems` turns a chase pair into ONE item at its first row (a row whose partner the caller can't see still renders as a chase on its own).
- `countdowns/chase.tsx`:
  - `NewChaseDialog`: Rivals, Notes, "The party is" Pursuing / Escaping, Die (d4 d6 d8 d10 d12 d20) with the R8 range-band hint, "The escapee's lead" (Small 1 / Decent 3 / Substantial 5 lower; leads not below the die are disabled and the choice falls back to the largest that fits), a live preview ("The party starts at 6, The thief at 3."), Who can see this, "Advance automatically on action rolls" (checked), "Start chase". Intents only: the server sets both values.
  - `ChaseCard` (spans the grid's full row): "Chase" kicker, "The party pursues / flees <rivals>", notes, Paused chip, the visibility button (pair-wide; the shared `VisibilityForm`), a "Caught!" / "Got away!" banner with a line ("The thief got away from the party.") once a side is at 0, two tracks ("The party" and the rivals' name, each with Pursuing / Escaping, value n/N, pips, the R4 line "Your successes move this: ..." / "Failures and success with Fear move this: ...", Tick −1 and Borrowed Time per side), "Pause chase" / "Resume chase", one Armed switch (aria-pressed, 44 px), "Cancel chase…" with a confirm. Players get the same card read-only (no buttons), values hidden per the shared visibility.
  - Optimistic updates: operate (computed with `operatedView` from card.tsx, i.e. the domain's `applyCountdownAction` / `tickCountdown`; pause / resume on both rows; cancel removes both) and Armed on both rows.

## Tests

- `tests/convex/countdowns-chase.test.ts` (14 tests): createChase for anonymous (UNAUTHENTICATED), outsider (NOT_FOUND), player (FORBIDDEN), GM; pursuing rows, links, modes, consequences, history; escaping with small / substantial / typed leads; absent armed; INVALID cases with nothing written; setVisibility per role moving both rows (player list blanked, then private = empty); setArmed pair-wide; operate pause / resume / cancel per role, pair-wide with history; manual ticks per side and cancel of an ended pair; the book's example through `rolls.manualRoll` (success with Hope 6 -> 4; a failure with Fear moves the thief by the table, see QUESTIONS; a failure with Hope 3 -> 1); a success with Fear moves both; an unarmed or paused pair doesn't move; the pair stops after the thief reaches 0, undoing that roll reopens it, Borrowed Time reopens it; players see the pair per visibility without armed.
- `tests/e2e/countdowns-chase.spec.ts`: the GM starts a chase in the dialog (d6, decent lead, pursuing); the player's manual rolls move the tracks (success with Hope 6 -> 4; failure with Hope thief 3 -> 1; success with Fear both, thief 0); the card says "Got away!"; a critical then moves nothing; the player sees the card with no buttons; cancelling removes the pair.
- `tests/e2e/visual/CD-K3.spec.ts` (@visual): see below.

## Visual shots (`test-results/visual/CD-K3/`, not committed; 1440, 1024, 390)

- `card-running-*`: the book's market chase after Tabby's success with Hope (party 4/6, thief 3/6). Pass: the two tracks side by side at 1440 / 1024, stacked at 390; touch targets 44 px.
- `card-got-away-*` and `card-caught-*`: ended chases: red border, the "Got away!" / "Caught!" banner with its line, the side at 0 outlined red, its Tick −1 disabled, Borrowed Time live. Pass.
- `cards-gm-*`, `cards-player-*`: the list with three chases; the player's cards have no buttons and no Armed switch. Pass; one column at 390, no horizontal scroll (checked by the helper).
- `dialog-*`, `dialog-escaping-d4-*`: the dialog; with d4 the Substantial lead is disabled. Pass; at 390 the shot shows the scrolling modal's upper part.
- Deliberate deviations: no board design exists for a chase pair, so the card reuses the countdown card's palette with pip tracks instead of the hourglass; it spans the grid's full row so the two tracks sit side by side.

## Deviations and notes

- A chase cancel also cancels a completed side (the legacy rule refuses cancelling a completed countdown); otherwise an ended chase could never leave the board.
- The R4 line on the party's track follows the plan's wording "Your successes move this" (players are the party).
- E7 / existing tests: tests/convex/countdowns.test.ts, countdowns-modes, countdown-rolls, countdown-ticks, history pass unchanged (full vitest run green).

## QUESTIONS

- Q-K3-1: The book's chase example (CB p.163) ticks the thief "from 3 to 1" on Rune's failure with Fear, but the Dynamic Countdown Advancement table it points to says a consequence countdown ticks 3 on a failure with Fear (2 on a failure with Hope). The app follows the table (K0's `rollTicks`), so a failure with Fear takes the thief from 3 to 0. Default: keep the table. Alternative: treat the example as authoritative for chases (failure with Fear 2 on a chase's consequence row), which would need a K0 domain change.
