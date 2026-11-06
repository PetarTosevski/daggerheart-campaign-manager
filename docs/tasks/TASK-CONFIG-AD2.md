# TASK-CONFIG-AD2: Overview server

Plan `.omc/plans/config.yaml`, tracer AD2 (bead dcm-jh6d.36), Part B. Server only: the App admin Overview's reads.
AU1 builds the tab. Depends on AD0 (owner wrappers, admin tables, `readAppConfig`).

## API (`convex/adminOverview.ts`)

Every function is an `appOwnerQuery`: signed out `UNAUTHENTICATED`, everyone else (the GMs included) `FORBIDDEN`,
checked in the wrapper before any handler code.

| Function | Args | Returns |
|---|---|---|
| `stats` | `{ month }` (UTC "YYYY-MM", CF10) | `accounts { total, owner, gms, players, more }`, `campaigns { live { count, more }, cap }`, `lorekeeper { questions, costMicros, limitMicros }` |
| `alerts` | `{ day, month }` (UTC; `day` must be in `month`) | an array of `{ code, params }` |
| `campaigns` | `{ paginationOpts }` | page of `{ campaignId, name, gmId, gmName, players { count, more }, archived, liveNow, lastPlayedAt, createdAt }` |
| `audit` | `{ paginationOpts }` | page of the `adminAudit` rows newest first, plus `actorName` |

A malformed `day` / `month` is `INVALID`.

## Decisions

- **Roles (stats):** owner = `appConfig.ownerId`; GM = owns a live (not deleted) campaign, archived included;
  player = every other account. The owner counts once, as owner, even when they own a campaign. Every account row
  counts (unverified sign-ups are removed by their own cleanup cron).
- **Bounds:** `ADMIN_READ_BOUND` 1000 for users and live campaigns (`take(1001)`); past it `more: true`, which the
  client shows as "1000+". Members per campaign card row: `PLAYER_COUNT_BOUND` 100. Pending limit requests: `take(51)`,
  "50+" (Q21). Today's user counters: `take(1000)` on `lorekeeperUsage.by_kind_period`. Pages are clamped to
  `ADMIN_PAGE_MAX` 50 rows.
- **Campaigns "N of M allowed":** live non-archived campaigns against `caps.campaignsApp` (archived and deleted don't
  count, as in AD5a).
- **Lorekeeper:** the deployment counter of `lib/lorekeeper/caps.ts` for the month (no second counter); `limitMicros`
  is `readAppConfig().lorekeeper.monthlyUsd` × 1,000,000. Q22 a: questions are a count, there is no question cap.
- **Alerts, in order:** `limitRequestsWaiting { count, more }`; `readOnly {}` (`appStatus.readOnly`);
  `keyMissing { service: "lorekeeper" | "email" }` (`ANTHROPIC_API_KEY`, `AUTH_RESEND_KEY` absent; presence only, no
  value or env name leaves the server); `spendAtLimit` (≥ 100%) or else `spendNearLimit` (≥ 80%)
  `{ costMicros, limitMicros }`; `userNearDailyCap { userId, name, questions, cap }` for each user at ≥ 90% of
  `readAppConfig().lorekeeper.dailyQuestions` today, most questions first. The owner is never listed (uncapped, AD6).
  The client writes the text ("Mira is at 27 of 30 questions today").
- **Campaigns card:** live (not deleted) campaigns, newest created first (`by_deletedAt`, desc); archived ones are
  listed with `archived: true`. Players = member rows (players and co-GMs; the creator has none). Live now =
  `campaignState.liveSessionId` set; last played = the latest `sessions.endedAt` (`by_campaign_ended`). The id is for
  "Open" (Q27 b; the read-only view is AD13's, the link AU1's).
- **Privacy:** names only (`users.name`, else null; the client shows a fallback). No email, no key, no secret; tests
  check that no email or secret value appears.

## Tests

- `tests/convex/admin-overview.test.ts`: owner only, INVALID periods, role split, bounds and `more`, alerts and their
  order, no secrets, campaigns paging and fields, page clamp, audit newest first.
- `tests/convex/authz/admin-overview.entries.ts` (+ `.test.ts`): the four functions under class `appOwner`.
