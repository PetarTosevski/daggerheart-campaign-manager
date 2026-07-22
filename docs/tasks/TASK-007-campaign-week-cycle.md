# Task 007 — Campaign Week and Day/Night Cycle

## Status

Complete — explicitly approved, implemented, and verified on 2026-07-19 after
the Tasks 001–006 verification gate passed.

## Implementation decisions

- No unresolved open question blocks this task. `OQ-RULE-004` does not block
  explicit one-day advancement, and generic undo under `OQ-PROD-005` remains
  excluded.
- The pre-Task-007 planned `campaign_weeks` shape could not represent the
  required day 1–6 transitions or arbitrary auditable corrections because it
  required a positive week increment. Task 007 therefore replaced that planned
  shape with `campaign_time_events`, which records canonical before-and-after
  week, cycle, and cycle-day values for every committed time change.
- A correction is a Task-007-specific compensating operation that may set any
  different valid canonical state. It preserves prior events and links to the
  latest event when one exists. It does not establish generic undo eligibility,
  undo windows, or automatic reversal behavior.
- Preview uses the same pure application transition function as the UI and
  performs no database write. The database function independently enforces the
  identical one-day transition invariant at commit time.

## Goal

Track and display the current campaign week, cycle, cycle day, and thematic phase
without yet applying food, Fear, countdown, or other automatic campaign effects.

## User story

As the Game Master, I need the campaign dashboard to show the current point in
the Witherwild calendar using its thematic phase names so that I can understand
the state of the world at a glance.

## Included behavior

- Read `current_week`, `current_cycle`, and `current_cycle_day` from
  `campaign_state`.
- Derive the thematic display phase from `current_cycle` and
  `current_cycle_day`.
- Display the current value in a prominent format such as:
  `Week 8 • Day Cycle • Forenoon`.
- Display the complete seven-phase sequence for the current cycle when useful.
- Provide a manual control to advance by one campaign day.
- Preview the resulting week, cycle, cycle day, and display phase before commit.
- Commit the transition as one atomic operation.
- Preserve transition history.
- Allow an erroneous transition to be corrected through an auditable operation.
- Permit an explicit GM correction to a valid week, cycle, and cycle day.

## Canonical state

Persist only:

- `current_week`
- `current_cycle`
- `current_cycle_day`

Do not persist the thematic phase name.

The UI derives phase names from this fixed lookup.

### Day Cycle

| Cycle Day | Display Phase |
|---:|---|
| 1 | Dawn |
| 2 | Sunrise |
| 3 | Morning |
| 4 | Forenoon |
| 5 | Midday |
| 6 | Afternoon |
| 7 | Civil Twilight |

### Night Cycle

| Cycle Day | Display Phase |
|---:|---|
| 1 | Nautical Twilight |
| 2 | Astronomical Twilight |
| 3 | Evening |
| 4 | Night |
| 5 | Midnight |
| 6 | Dead of Night |
| 7 | Pre-Dawn |

## Transition rules

- The campaign begins at `Week 1`, `DAY`, cycle day `1` (`Dawn`).
- Advancing from cycle day `1–6` increments only `current_cycle_day`.
- Advancing from cycle day `7`:
  - increments `current_week` by one;
  - resets `current_cycle_day` to `1`;
  - alternates `current_cycle` between `DAY` and `NIGHT`.
- The sequence therefore alternates one seven-day Day Cycle with one seven-day
  Night Cycle.
- A GM correction may set any valid combination without deleting history.

Examples:

```text
Week 1 • Day Cycle • Civil Twilight
→ Week 2 • Night Cycle • Nautical Twilight

Week 2 • Night Cycle • Pre-Dawn
→ Week 3 • Day Cycle • Dawn
```

## Excluded behavior

- Converting rests, sleep, travel, hunting, or settlement activities into an
  automatic number of campaign days
- Hour-by-hour timekeeping
- Food consumption
- Spoilage
- Extended-downtime Fear
- Automatic countdown changes
- Session-end Wither resolution
- Automatic narrative consequences

## Dependencies

- Task 003
- Task 006 for shared operation and idempotency infrastructure
- Resolved `OQ-RULE-003`

`OQ-RULE-004` does not block manual one-day advancement. It remains relevant to
future automatic duration conversion and broader time-advancement workflows.

## Validation

- Week must be at least `1`.
- Cycle must be `DAY` or `NIGHT`.
- Cycle day must be from `1` through `7`.
- Derived phase lookup must be exhaustive and must not return an unknown value
  for valid state.
- Preview must not modify persistent state.
- Retrying a committed operation must not advance time twice.

## Normal flow

1. The GM views the current campaign time.
2. The GM selects advance one day.
3. The application previews the resulting canonical values and thematic phase.
4. The GM confirms.
5. The application records the operation and transition event in one
   transaction.
6. The dashboard displays the newly derived phase.

## History and audit behavior

Each committed transition records:

- Previous week, cycle, and cycle day
- New week, cycle, and cycle day
- Operation type
- Optional GM reason or note
- Timestamp
- Campaign
- Idempotency key or operation identifier
- Correction relationship when applicable

The derived phase name may be included in display output or event summaries, but
the canonical before-and-after numeric/cycle values remain authoritative.

## Acceptance criteria

- The dashboard shows week, cycle, cycle day, and thematic phase.
- Every valid canonical state maps to exactly one thematic phase.
- No thematic phase name is stored as the current campaign-time value.
- Day 7 advances to day 1 of the opposite cycle and increments the week.
- Other day advances do not increment the week or change the cycle.
- Preview performs no write.
- Confirmation is atomic and idempotent.
- Transition history is visible.
- Correction preserves the original event and records a compensating operation.
- Required tests pass.

## Unit tests

Test a pure phase lookup and transition function for:

- All seven Day Cycle mappings
- All seven Night Cycle mappings
- Day 1 through day 6 advancement
- Day Cycle day 7 to Night Cycle day 1
- Night Cycle day 7 to Day Cycle day 1
- Week increment behavior
- Invalid cycle or cycle-day input

## Integration tests

- Atomic state update and transition-event insertion
- Idempotent retry
- Owner authorization and RLS
- Correction operation
- Database constraint enforcement

## End-to-end tests

- Display `Week 1 • Day Cycle • Dawn` for a new campaign.
- Advance from Dawn to Sunrise.
- Advance across the Day-to-Night boundary and verify
  `Week 2 • Night Cycle • Nautical Twilight`.
- Correct a transition and verify history remains available.

## Documentation updates

- Keep `data-model.md`, `game-interpretation.md`, `product-spec.md`, and
  `witherwild-notes.md` synchronized with the implemented lookup and transition
  rules.
- Record any deviation in `open-questions.md`.

## Open questions

No unresolved question blocks or was resolved by this task. The existing
`OQ-RULE-004` decision permits explicit GM-directed time passage, while mapping
narrative activities to durations remains outside Task 007. Generic undo under
`OQ-PROD-005` remains open and was not implemented.

## Implementation summary

- Added `campaign_time_events` and the transactional
  `change_campaign_time(...)` function in
  `20260719130000_campaign_time_tracker.sql`.
- Integrated every committed time change with the Task 006 operations table,
  including campaign-scoped idempotency, actor attribution, and correction
  provenance.
- Revoked direct authenticated writes to canonical campaign-time columns and
  event history; owner reads remain available through RLS.
- Added pure domain transition and phase-sequence logic, Zod action validation,
  server-side data loading, a named Server Action, and a prominent dashboard
  tracker with preview, loading, empty-history, failure, correction, and recent
  history states.
- Added unit, validation, component, database integration, and Playwright
  coverage. Updated the existing Phase 1 and Fear browser regression assertions
  for the intentional authorization boundary and new phase list.

## Verification evidence

- Pre-implementation frozen install and Tasks 001–006 gate: passed.
- Pre-implementation clean six-migration reset and exact generated public
  schema types: passed.
- Final clean reset: all seven migrations replayed successfully.
- Final generated public-schema database types: exact match.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `RUN_SUPABASE_DB_E2E=1 pnpm test`: 18 files and 97 tests passed.
- `pnpm build`: passed.
- Live Playwright: 6 passed and 1 intentionally skipped.
- Non-live Playwright: 3 passed and 4 intentionally skipped.
- Production browser bundle contains neither the service-role variable name nor
  its configured value.
- The only build warning is the existing Next.js middleware-to-proxy
  deprecation notice.

## Acceptance result

Every Task 007 acceptance criterion passed. The dashboard derives and displays
all canonical phases, preview writes nothing, ordinary and boundary advances
follow the approved sequence, commit is atomic and idempotent, correction is
append-only and linked, history is visible, authorization is enforced, and all
Tasks 001–006 regression checks remain operational. Task 008 was not started.