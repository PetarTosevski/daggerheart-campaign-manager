# TASK-CONFIG-R3: Fear at the start of a session

Plan `.omc/plans/config.yaml`, tracer R3 (bead dcm-jh6d.13). Server only; the Sessions section's control is U5.

## The rule (user answer Q1 a, Core Rulebook p.154)

> "When you start a campaign, you begin with an amount of Fear equal to the number of PCs. … Fear carries over between
> sessions."

- **Carry over** (`fearAtStart` "carry", the default and the book's rule): `sessions.start` leaves GM Fear alone.
- **Reset to number of PCs** ("pcs", a variant): a Start sets GM Fear to the number of the campaign's PCs that are not
  retired and not dead, capped at 12.

## What changed (`convex/sessions.ts`)

- `fearAtStart(ctx, pcs)` reads `resolveTableSettings(campaign.tableSettings).fearAtStart`. Under "pcs" it patches
  `campaignState.fear` to `min(12, pcs)` and writes a `history` Fear row (action `"reset"`, before / after), like any
  Fear change. The count is the party's characters whose status is not `retired` or `dead`, so `active` and `away`
  count. A character with an unreadable sheet is not counted, because `party` skips it.
- It runs inside `start`'s keyed `once`, after the class hooks and session features (and after the B6 end of another
  live session). The start's campaign `actionLog` row carries the signed change as `fearDelta`. Undoing the Start
  calls `revertFear` and restores the previous Fear.
- The campaign row reads "Session started; Fear reset to N". The session log's start line ends with "Fear reset to N".
  `startResult` gains an optional `fearReset` (N). When Fear already equals N, there is no history row and no
  `fearDelta`, but the line still names the reset.
- A Start for the live session stays a no-op (`alreadyStarted`). A played session that starts again (B7) resets again.

## Tests

`tests/convex/fear-at-start.test.ts`: carry; reset with 4 PCs (Fear, history row, `fearDelta`, log line); away
counted, retired and dead not; the cap at 12; Fear already at the count; undo restores; a restarted session resets
again; Start for a live session changes nothing. `tests/convex/sessions.test.ts` passes unchanged.

## Notes

- The reset is a Fear history row inside the session's window, so the Journal tally counts it as Fear gained or spent,
  the same way it counts a GM's `fear.set`. An undo writes an `"undo"` row, which the tally takes back.
