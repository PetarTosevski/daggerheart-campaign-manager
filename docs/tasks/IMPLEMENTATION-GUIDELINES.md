# Implementation Guidelines

## One task at a time

For each task:

1. Read `AGENTS.md`.
2. Verify prior tasks and migrations.
3. Review only blocking open questions.
4. Implement only the assigned scope.
5. Add migrations, RLS, tests, and documentation.
6. Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

7. Stop and report:
   - files changed,
   - migrations,
   - RLS policies,
   - tests,
   - command results,
   - blockers,
   - deferred work.

## Critical boundaries

Do not merge Tasks 011A, 011B, and 011C.

```text
011A = immutable files and rendering
011B = template definitions
011C = character-specific runtime values
```

After Tasks 012–014, the character sheet is not authoritative for Food, Inventory, or Wither. It must use domain adapters.

## Suggested migration order

```text
008_campaign_time_advancement.sql
010_character_foundation.sql
011a_sheet_template_versions.sql
011b_sheet_template_fields.sql
011c_character_sheet_values.sql
012_food_domain.sql
013_inventory_domain.sql
014_wither_domain.sql
015_asset_library.sql
016_roll_history.sql
```
