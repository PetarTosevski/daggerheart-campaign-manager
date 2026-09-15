# Task 012 — Character Food System

## Status

Review — the core food system (migration `20260727090000_food_system.sql`) was
implemented and verified on 2026-07-24 against a clean `supabase db reset` (no
manual SQL). It adds `food_settings`, `food_batches`, `food_transactions`, and
`food_week_processes` with RLS and the owner-authorized, idempotent functions
`acquire_food_batch`, `process_weekly_food`, and `correct_food_batch`, and makes
the reserved `food_rations`/`food_portions` sheet keys read-only projections
(rejected by `save_character_sheet_value`).

A follow-up (migration `20260731090000_food_batch_selection.sql`) closes the one
remaining acceptance gap — the GM batch-selection override — by letting the GM
choose which eligible batches are consumed and in what order, as an audited,
reason-gated override of default FIFO. See "GM override" below.

`pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass; the gated DB
integration and Playwright suites pass (`RUN_SUPABASE_DB_E2E=1` /
`RUN_SUPABASE_E2E=1`).

Interpretation decisions, following the task prompt over the older sketch:
food is a single shared campaign store (no per-character balances); weekly
processing is a standalone action (not coupled to Task 008 advancement) and
protected against duplicate standard runs per week; the migration-preview table
and Food/Wither adapters from the sketch were not built (character migration and
Food/Wither integration are out of scope). See "Implementation and verification"
in the completion report.

## Objective

Implement food as an authoritative campaign domain and connect it to character pages and sheets.

## Canonical rules

```text
1 Ration = 7 Portions
5 active PCs consume 5 Rations per week
```

Do not hard-code character names. Consumption derives from eligible active characters or a campaign override.

## Suggested schema

```text
food_batches
- id
- campaign_id
- label
- acquired_week
- acquired_cycle
- acquired_cycle_day
- initial_portions
- remaining_portions
- spoilage_rule_id nullable
- source_note nullable
- status
- created_at
- updated_at
```

```text
food_transactions
- id
- campaign_id
- batch_id nullable
- character_id nullable
- operation_id nullable
- transaction_type
- portions_delta
- before_portions
- after_portions
- reason
- occurred_at
```

```text
food_settings
- campaign_id
- portions_per_ration
- portions_per_active_character_per_week
- default_spoilage_policy
- updated_at
```

## Domain rules

- Store food internally as portions.
- Display rations and portions.
- Track acquisition week.
- Track partial batches.
- Consume oldest eligible food first unless overridden.
- Preview spoilage and consumption before commit.
- Prevent negative balances.
- Corrections create history rather than rewriting past transactions.

## Weekly processing

Preview:

- eligible characters,
- required portions,
- selected batches,
- shortages,
- spoilage,
- resulting balances.

Commit atomically with idempotency and transaction history.

Initial implementation may use a separate **Process Weekly Food** action rather than running automatically during Task 008 advancement.

## GM override

Allow overrides for consuming-character count, portions, selected batches, and spoilage decision. Require a reason.

### Batch-selection override (follow-up)

FIFO (oldest eligible first) is the default and requires no reason. The GM may
instead explicitly select **which** eligible batches are consumed and **in what
order**. This is an audited, reason-gated override:

- **Eligibility.** Only active batches with remaining portions may be selected.
  Fresh batches that will spoil in the target process are shown but not
  consumable (unless spoilage is skipped, which keeps them available). Spoiled,
  depleted, cross-campaign, duplicate, and unknown batches are rejected.
- **Consumption.** When a selection is active, ONLY the selected batches are
  consumed, in the exact submitted order; there is never a fall-back to
  unselected batches. Shortage is computed from the selected post-spoilage
  supply, so it can report a shortage even while unselected batches still hold
  food.
- **Spoilage interaction.** Spoilage is applied first; a selected batch that
  spoils in the same process contributes nothing and is rejected on commit. The
  batch override composes with the required-portions and skip-spoilage overrides.
- **Validation.** Enforced independently in the pure domain (`validateBatchSelection`,
  `computeWeeklyPreview`), in Zod (`processWeeklyFoodSchema`: override flag,
  ordered UUID list, no duplicates, non-empty when active, reason required, and
  no selected batches unless the override is enabled), and authoritatively in SQL
  under row locks.
- **Audit.** `food_week_processes` records `used_custom_selection`, the submitted
  ordered ids (`selected_batch_ids`), and an immutable per-batch snapshot
  (`selection_detail`: effective position and consumed portions per batch,
  including selected batches that consumed zero), alongside the existing reason
  and the append-only `food_transactions` consume rows. Idempotency is unchanged:
  a genuine retry (same key + identical selection/order/reason) returns the
  original result without re-consuming; a reused key with a changed
  selection/order/reason fails.
- **UI.** The normal workflow is unchanged. A "Override FIFO batch selection"
  toggle in the GM-override panel reveals an accessible editor (include/exclude
  plus move-up/move-down ordering, not drag-only) listing each batch's label,
  food type, acquisition week, remaining portions, and spoilage state, with a
  running selected-available-vs-required and expected-shortage readout, a
  required reason, a summary of all active overrides, and a clear "FIFO
  overridden" indicator in the preview.

## Character-sheet integration

Replace provisional `food_rations` and `food_portions` values with domain-backed presentation. There must be one authoritative food source.

## Acceptance criteria

- Food is stored in portions.
- Weekly processing can be previewed.
- Commit is atomic and idempotent.
- Partial batches and acquisition week are preserved.
- GM overrides are audited.
- Sheet food values cannot diverge.
