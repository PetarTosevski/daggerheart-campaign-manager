# TASK-PF-PF10: Bounded permission and N+1 reads

Status: Review. Plan: `.omc/plans/performance.yaml`, tracer PF10. Findings: `.omc/autopilot/perf-analysis.md`
(server reads).

## What changed

- **Notes page checks memoized per list** (`convex/lib/permissions.ts`). New `PageReadCache` (`pageReadCache(user,
  campaign)`): a per-query memo of the caller's role, each journal (and its departure, D1) and the set of pages that
  tick the caller (one `by_campaign_user` range of `journalPageRecipients`, up to 1,000 rows, else per-page lookups as
  before). A `journalPage` resource takes an optional `cache`; `journalPagePermission` and `readsJournalPage` use it
  through `cachedRole`, `cachedDeparted` and `ticks`. The decision itself is unchanged: same table, same N1
  `canReadPage`, same order of checks. Queries only; mutations never pass a cache, so a write between two checks is
  always seen.
- **`pageAccess(ctx, pageOrId, cache?)`** (`convex/lib/notes.ts`) accepts the page document a list already read, and
  the cache. Mutations and single-page queries call it as before.
- **Lists that pass the cache**: `notesSharing.shared`, `notesJournals.playerJournals` / `pastJournals` /
  `journalView`, `notesBin.bin`. `notesSharing` also reads the campaign's characters and each user row once per call
  for the recipient names (`playerNamer`), and fetches the ticked pages in one `Promise.all`.
- **Grant scan** (`permissionFor`, CF2). Grants to campaigns on a target are now probed with one `first()`; none (the
  usual case, the table is empty today) costs no document, as before. When there are some, the check runs from the
  user's side: the live campaigns they run (`by_owner_deletedAt_lastOpened`, `deletedAt` unset) and joined
  (`campaignMembers.by_user`, plus each campaign's get for liveness), at most 16 of each, then one
  `by_resource_principal` point lookup per campaign. A user in more than 16 of either falls back to the old walk of
  the target's grants (`actsFor` per grant). Same answer as before, exact up to `need`.
- **`members.roster`**: bounded `take(200)` instead of `collect()`; user rows already came in one `Promise.all`.
- **`combatMaps.list`**: the per-map image file and URL lookups run in one `Promise.all`.
- **`rests.current`**: still reads characters only while a rest is open; that read and the choices read are now
  bounded by `MAX_CHARACTERS_PER_CAMPAIGN`.

## Measurements

`tests/convex/perf-reads.test.ts` (convex-test `ctx.meta.getTransactionMetrics`; "queries" = gets plus index ranges,
the count Convex caps at 4,096). Campaign: GM and three players, 600 pages in each of three journals (MAX_PAGES caps
what a query reads of one journal at 200), visibilities cycling, chosen pages ticking two members.

| Query | Before (documents / queries) | After |
|---|---|---|
| GM `notesSharing.shared` players | 1,492 / 895 | 1,052 / 216 |
| GM `notesSharing.shared` gm | 884 / 366 | 689 / 249 |
| GM `notesJournals.playerJournals` | 571 / 370 | 451 / 11 |
| GM `notesJournals.pastJournals` | 531 / 330 | 211 / 10 |
| GM `journalView` (player journal) | 1,207 / 1,008 | 447 / 9 |
| GM `journalView` (departed journal) | 1,247 / 1,048 | 207 / 8 |
| Player `notesSharing.shared` players | 1,609 / 1,012 | 1,170 / 214 |
| Player `notesSharing.shared` gm | 886 / 488 | 967 / 210 |
| Player `journalView` (other player) | 1,529 / 1,330 | 570 / 12 |
| Player `journalView` (departed journal) | 1,609 / 1,410 | 210 / 11 |
| Player `feed.list`, 0 / 10 / 300 campaign grants | 3 / 23 / 603 documents | 3 / 6 / 6 documents |
| `members.roster` (player, 3 members) | 10 / 10 | 10 / 10 |
| `combatMaps.list` (3 maps) | 5 / 3 | 5 / 3 |

Every Notes list is under 1,500 documents and 1,500 queries; the remaining documents are the pages themselves.

## Not done here (outside owns)

- `rests.current` re-runs on every character edit while a rest is open, because it reads every sheet for the
  pickable moves. An index `characters.by_campaign_status` (`["campaignId", "status"]`, in
  `convex/tables/characters.ts`) would let it read only active characters; the re-run on an active character's
  edit stays inherent unless the moves move to their own query.
