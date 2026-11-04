# TASK-JOURNAL-JD3b: Hope spent and HP marked counters

Plan `.omc/plans/journal.yaml`, tracer JD3b (bead dcm-z9rz.6). Server only; no UI and no new public function.

## What landed

**`convex/lib/characterSheet.ts`, `saveSheet`** (user Q8: counted as they happen during the live session):

- Before the patch, `saveSheet` reads the stored character (one `get`). A caller that already holds it in this
  mutation may pass it as the new optional fourth argument `current`. Existing callers are unchanged.
- After the patch, it compares the stored blob's `hope` and `hp` with the new sheet. The sheet's `hp` is the
  marked count (`hp < hpMax` means a Hit Point is still clear, LL1), so:
  - `hopeSpent += max(0, hopeBefore − hopeAfter)`
  - `hpMarked += max(0, hpAfter − hpBefore)`
- Only when one of them is above 0 does it look up the live session: `sessions` by `by_campaign_status_n`
  (campaign, `"live"`). Then it patches or inserts the PC's `sessionCharacterStats` row (`by_session_character`)
  in the same mutation. With no live session, or with no drop, nothing more is read or written.
- **Cap:** a new row is inserted only while the session holds fewer than `CHARACTER_READ_BOUND` rows. That is the
  same number as `MAX_SESSION_CHARACTER_STATS`, checked with a bounded `.take`. A full session drops the count
  without an error, so a sheet save never fails over a counter.
- The live session is read inline, not through `liveSession`. `convex/lib/sessions.ts` imports `characterSheet.ts`
  (for `MAX_CHARACTERS_PER_CAMPAIGN`), and the reverse import would make a cycle. Under that cycle,
  `MAX_SESSION_CHARACTER_STATS` would be read before it is initialised.
- The stored blob is read for `hope` and `hp` without a full `readSheet` parse. Every sheet version stores both as
  numbers. A blob without them counts nothing.

**Why every path counts:** every engine write of a sheet goes through `saveSheet`: cards, attacks, rolls, hits,
death moves, rests, level-ups and the manual steppers. That is 82 call sites. A grep for `patch("characters"` with a
`sheet` finds only two other writers:

- `characters.create`, which is the first sheet, so there is nothing to diff.
- The undo in `convex/lib/actionLog.ts`. See below.

**Order of effects / undo:** undo writes the `before` sheets straight to the document (`undoGroup`) and never calls
`saveSheet`. So undo neither adds to nor subtracts from the counters.

- Undoing a Hope spend keeps its count.
- Undoing a heal brings the HP back marked without counting them again.
- This matches the plan's acceptance ("Undo … never subtract") and the brief's risk note ("undo does not subtract").

A true rollback would need the counter deltas recorded on the action-log row and reversed in `undoGroup`. That
means `convex/lib/actionLog.ts` plus a widened `actionLog` field, both outside this tracer's owns. See Q1.

## Caveats (Q8, as the brief names them)

- **GM corrections count.** A GM's Hope −1 or HP +1 by hand counts as spent or marked, on the PC's row.
- **Net per save.** A save is counted by its net change. One mutation that spends and regains Hope in a single save
  nets out:
  - an Experience (−1) on a roll with Hope (+1);
  - a card whose cost the roll's own Hope pays (Bolt Beacon, R8).

  Several saves in one mutation each count their own step (tested). Fixing this needs the callers (`convex/lib/rolls.ts`,
  `convex/lib/combatActions.ts`, …) to pass the spent amount, outside owns. See Q2.
- **Hope lost to a scar counts as spent.** Avoid Death's scar, or a scar from the stepper, closes a Hope slot, and a
  full Hope track loses its last point (`applyResourceDelta` clamps). Tested.
- **Raising Hope or clearing HP never subtracts.** This covers rests, level-ups, healing, Risk It All and undo.
- **Away / dead PCs are counted the same.** Their row is per character, whatever the status.

## Tests

`tests/convex/journal-tally-counters.test.ts` has 12 tests. The paths it covers:

- **Manual stepper:** player and GM. Raising and clearing don't subtract, and stress is ignored.
- **No live session:** nothing before the first start or after the end. A restarted session adds to the same row.
- **Hits:** `characters.applyDamage`.
- **Rolls:** a roll spending an Experience with Fear (`rolls.manualRoll`).
- **Attacks:** a Combat Map weapon attack with an Experience (`combatActions.attack`, forced dice).
- **Cards:** a card that costs Hope (`combatCards.useCard`, Rain of Blades, forced dice).
- **Death moves:** Risk It All clearing every HP (no subtract), and Avoid Death's scar taking the sixth Hope
  (counts 1).
- **Rests:** Tend to Wounds clears another PC's HP (no subtract).
- **Undo:** undoing a Hope spend keeps its count, and undoing a rest re-marks HP without counting.
- **Several saves in one mutation,** and the `current` argument.
- **Cap:** `MAX_SESSION_CHARACTER_STATS`. A full session gets no new row and the save succeeds.

The full vitest suite passes, and every sheet-writing test runs through the hook.

## Design states

None: JD3b has no UI. JD3a's tally reads the rows: `hopeSpent` and `hpMarked` are the sums of the
`sessionCharacterStats` rows.

## Questions (defaults taken)

1. **Undo and the counters.** Default: undo neither adds nor subtracts (plan acceptance). An undone Hope spend still
   counts. Alternative: record the counter deltas on the action-log row and reverse them in `undoGroup`. That is a
   follow-up touching `convex/lib/actionLog.ts` and the `actionLog` table (widen).
2. **Spend and gain in one save net out.** Default: the hook counts the net drop per save. Alternative: callers that
   spend Hope (Experiences, card and feature costs) pass the spent amount to `saveSheet`. That is a follow-up across
   the engine lanes.
3. **Hope lost to a scar's clamp counts as spent.** Default: yes, because a drop is a drop. Alternative: skip drops
   that come with a new scar.

## Merge-time actions

- None for codegen: no new function or table.
- JD3a reads the rows as they are (`hopeSpent`, `hpMarked`).
