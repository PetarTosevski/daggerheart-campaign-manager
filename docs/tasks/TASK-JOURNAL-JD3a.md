# TASK-JOURNAL-JD3a: session tally server (six numbers)

Plan `.omc/plans/journal.yaml`, tracer JD3a, bead dcm-z9rz.5. Board "Log & recap", Session tally tiles.

## What landed

`convex/journalTally.ts`, read-only, one public function:

`journalTally.tally({ campaignId, sessionId })` (`gmQuery`, GM only per user Q5) returns `journalTallyValidator`:

```ts
{
  fearGained: number | null, fearSpent: number | null, hopeSpent: number | null, hpMarked: number | null,
  adversariesDefeated: number | null, criticals: number | null,
  live: boolean,       // the session is live; its open window counts up to now
  truncated: boolean,  // a read hit its cap: the counts are a floor
}
```

All six counts are `null` together when the session was never live (`liveWindows` is empty); otherwise all are
numbers. A session of another campaign, or a bad id, is `SESSION_NOT_FOUND`.

Every "during the session" read uses J0's `liveWindows`:

- **Fear gained / spent:** the stored `sessions.tally` is the source for finished windows, as in `sessionPlay.tally`.
  The open window is counted from the Fear history (`tallyRows` + `windowTally`). A session with finished windows but no
  stored tally (played before the tally existed) counts those windows from history. Rests stay in the stored tally
  but are not returned (the design drops them).
- **Critical successes:** `actionLog` rows (`by_campaign_at`, per window) with `roll.outcome === "critical"` and no
  `undoneAt`. A row the GM removed from the feed (`removedAt`) still counts, because removing it only hides it. Every
  kind with a roll counts (PC rolls, combat rolls, a death move's matching dice). At most `MAX_TALLY_FEED_ROWS` (1000)
  rows are read across all windows; more sets `truncated`. The cap is lower than `MAX_TALLY_ROWS` because recent
  feed rows carry sheet snapshots.
- **Adversaries defeated:** the campaign's encounters (`by_campaign_status_updated`, `take(MAX_ENCOUNTERS)`, the cap)
  whose `startedAt` falls in a window. For each, the instances (`by_encounter_order`, `take(MAX_INSTANCES)`). A normal
  instance counts 1 when `defeated`. A Minion group counts its defeated Minions: its marked HP (one HP each, CB p.201),
  or the whole group when defeated.
- **Hope spent / HP marked:** the sum of the session's `sessionCharacterStats` rows (`by_session_character`,
  `take(MAX_SESSION_CHARACTER_STATS)`). JD3b writes them. Until JD3b lands they are 0.

## Tests

- `tests/convex/journal-tally.test.ts` covers:
  - a never-live session gives null tiles;
  - all six numbers for a live open window: rows before the session are out, undone criticals are out, removed ones
    are in, Minion groups count partly and in full, and encounters started before the session or never started are out;
  - a restarted session counts both windows and nothing between them, live and after End;
  - stored tally against history fallback for Fear;
  - stats of another session are not summed;
  - the feed cap sets `truncated`;
  - `SESSION_NOT_FOUND` for another campaign's session.
- `tests/convex/authz/journal-tally.entries.ts` (area `journal-tally`): GM ok; anonymous UNAUTHENTICATED; outsider
  NOT_FOUND; player, other player and grantee FORBIDDEN.

## Design states

No UI (JT renders the tiles). The design's six tiles map 1:1 to the six fields. '-' shows when the counts are null.
JT may show a 'floor' note when `truncated` is set.

## Questions (defaults taken)

1. Return shape: flat, with nullable counts, as the acceptance lists. `sessionPlay.tally` nests `{ tally | null }`
   instead.
2. Criticals count every action-log row whose roll is critical, including combat rows and the death move's "matching
   dice" row, and including rows the GM removed from the feed. Undone rows do not count.
3. Encounters count when their `startedAt` is in a window. An encounter started before the session and still running
   during it does not count. A restarted encounter counts by its latest `startedAt`.
4. Summoned adversaries count when defeated. Battle Points ignore them, but they were still defeated.
5. When a played session has no stored tally, Fear comes from history over its finished windows. `sessionPlay.tally`
   shows null for such a session.

## Merge-time actions

- Run codegen (`convex/_generated`): new module `convex/journalTally.ts`.
