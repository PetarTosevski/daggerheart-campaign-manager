# Task 016 — Dice Engine and Roll History

## Objective

Implement a reusable dice engine, character-linked rolling, immutable roll history, notes, tags, and safe foundations for confirmed Daggerheart mechanics.

## Suggested schema

```text
rolls
- id
- campaign_id
- character_id nullable
- operation_id nullable
- roll_type
- expression
- label nullable
- total
- modifier_total
- result_data
- notes nullable
- created_at
```

```text
roll_tags
- id
- campaign_id
- name
```

## Supported expression subset

```text
d20
2d6
2d6+3
1d12-2
```

Set limits for dice count, sides, modifier size, and expression length. Reject arbitrary code and unsupported operators.

## Roll record

Persist:

- each individual die,
- modifier,
- total,
- roll type,
- linked character,
- timestamp.

Do not store only the total.

## Daggerheart support

Optional initial support may include:

- Hope die,
- Fear die,
- combined total,
- higher-die interpretation,
- confirmed critical conditions.

Only automate rules that are explicitly documented.

## Randomness

Use and document either:

1. server-authoritative randomness, or
2. cryptographic client randomness with immutable server recording.

Do not use `Math.random()` for authoritative rolls.

## UI

Implement:

- Global dice control.
- Character Rolls tab.
- Quick rolls.
- Custom expression.
- Result breakdown.
- Recent history.
- Search/filter.
- Notes and tags.
- Copyable result summary.

## History rules

- Outcomes are immutable.
- Notes and tags may be appended or edited separately.
- Hiding is preferable to deleting.
- Campaign and character references are validated.

## Acceptance criteria

- Valid expressions roll correctly.
- Individual results and totals persist.
- History is searchable and character-linked.
- Outcomes cannot be silently edited.
- Randomness uses an approved method.
- Any Hope/Fear interpretation is rule-grounded.
