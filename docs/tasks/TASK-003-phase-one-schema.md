# Task 003 — Phase 1 Database Schema

## Status

Complete — schema, RLS, seed, domain logic, and integration tests are
implemented and verified against a local Supabase database (`supabase db reset`
applied both migrations; all nine DB integration tests pass).

## Goal

Create the minimum relational schema required for campaigns, current campaign
state, Fear history, countdown history, and basic character records.

## User story

As the project owner, I need a reproducible and secure schema so that Phase 1
features can be implemented against stable data contracts.

## Included behavior

Create migrations for:

- `campaigns`
- `campaign_state`
- `fear_events`
- `countdowns`
- `countdown_events`
- `characters`

Also include:

- Foreign keys
- Constraints
- Indexes
- Automatic `updated_at`
- Automatic initial campaign-state creation
- Row-Level Security
- Owner policies
- Seed data suitable for local development
- Generated TypeScript database types if part of the chosen workflow

The `campaign_state` table must store the canonical campaign-time values:

- `current_week`
- `current_cycle`
- `current_cycle_day`

The named phase, such as `Forenoon` or `Dead of Night`, is derived by application
logic and must not be stored as the current time value.

## Excluded behavior

- Inventory tables
- Food tables
- Campaign week or day transition history
- Automatic time advancement
- Time-phase UI
- Custom mechanics
- Player membership
- Production data migration

## Dependencies

- Task 001
- Task 002
- `docs/data-model.md`
- Resolved `OQ-RULE-002`
- Resolved `OQ-RULE-003`

## Rules references

- Campaign Fear has a fixed range of `0–12`.
- The campaign begins at week `1`, cycle `DAY`, cycle day `1`.
- `current_cycle` has exactly two allowed values: `DAY` and `NIGHT`.
- `current_cycle_day` has a range of `1–7`.
- Named phases are presentation values derived from cycle and cycle day.
- Character level range must be confirmed before enforcing a final upper bound.

## Data-model changes

The `campaign_state` table must include:

| Field | Type | Required | Default | Notes |
|---|---|---:|---|---|
| `campaign_id` | uuid | yes | none | Primary key and FK to `campaigns` |
| `current_week` | integer | yes | `1` | Minimum `1` |
| `current_cycle` | text | yes | `DAY` | Allowed values: `DAY`, `NIGHT` |
| `current_cycle_day` | smallint | yes | `1` | Integer from `1` through `7` |
| `current_fear` | integer | yes | `0` | Integer from `0` through `12` |
| `campaign_phase` | text | no | `null` | Optional GM-defined narrative label; unrelated to the time-phase lookup |
| `updated_at` | timestamptz | yes | `now()` | Updated automatically |

Required checks:

```sql
check (current_week >= 1)
check (current_cycle in ('DAY', 'NIGHT'))
check (current_cycle_day between 1 and 7)
check (current_fear between 0 and 12)
```

Do not add a persisted column for `Dawn`, `Forenoon`, `Midnight`, or any other
derived phase name.

## Authorization

- Campaign rows are accessible only to their owner.
- Related rows are accessible only through an owned campaign.
- RLS is enabled on every exposed table.

## Validation

Persistent constraints must enforce:

- Nonblank names
- Fear event amount not equal to zero
- Current Fear between `0` and `12`, inclusive
- Valid countdown status
- Valid countdown value boundaries
- `current_week >= 1`
- `current_cycle IN ('DAY', 'NIGHT')`
- `current_cycle_day BETWEEN 1 AND 7`

Application validation must use the same boundaries as the database.

## Normal flow

1. Start a clean local Supabase instance.
2. Apply migrations.
3. Create a test user.
4. Create a campaign.
5. Confirm an initial `campaign_state` row is created with:
   - `current_week = 1`
   - `current_cycle = 'DAY'`
   - `current_cycle_day = 1`
   - `current_fear = 0`
6. Confirm owned related data can be read and written.
7. Confirm another user cannot access it.

## Empty state

A new authenticated user has no campaigns.

## Loading state

Not applicable to the migration itself.

## Failure state

- Migration fails clearly when constraints are invalid.
- Inserts or updates outside the allowed time and Fear ranges fail.
- Unauthorized access is denied.
- A clean reset reproduces the schema.

## History and audit behavior

Fear and countdown changes are represented through event tables.

Campaign-time transition history is introduced in Task 007 rather than in this
schema task.

## Undo or correction behavior

The schema must support correction event types. Full operation-level undo is a
later task.

## Acceptance criteria

- Local database reset applies all migrations successfully.
- All six Phase 1 tables exist.
- Foreign keys and deletion behavior match `data-model.md`.
- `campaign_state` includes `current_week`, `current_cycle`, and
  `current_cycle_day` with the required defaults and checks.
- A new campaign starts at `Week 1 • Day Cycle • Dawn` when the application
  derives the display phase.
- No named time-phase value is persisted as campaign time.
- Current Fear cannot be set below `0` or above `12`.
- RLS is enabled and tested.
- Campaign creation creates exactly one initial campaign-state row.
- Unauthorized cross-user access fails.
- Migration files are committed and reproducible.
- `data-model.md` matches the implemented schema.

## Unit tests

None required for raw SQL.

## Integration tests

- Campaign-state initialization with the exact defaults
- Rejection of week values below `1`
- Rejection of invalid cycle values
- Rejection of cycle-day values outside `1–7`
- Rejection of Fear values outside `0–12`
- Owner RLS for each table
- Constraint enforcement
- Cascade behavior
- Updated timestamp behavior

## End-to-end tests

None required.

## Documentation updates

- Update `data-model.md` with exact implemented field names and SQL types.
- Update generated database types if the project uses them.
- Resolve or record deviations in `open-questions.md`.

## Open questions

- `OQ-PROD-003`
- `OQ-ARCH-003`
- `OQ-DATA-002`

## Completion report

Report:

- Migration files created
- Exact `campaign_state` schema
- Commands executed
- Database reset result
- Integration-test results
- Any deviations from `data-model.md`

### Report (2026-07-18)

Files created:

- `supabase/migrations/20260718090000_phase1_schema.sql` — all six Phase 1
  tables, `set_updated_at()` and `create_initial_campaign_state()` triggers,
  constraints, and indexes.
- `supabase/migrations/20260718090100_phase1_rls.sql` — `owns_campaign()` and
  `owns_countdown()` helpers, RLS enabled with owner select/insert/update/delete
  policies on every table, and `authenticated` grants.
- `supabase/seed.sql` — defensive local seed attaching a demo campaign and five
  characters to the first `auth.users` row; enabled in `supabase/config.toml`.
- `src/lib/domain/campaign-time/index.ts` — canonical phase-name derivation
  (`getPhaseName`, `formatCampaignTime`) with range validation; the named phase
  is never persisted.
- `src/lib/supabase/database.types.ts` — generated from the applied local
  schema and used as the `Database` generic by all Supabase clients.
- `tests/unit/campaign-time.test.ts` — phase mapping, formatting, and range
  errors.
- `tests/integration/phase1-schema.db.test.ts` — `pg`-based integration tests
  for defaults, constraint rejections, cascade, `updated_at`, and owner/cross-
  user RLS on all six Phase 1 tables, gated behind
  `RUN_SUPABASE_DB_E2E=1` and DB reachability.

Exact `campaign_state` schema: `campaign_id` (uuid pk/FK), `current_week`
(integer, default 1, `>= 1`), `current_cycle` (text, default `DAY`, in
`DAY`/`NIGHT`), `current_cycle_day` (smallint, default 1, `1–7`),
`current_fear` (integer, default 0, `0–12`), `campaign_phase` (text, nullable),
`updated_at` (timestamptz, default `now()`, trigger-maintained). Initialized by
the `create_initial_campaign_state()` after-insert trigger.

Commands executed and results:

- `pnpm lint` — pass
- `pnpm typecheck` — pass
- `pnpm test` (with `RUN_SUPABASE_DB_E2E=1`) — pass (26 passed, including all 9
  database integration tests)
- `pnpm build` — pass
- `pnpm test:e2e` — pass

Database reset result: `pnpm dlx supabase db reset` succeeded — both migrations
(`20260718090000_phase1_schema.sql`, `20260718090100_phase1_rls.sql`) applied
cleanly, and the seed correctly no-op'd when no auth user was present.

Generated types result: a fresh local `supabase gen types typescript` output
matched `src/lib/supabase/database.types.ts` exactly on 2026-07-19.

Integration-test results: all nine tests in
`tests/integration/phase1-schema.db.test.ts` pass — campaign_state default
initialization, rejection of week < 1, invalid cycle, cycle day outside 1–7,
and Fear outside 0–12, zero-amount fear event rejection, cascade deletion,
automatic `updated_at`, and cross-user RLS isolation.

Deviations from `data-model.md`: none. `data-model.md` was reconciled in the
same change (character `level` documented as 1–10, `campaign_state` example
block corrected, trigger-based initialization and deferred `operation_id`
foreign key documented).