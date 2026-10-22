# TASK-PF-PF9: Dashboard party summary projection

Status: Review. Plan: `.omc/plans/performance.yaml`, tracer PF9. Branched from `rebuild` at f2c340c. The owns were
widened twice on the orchestrator's answer to this tracer's questions: e4bd3f2 added party-card, rest launcher,
wither panel and slots.ts; the four badge files and portrait.tsx (type-only) were added later.

## What changed

- **`characters.partySummary`** (`convex/characters.ts`). A `campaignQuery` (`need: "view"`, `enough: "edit"`, as
  `listByCampaign`) with a `returns` validator (`partyMemberValidator`). Each row holds `_id`, `status`, `away?`,
  `benched?`, `portraitUrl`, `canEdit`, `corrupt?`, and a sheet with only what a card shows:
  - name, level, class, subclass, ancestry, community, portrait
  - HP, Stress, Hope, scars, armor marked
  - the badges' fields: `hopeSlotBonus`, `levelUpPending`, `conditions`, `wither` and `journeyEnds`, each sent only
    when it shows something

  Each field has `CharacterView`'s type, so a full view also fits a `PartyMember`.
- **Same reads, same privacy.** `listByCampaign` and `partySummary` share `partyViews` (the one `by_campaign` read,
  the corrupt-sheet placeholder, `toView`'s portrait URL, and the upload storage id hidden from non-editors).
  `partySummary` only cuts the rows down. Every member still sees every card, as before.
- **The dashboard reads only the summary.** `party-section.tsx`, `rest/launcher.tsx` (status, name, conditions) and
  `wither-panel.tsx` (wither, corrupt) switched from `listByCampaign` to `partySummary`, so no dashboard component
  subscribes to `listByCampaign` any more.
- **Card typed on the summary** (no casts). `slots.ts` adds `CardCharacter` (= `PartyMember`), `CardSlotProps` and
  `CardSlot`. `PartyCard`, `BenchButton`, `LevelUpCardBadge` / `LevelUpRosterBadge`, `WitherCardBadge`,
  `DeathCardBadge` and `DeathBadges` / `AwayRequest` / `awayLabel` take it. The roster and the sheet banner still pass
  full `CharacterView`s.
- **Portrait type narrowed.** `CharacterPortrait` now takes `{ _id, sheet: Pick<…portrait, subclassId, ancestry, name,
  classId>, portraitUrl? }`, which is what `portraitSource` reads.
- **Optimistic HP tick kept** (CL3 / rule 12). `PartyCard`'s `adjustResource` optimistic update patches
  `partySummary` when it is loaded (the dashboard) and `listByCampaign` when it is loaded (the roster).
- **Tests.**
  - `tests/convex/authz/characters.entries.ts` has a matrix row (`access: "view"`).
  - `tests/convex/characters-summary.test.ts` covers anonymous `UNAUTHENTICATED` and outsider `NOT_FOUND` (by
    `ConvexError.data.code`).
  - It checks that a player sees all four cards but can edit only their own, and that the GM can edit all four.
  - It checks the field allowlist, that values match `listByCampaign`, and that the badge fields appear only when set.
  - It checks that the upload storage id is hidden from a non-editor and that a corrupt sheet comes back as
    `corrupt: true`.
  - It checks the byte and read budget.

## Measurements

Same worktree, before = `rebuild` f2c340c, the PF0 bench (4 level-1 bards on `Perf 3`). The host was 16 cores, WSL2,
shared with other tracers.

**Server reads and result size** (`characters-summary.test.ts`, convex-test `getTransactionMetrics`, GM; bytes =
`JSON.stringify(convexToJson(result))`, which is what PF0's harness counts):

| Query | wire bytes | documents read | database queries |
|---|---:|---:|---:|
| before: `listByCampaign` (dashboard) | 5,902 | 6 | 3 |
| after: `partySummary` | **1,259** | 6 | 3 |

**PF0 harness** (`measure.mjs --profile local --runs 3`; load average 2.4 → 3.4 before, 4.6 → 1.6 after). Bytes per
step = sum of first results:

| Step | before: character query bytes / all queries' bytes / q | after |
|---|---|---|
| Load → Dashboard | listByCampaign 5,899 / 6,857 / 11 | **partySummary 1,259** / 2,217 / 11 |
| first / revisit: Dashboard | 5,899 / 6,500 / 10 | **1,259** / 1,860 / 10 |
| hard load: Dashboard | 5,899 / 6,920 / 12 | **1,259** / 2,280 / 12 |

- `characters.listByCampaign` no longer appears in any dashboard step's subscriptions. Query counts are unchanged:
  the summary replaces the list one for one.
- Every HP / Stress / Hope tick, rest or Wither change now re-sends about 315 bytes per character, not about 1.5 KB.
- Timing (ms, median): Load → Dashboard `lastData` 154 → 395, first Dashboard 54 → 57, revisit 61 → 60, hard load
  208 → 192. Per run, Load → Dashboard is bimodal in both sets (before 500 / 143 / 154, after 484 / 148 / 395). That is
  host noise, not this change: the slowest query in those runs is `feed.list`, `countdowns`, `fear` or `sessionWrap`.
- An intermediate state was measured and dropped: only `party-section` switched, with the rest launcher still on
  `listByCampaign`. The dashboard then held **both** queries (12, 8,116 bytes on entry), which is why the launcher and
  the wither panel are part of this tracer.

**Optimistic update**, checked with a throwaway Playwright script (deleted). It added a 1.5 s delay on server →
client Convex frames, then clicked "Mark one Hit Point" on the dashboard. The tile changed after 169 ms (click
included), before the server answered.

**Bundle** (`bundle.mjs`): `/campaigns/[campaignId]` 1,188 / 448 KB before and after; `/party` 1,372 / 487 KB before
and after. The changes are a query name and types.

## Checks

- `pnpm lint`, `pnpm typecheck`: clean.
- `vitest --maxWorkers=4 --testTimeout=60000`: 278 files, 7,505 passed (1 expected fail).
- Playwright (`E2E_REUSE_SERVERS=1`, ports 3192 / 3496): 22 passed across `dashboard.spec.ts`, `party-roster.spec.ts`,
  `live-dashboard.spec.ts`, `wither.spec.ts`, `rest.spec.ts`, `death.spec.ts` and `level-up.spec.ts`.

## Left for others

- The Party tab still reads `listByCampaign` (the roster needs the full sheets for its tabs). `rest/picker.tsx`,
  `dice/tag-team.tsx` and `features/panel.tsx` (sheet page) also still read it. They could move to `partySummary`
  where the fields suffice: `tag-team` and `picker` read names, status and conditions.
