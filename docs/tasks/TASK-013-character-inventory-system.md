# Task 013 — Character Inventory System

## Status

Complete. The inventory system (migration `20260801090000_inventory_system.sql`)
was implemented and verified on 2026-09-15 against the running local database via
`migration up`. It adds `item_definitions`, `inventory_containers`,
`inventory_entries`, and `inventory_transactions` with RLS, plus the
owner-authorized, idempotent, audited functions `create_item_definition`,
`update_item_definition`, `create_inventory_container`,
`move_inventory_container`, `add_inventory_item`, `transfer_inventory_entry`,
`split_inventory_entry`, `merge_inventory_entries`, `equip_inventory_entry`,
`unequip_inventory_entry`, `consume_inventory_entry`, and
`correct_inventory_entry`. It also makes the reserved `inventory_summary`,
`equipped_items`, and `carried_weight` sheet keys read-only projections
(rejected by `save_character_sheet_value`).

`pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass; the gated DB
integration suite (`tests/integration/inventory-system.db.test.ts`, 15 cases) and
the Playwright inventory spec pass under `RUN_SUPABASE_DB_E2E=1` /
`RUN_SUPABASE_E2E=1`. (Two unrelated PDF/canvas sheet-template e2e specs flake
intermittently under full-suite load but pass on isolated re-run.)

Interpretation decisions, following the task prompt:

- **Ownership.** Every entry carries a denormalized `character_id` (null =
  shared campaign store), set from its container's owner. Equipped items are
  worn by a character (no container); stored items live in a container. A
  placement CHECK keeps those two states mutually exclusive and enforces that an
  equipped entry is a single unit.
- **Cycles are impossible three ways:** a row-level `not_self_parent` CHECK, a
  `before insert/update` trigger that walks the parent chain, and an explicit
  walk in `move_inventory_container`. Nested containers must share their parent's
  owner.
- **Stack rules** live once in `src/lib/domain/inventory` and are re-derived
  authoritatively in SQL: non-stackable items are limited to quantity 1, a
  configured `default_stack_limit` is enforced on add/split/merge/correct, and a
  partial unique index enforces one equipped item per character per slot.
- **Client-supplied resource ids.** Create/add/split functions take a
  client-generated row id so a genuine idempotent retry re-reads the same row.
- **Seeding.** Each campaign gets a default shared container and each character a
  default backpack (trigger plus backfill), so there is always a valid drop
  target.
- **Transfers move a whole stack** (audited `move` when the owner is unchanged,
  `transfer` when it changes); partial moves are done by splitting first. This
  keeps each operation atomic and independently audited.
- **Out of scope:** `item_definitions.asset_id` is a reserved nullable column
  with no foreign key yet (item media arrives with Task 015).

### Generated types note

The committed `database.types.ts` predates a Supabase CLI version bump, so a raw
`supabase gen types --local` reorders unrelated definitions. The inventory table
and function types were spliced onto the committed baseline so existing
definitions stay byte-identical; nullable function arguments are typed `X | null`
to match the committed file's convention.

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
