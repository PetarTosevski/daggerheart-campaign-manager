# Task 014 — Wither Token System

## Objective

Implement Wither Tokens as an authoritative per-character domain with constraints, history, previews, adjustments, and sheet integration.

## Suggested schema

```text
character_wither
- character_id
- campaign_id
- current_tokens
- minimum_tokens
- maximum_tokens nullable
- updated_at
```

```text
wither_transactions
- id
- campaign_id
- character_id
- operation_id nullable
- previous_value
- new_value
- delta
- transaction_type
- reason
- created_at
```

## Rules

- Value cannot fall below minimum.
- Optional maximum is enforced.
- Every change records previous, new, and delta.
- Direct set also creates a transaction.
- Reversal creates a compensating transaction rather than deleting history.
- Future automated effects use the same domain service.

## UI

Implement:

- Overview summary.
- Wither Tokens tab.
- Increment/decrement.
- Direct set with confirmation.
- Required reason for override.
- History.
- Preview of proposed changes.

## Character-sheet integration

Replace provisional `wither_tokens` with the authoritative domain value. The sheet may display it read-only or mutate through the Wither service.

## Acceptance criteria

- One authoritative value exists per character.
- Every change is auditable.
- Constraints are enforced server-side and in the database.
- Sheet values cannot diverge.
- Future automation can reuse the domain service.
