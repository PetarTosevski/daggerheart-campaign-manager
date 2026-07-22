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
