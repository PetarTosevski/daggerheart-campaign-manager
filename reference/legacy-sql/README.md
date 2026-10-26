# Legacy SQL (read-only reference)

These Postgres migrations come from the Witherwild-era app (tag
`witherwild-final`), which ran on the previous hosted Postgres backend. They are
**not executed** by anything in this repository.

They are kept only as the behavioural reference for porting Fear, countdowns,
campaign time, idempotent operations and campaign-name uniqueness to Convex.
Each file is deleted once the Convex port matches its behaviour in tests (see
`.omc/plans/campaign-manager-rebuild.md`).

| File | Reference for |
|---|---|
| `20260718090000_phase1_schema.sql` | Base tables, Fear and countdown event-type constraints |
| `20260719090000_fear_tracker.sql` | Original Fear adjustment function |
| `20260719090100_remove_fear_reasons.sql` | Current Fear adjustment function |
| `20260719110000_countdown_tracker.sql` | Countdown create/operate/correct rules |
| `20260719120000_operations_foundation.sql` | Idempotent operations |
| `20260719130000_campaign_time_tracker.sql` | Week and DAY/NIGHT advancement |
| `20260724090000_campaign_name_unique_per_owner.sql` | Campaign-name uniqueness rule |
