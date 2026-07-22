# Task 011B — Sheet Template Editor

## Status

Complete — implemented and verified on 2026-07-25. `pnpm lint`, `pnpm typecheck`,
`pnpm test`, and `pnpm build` pass. Against live local Supabase the migration
applied via `supabase migration up`, the full DB integration suite passed with
`RUN_SUPABASE_DB_E2E=1` (including the new `sheet-template-fields.db.test.ts`),
and the full Playwright suite passed with `RUN_SUPABASE_E2E=1` (including the new
`sheet-template-editor.spec.ts`). See "Implementation and verification" below.

## Implementation and verification

Migration `20260725090000_sheet_template_fields.sql` adds `sheet_template_fields`
(coordinates normalized to `[0,1]`, campaign-scoped, RLS, composite same-campaign
FK, one active key per version) and a version draft/published layout lifecycle
(`layout_status`, `published_at`), with owner-authorized `SECURITY DEFINER`
functions `save_sheet_template_fields`, `publish_sheet_template_version`, and
`create_sheet_template_revision`. Published layouts are immutable in place;
editing one clones a new draft revision (PDF object copied, fields copied).

The GM editor lives at
`app/(app)/characters/templates/[templateId]/edit/[versionId]`
(`components/sheet-templates/template-field-editor.tsx`): PDF-page overlay canvas,
add/select/drag/resize/duplicate/deactivate/delete, a field inspector with numeric
placement, multi-page support, save/publish/revise, and an unsaved-changes guard.
Reserved keys (`food_rations`, `food_portions`, `wither_tokens`) are ordinary
fields; `computed` fields store a predefined formula but are not evaluated.

Route note: templates are reached from the Characters page → "Sheet templates";
each version row links into the editor ("Edit fields" for drafts, "Open editor"
for published). Runtime character values and computed evaluation are deferred to
Task 011C.

## Objective

Create a GM-only editor for defining interactive fields over PDF pages.

## Coordinate rule

Store coordinates independently of viewport pixels.

Recommended:

```text
x, y, width, height ∈ [0, 1]
```

relative to page bounds.

## Suggested schema

```text
sheet_template_fields
- id
- template_version_id
- field_key
- label
- field_type
- page_number
- x
- y
- width
- height
- configuration
- display_order
- is_required
- is_active
- created_at
- updated_at
```

## Supported field types

```text
text
multiline_text
number
checkbox
select
radio
image
counter
computed
```

Computed fields must use predefined safe logic.

## Reserved keys

```text
food_rations
food_portions
wither_tokens
```

Recommended common keys:

```text
character_name
class_name
portrait
notes
```

## Scope

Implement:

- Template-editor route.
- Add, select, drag, resize, duplicate, deactivate, and delete.
- Property editor.
- Multi-page support.
- Stable field keys.
- Draft, preview, and publish workflow.
- Keyboard and numeric placement alternatives.
- Validation, RLS, tests, and documentation.

## Versioning

- Published definitions are immutable.
- Editing a published layout creates a revision.
- Existing characters stay on their assigned version.
- New characters may use the active version.

- The template editor should use the reference PDFs as the design source.
- Interactive fields are placed as overlays on top of the original PDF pages.
- The PDF itself is never edited.

## Acceptance criteria

- Fields can be placed accurately on any page.
- Alignment survives zoom and viewport changes.
- Stable and reserved keys are enforced.
- Drafts can be previewed and published.
- Published layouts cannot be mutated in place.
