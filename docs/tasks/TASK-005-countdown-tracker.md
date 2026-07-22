# Task 005 — Countdown Tracker

## Status

Complete — implemented and verified on 2026-07-19 after resolving the category
and completion decisions.

## Verification status

Tasks 001–004 were fully reverified before implementation. Task 005 then passed
a clean five-migration reset, exact generated-type comparison, lint, strict
typecheck, production build, 61 unit/component/integration tests, the live
Playwright suite (5 passed, 1 intentionally skipped), and the complementary
non-live Playwright suite (3 passed, 3 intentionally skipped). The production
browser bundle contains neither the service-role variable name nor its
configured value.

## Goal

Allow the Game Master to create and operate countdowns while preserving a clear
history.

## User story

As the Game Master, I need to track developing threats, projects, and
consequences so that long-running campaign changes remain visible and
consistent.

## Included behavior

- List active countdowns.
- Create a countdown.
- View countdown details.
- Advance a countdown.
- Reverse a countdown when permitted.
- Pause and resume.
- Complete and cancel.
- Show event history.
- Preserve completed countdowns.
- Prevent completion effects from applying twice.
- Provide validation, pending, empty, and failure states.

## Excluded behavior

- Automatic week-linked advancement
- Arbitrary executable completion effects
- Player-facing visibility controls beyond storing the initial visibility value
- Complex templates
- Bulk countdown editing

## Dependencies

- Tasks 001–003
- Resolved `OQ-RULE-007` and `OQ-RULE-008`

## Rules references

Before implementation:

1. Read countdown entries in `docs/rules-index.md`.
2. Verify cited SRD pages.
3. Check campaign overrides.
4. Record the application model in `game-interpretation.md`.

## Data-model changes

Migration `20260719110000_countdown_tracker.sql` adds campaign-scoped creation
idempotency, per-countdown operation idempotency, event status snapshots, and
validated optional reasons. `create_campaign_countdown(...)` and
`operate_countdown(...)` are owner-authorized `SECURITY DEFINER` functions.
They serialize operations where required and atomically maintain cached state
and event history. Direct authenticated countdown writes are revoked.

## Authorization

Only the campaign owner may read or mutate countdowns.

## Validation

- Name is required.
- The starting value must be a positive integer; the target is always `0`.
- Changes cannot move beyond configured boundaries unless correction behavior
  explicitly allows it.
- Status transitions must be valid.
- Completion can occur only once.

## Normal flow

1. GM creates a countdown.
2. Countdown appears in the active list.
3. GM advances it.
4. One countdown event is recorded.
5. Current value updates.
6. Reaching `0` completes the countdown automatically and exactly once.
7. Increasing a completed countdown reopens it without reversing narrative
  consequences.

## Empty state

Show a concise empty state with an action to create the first countdown.

## Loading state

Disable repeated submissions while a mutation is pending.

## Failure state

- Preserve form input after recoverable errors.
- Do not partially update value and history.
- Report invalid status transitions clearly.

## History and audit behavior

Each event displays:

- Event type
- Previous value
- New value
- Change amount
- Reason when present
- Timestamp

## Undo or correction behavior

Initial correction behavior uses compensating events.

Full operation undo may be added after the central operations model exists.

## Acceptance criteria

- A valid countdown can be created.
- Active countdowns are visible from the campaign.
- Advances and reversals create event records.
- Values remain within configured boundaries.
- Pause, resume, complete, and cancel transitions are validated.
- A countdown cannot complete twice.
- Completed countdowns remain in history.
- Unauthorized access fails.
- Required automated checks pass.

## Unit tests

- Direction and boundary calculations
- Status transition rules
- Completion detection
- Validation schemas

## Integration tests

- Atomic value and event update
- Completion-once behavior
- RLS
- Correction behavior

## End-to-end tests

1. Create a countdown.
2. Advance it.
3. Verify current value and history.
4. Pause and resume it.
5. Complete it.
6. Verify it remains visible in completed history.

## Documentation updates

- Update `game-interpretation.md`.
- Update `rules-index.md`.
- Resolve countdown questions in `open-questions.md`.
- Reconcile `product-spec.md` and `data-model.md`.

## Open questions

None for this task. Phase 1 categories are `threat`, `project`, `consequence`,
and `other`; all countdowns count down to `0`; reaching `0` completes
automatically; reversal is allowed up to the initial value; and consequences
are narrative-only.

## Implementation summary

- Added pure countdown boundary/status rules and Zod mutation schemas.
- Added server-only countdown reads and named Server Actions.
- Added responsive creation, operation, status, empty, failure, and event
  history UI to the protected campaign dashboard.
- Added atomic create, advance, reverse, pause, resume, cancel, correction,
  automatic completion, and reopen behavior.
- Added controlled, rotating idempotency keys. Successful operations reload the
  protected dashboard to present authoritative server state; failed operations
  preserve form input and display a safe error.
- Serialized Playwright workflows because all browser tests share one mutable
  local Supabase and one Next.js process. The browser origin now matches the
  Next.js `localhost` origin.

## Verification evidence

- Clean `supabase db reset`: all five migrations applied successfully.
- Fresh local generated types exactly match the committed database types.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `RUN_SUPABASE_DB_E2E=1 pnpm test`: 14 files and 61 tests passed.
- `pnpm build`: passed.
- Live `pnpm test:e2e`: 5 passed and 1 intentionally skipped.
- Non-live `pnpm test:e2e`: 3 passed and 3 intentionally skipped.
- Service-role browser-bundle name/value scan: both absent.
- The only reported build warning is Next.js's existing middleware-to-proxy
  deprecation notice; it does not affect Task 005 behavior.

## Acceptance result

All acceptance criteria are satisfied. Database tests verify atomicity,
boundaries, idempotency, completion-once behavior, corrections, blocked direct
writes, and cross-campaign denial. The browser workflow creates a countdown,
advances it, pauses and resumes it, automatically completes it at zero, checks
four ordered history events, and verifies persistence after reload.
