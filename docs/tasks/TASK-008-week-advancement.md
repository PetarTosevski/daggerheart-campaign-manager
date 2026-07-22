# Task 008 — Week Advancement

## Status

Complete — satisfied primarily by the existing Task 007 implementation, plus a
small reconciling delta. See "Verification and reconciliation" below.

## Objective

Implement authoritative campaign-time advancement by one cycle day.

## Canonical model

```ts
type CampaignTime = {
  currentWeek: number;
  currentCycle: "DAY" | "NIGHT";
  currentCycleDay: 1 | 2 | 3 | 4 | 5 | 6 | 7;
};
```

## Rules

- Days 1–6 advance within the current cycle.
- `DAY 7` advances to the next week at `NIGHT 1`.
- `NIGHT 7` advances to the next week at `DAY 1`.
- Week increments only when leaving cycle day 7.

## Scope

Implement:

- Pure `getNextCampaignTime` function.
- Preview action.
- Atomic commit action.
- Campaign-scoped idempotency.
- Operation history with before/after values.
- Confirmation UI.
- Tests and documentation.

## Database constraints

```text
current_week >= 1
current_cycle IN ('DAY', 'NIGHT')
current_cycle_day BETWEEN 1 AND 7
```

## Commit requirements

A commit must:

1. Re-read canonical state inside a transaction.
2. Derive the next state server-side.
3. Update the campaign.
4. Record the operation.
5. Return the committed result.
6. Roll back fully on failure.

## UI flow

```text
Advance Time
  → Preview current and next state
  → Confirm or cancel
  → Commit
  → Refresh canonical campaign state
```

Do not process food, spoilage, countdowns, or Wither in this task.

## Tests

Cover all 14 valid states, invalid values, both cycle boundaries, duplicate idempotency keys, concurrent requests, unauthorized access, cross-campaign isolation, and transaction rollback.

## Acceptance criteria

- Every valid state advances correctly.
- Duplicate requests cannot advance twice.
- Invalid state is rejected.
- Before/after values are audited.
- Preview and commit use one domain rule.
- Verification commands pass.

## Verification and reconciliation

Reconciled on 2026-07-21. Task 008's entire scope was already implemented and
verified by the completed Task 007, which owns campaign-time advancement. Per
the source-of-truth hierarchy in `AGENTS.md` (existing implemented behavior and
committed migrations outrank a task spec) and the reconciliation rule in
`docs/tasks/README.md`, the feature was not recreated. Existing coverage was
audited against every requirement in this task and mapped as follows:

| Requirement | Existing implementation |
|---|---|
| Pure next-state function | `getNextCampaignTime` in `src/lib/domain/campaign-time/index.ts` |
| Preview (no write) | `src/components/campaign-time/campaign-time-tracker.tsx` |
| Atomic idempotent commit | `change_campaign_time(... 'advance')` in `20260719130000_campaign_time_tracker.sql` |
| Campaign-scoped idempotency | `record_operation` (Task 006) |
| Operation history with before/after | `public.campaign_time_events` |
| Confirmation UI | campaign-time tracker |
| Commit re-reads → derives server-side → updates → records → returns → rolls back | `change_campaign_time` (single `plpgsql` transaction, `for update`) |
| DB constraints (week ≥ 1, cycle in DAY/NIGHT, day 1–7) | `public.campaign_state` (Task 003) and `campaign_time_events` checks |
| Tests: 14 states, invalid input, both boundaries, duplicate keys, concurrency, unauthorized, cross-campaign, rollback | `tests/unit/campaign-time.test.ts`, `tests/integration/campaign-time.db.test.ts` |

### Delta added by Task 008

Only two non-duplicative changes were made:

1. Renamed the pure transition function to the contract name
   `getNextCampaignTime` (was `advanceCampaignTimeByOneDay`), updating its three
   references. Behavior is unchanged.
2. Added an integration test that advances all 14 valid states through the
   `change_campaign_time` RPC, satisfying "cover all 14 valid states" at the
   authoritative layer (the RPC previously exercised three states directly).
3. Refined `CampaignTime.currentCycleDay` to the specification's literal union
   `1 | 2 | 3 | 4 | 5 | 6 | 7` (was `number`). Added the `CampaignCycleDay` type
   with an `isCampaignCycleDay` guard and a `toCampaignCycleDay` converter, and
   routed the data and action layers through the converter so the union
   propagates with full type safety. Runtime behavior is unchanged; the same
   range validation still runs.

No new migration, RPC, RLS policy, or UI was created, because doing so would
duplicate Task 007.

### Verification commands (2026-07-21)

- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `RUN_SUPABASE_DB_E2E=1 pnpm test`: 18 files, 98 tests passed (was 97 before
  the added 14-state test; the database integration suite executed rather than
  skipped).
- `pnpm build`: passed. The only warning is the pre-existing Next.js
  middleware-to-proxy deprecation noted in Task 007.
- Playwright end-to-end was not re-run; the change is an internal rename plus an
  added database test, with no change to user-visible behavior.
