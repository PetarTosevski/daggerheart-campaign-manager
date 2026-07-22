# Task 012 — Character Food System

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

## Character-sheet integration

Replace provisional `food_rations` and `food_portions` values with domain-backed presentation. There must be one authoritative food source.

## Acceptance criteria

- Food is stored in portions.
- Weekly processing can be previewed.
- Commit is atomic and idempotent.
- Partial batches and acquisition week are preserved.
- GM overrides are audited.
- Sheet food values cannot diverge.
