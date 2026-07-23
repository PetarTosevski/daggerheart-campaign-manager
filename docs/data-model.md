# Data Model

## Document status

Status: Reconciled through the Character Sheet Runtime migration
(`20260718090000_phase1_schema.sql`, `20260718090100_phase1_rls.sql`, and
`20260719090000_fear_tracker.sql`, followed by
`20260719090100_remove_fear_reasons.sql` and
`20260719110000_countdown_tracker.sql`, followed by
`20260719120000_operations_foundation.sql`,
`20260719130000_campaign_time_tracker.sql`,
`20260722090000_character_workspace.sql`,
`20260723090000_sheet_template_versions.sql`,
`20260724090000_campaign_name_unique_per_owner.sql`,
`20260725090000_sheet_template_fields.sql`, and
`20260726090000_character_sheet_runtime.sql`).

This document defines the relational data model, important constraints,
relationships, event history, and invariants.

The initial schema should be implemented incrementally through migrations.


## Migration reconciliation

The committed Supabase migrations are the source of truth for the schema that
actually exists. This document is the source of truth for intended invariants
and design rationale.

Before modifying an existing schema:

1. Inspect every committed migration in order.
2. Compare actual tables, columns, functions, indexes, policies, and constraints
   with this document.
3. Record discrepancies before generating a new migration.
4. Never rewrite a migration already applied to a shared or production
   database.
5. Update this document in the same change as a schema migration.

Tables described as `Later table` are planned, not confirmed as absent or
present, until the repository is inspected.

## Modeling principles

1. Every campaign-owned record must reference a campaign directly or through a
   required parent.
2. Use UUID primary keys.
3. Use `timestamptz` for timestamps.
4. Use relational columns for stable fields.
5. Use JSONB only for genuinely flexible custom-mechanic data.
6. Preserve event history for important state changes.
7. Use database constraints for persistent invariants.
8. Use transactions for compound operations.
9. Prefer archival or compensating events over destructive deletion.
10. Protect user-owned data with Row-Level Security.

## Initial Phase 1 tables

The first schema contains:

- `campaigns`
- `campaign_state`
- `fear_events`
- `countdowns`
- `countdown_events`
- `characters`

The operations foundation adds:

- `operations`

The campaign-time tracker adds:

- `campaign_time_events`

The character workspace foundation adds:

- `character_classes`
- `sheet_templates`

and links `characters` to a chosen class and sheet template.

The sheet-template PDF foundation adds:

- `sheet_template_versions`

and an `active_version_id` pointer on `sheet_templates`, backed by the private
`character-sheet-templates` Storage bucket.

Later phases add:

- `inventory_items`
- `inventory_transactions`
- `food_stores`
- `food_transactions`
- `character_resources`
- `mechanic_definitions`
- `mechanic_instances`
- `notes`
- `audit_events`

## Entity relationships

```text
auth.users
  └── campaigns
        ├── campaign_state
        ├── fear_events
        ├── countdowns
        │     └── countdown_events
        ├── character_classes
        ├── sheet_templates
        │     └── sheet_template_versions
        ├── characters
        ├── campaign_time_events
        ├── inventory_items
        │     └── inventory_transactions
        ├── food_stores
        │     └── food_transactions
        ├── mechanic_instances
        ├── notes
        └── operations
```

## Table: campaigns

Purpose: Top-level container for all campaign data.

Fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | Primary key |
| `owner_id` | uuid | yes | References `auth.users(id)` |
| `name` | text | yes | Trimmed, 1–100 characters |
| `description` | text | no | Short campaign description |
| `status` | text | yes | `active` or `archived` |
| `created_at` | timestamptz | yes | Defaults to `now()` |
| `updated_at` | timestamptz | yes | Updated automatically |
| `archived_at` | timestamptz | no | Set when archived |

Relationships:

- One campaign has one current campaign state.
- One campaign has many Fear events.
- One campaign has many countdowns.
- One campaign has many characters.
- One campaign has many later-phase resources and operations.

Constraints:

- `name` must not be blank.
- `owner_id` must exist.
- Campaign name is unique per owner, case-insensitively and trimmed
  (`campaigns_owner_name_unique` on `(owner_id, lower(btrim(name)))`, Task 009A).
  Names may repeat across different owners.
- Archived campaigns remain readable unless explicitly deleted.

Creation path (Task 009A):

An authenticated GM creates the first campaign in-app through the
`campaigns_insert_own` RLS policy (`owner_id = auth.uid()`); the
`create_initial_campaign_state()` trigger seeds the canonical starting state
(Week 1, `DAY`, cycle day 1, Fear 0) in the same transaction. No service-role
access or hard-coded UUID is involved, and the application never depends on
`seed.sql` to become usable. The app operates a single active campaign, selecting
the earliest-created active campaign deterministically; a multi-campaign switcher
is not built (see `OQ-PROD-002`).

## Table: campaign_state

Purpose: Stores fast-access current campaign values.

Fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `campaign_id` | uuid | yes | Primary key and FK to `campaigns` |
| `current_week` | integer | yes | Minimum 1 |
| `current_cycle` | text | yes | Allowed values: `DAY`, `NIGHT` |
| `current_cycle_day` | smallint | yes | Integer from 1 through 7 |
| `current_fear` | integer | yes | Integer from 0 through 12 |
| `campaign_phase` | text | no | Optional user-defined narrative phase; not used for Day/Night cycle display |
| `updated_at` | timestamptz | yes | Updated automatically |

Constraints:

- `current_week >= 1`
- `current_cycle IN ('DAY', 'NIGHT')`
- `current_cycle_day BETWEEN 1 AND 7`
- `current_fear BETWEEN 0 AND 12`

Derived values:

The named time phase is not stored in the database.

The application derives the displayed phase from `current_cycle` and
`current_cycle_day`.

### Day Cycle display phases

| Cycle Day | Display Phase |
|---:|---|
| 1 | Dawn |
| 2 | Sunrise |
| 3 | Morning |
| 4 | Forenoon |
| 5 | Midday |
| 6 | Afternoon |
| 7 | Civil Twilight |

### Night Cycle display phases

| Cycle Day | Display Phase |
|---:|---|
| 1 | Nautical Twilight |
| 2 | Astronomical Twilight |
| 3 | Evening |
| 4 | Night |
| 5 | Midnight |
| 6 | Dead of Night |
| 7 | Pre-Dawn |

Example:

```text
current_week = 8
current_cycle = DAY
current_cycle_day = 4
→ displayed as "Week 8 • Day Cycle • Forenoon"
```

Initialization:

Exactly one `campaign_state` row is created per campaign by the
`create_initial_campaign_state()` trigger, which fires after a campaign is
inserted and seeds Week 1, `DAY`, cycle day 1, Fear 0.

Invariant:

`campaign_state` is a cached current view. Events and operations preserve the
history explaining how the current values were reached. The Fear maximum of 12
is enforced by a database check constraint, and any adjustment must update
`current_fear` in the same transaction as its `fear_events` record.

Authenticated clients cannot update `current_week`, `current_cycle`, or
`current_cycle_day` directly. Task 007 changes those values only through
`change_campaign_time(...)`, atomically with an operation and a
`campaign_time_events` row.

## Table: fear_events

Purpose: Records every Fear adjustment.

Fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | Primary key |
| `campaign_id` | uuid | yes | FK to `campaigns` |
| `operation_id` | uuid | no | FK to `operations(id)` for a compound operation when applicable |
| `amount` | integer | yes | Positive adds Fear; negative removes Fear |
| `event_type` | text | yes | `adjustment`, `correction`, `undo`, or `automatic` |
| `previous_value` | integer | yes | Fear immediately before the event |
| `new_value` | integer | yes | Fear immediately after the event |
| `idempotency_key` | uuid | yes | Request identifier unique within the campaign |
| `created_at` | timestamptz | yes | Defaults to `now()` |
| `created_by` | uuid | yes | Authenticated user |

Constraints:

- `amount <> 0`.
- `previous_value` and `new_value` are each between 0 and 12.
- `new_value = previous_value + amount`.
- `(campaign_id, idempotency_key)` is unique.
- A correction must preserve the original event rather than deleting it.

Indexes:

- `(campaign_id, created_at desc)`
- Unique `(campaign_id, idempotency_key)`
- `(operation_id)` when operations are introduced

Invariant:

Every change to current Fear creates exactly one Fear event inside the same
transaction that updates `campaign_state.current_fear`. Authenticated clients
cannot insert, update, or delete Fear events directly and cannot update
`current_fear` directly.

Mutation path:

`adjust_campaign_fear(campaign_id, amount, event_type, idempotency_key)` is the
only authenticated Fear write path. The PostgreSQL
function:

- requires an authenticated campaign owner;
- validates the nonzero integer change, supported event type, idempotency key,
  and resulting `0–12` total;
- locks the campaign-state row to serialize concurrent adjustments;
- atomically updates the cached total and inserts the complete transition;
- returns the original event without reapplying a retried request key; and
- rejects reuse of a request key with different input.

Fear adjustments retain their existing UUID request-level idempotency. The
nullable `operation_id` now references the shared operations foundation, but
the current Fear mutation does not populate it because Task 006 deliberately
does not retrofit existing single-resource workflows.

## Table: countdowns

Purpose: Represents progress toward a defined outcome.

Fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | Primary key |
| `campaign_id` | uuid | yes | FK to `campaigns` |
| `name` | text | yes | 1–100 characters |
| `description` | text | no | Optional explanation |
| `category` | text | yes | `threat`, `project`, `consequence`, or `other` for Phase 1 |
| `direction` | text | yes | `up` or `down` |
| `current_value` | integer | yes | Current cached value |
| `target_value` | integer | yes | Completion boundary |
| `starting_value` | integer | yes | Initial value |
| `status` | text | yes | `active`, `paused`, `completed`, `cancelled` |
| `visibility` | text | yes | `gm` initially; future values may be added |
| `consequence` | text | no | Short user-entered outcome |
| `idempotency_key` | uuid | no | Required for Task 005 creation; unique within the campaign when present |
| `linked_entity_type` | text | no | Optional polymorphic link descriptor |
| `linked_entity_id` | uuid | no | Optional linked entity |
| `completed_at` | timestamptz | no | Set once completed |
| `created_at` | timestamptz | yes | Defaults to `now()` |
| `updated_at` | timestamptz | yes | Updated automatically |
| `archived_at` | timestamptz | no | Optional archival timestamp |

Constraints:

- `name` must not be blank.
- `starting_value`, `current_value`, and `target_value` must be valid for the
  selected direction.
- Task 005 creates only downward countdowns with a positive `starting_value`,
  target `0`, initial value equal to the starting value, and GM visibility.
- Task 005 values remain between `0` and `starting_value`.
- Completed countdowns remain available in history.
- Reaching `0` changes the status to `completed` atomically with the event.
- Reversing a completed countdown above `0` reopens it and clears
  `completed_at`; this does not reverse narrative consequences.
- `(campaign_id, idempotency_key)` is unique when an idempotency key is
  present, preserving compatibility with pre-Task-005 rows.

Indexes:

- `(campaign_id, status)`
- `(campaign_id, category)`
- Unique partial `(campaign_id, idempotency_key)`
- `(linked_entity_type, linked_entity_id)` when used

Mutation path:

`create_campaign_countdown(campaign_id, name, description, category,
starting_value, consequence, idempotency_key)` is the only authenticated Task
005 creation path. It authorizes the campaign owner, trims and validates input,
creates the constrained initial state, and returns the original countdown
without inserting again when an identical request is retried. Reusing the key
with different input is rejected.

## Table: countdown_events

Purpose: Records every countdown mutation.

Fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | Primary key |
| `countdown_id` | uuid | yes | FK to `countdowns` |
| `operation_id` | uuid | no | FK to `operations(id)` for a compound operation when applicable |
| `change_amount` | integer | yes | Signed change |
| `event_type` | text | yes | `advance`, `reverse`, `pause`, `resume`, `complete`, `cancel`, `correction`, `undo` |
| `reason` | text | no | Optional explanation |
| `previous_value` | integer | yes | Value before mutation |
| `new_value` | integer | yes | Value after mutation |
| `previous_status` | text | no | Status before mutation; populated by Task 005 operations |
| `new_status` | text | no | Status after mutation; populated by Task 005 operations |
| `idempotency_key` | uuid | no | Required for Task 005 operations; unique within the countdown when present |
| `created_at` | timestamptz | yes | Defaults to `now()` |
| `created_by` | uuid | yes | Authenticated user |

Constraints:

- Value-changing events require `change_amount <> 0`.
- State-only events may use `change_amount = 0`.
- `new_value` must match the resulting countdown state.
- Optional reasons contain 1–200 trimmed characters.
- Status snapshots, when present, are `active`, `paused`, `completed`, or
  `cancelled`.
- A retry with the same operation key returns the original event without
  changing the countdown again.

Indexes:

- `(countdown_id, created_at desc)`
- Unique partial `(countdown_id, idempotency_key)`
- `(operation_id)` when operations exist

Mutation path:

`operate_countdown(countdown_id, action, change_amount, reason,
idempotency_key)` is the only authenticated Task 005 operation path. It locks
the countdown row, authorizes its campaign owner, validates boundaries and
status transitions, atomically updates cached value/status and inserts one
event, and protects retries by idempotency key. Supported actions are
`advance`, `reverse`, `pause`, `resume`, `cancel`, and `correction`.

An advance that reaches `0` retains event type `advance` while its
`previous_status` and `new_status` record the automatic completion transition.
Paused countdowns cannot change value, and cancelled countdowns are terminal.
Authenticated clients cannot directly insert, update, or delete countdowns or
countdown events. The current Countdown functions leave `operation_id` null;
later approved compound workflows may populate it atomically.

## Table: characters

Purpose: Stores basic player-character records.

Fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | Primary key |
| `campaign_id` | uuid | yes | FK to `campaigns` |
| `name` | text | yes | 1–100 characters |
| `pronouns` | text | no | User-entered (legacy Phase 1 column) |
| `ancestry` | text | no | Short label (legacy Phase 1 column) |
| `community` | text | no | Short label (legacy Phase 1 column) |
| `class_name` | text | no | Legacy free-text label; superseded by `class_id` |
| `subclass_name` | text | no | Short label (legacy Phase 1 column) |
| `level` | integer | yes | Defaults to 1; constrained to 1–10 (Daggerheart range) |
| `class_id` | uuid | no | Task 010; same-campaign FK to `character_classes` |
| `sheet_template_id` | uuid | no | Task 010; same-campaign FK to `sheet_templates` |
| `portrait_url` | text | no | User-supplied asset reference |
| `notes` | text | no | Private GM notes |
| `status` | text | yes | `active` or `archived` |
| `created_at` | timestamptz | yes | Defaults to `now()` |
| `updated_at` | timestamptz | yes | Updated automatically |
| `archived_at` | timestamptz | no | Optional archival timestamp |

Task 010 additions:

- `class_id` and `sheet_template_id` are nullable so pre-existing rows and
  campaigns without classes/templates remain valid. The guided builder always
  sets both through `create_character(...)`.
- Both use composite `(campaign_id, <ref>_id)` foreign keys, so a character can
  only ever reference a class and template inside its own campaign. Deleting a
  referenced class or template nulls only that reference column (`on delete set
  null (<col>)`), never `campaign_id`.
- Indexes `(campaign_id, class_id)` and `(campaign_id, sheet_template_id)`.

Immutability rule:

Once a character is created, its `sheet_template_id` is fixed data. Nothing
rewrites it in response to later class or template changes. `update_character`
edits only `name`, `status`, and `notes`; it never re-templates a character.

Mutation path:

`create_character(campaign_id, name, class_id, sheet_template_id, notes)` and
`update_character(character_id, name, status, notes)` are the application's
owner-authorized, `SECURITY DEFINER` mutation paths. `create_character`
validates the trimmed name, requires an active same-campaign class, and accepts
an optional active same-campaign template. `update_character` validates the
trimmed name and `active`/`archived` status, trims notes, and stamps
`archived_at` when a character is archived. Direct table grants from Phase 1
remain for backward compatibility with existing tests and seeds; the application
writes only through these functions, and campaign isolation is enforced
structurally by RLS and the composite foreign keys on every path.

Initial design rule:

Do not store the entire character sheet as one unvalidated JSON object.

Later character details should be added through stable columns or related tables
such as `character_resources`, `character_experiences`, and
`character_conditions`.

## Table: character_classes

Purpose: Campaign-scoped character classes offered by the guided builder. Each
class may suggest a default sheet template.

Fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | Primary key |
| `campaign_id` | uuid | yes | FK to `campaigns` |
| `name` | text | yes | Trimmed, 1–100 characters |
| `description` | text | no | Short description |
| `default_template_id` | uuid | no | Same-campaign FK to `sheet_templates` |
| `is_active` | boolean | yes | Defaults to true; inactive classes are unavailable for creation |
| `created_at` | timestamptz | yes | Defaults to `now()` |
| `updated_at` | timestamptz | yes | Updated automatically |

Constraints and indexes:

- `name` must not be blank.
- Unique `(campaign_id, id)` supports same-campaign composite foreign keys.
- `(campaign_id, default_template_id)` references
  `sheet_templates(campaign_id, id)` with `on delete set null (default_template_id)`.
- Index `(campaign_id, is_active)`.

Asset columns from the task's suggested schema (`artwork_asset_id`,
`class_recording_asset_id`) are deferred to the asset/media library task; this
migration adds no placeholder asset columns or tables.

## Table: sheet_templates

Purpose: Campaign-scoped character-sheet templates. Task 010 stores only
template identity and association; PDF storage, versions, fields, and rendering
belong to Tasks 011A–011C.

Fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | Primary key |
| `campaign_id` | uuid | yes | FK to `campaigns` |
| `name` | text | yes | Trimmed, 1–100 characters |
| `class_id` | uuid | no | Same-campaign FK to `character_classes` |
| `is_blank_template` | boolean | yes | Defaults to false; the builder's fallback |
| `status` | text | yes | `active` or `archived` |
| `created_at` | timestamptz | yes | Defaults to `now()` |
| `updated_at` | timestamptz | yes | Updated automatically |

Constraints and indexes:

- `name` must not be blank; `status in ('active', 'archived')`.
- Unique `(campaign_id, id)` supports same-campaign composite foreign keys.
- `(campaign_id, class_id)` references `character_classes(campaign_id, id)` with
  `on delete set null (class_id)`.
- Partial unique index on `(campaign_id) where is_blank_template` guarantees at
  most one blank template per campaign, so the builder's fallback is
  unambiguous.
- Indexes `(campaign_id, status)` and `(campaign_id, class_id)`.

Template suggestion is a presentation rule computed in the domain layer
(`suggestTemplateId`): a class suggests its active default template, falling back
to the campaign blank template, then to none. The database does not compute the
suggestion.

Task 011A additions:

- `active_version_id` points at the currently rendered
  `sheet_template_versions` row. It uses a composite `(campaign_id,
  active_version_id)` foreign key that is `DEFERRABLE INITIALLY DEFERRED`, so a
  full template/campaign cascade delete succeeds in one transaction while a
  normal attempt to delete a still-referenced (active) version fails at commit.

## Table: sheet_template_versions

Purpose: Immutable, campaign-scoped PDF versions behind a sheet template
(Task 011A). Storage holds the bytes; this table holds validated metadata and the
pointer target for a template's active version. It contains no field
definitions, coordinates, or sheet values — those belong to Tasks 011B–011C.

Fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | Primary key; generated by the server so the storage path can be built before insert |
| `campaign_id` | uuid | yes | FK to `campaigns` |
| `template_id` | uuid | yes | Same-campaign FK to `sheet_templates` |
| `version_number` | integer | yes | Per-template, starts at 1, increments |
| `source_bucket` | text | yes | Always `character-sheet-templates` |
| `source_object_path` | text | yes | `{campaignId}/{templateId}/{versionId}/source.pdf`; unique |
| `original_filename` | text | yes | Uploaded filename (1–300 chars) |
| `mime_type` | text | yes | Always `application/pdf` |
| `size_bytes` | bigint | yes | 1 byte to 25 MiB (26,214,400) |
| `checksum` | text | yes | SHA-256 hex of the uploaded bytes |
| `page_count` | integer | yes | 1–100; extracted server-side with unpdf |
| `status` | text | yes | `active` or `archived` |
| `created_at` | timestamptz | yes | Defaults to `now()` |
| `created_by` | uuid | yes | Authenticated owner |

Constraints and indexes:

- Unique `(source_object_path)`, `(template_id, version_number)`, and
  `(campaign_id, id)` (the last supports the active-version composite FK).
- Composite `(campaign_id, template_id)` → `sheet_templates(campaign_id, id)`
  `on delete cascade` makes a version impossible to attach across campaigns.
- Check constraints pin MIME to `application/pdf`, size to `(0, 26214400]`,
  page count to `1–100`, version number `>= 1`, and non-blank checksum/filename.
- Indexes `(template_id, version_number desc)` and `(campaign_id)`.

Storage:

- Private bucket `character-sheet-templates` (not public), 25 MiB limit, MIME
  restricted to `application/pdf`.
- Object path `{campaignId}/{templateId}/{versionId}/source.pdf`. New PDFs always
  create a new version and a new path; originals are never overwritten (no
  storage UPDATE policy). Access is through short-lived signed URLs only; there
  are no permanent public URLs.
- `storage.objects` policies scope select/insert/delete to the owner of the
  campaign named by the first path segment (`owns_campaign(foldername[1])`).

Mutation path:

`create_sheet_template_version(template_id, version_id, source_object_path,
original_filename, size_bytes, checksum, page_count)` is the owner-authorized,
`SECURITY DEFINER` creation path. The server first validates the PDF (signature,
MIME, size, corruption/page-count via unpdf) and uploads the immutable object,
then calls this function, which authorizes the owner, requires an active template,
assigns the next version number, re-derives and enforces the exact object path,
records the metadata, and atomically points the template at the new active
version. `archive_sheet_template_version(version_id)` marks a version archived and
moves the active pointer to the newest remaining active version (or clears it).
Direct insert/update on `sheet_template_versions` is revoked; owners retain select
and delete, and the deferred active-version FK prevents deleting a referenced
version.

Layout lifecycle (Task 011B): `layout_status` (`draft` or `published`, default
`draft`) and `published_at` were added. A version's field layout is editable only
while `draft`; publishing freezes the fields and points the template's
`active_version_id` at the version. Editing a published layout clones the version
into a new draft revision (`create_sheet_template_revision`), copying the PDF
object and field definitions; existing/assigned versions are never mutated.

## Table: sheet_template_fields

Purpose: Interactive field definitions overlaid on a template version's PDF pages
(Task 011B). Stores field DEFINITIONS only — no runtime character values (those
are Task 011C).

Fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | Primary key |
| `campaign_id` | uuid | yes | FK to `campaigns` (RLS + composite FK) |
| `template_version_id` | uuid | yes | Same-campaign FK to `sheet_template_versions` |
| `field_key` | text | yes | Stable key: `^[a-z][a-z0-9_]{0,63}$` |
| `label` | text | yes | 1–100 characters |
| `field_type` | text | yes | `text`, `multiline_text`, `number`, `checkbox`, `select`, `radio`, `image`, `counter`, `computed` |
| `page_number` | integer | yes | `>= 1`; validated against the version's page count |
| `x`, `y`, `width`, `height` | numeric | yes | Normalized to page bounds `[0,1]`, fully inside the page |
| `configuration` | jsonb | yes | Object; options/placeholder/default/computed formula, etc. |
| `display_order` | integer | yes | Ordering within the version |
| `is_required` | boolean | yes | Defaults false |
| `is_active` | boolean | yes | Deactivated fields are retained but not enforced |
| `created_at` / `updated_at` | timestamptz | yes | Defaults to `now()` |

Constraints and indexes:

- Key format, label length, allowed `field_type`, `page_number >= 1`, and
  normalized-coordinate bounds (`0 <= x,y`; `0 < width,height <= 1`;
  `x+width <= 1`; `y+height <= 1`) are DB check constraints. `configuration`
  must be a JSON object.
- Partial unique index on `(template_version_id, lower(field_key)) where
  is_active` enforces one active key per version (case-insensitive); a
  deactivated key may be reused.
- Composite `(campaign_id, template_version_id)` →
  `sheet_template_versions(campaign_id, id)` `on delete cascade` makes a
  cross-campaign field impossible.
- Indexes `(template_version_id, page_number, display_order)` and `(campaign_id)`.

Reserved keys (`food_rations`, `food_portions`, `wither_tokens`) are ordinary
editable fields in Task 011B and are intentionally not wired to the food or
Wither systems. `computed` fields store a predefined-formula choice but are not
evaluated (runtime calculation is Task 011C).

Mutation path:

Direct insert/update is revoked; owners retain select (and delete). Writes flow
through owner-authorized `SECURITY DEFINER` functions:

- `save_sheet_template_fields(template_version_id, fields jsonb)` replaces a
  draft version's field set atomically, validating type, page range, normalized
  coordinates, key format, and duplicate active keys; it rejects edits to a
  published version.
- `publish_sheet_template_version(template_version_id)` sets `layout_status =
  published`, stamps `published_at`, and sets the template's `active_version_id`.
- `create_sheet_template_revision(source_version_id, new_version_id,
  new_object_path)` clones a published version into a new draft (server copies
  the PDF object first), copying the field definitions.

## Character sheet version pinning (Task 011C)

`characters.sheet_template_version_id` (nullable) pins a character to a specific
immutable `sheet_template_versions` row via a same-campaign composite foreign key
`(campaign_id, sheet_template_version_id)` (`on delete set null
(sheet_template_version_id)`, so a character never loses its `campaign_id`). This
is the layout a character renders and stores values against.

Invariants:

- New characters are pinned at creation (`create_character`) to the selected
  template's current active version **only when that version is published**;
  otherwise the pin is left null and the runtime shows a controlled
  assign-version state.
- Runtime code reads the pinned version, never `sheet_templates.active_version_id`
  dynamically, so **publishing a newer version cannot change an existing
  character's layout**.
- Upgrading a character to a newer version is deliberately not implemented (a
  future, explicit workflow). `pin_character_sheet_version(character_id)` performs
  a one-time assignment for a character that has a template but no pin, and only
  when the template's active version is published; it never reassigns an
  already-pinned character or assigns a draft.
- `characters` also gained a unique `(campaign_id, id)` to support the
  same-campaign composite foreign key from `character_sheet_values`.

## Table: character_sheet_values

Purpose: Character-specific runtime values for the pinned sheet, stored SEPARATELY
from the template and the PDF (Task 011C). Editing a character never modifies the
PDF, field definitions, or version metadata.

Fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | Primary key |
| `campaign_id` | uuid | yes | FK to `campaigns` (RLS + composite FKs) |
| `character_id` | uuid | yes | Same-campaign FK to `characters` |
| `template_field_id` | uuid | yes | Same-campaign FK to `sheet_template_fields` (a field of the pinned version) |
| `field_key` | text | yes | Snapshot of the field key at write time |
| `value` | text | no | Serialized value; null clears the field |
| `value_type` | text | yes | Snapshot of the field type |
| `created_at` / `updated_at` | timestamptz | yes | Server-managed; `updated_at` drives optimistic concurrency |

Constraints and indexes:

- Unique `(character_id, template_field_id)` — one value per character and field.
- Composite `(campaign_id, character_id)` → `characters(campaign_id, id)` and
  `(campaign_id, template_field_id)` → `sheet_template_fields(campaign_id, id)`,
  both `on delete cascade`, make cross-character/cross-campaign values impossible.
- `value_type` check across the nine field types; indexes on `character_id` and
  `campaign_id`; `updated_at` trigger.

Mutation path:

Direct insert/update is revoked (owners retain select). Writes flow through the
owner-authorized `SECURITY DEFINER` function
`save_character_sheet_value(character_id, template_field_id, value,
expected_updated_at)`, which:

- authorizes the campaign owner and requires the character to have a pinned
  version;
- requires the field to belong to that pinned version and be active;
- rejects computed and read-only fields;
- validates/normalizes by type (numeric with min/max, boolean checkbox,
  select/radio option membership, length caps) — an empty value clears the field
  and a valid zero is preserved;
- applies optimistic concurrency via `expected_updated_at` (a stale snapshot is
  rejected with SQLSTATE `40001`), so a delayed write cannot clobber a newer edit.

Computed fields are read-only and are **not** evaluated in Task 011C: the task
document defines no safe expression language (operands, dependency model,
allowlist), so per the task contract none was invented. The reserved keys
`food_rations`, `food_portions`, and `wither_tokens` are ordinary sheet fields
here with no Food/Wither integration.

## Table: operations

Purpose: Provides one campaign-owned identity, idempotency boundary, and audit
summary for a logical operation. A row may describe future compound changes,
but Task 006 does not itself apply domain effects or determine undo eligibility.

Fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | Primary key |
| `campaign_id` | uuid | yes | FK to `campaigns` |
| `idempotency_key` | uuid | yes | Request identifier unique within the campaign |
| `operation_type` | text | yes | Trimmed, lower-cased identifier; 1–100 characters |
| `summary` | text | yes | Trimmed human-readable description; 1–200 characters |
| `created_by` | uuid | yes | Authenticated campaign owner derived from `auth.uid()` |
| `created_at` | timestamptz | yes | Defaults to `now()` |
| `metadata` | jsonb | no | Optional JSON object; stored but not interpreted by Task 006 |
| `reverses_operation_id` | uuid | no | Provenance link to a different operation in the same campaign |

Constraints:

- Unique `(campaign_id, idempotency_key)`.
- Unique `(campaign_id, id)` supports the composite reversal foreign key.
- `(campaign_id, reverses_operation_id)` references
  `operations(campaign_id, id)`, preventing cross-campaign reversal links.
- `reverses_operation_id` cannot equal the row's own `id`.
- Metadata is null or a JSON object.
- Task 006 does not limit how many records may reference an original operation;
  that would define undo policy and remains under `OQ-PROD-005`.

Indexes:

- Unique `(campaign_id, idempotency_key)`.
- `(campaign_id, created_at desc, id desc)` for deterministic campaign history.
- Partial `(reverses_operation_id)` for non-null provenance links.

Mutation and idempotency path:

`record_operation(campaign_id, idempotency_key, operation_type, summary,
metadata, reverses_operation_id)` is the only authenticated mutation path. The
`SECURITY DEFINER` function:

- derives the actor from `auth.uid()` and verifies that actor owns the campaign;
- locks the owned campaign before checking its request key, serializing
  concurrent requests in that campaign;
- relies on the database unique constraint as the final duplicate guard;
- inserts and returns a new row with `was_applied = true` for a new key;
- returns the original row with `was_applied = false` for an identical retry;
- rejects reuse of a key when type, summary, metadata, or reversal reference
  differs; and
- validates that a referenced original operation belongs to the same campaign.

The same UUID key may be used independently in different campaigns. Direct
authenticated insert, update, and delete permissions are revoked. RLS and the
`operations_select_own` policy permit authenticated users to read only rows for
campaigns they own. No client-supplied actor identity is accepted.

History and reversal semantics:

Operations are append-only through the authenticated interface. A reversal
reference records provenance only. It does not decide whether the original is
eligible, define a time window or blocking rule, or apply compensating changes.
Those decisions remain explicitly deferred under `OQ-PROD-005`.

## Table: campaign_time_events

Purpose: Records every committed one-day campaign-time advance and explicit GM
correction using canonical before-and-after state.

Fields:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `id` | uuid | yes | Primary key |
| `campaign_id` | uuid | yes | FK to `campaigns` |
| `operation_id` | uuid | yes | Same-campaign FK to `operations`; unique per event |
| `event_type` | text | yes | `advance` or `correction` |
| `previous_week` | integer | yes | Canonical week before the change |
| `previous_cycle` | text | yes | `DAY` or `NIGHT` before the change |
| `previous_cycle_day` | smallint | yes | Cycle day `1–7` before the change |
| `new_week` | integer | yes | Canonical week after the change |
| `new_cycle` | text | yes | `DAY` or `NIGHT` after the change |
| `new_cycle_day` | smallint | yes | Cycle day `1–7` after the change |
| `note` | text | no | Trimmed GM note, at most 200 characters |
| `corrects_event_id` | uuid | no | Optional same-campaign link to the corrected event |
| `created_at` | timestamptz | yes | Defaults to `now()` |

Constraints:

- Every before-and-after canonical value satisfies the same week, cycle, and
  cycle-day bounds as `campaign_state`.
- An event must change at least one canonical value.
- An `advance` event must represent exactly one day: days `1–6` increment only
  the cycle day; day `7` increments the week, resets the day to `1`, and
  alternates the cycle.
- `(campaign_id, operation_id)` links to an operation in the same campaign, and
  each operation can have at most one campaign-time event.
- `(campaign_id, corrects_event_id)` can reference only an event in the same
  campaign and cannot reference the event itself.

Indexes:

- `(campaign_id, created_at desc, id desc)` for deterministic recent history.
- Partial `(corrects_event_id)` for correction provenance.

Mutation path:

`change_campaign_time(campaign_id, idempotency_key, intent, target_week,
target_cycle, target_cycle_day, note, corrects_event_id)` is the only
authenticated mutation path. The `SECURITY DEFINER` function:

- derives the actor from `auth.uid()` and verifies campaign ownership;
- uses `record_operation(...)` for campaign-scoped idempotency and operation
  provenance;
- locks authoritative campaign state before calculating and applying a change;
- atomically updates canonical state and inserts one event;
- returns the original event without reapplying an identical retry;
- rejects conflicting retries, malformed one-day transitions, no-op
  corrections, and cross-campaign correction links; and
- links a correction operation to the corrected event's operation when a
  corrected event is supplied.

Authorization and history:

RLS permits owners to read their campaign-time events. Direct authenticated
insert, update, and delete are revoked, as are direct updates to canonical
campaign-time columns. Corrections append compensating operations and events;
they never rewrite or delete prior history. This Task-007-specific correction
path does not define generic undo eligibility under `OQ-PROD-005`.

## Later table: inventory_items

Purpose: Represents a distinct inventory stack or item record.

Fields include:

- `id`
- `campaign_id`
- `name`
- `description`
- `owner_type`
- `owner_id`
- `quantity`
- `unit`
- `consumable`
- `tags`
- `notes`
- timestamps
- archival state

Owner types initially:

- `character`
- `party`
- `location`

Invariant:

Quantity must never become negative.

## Later table: inventory_transactions

Purpose: Preserves acquisition, consumption, transfer, loss, and correction
history.

Transaction types:

- `acquire`
- `consume`
- `transfer_out`
- `transfer_in`
- `lose`
- `discard`
- `correction`
- `undo`

A transfer must create matched transaction records under one operation.

Invariant:

The total quantity across source and destination changes by zero for a pure
transfer.

## Later table: food_stores

Purpose: Stores food separately from general inventory.

Fields include:

- `id`
- `campaign_id`
- `owner_type`
- `owner_id`
- `name`
- `quantity`
- `unit`
- `portions`
- `acquired_week`
- `spoils_at_week`
- `food_category`
- `notes`
- timestamps
- archival state

Invariant:

Food quantity and portions must not be negative.

No universal spoilage or consumption rule is assumed.

## Later table: food_transactions

Transaction types:

- `acquire`
- `consume`
- `transfer_out`
- `transfer_in`
- `spoil`
- `lose`
- `correction`
- `undo`

Every weekly consumption applied during week advancement must link to the same
operation as the week advancement.

## Later table: character_resources

Purpose: Stores character resources without hard-coding every resource directly
into the character table.

Possible fields:

- `id`
- `character_id`
- `resource_type`
- `current_value`
- `maximum_value`
- `updated_at`

The set of resources must be confirmed against the SRD and the initial product
scope before implementation.

## Later table: mechanic_definitions

Purpose: Defines constrained campaign-specific mechanic schemas.

Fields include:

- `id`
- `campaign_id`
- `stable_key`
- `name`
- `description`
- `scope`
- `field_schema`
- `validation_schema`
- timestamps
- archival state

Use JSONB only for the constrained schema definitions.

Do not permit arbitrary executable code.

## Later table: mechanic_instances

Purpose: Stores active state for a mechanic definition.

Fields include:

- `id`
- `campaign_id`
- `mechanic_definition_id`
- `scope_type`
- `scope_id`
- `state`
- timestamps
- archival state

The `state` JSONB must be validated against the associated definition.

## Row-Level Security

Initial ownership policy:

- `campaigns.owner_id = auth.uid()`
- Related records are accessible only when their parent campaign belongs to
  `auth.uid()`.
- Operations are selectable only when their campaign belongs to `auth.uid()`;
  mutation is restricted to the owner-authorized `record_operation()` function.
- `character_classes`, `sheet_templates`, and `characters` all use owner RLS via
  `owns_campaign(campaign_id)`. Character mutation additionally goes through the
  owner-authorized `create_character()` and `update_character()` functions, and
  cross-campaign references are impossible because every class/template/character
  reference is a composite `(campaign_id, id)` foreign key.
- `sheet_template_versions` uses owner RLS via `owns_campaign(campaign_id)`;
  inserts/updates flow only through the version functions, while owners retain
  select/delete. Storage objects in `character-sheet-templates` are authorized by
  the campaign named in the object's first path segment.

RLS must be enabled on every exposed campaign-owned table.

## Deletion behavior

Default behavior:

- Deleting a campaign cascades to campaign-owned data only after explicit
  destructive confirmation.
- Characters, countdowns, items, and food stores should normally be archived.
- Historical event rows should not be individually deleted through normal UI.
- Corrections and undo operations should preserve the original history.

## Derived values

Derived or cached values include:

- `campaign_state.current_fear`
- `campaign_state.current_week`
- `countdowns.current_value`
- inventory quantities
- food quantities and portions

Rules:

1. Cached totals must be updated in the same transaction as their event.
2. History must be sufficient to audit the change.
3. Reconciliation tests should confirm cached values match event history where
   practical.

## Required database invariants

- Fear cannot be negative.
- Countdown completion cannot occur twice.
- Campaign week cannot move backward through normal advancement.
- Inventory quantity cannot be negative.
- Food quantity and portions cannot be negative.
- A transfer preserves total quantity.
- A retried operation does not apply twice.
- Operation idempotency is campaign-scoped, not global.
- Reversal provenance cannot point across campaigns or to the same operation.
- A character cannot reference a class or sheet template from another campaign.
- A character's sheet template does not change automatically when its class or a
  template default changes later.
- A sheet-template version cannot reference a template in another campaign, and a
  stored PDF object is reachable only by the owner of its campaign folder.
- A template version that is still referenced as the active version cannot be
  deleted; uploaded PDF originals are never overwritten.
- An unauthorized user cannot read or mutate another user's campaign.
- Compound operations are atomic.
- Undo creates traceable compensating changes.

## Schema questions still unresolved

See `open-questions.md` for:

- Fear maximum
- Countdown direction rules
- Character level range confirmation
- Required character resources
- Food units and portion rules
- Spoilage model
- Undo eligibility and retention
- Location modeling
- Whether recent activity uses a dedicated table or a unified operation view
