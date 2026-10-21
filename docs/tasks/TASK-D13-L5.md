# TASK-D13-L5: Cost caps and usage counters

Plan `.omc/plans/d13-lorekeeper.yaml`, tracer L5 (wave 2). Bead dcm-bxp.82. Depends on L0 (tables, `capLimits`,
`usageDay`, `usageMonth`, the stub signatures) and L1 (`src/lib/lorekeeper/pricing.ts`).

## What landed

| File | Role |
|---|---|
| `convex/lib/lorekeeper/caps.ts` | Real bodies for `reserve`, `settle` and `remaining`; new `reservePass` (+ types `ReservePass`, `PassOptions`). `capLimits`, `usageDay`, `usageMonth` and the L0 types are unchanged. |
| `convex/lorekeeperUsage.ts` | `mine` (campaignQuery view): what the composer shows. |
| `tests/convex/lorekeeper-caps.test.ts` | 21 tests: limits, reserve, reservePass, settle, `mine`. |
| `tests/convex/authz/lorekeeper-usage.{entries,test}.ts` | Matrix area `lorekeeper-usage`. |

## Limits (USER ANSWER Q9)

40 questions per person per UTC day (across all campaigns), $50 per campaign per calendar month (UTC), $150 per
month server-wide. Env vars, read in every call, so `npx convex env set` changes them without a deploy:
`LOREKEEPER_DAILY_QUESTIONS`, `LOREKEEPER_CAMPAIGN_MONTHLY_USD`, `LOREKEEPER_MONTHLY_USD`. A value that is not a
non-negative number falls back to the default; 0 refuses everything. The plan's acceptance text ($10 / $25, env
default 25) predates Q9; the user's answer wins.

## Reserve / settle design (orchestrator decision on L1 question 4: reserve per pass)

Counters: `lorekeeperUsage` rows `user` (userId, day), `campaign` (campaignId, month), `deployment` (month), each
found by point read on `by_user_period`, `by_campaign_period`, `by_kind_period`. Every row holds `questions` and
`costMicros` (reservations plus settled costs).

1. **`reserve(ctx, user, campaign, model, now)`** — in `lorekeeper.ask`'s transaction. Refuses, in this order:
   `LOREKEEPER_CAP_USER` when the user's day count is already at the limit; `LOREKEEPER_CAP_CAMPAIGN` /
   `LOREKEEPER_CAP_DEPLOYMENT` when `costMicros + reserveMicros(model)` would exceed the month's cap. Otherwise +1
   question and +`reserveMicros(model)` on all three rows (created on first use). Returns `{ micros, day, month }`
   for the answer's `reserved` field.
2. **`reservePass(ctx, scopes, model, now, opts?)`** — before the Opus retry (L3) and before the web pass (L8, pass
   `{ webSearches: 3 }`), from an internal mutation. Checks only the money caps (the question is already counted);
   returns the micros booked, or **null with nothing booked** when a cap would be exceeded: the run then skips the
   pass and keeps the Sonnet answer. The caller adds the micros to the row's `reserved.micros`.
3. **`settle(ctx, scopes, reservedMicros, actualMicros)`** — adds `actual − reserved` to all three rows (never below
   0; a missing row is left alone, never recreated). Call it per pass with that pass's real cost
   (`costMicros(usageFromApi(...), model)`), and lower `reserved.micros` on the row by what was settled, so the
   stale-run sweep in `lorekeeperRetention.expireStaleRuns` (which settles `reserved.micros` against
   `usage.costMicros`) never double-settles. On error or stop settle the usage received so far, 0 before any token.
   `scopes` are the reservation's `day` / `month`, so an answer finishing after midnight settles the right periods.
   Questions stay counted on error.

**Race safety:** each function reads and writes the counter rows inside the caller's mutation. Convex mutations are
serializable (OCC), so of two concurrent asks the second sees the first's write or retries; a cap is never passed.
Tested with two concurrent reserves at the edge of the campaign cap and of the daily cap.

## Public functions

| Function | Wrapper | anon | outsider | otherPlayer | player | grantee | GM |
|---|---|---|---|---|---|---|---|
| `lorekeeperUsage:mine` | campaignQuery `need: "view"` | UNAUTHENTICATED | NOT_FOUND | ok | ok | ok | ok |

`mine({ campaignId, day, month })` — `day` "YYYY-MM-DD", `month` "YYYY-MM" from the client's UTC clock (CF10);
malformed or mismatched values throw `INVALID` (after the access check). Returns `{ questionsLeft,
campaignCapReached, deploymentCapReached }` (returns validator). Only the caller's own question count is read; the
budgets are booleans and say whether the next question's Sonnet worst case (`reserveMicros(modelFor("answer"))`)
would be refused, matching `reserve`.

## Checks

`pnpm lint`, `pnpm typecheck`, `pnpm vitest run --maxWorkers=4 --testTimeout=60000` (see the tracer report for
counts), `pnpm tracer:guard .omc/plans/d13-lorekeeper.yaml L5`.

## For the tracers that consume this

- **L3:** `ask` calls `reserve(ctx, ctx.user, ctx.campaign, modelFor("answer"), Date.now())` and stores the result
  as `reserved`. Before the retry: `reservePass(ctx, scopes, modelFor("retry"), now)`; null → keep the Sonnet answer
  (no "Checked again"). Settle each pass's real cost and keep `reserved.micros` equal to what is still unsettled.
- **L6:** the composer calls `lorekeeperUsage.mine` with `new Date().toISOString().slice(0, 10)` / `.slice(0, 7)`;
  disable it with `CAP_USER_TEXT` when `questionsLeft === 0`, `CAP_CAMPAIGN_TEXT` / `CAP_DEPLOYMENT_TEXT` when a
  budget flag is true.
- **L8:** `reservePass(ctx, scopes, modelFor("web"), now, { webSearches: 3 })` before the web pass; null → store the
  books-only miss.
