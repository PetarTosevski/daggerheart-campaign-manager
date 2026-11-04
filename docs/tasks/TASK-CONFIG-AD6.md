# TASK-CONFIG-AD6: Lorekeeper budget server

Plan `.omc/plans/config.yaml`, tracer AD6 (bead dcm-jh6d.41), Part B. Server only: the Lorekeeper's limits come from
the owner's admin settings, what happens at the monthly limit (Q20 a), daily internet searches, the owner's
exemption and the month's use by campaign. No UI (AU3 builds the Lorekeeper tab; AD12 writes the per-campaign
numbers).

## One meter (`convex/lib/lorekeeper/caps.ts`)

The existing meter (`lorekeeperUsage`, `reserve` / `reservePass` / `settle`, `costMicros`) is extended; there is no
second counter.

- `capLimits(ctx, campaignId)` (async now) reads `readAppConfig` (owner's saved value → `LOREKEEPER_*` env var → code
  default) and then the campaign's `lorekeeperCampaignLimits` row: its `dailyQuestions` / `dailyWebSearches` replace
  the app's per-person numbers for that campaign (Q21 changed: only the owner writes that row, AD12). `bookCount` /
  `bookPages` are not read (N6 b: no book-count limit).
- `reserve` order: the daily questions (`LOREKEEPER_CAP_USER`), the campaign's monthly budget
  (`LOREKEEPER_CAP_CAMPAIGN`, a hard stop in every mode), then the deployment's monthly limit with `atLimit`:

| `atLimit` | Past the limit | Past 120% of the limit |
|---|---|---|
| `pause` (default) | everyone refused, `LOREKEEPER_CAP_DEPLOYMENT` (as before AD6) | same |
| `gmOnly` | callers with `owner` on the campaign (GM, co-GM; `permissionFor`) ask normally, `reserved.mode: "gmOnly"`; players `LOREKEEPER_CAP_DEPLOYMENT` | `LOREKEEPER_PAUSED` |
| `short` | everyone gets a shorter answer, `reserved.mode: "short"`, booked at Sonnet with `SHORT_MAX_TOKENS` (1000) | `LOREKEEPER_PAUSED` |

- The app owner (`isAppOwner`) is never capped: `reserve` skips every check and stores `reserved.mode: "owner"`; the
  question and its cost are still counted, and later passes are booked without a check.
- `reservePass` takes the answer's `mode`: `short` → always null (no later pass); `gmOnly` → the deployment check
  uses the 120% ceiling; `owner` → no check. The web pass (`webSearches` > 0) books **one** internet search on the
  asker's user-day row (`lorekeeperUsage.webSearches`, widened, optional) and is refused (null: the answer is kept,
  as for a budget refusal) once the day's `dailyWebSearches` are used. The Opus retry is not a search.
- `remaining` (and `lorekeeperUsage.mine`, now `enough: "owner"`) uses the same deployment decision as `reserve`, per
  caller: `{ questionsLeft, webSearchesLeft, campaignCapReached, deploymentCapReached, shortAnswers }`. Only the
  caller's own counts; budgets are booleans. The owner gets `UNCAPPED_LEFT` (9999) for both counts.

## The run (`convex/lorekeeperRun.ts`)

A `short` answer runs one Sonnet pass (even when `LOREKEEPER_MODEL` names another model) with `max_tokens`
1000, streamed live whatever its verdict, never retried with Opus, never searched (`prepare` turns `webSearch` off),
and stands as written (no books-only miss text). `reserveNextPass` passes the reservation's mode to `reservePass`.

## Owner API (`convex/adminLorekeeper.ts`, authz class `appOwner`)

| Function | Args | Returns |
|---|---|---|
| `setLimit` (`appOwnerMutation`) | `{ change: { field, value } }`, one of `monthlyUsd`, `campaignMonthlyUsd` (0..100,000, rounded to the cent), `dailyQuestions`, `dailyWebSearches` (whole, 0..10,000), `atLimit`, `allowGmRequests` | `null`; INVALID outside the bounds; audited `lorekeeper.set` with `field`, the effective value before and the new one |
| `useByCampaign` (`appOwnerQuery`) | `{ month: "YYYY-MM" }` | `{ month, total: { questions, costMicros }, campaigns: [{ campaignId, name, deleted, questions, costMicros }], truncated }`: campaign rows by `by_kind_period`, at most 300, most spent first, joined to names |

`allowGmRequests` is the board's "Let GMs raise limits", re-labelled "Let GMs ask for higher limits · You approve each
request" (N10); AD12 enforces it.

## Decisions taken (recommended defaults)

- `pause` keeps `LOREKEEPER_CAP_DEPLOYMENT` (the acceptance's "= today's" behaviour, and the composer already maps
  it); `LOREKEEPER_PAUSED` is used only past the 120% ceiling of `gmOnly` / `short`.
- `atLimit` applies to the deployment's monthly limit only; the campaign's monthly budget stays a hard stop.
- A `gmOnly` answer's later passes may use the room up to the ceiling; a normal answer's later passes stop at the
  limit (the run keeps the answer it has).
- `LOREKEEPER_WEB_CAP` is not thrown: the web pass is skipped silently and `webSearchesLeft` tells the client.

## Tests

`tests/convex/lorekeeper-budget.test.ts` (settings order, campaign numbers, each `atLimit` mode and the ceiling, the
owner, web searches, `mine` per caller, a short run end to end with stubbed fetch, `setLimit` and `useByCampaign`),
`tests/convex/lorekeeper-caps.test.ts` (updated for the async `capLimits` and the wider `mine`),
`tests/convex/authz/admin-lorekeeper.entries.ts` (both functions `appOwner`).
