# Task 006 — Operations Foundation

## Status

Complete — approved, implemented, and verified on 2026-07-19 after the Tasks
001–005 baseline verification passed.

## Goal

Introduce a central operation record and idempotency foundation before
implementing week advancement, transfers, and operation-level undo.

## Included behavior

- Add an `operations` table.
- Add campaign-scoped idempotency keys.
- Record operation type, summary, actor, timestamps, and optional metadata.
- Support a link from a reversing operation to the original operation.
- Add RLS and indexes.
- Add integration tests for duplicate requests and ownership.
- Add the existing Fear and Countdown event foreign keys without changing their
  current mutation functions.

## Excluded behavior

- Week advancement
- Inventory transfer UI
- Full generic undo engine
- Arbitrary operation plugins
- Undo eligibility, undo windows, blocking rules, and automatic reversal
- Time advancement and transfers

## Acceptance criteria

- Duplicate campaign-scoped idempotency keys cannot apply twice.
- Identical retries return the original operation with `was_applied = false`;
  reuse of the key with different input is rejected.
- The same idempotency key can be used in different campaigns.
- Unauthorized users cannot access operations.
- Authenticated clients cannot directly insert, update, or delete operations.
- The authenticated campaign owner is always recorded as the actor; callers do
  not supply actor identity.
- A reversal reference can target only a different operation in the same
  campaign.
- Existing Fear and Countdown event operation links reference the central
  operations table.
- Existing Phase 1 behavior remains functional.
- Migrations are reproducible.
- `data-model.md` is updated.

## Implementation decisions

- Idempotency keys are UUIDs, consistent with the existing Fear and Countdown
  request keys.
- Operation type and summary are trimmed constrained text. Operation types are
  identifiers, not executable plugins.
- Optional metadata is a JSON object. Task 006 does not interpret it.
- `record_operation(...)` is the only authenticated mutation path. It locks the
  owned campaign before checking the unique campaign/key pair so concurrent
  identical requests serialize safely.
- A matching retry returns the original row and `was_applied = false`. A retry
  whose operation type, summary, metadata, or reversal reference differs is a
  conflict.
- Reversal references provide provenance only. They do not declare that the
  target was eligible for undo or apply compensating changes.

## Implementation summary

- Added `operations` through migration
  `20260719120000_operations_foundation.sql`.
- Added campaign-scoped UUID idempotency, actor attribution, operation type,
  summary, optional JSON-object metadata, timestamp, and optional same-campaign
  reversal provenance.
- Added the owner-authorized `record_operation(...)` transactional function.
- Added RLS owner reads and revoked all direct authenticated mutations.
- Added foreign keys from `fear_events.operation_id` and
  `countdown_events.operation_id` without changing either existing mutation
  function.
- Added seven database integration tests covering creation, matching and
  conflicting retries, concurrent duplicate serialization, cross-campaign key
  reuse, RLS and direct-write denial, reversal constraints, event foreign keys,
  and Fear/Countdown regression behavior.

## Verification evidence

- Frozen dependency install: passed.
- Pre-implementation Tasks 001–005 verification: lint, typecheck, 61 tests,
  production build, clean five-migration reset, exact generated types, and both
  Playwright modes passed.
- Final clean reset: all six migrations replayed successfully.
- Final generated database types: exact match.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `RUN_SUPABASE_DB_E2E=1 pnpm test`: 15 files and 68 tests passed.
- `pnpm build`: passed.
- Live Playwright: 5 passed and 1 intentionally skipped.
- Non-live Playwright: 3 passed and 3 intentionally skipped.
- The only build warning is the existing Next.js middleware-to-proxy
  deprecation notice.

## Acceptance result

Every Task 006 acceptance criterion passed. Campaign-scoped duplicate keys are
database-constrained and cannot apply twice, unauthorized users cannot access
operations, cross-campaign and self reversal links are rejected, migrations
reproduce from a clean database, existing Fear and Countdown behavior remains
operational, and `data-model.md` reflects the implemented schema.

`OQ-DATA-002` is resolved by this implementation. `OQ-PROD-005` remains open;
no generic undo policy or automatic reversal behavior was introduced.
