# Task 013 — Character Inventory System

## Objective

Implement authoritative character and campaign inventory with reusable items, stacks, containers, equipment, transfers, consumables, and history.

## Suggested schema

```text
item_definitions
- id
- campaign_id
- name
- description
- category
- stackable
- default_stack_limit nullable
- unit_weight nullable
- asset_id nullable
- is_active
- created_at
- updated_at
```

```text
inventory_containers
- id
- campaign_id
- character_id nullable
- parent_container_id nullable
- name
- container_type
- capacity_value nullable
- sort_order
- created_at
- updated_at
```

```text
inventory_entries
- id
- campaign_id
- character_id nullable
- container_id nullable
- item_definition_id
- quantity
- state
- equipped_slot nullable
- custom_name nullable
- notes nullable
- created_at
- updated_at
```

```text
inventory_transactions
- id
- campaign_id
- operation_id nullable
- transaction_type
- quantity_delta
- source_character_id nullable
- target_character_id nullable
- source_container_id nullable
- target_container_id nullable
- reason
- created_at
```

## Domain rules

- Quantity cannot be negative.
- Non-stackable items use quantity 1.
- Stack limits are enforced when configured.
- Containers cannot contain themselves or form cycles.
- Equipped state requires a character owner.
- Transfers, splits, merges, and consumption are atomic and audited.

## UI

Implement:

- Character Inventory tab.
- Shared campaign inventory.
- Item-definition manager.
- Add, move, transfer, equip, consume, split, and merge.
- Search, filters, containers, and history.

## Character-sheet integration

Expose derived fields such as:

```text
inventory_summary
equipped_items
carried_weight
```

Do not duplicate inventory rows into generic sheet values.

## Acceptance criteria

- Characters and shared stores can hold items.
- Transfers and consumption are atomic.
- Container cycles are impossible.
- Stack rules are enforced.
- Sheet presentation derives from the inventory domain.
