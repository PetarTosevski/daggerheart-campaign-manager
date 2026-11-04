# TASK LN3-CT: Campaign time for every frame (days, weeks, End day, GM-turn expiry)

Plan `.omc/plans/lanes-2.yaml`, wave 9, tracer CT (label `lane:w2-campaign-time`, branch `lane3-ct`). User answer
2026-10-31 (dcm-ztb8): every campaign tracks days of a week; the GM's End day clears all once-per-day uses; a week passes
after 7 days and clears weekly limits; only Witherwild keeps its 7-day Day / Night cycles.

## What landed

| Piece | File | What |
|---|---|---|
| `passDay`, `formatCalendarDay` | `src/lib/domain/campaign-time/index.ts` | One day forward; `newWeek` after day 7. With `cycles` (Witherwild) the new week flips Day / Night as `getNextCampaignTime`; other frames keep `cycle` "DAY". |
| `campaignTime.calendar` (view, new) | `convex/campaignTime.ts` | `{ week, day, cycles }` for every frame; week 1, day 1 before the first End day (the row is created lazily). |
| `campaignTime.endDay` (keyedGmMutation, new) | same | Passes a day (history row `campaignTime` / `endDay`), then `expireParty(..., "day")`, or `"week"` when day 7 ended. Returns `{ week, day, cycle, newWeek, ended, entryId }`. |
| `expireParty` | same | `expire(sheet, event)` for every active PC; for day / week also drops `day` (`day`, `week`) featureUses of the instances in the campaign's running encounters. One undoable `actionLog` group (kind `session`): a row per changed PC (`before`), a campaign row with the instances' `adversaryBefore` (featureUses). Nothing to end writes nothing. |
| `endGmTurn` | `convex/encounterTracking.ts` | After `gmTurn + 1`, `expireParty(..., "gmTurn")` ("GM turn N ended"), the GM turn's own undo group. Returns unchanged. |
| End day → Day | `convex/campaignTime.ts` `endDay` | User answer Q2: outside the Witherwild End day sets `campaigns.timeOfDay` to "day" (the Witherwild's light follows its phase). |
| `setDay` forward | same | User answer Q3: a Witherwild day icon forward by N days runs `expireParty(..., "day")` ("Days A-B ended"); a jump back ends nothing. A week only passes through End day on day 7 (`setDay` stays within the week). |
| `get` / `advance` | `convex/campaignTime.ts` | Unchanged: Witherwild-only (MECHANIC_DISABLED elsewhere); `tests/convex/campaign-time.test.ts` passes untouched. |
| UI: Witherwild | `time-arc.tsx` | An "End day" button under the arc on days 1-6 (GM only); the day-7 "Bring the Dawn / Night" button now calls `endDay` (same time result as `advance`, plus weekly uses end). A status line says "Day N begins; X limits refreshed." |
| UI: other frames | `time-arc.tsx` `CampaignDay`, `campaign-shell.tsx` | "Campaign day: Week N · Day D" beside the time-of-day control in the dashboard header; End day for the GM, read-only for players. |
| table comment | `convex/tables/countdowns.ts` | `campaignTime` is now every campaign's row (no schema change). |

## Beads

| Bead | State | Done / left |
|---|---|---|
| dcm-ztb8 | closable | Days and weeks for every frame, End day clears daily uses (and resets the time of day to Day), day 7 clears weekly ones, Witherwild day icons forward count as ended days. Undo of the day itself: follow-up dcm-jq4b. |
| dcm-gfk3 | closable | GM turn end fires `gmTurn`; End day fires `day` / `week` for the party and drops instance `day` / `week` uses. |
| dcm-55k | callers done | Caller half done here. Left (E5, dcm-bc67): add gmTurn / day / week to `availability.EXPIRING_UNTIL` and let `limitUntil` / `featureLimitUntil` store `limitPeriod(limit)`; until then no limit stores those periods, so these callers end nothing in live play (tests seed them). |
| dcm-bc67 | caller half done | Same as above: the E5 half (availability.ts) is left. |

## Follow-ups

- dcm-jq4b (new, `lane:w2-campaign-time`): undo of End day also rolls back the day counter and time of day (user answer
  Q4). Needs an `actionLog` widen (`convex/lib/validators/actionLog.ts`) and `undoEntry` (`convex/lib/actionLog.ts`),
  neither in CT's owns.

- E5 (dcm-bc67, `lane:w1-e5-checks-limits-numbers`): `EXPIRING_UNTIL` + `limitUntil` now have callers for every period. No new bead (dcm-bc67 already says it).
- Instance `gmTurn` uses stay lazily bound by E7 (`@gmTurn<N>`); `endGmTurn` drops none.

## Data switches ready for wave 10

None (no SRD data change). Once E5 stores day / week periods, once-per-day / weekly entries (Summon Tormentors CB p.237,
Resurrection CB p.341) refresh through End day without further work.

## User answers (2026-10-31)

1. **Where does End day live?** As built: dashboard header beside the time-of-day control (other frames), under the
   time arc (Witherwild), GM only. Kept.
2. **Does End day also move the time of day?** Yes: End day resets it to Day. Built (other frames; the Witherwild's
   light follows its phase).
3. **Witherwild day icons.** A jump forward by N days counts as N ended days (day uses end; week uses when a week
   passes, which within a week only End day on day 7 does). A jump back clears nothing. Built in `setDay`.
4. **Undo of End day** also rolls the day counter and time of day back, in the same undo group. Not built here
   (actionLog files are outside CT's owns): follow-up dcm-jq4b. Today undo gives the uses back and leaves the day.

## QUESTIONS

1. **Instances** whose day / week uses end are those in running encounters only (ended encounters' instances are never
   used again; draft ones hold no uses). Confirm.
2. Does a Witherwild day-icon jump forward also reset anything else End day does? Today it only ends day uses (the
   Witherwild's light follows the phase, so no time-of-day reset applies).

## Checks

- `pnpm lint` clean, `pnpm typecheck` clean.
- `pnpm test --maxWorkers=1 --testTimeout=120000`: 394 files, 9606 passed, 1 expected fail.
- e2e `tests/e2e/lane3-campaign-time.spec.ts` (+ `lane-m-time-of-day.spec.ts`), ports 3149 / 3410: 4 passed.

## Merge-time actions

- New public functions `campaignTime.calendar` (view) and `campaignTime.endDay` (gm): entries added in
  `tests/convex/authz/core.entries.ts` (CT owns it).
- Regenerate `convex/_generated` (no new module; new exports in `campaignTime`).
- No package.json change, no schema change, no migration.
