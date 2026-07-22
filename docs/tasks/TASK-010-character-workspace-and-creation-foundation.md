# Task 010 — Character Workspace and Creation Foundation

## Status

Complete — implemented on 2026-07-22 and fully verified. `pnpm lint`,
`pnpm typecheck`, `pnpm test` (offline), and `pnpm build` pass. The migration
applies cleanly via `supabase db reset`, the DB integration suite passes with
`RUN_SUPABASE_DB_E2E=1` (`tests/integration/characters.db.test.ts` +
`phase1-schema.db.test.ts`), and the Playwright workflow
(`tests/e2e/characters.spec.ts`) passes with `RUN_SUPABASE_E2E=1`.

Bug fixed during 011A verification (first end-to-end run of this task's e2e,
since local Supabase was unavailable when Task 010 was authored):
`src/app/(app)/characters/actions.ts` exported a non-function value
(`initialActionState`) from a `"use server"` module, which is illegal and threw
at request time (`A "use server" file can only export async functions`). The
production build did not catch it; the e2e did. The unused export was removed and
the character create/edit flow now works in-browser. A test race in
`characters.spec.ts` (reloading before the async save completed) was also fixed.
See "Implementation and verification" below.

Environment note: local Supabase ports were remapped from the default 543xx
block into 545xx in `supabase/config.toml` (and `.env.local`) because this host
reserves the entire 543xx TCP range (Windows excluded-port range 54298–54397).

## Implementation and verification

Migration: `supabase/migrations/20260722090000_character_workspace.sql`.

- Adds `character_classes` and `sheet_templates` (campaign-scoped, RLS-enabled,
  unique `(campaign_id, id)`), links `characters.class_id` and
  `characters.sheet_template_id` via same-campaign composite foreign keys, and
  guarantees at most one blank template per campaign.
- Adds owner-authorized `create_character` and `update_character`
  `SECURITY DEFINER` functions for server-side validation (trimmed required
  name, active same-campaign class, active same-campaign template, valid status)
  and archival stamping.
- Cross-campaign references are structurally impossible; a character's chosen
  template is fixed at creation and never auto-changes.

Reconciliation note: the Phase 1 `characters` table predates this task and has a
different shape than the task's suggested schema. Rather than rewrite an applied
migration (prohibited by `AGENTS.md`), this task extends the table with
`class_id` and `sheet_template_id` and keeps the legacy columns. The suggested
`portrait_asset_id` (character) and `artwork_asset_id` /
`class_recording_asset_id` (class) columns are deferred to the asset/media task;
no placeholder asset tables or columns were created.

Deferred by design: PDF storage/rendering, template editor, interactive sheet,
sheet field values, autosave, inventory, food, wither tokens, artwork, dice, and
class/template migration. The workspace shows these sections as labeled
placeholders only.

## Objective

Create the Characters module and guided character-builder foundation.

## Routes

```text
/characters
/characters/new
/characters/[characterId]
```

## Suggested schema

```text
characters
- id
- campaign_id
- name
- class_id
- sheet_template_id
- portrait_asset_id nullable
- status
- notes
- created_at
- updated_at
```

```text
character_classes
- id
- campaign_id
- name
- description
- default_template_id nullable
- artwork_asset_id nullable
- class_recording_asset_id nullable
- is_active
- created_at
- updated_at
```

```text
sheet_templates
- id
- campaign_id
- name
- class_id nullable
- is_blank_template
- status
- created_at
- updated_at
```

## Creation flow

```text
Identity
  → Class selection
  → Template suggestion
  → Review
  → Create
  → Open character
```

Selecting a class suggests its default template. Fall back to a blank template. The GM may override the suggestion.

## Character workspace sections

```text
Overview
Character Sheet
Inventory
Food
Wither Tokens
Notes
Artwork
Rolls
```

In this task:

- Overview and Notes are functional.
- Character Sheet shows selected-template metadata.
- Other sections are explicit placeholders.

## Security and validation

- GM-only.
- Campaign-scoped.
- Required trimmed name.
- Same-campaign class and template.
- Inactive classes unavailable for creation.
- Unknown character routes return safe not found.

## Acceptance criteria

- Characters appears in persistent navigation.
- The GM can create and open a character.
- Class selection recommends a template.
- Template override works.
- Overview and Notes persist.
- RLS and campaign isolation are tested.
