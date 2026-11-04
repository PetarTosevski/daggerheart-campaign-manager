# TASK LN4-CT2: Undo of End day rolls back the day (dcm-jq4b)

Plan `.omc/plans/lanes-2.yaml`, wave 10 batch B, tracer CT2 (label `lane:w2-campaign-time`, branch `lane4-ct2`). User
answers: 2026-10-31 (TASK-LN3-CT Q4) undoing End day also rolls back the day counter and the time of day, in the same
undo group as the uses; 2026-11-01 (wave-10 Q4, default (a)) only undoing the LATEST End day moves the calendar back,
undoing an OLDER one gives back its uses only, with a feed line.

## What landed

| Piece | File | What |
|---|---|---|
| `timeChange` (widen) | `convex/lib/validators/actionLog.ts` | Optional `{ before, after, timeOfDayBefore? }` on an `actionLog` row (`before` / `after`: `{ week, cycle, cycleDay }`; `timeOfDayBefore` only when End day reset the time of day to Day). Widen only: older rows have none; no migration needed (nothing to backfill: old End days stay uses-only). Types `CampaignTimeSnapshot`, `TimeChange`. |
| `expireParty(..., time?)` | `convex/campaignTime.ts` | New optional last argument. With `time` the group's campaign row is always written (even when nothing ended; summary "Day 1 ended" without the "0 limits" tail) and carries `timeChange`. `endGmTurn` (no `time`) is unchanged. |
| `endDay` | same | Passes the calendar move (and `timeOfDayBefore` outside the Witherwild when the light was not Day). `entryId` is now always set (the return validator keeps `null` for compatibility). |
| `setDay` forward | same | A Witherwild day-icon jump forward passes its calendar move too, so undo moves the arc back with the uses. A jump back still writes nothing. |
| `restoreTime` in `undoEntry` | `convex/lib/actionLog.ts` | After the group is undone: if the `campaignTime` row still stands on `timeChange.after` (this is the latest day's end), the row goes back to `before` (a `history` row `campaignTime` / `undoEndDay`) and `campaigns.timeOfDay` back to `timeOfDayBefore` when set. Otherwise (a later day has passed) the calendar stays and a public, non-undoable `session` row says "End of Week W · Day D undone: its uses are back; the calendar stays on Week W' · Day D' (a later day has passed)". |
| UI | `src/app/(gm)/campaigns/[campaignId]/time-arc.tsx` | After End day the GM gets an "Undo the day's end" button (both the Witherwild arc and the other frames' `CampaignDay`), calling `actionLog.undo` on the returned `entryId`; notice "End day undone.". A day-icon click hides it. The feed's Undo does the same for any End day / jump row. |

"Latest" is decided by the calendar itself: the End day is the latest while the campaign still stands on the day it
reached. Undoing the later End day first makes the earlier one the latest again (tested). Edge: in the Witherwild a
GM who jumps back with a day icon and then forward again to the same day makes an older jump look "latest"; the
calendar then goes back to that row's `before`, which is what the GM sees as the day before anyway.

## Beads

| Bead | State | Done / left |
|---|---|---|
| dcm-jq4b | closable | Undo of End day (and a Witherwild jump forward) restores week / cycle / cycleDay and the time of day in the same undo; the user's 2026-11-01 answer on older End days is built. |

## Follow-ups

None filed.

## Data switches ready for wave 11

None (no SRD data change).

## Edits outside owns forced by existing tests

`tests/convex/lane3-ct-campaign-time.test.ts` (wave-9 CT, not in CT2's owns): two tests encoded the behaviour the user's
answer replaced.
- "writes no log rows when nothing ends" -> "writes only the campaign row when nothing ends" (End day now always writes
  its campaign row so the day is undoable).
- "ends the day / week uses of running encounters' instances, and undo gives them back": after the undo the day is back
  to 1, so six End days (not five) reach day 7 before the week passes. The comment says why.
Every Witherwild test (`tests/convex/campaign-time.test.ts`) passes unchanged.

## QUESTIONS

None new. The rule is the user's (not a book mechanic): CB has no rule for undoing a day; the calendar is a table aid.

## Checks

- `pnpm lint` clean, `pnpm typecheck` clean.
- Focused: `tests/convex/lane4-ct2-end-day-undo.test.ts` (13), `lane3-ct-campaign-time.test.ts`, `campaign-time.test.ts`,
  `action-log.test.ts`, `lane-m-time-of-day.test.ts`: 54 passed.
- Full: `pnpm vitest run --maxWorkers=1 --testTimeout=120000`: 434 files, 10019 passed, 1 expected fail.
- e2e `tests/e2e/lane4-end-day-undo.spec.ts` + `tests/e2e/lane3-campaign-time.spec.ts` (ports 3173 / 3458): 4 passed. The
  undo button is named "Undo the day's end" so the wave-9 spec's `name: "End day"` locator still matches one button.

## Merge-time actions

- No new public function, no args change: no authz entry (core.entries.ts unchanged).
- Regenerate `convex/_generated` (schema widened: `actionLog.timeChange`).
- No migration, no package.json change.
