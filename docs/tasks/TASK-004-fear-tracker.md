# Task 004 — Fear Tracker

## Status

Complete — the approved requirement revision removes Fear reasons from the
interface, validation, persistence, history, RPC, and tests.

## Verification status

Approved by the user's explicit Task 004 instruction on 2026-07-19.

Tasks 002 and 003 were reverified before implementation: clean migration reset,
current generated Supabase types, owner/cross-user RLS on all six Phase 1
tables, live authentication with session persistence, frozen install, lint,
typecheck, 26 unit/integration tests, production build, and live Playwright all
passed.

Task 004 requirement-revision verification completed 2026-07-19. All required
checks passed:

- Clean local database reset applied all four committed migrations, including
  the forward-only Fear reason-removal migration.
- Fresh local Supabase type generation exactly matched
  `src/lib/supabase/database.types.ts`.
- `pnpm install --frozen-lockfile` completed successfully.
- `pnpm lint` and `pnpm typecheck` completed successfully.
- `RUN_SUPABASE_DB_E2E=1 pnpm test` passed all 44 unit, component,
  authentication, RLS, and database integration tests.
- `pnpm build` completed successfully.
- Live Playwright passed the Fear persistence workflow and full configured
  parallel suite: 4 passed, 1 intentionally skipped while live authentication
  was enabled.
- Browser verification confirmed immediate total/history updates, pending and
  boundary states, persistence after refresh, and the reason-free workflow.
- Regression coverage confirms multiple increases and decreases can be applied
  consecutively without a reload, with a distinct idempotency key for each
  intentional adjustment.

The only build warning is Next.js 16's existing deprecation notice for the
`middleware` file convention; it does not affect Task 004 behavior.

## Goal

Allow the Game Master to view, adjust, and audit campaign Fear safely.

## User story

As the Game Master, I need to change Fear quickly during a session and see its
ordered adjustment history so that the current total remains trustworthy.

## Included behavior

- Display current Fear.
- Increase Fear.
- Decrease Fear.
- Show recent Fear history.
- Prevent negative Fear.
- Record every adjustment as a Fear event.
- Update current Fear and insert the event transactionally.
- Support correction through a compensating event.
- Provide clear pending and error states.

## Excluded behavior

- Automatic Fear changes from week advancement
- Full operation undo
- Player-facing display
- Campaign analytics
- Rules text reproduction

## Dependencies

- Tasks 001–003
- Resolution or deliberate deferral of `OQ-RULE-002`

## Rules references

Before implementation:

1. Read the Fear entry in `docs/rules-index.md`.
2. Verify the cited SRD pages.
3. Check `campaign-house-rules.md`.
4. Update `game-interpretation.md` with the application behavior.

## Data-model changes

Prefer a transactional database function such as:

```text
adjust_campaign_fear(
  campaign_id,
  amount,
  event_type,
  idempotency_key
)
```

If an operations table does not yet exist, document the temporary idempotency
strategy.

Task 004 strategy: add a dedicated UUID `idempotency_key` to each Fear event
with a unique `(campaign_id, idempotency_key)` index. The Fear adjustment
database function serializes adjustments per campaign, returns the original
result for a retried key, and does not depend on the later `operations` table.
The existing nullable `operation_id` remains reserved for Task 006.

## Authorization

Only the campaign owner may read or adjust Fear.

## Validation

- Amount must be an integer.
- Amount must not be zero.
- Resulting Fear must not be negative.
- Maximum validation depends on the resolved rule.

## Normal flow

1. GM opens the dashboard.
2. Current Fear is visible.
3. GM selects adjustment or correction.
4. GM selects the one-point increase or decrease action.
5. The application saves one event and updates the total.
6. The dashboard and newest-first history refresh.

## Empty state

A new campaign displays Fear at its configured initial value and an empty
history message.

## Loading state

- Disable duplicate submission.
- Show a clear pending state.
- Do not optimistically display a committed total unless rollback is reliable.

## Failure state

- Preserve the selected change type after recoverable errors.
- Display invariant failures clearly.
- Do not partially update the total or history.

## History and audit behavior

History displays:

- Signed amount
- Resulting total when available
- Timestamp
- Event type

## Undo or correction behavior

A correction creates a compensating Fear event. It does not delete or edit the
original event.

## Acceptance criteria

- Current Fear is displayed.
- Valid increases and decreases work.
- Negative resulting Fear is rejected.
- Every successful adjustment creates exactly one event.
- Current total and event insertion are atomic.
- Duplicate submissions do not apply twice.
- History is ordered newest first.
- Unauthorized access fails.
- Required automated checks pass.

## Unit tests

- Direction and event-type schemas
- Negative-result domain rule
- Maximum rule when confirmed

## Integration tests

- Atomic total and event update
- Duplicate request protection
- RLS
- Correction event behavior

## End-to-end tests

1. Open a campaign.
2. Increase Fear.
3. Verify the total and history.
4. Refresh and verify the committed total and history persist.
5. Decrease Fear.
6. Verify the lower-bound control prevents an invalid decrease.

Direct database integration tests additionally attempt values below 0 and above
12 and verify both the cached total and event count remain unchanged.

## Documentation updates

- `game-interpretation.md` records the atomic, idempotent Fear workflow.
- `campaign-house-rules.md`, `product-spec.md`, and `rules-index.md` record the
  confirmed `0–12` range and public-rules reference.
- `data-model.md` documents the implemented transition fields, constraints,
  direct-write restrictions, and PostgreSQL function.
- `OQ-RULE-002` and `OQ-ARCH-003` are resolved.

## Open questions

None for this task. The Fear range is `0–12` (`OQ-RULE-002`), and a new campaign
starts at Fear `0` per the committed Task 003 schema.
