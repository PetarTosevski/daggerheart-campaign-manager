# TASK-JOURNAL-JD1: spotlight per PC per live session

Plan `.omc/plans/journal.yaml`, tracer JD1, bead dcm-z9rz.3. User answer 2026-11-03: "Spotlight per PC per live
session ... count every spotlight move to a PC during the live session; the GM can reset it."

## What landed

- `convex/lib/spotlight.ts`: `setHolder` calls a new private `countLiveSpotlight` after it writes a new PC holder.
  The helper reads the campaign's live session (`liveSession`, one indexed read). If there is one, it upserts that
  session's `sessionSpotlights` row for the PC (`by_session_character`) with count + 1. If no session is live, it writes
  nothing.
- Which paths count:
  - `giveTo` / `combatSpotlight.handTo` to a PC who does not hold the spotlight: counts.
  - `handTo` to the PC who already holds it: no count, because `setHolder` returns false before any write.
  - `moveToGm` (roll with Fear, failed roll, `gmTook`), `spotlightAdversary` and `takeWithFear`: the holder is the GM,
    so they never count.
  - `giveToParty` / `handToParty`: the row is deleted and nobody holds the spotlight, so it never counts. A later
    `handTo` from the party to a PC is a real move and counts.
- The count runs inside the caller's keyed `once` (`spotlight_hand_to`). A retry with the same key replays the result
  and counts nothing.
- `sessionPlay.spotlight`, `resetSpotlight` and `bumpSpotlight` are unchanged. They read, zero and add to the same rows.

## Tests

`tests/convex/journal-spotlight.test.ts` covers:

- A hand-to during a live session counts, and `sessionPlay.spotlight` returns the counts and the due flags.
- A hand-to to the same PC twice counts once. A move away and back (to another PC, or via the GM) counts again.
- These moves never count: GM take (free or for Fear), whole party, and the engine's `moveToGm`. Party → PC counts.
- Nothing counts before the session starts or after it ends.
- A retry with the same idempotency key counts once.
- Reset zeroes the counts, and the manual bump still adds.

Checks: `pnpm lint`, `pnpm typecheck` and the full vitest suite pass. No e2e (none in the acceptance).

## Schema / API

No schema change and no new public function. The table `sessionSpotlights` and its index `by_session_character`
already exist (D10 S0). The authz matrix is unchanged.

## Questions (took the default)

- Q9 (automatic only, or manual taps too) is still open in the plan. The old `bumpSpotlight` still adds, as the
  acceptance says, until the cut-over decision.
- A restarted session (D10 B7) counts into the same `sessionSpotlights` rows. The count is per session, not per live
  window.

## Merge-time actions

None.
