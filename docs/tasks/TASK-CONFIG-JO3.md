# TASK-CONFIG-JO3: show spotlight balance to players

Plan `.omc/plans/config.yaml`, tracer JO3 (bead dcm-jh6d.29). Built on S2 (the `spotlightToPlayers` table setting,
default off). Binding answer: Q5 (a) players see the spotlight bars and the "least spotlight" line in Log & recap; the
tally tiles stay GM-only.

## The query

- **`journalTally.spotlight`** (`convex/journalTally.ts`) is the spotlight read the Journal uses. It is a
  `campaignQuery` with `need: "view"` and args `{ campaignId, sessionId }`.
  - Returns `journalSpotlightValidator = v.union(v.array(spotlightEntryValidator), v.null())`. The entries have the
    same shape as `sessionPlay.spotlight`: the session's active PCs in roster order, each with its count and `due`.
  - `seesSpotlight(campaign, permission)` decides who gets the entries: `atLeast(permission, "owner")` (the GM and every
    co-GM) or `resolveTableSettings(campaign.tableSettings).spotlightToPlayers`. Everyone else gets `null`, and the
    session is not read at all.
  - Outsiders get NOT_FOUND and signed-out callers get UNAUTHENTICATED (from the wrapper).
- `sessionPlay.spotlight` (gm only) is unchanged; the Combat Map still reads it.
- `journalTally.tally` (the six tiles) stays `gmQuery`.

## UI

- `src/components/journal/tally/index.tsx`:
  - `Spotlight` reads `journalTally.spotlight` for everyone. It renders nothing when the read returns `null`. For a
    player it also renders nothing while the read loads, so turning the setting off shows no loading flash.
  - The GM and co-GMs get the bars, the least-spotlight line and Reset.
  - A player who gets entries sees the bars and the least-spotlight line, without Reset.
  - `SessionTally` is unchanged: GM only.
- `model.ts` `resetPending` now updates the cached `journalTally.spotlight` (and skips a `null` cache).
- `src/app/(gm)/campaigns/[campaignId]/journal/page.tsx` (outside owns, a minimal edit): the Spotlight slot is
  mounted for every member; the Session tally slot stays inside `slot.isGm`.

## Tests

- `tests/convex/journal-spotlight-players.test.ts`: player off (null), player on (the bars) and back off, GM and co-GM
  with the setting either way, the tiles still FORBIDDEN to a player with the setting on, and outsider / signed out.
- `tests/convex/authz/journal-tally.entries.ts` (outside owns): `journalTally.spotlight` as `view`, with
  player / otherPlayer / grantee `null` (the setting is off in the matrix world).
- `tests/unit/journal/tally.test.tsx` (outside owns): the unit mock key moves to `journalTally:spotlight`, and new
  cases cover a player with entries (bars and line, no Reset) and a player with null or a loading read (nothing).
