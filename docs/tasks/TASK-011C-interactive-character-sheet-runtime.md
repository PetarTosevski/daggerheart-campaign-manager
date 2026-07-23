# Task 011C — Interactive Character Sheet Runtime

## Prerequisite from Task 011B reconciliation (version pinning)

As of Task 011B the `characters` table stores only `sheet_template_id` (a FK to
`sheet_templates`) — it has **no version reference**. No runtime code currently
resolves a character's sheet through `sheet_templates.active_version_id` (the
character modules do not touch `sheet_template_versions` / `sheet_template_fields`
at all; the Character Sheet tab is still a placeholder). This preserves a clean
slate: nothing renders or stores sheet values yet.

Before 011C renders or stores any values, it MUST pin each character to a
specific immutable version:

1. Add `characters.sheet_template_version_id` (nullable uuid) with a
   same-campaign composite FK `(campaign_id, sheet_template_version_id)` →
   `sheet_template_versions(campaign_id, id)` (`on delete` chosen so a character
   never silently loses its pinned version).
2. Assign it at character creation to the template's **current active published**
   version (only `layout_status = 'published'` versions may be assigned). New
   characters use the active published version at creation time.
3. Runtime rendering and value storage MUST read the character's pinned
   `sheet_template_version_id` — never `sheet_templates.active_version_id`
   dynamically. Publishing a newer version therefore cannot change an existing
   character's layout.
4. Upgrading an existing character to a newer version remains an **explicit,
   future migration action** (not automatic).
5. Existing characters created before this column exists need a backfill/assignment
   step (or remain unpinned until explicitly assigned); define this in 011C.

## Status

Complete — implemented and verified on 2026-07-26. Migration
`20260726090000_character_sheet_runtime.sql` adds version pinning
(`characters.sheet_template_version_id`), the `character_sheet_values` table, and
the `save_character_sheet_value` / `pin_character_sheet_version` functions, and
pins new characters at creation. `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
`pnpm build` pass; against a clean `supabase db reset` (no manual SQL) the DB
integration suite passed with `RUN_SUPABASE_DB_E2E=1` and the full Playwright
suite with `RUN_SUPABASE_E2E=1`. See "Implementation and verification".

### Scope decisions (per the authoritative task prompt)

- **Computed fields — scoped blocker.** This task document defines no safe
  computed-field expression language (operands, dependency model, allowlist). Per
  the contract ("document the blocker and stop rather than inventing one"), no
  evaluator was invented: computed fields render **read-only and are not
  evaluated**, and the server rejects writes to them. Deterministic computed
  evaluation is deferred until an expression model is specified.
- **Migration preview / adapters — out of scope.** The prompt lists character
  migration between versions and Food/Wither integration as out of scope, so the
  suggested `character_sheet_migrations` table, migration preview, and reserved-key
  adapters were not built. Reserved keys are ordinary fields.
- **Image fields** render a placeholder pending the Task 015 asset library (no
  parallel asset system created).

### Implementation and verification

- Pinning: new characters pin the template's active version only when published;
  runtime reads the pinned version, never `active_version_id`. Existing/legacy
  characters are reconciled via an explicit `pin_character_sheet_version` GM
  action (published-only, never a draft, never a reassignment) surfaced as the
  "Assign published version" control; no data is deleted and no silent upgrade
  occurs.
- Values: `character_sheet_values` (one per character/field, same-campaign
  composite FKs, RLS, owner-only writes via `save_character_sheet_value`).
  Validation by type is authoritative in the DB function and mirrored client-side.
  Optimistic concurrency via `updated_at`; the client also ignores stale responses
  by sequence.
- Runtime UI: `components/character-sheet/character-sheet-runtime.tsx` renders the
  pinned PDF page with zoom/page navigation and HTML overlays positioned by
  normalized coordinates, with debounced autosave and Saving/Saved/Unsaved/Save
  failed feedback; wired into the workspace Character Sheet tab, replacing the
  Task 010 placeholder.

## Objective

Render and persist character-specific values over PDF templates and published field definitions.

## Suggested schema

```text
character_sheet_values
- id
- character_id
- template_field_id
- field_key_snapshot
- value
- value_type
- is_active
- created_at
- updated_at
```

```text
character_sheet_migrations
- id
- character_id
- from_template_version_id
- to_template_version_id
- mapping_summary
- unmatched_values
- created_at
- created_by
```

## Scope

Implement:

- Character Sheet runtime.
- Secure PDF and field loading.
- Character-specific values.
- Debounced autosave.
- Save-state feedback.
- Multi-page and zoom-safe overlays.
- Class/template migration preview.
- Reserved Food and Wither values behind adapters.
- RLS, tests, and documentation.

## Autosave states

```text
Saving…
Saved
Save failed
Offline or unavailable
```

Protect newer edits from stale responses and preserve unsaved input during transient failure.

## Migration rules

```text
same key + compatible type → carry value
same key + safe conversion → preview conversion
same key + incompatible type → conflict
missing target key → retain unmatched history
new target key → blank/default
```

Changing class or template requires explicit preview and confirmation. Existing characters do not silently adopt newer template versions.

The runtime character sheet must render the stored PDF page(s) as the background and display editable HTML controls positioned over the PDF.

The visual appearance should closely match the reference PDF supplied in docs/references/official/. Character data is stored separately from the PDF.

## Acceptance criteria

- PDF and fields remain aligned.
- Values persist independently per character.
- Autosave is reliable and visible.
- Class/template changes cannot silently lose data.
- Original PDFs remain unchanged.
- Reserved domain fields are isolated for Tasks 012 and 014.
