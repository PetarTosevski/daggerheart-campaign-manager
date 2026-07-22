# Task 011A — PDF Template Storage and Rendering

## Status

Complete — implemented on 2026-07-22 and fully verified. `pnpm lint`,
`pnpm typecheck`, `pnpm test`, and `pnpm build` pass. The migration applies
cleanly via `supabase db reset`, and the full DB integration suite passes with
`RUN_SUPABASE_DB_E2E=1`, including `tests/integration/sheet-template-versions.db.test.ts`
(version numbering + active pointer, path enforcement, archived-template
rejection, cross-owner rejection, deferred-FK safe deletion, non-active deletion,
archival pointer movement, RLS isolation, composite cross-campaign FK, and
storage-object folder authorization). Server-side page-count extraction is
verified against the real reference PDF in `tests/unit/pdf-validate.test.ts`. The
Playwright workflow (`tests/e2e/sheet-templates.spec.ts`) passes with
`RUN_SUPABASE_E2E=1`, exercising real in-browser upload, canvas rendering, and
archival.

Bug fixed during e2e verification: Next.js Server Actions default to a 1 MB body
limit, which rejected real (multi-MB) PDF uploads before reaching the handler.
`next.config.ts` now sets `serverActions.bodySizeLimit` to `26mb` (just above the
enforced 25 MB PDF cap). The e2e caught this; the build did not.

Environment note: local Supabase ports were remapped from 543xx to 545xx in
`supabase/config.toml` / `.env.local` (Windows reserves the 543xx range on this
host); DB test runs use `SUPABASE_DB_URL=...54522...`.

## Implementation and verification

Approved new dependencies: `pdfjs-dist` (client rendering) and `unpdf`
(server-side page count / corruption check). See resolved `OQ-ARCH-005`.

Migration `20260723090000_sheet_template_versions.sql`:

- `sheet_template_versions` (immutable, campaign-scoped metadata) + a deferred
  same-campaign `sheet_templates.active_version_id` pointer that blocks deleting a
  referenced version while allowing cascade deletes.
- Private `character-sheet-templates` Storage bucket (25 MiB, `application/pdf`
  only) with owner-by-campaign-folder `storage.objects` policies and no UPDATE
  policy (immutable originals).
- Owner-authorized `create_sheet_template_version` and
  `archive_sheet_template_version` functions.

Flow: the Server Action validates the PDF (signature, MIME, size, corruption +
page count via unpdf), uploads the immutable object to
`{campaignId}/{templateId}/{versionId}/source.pdf`, then records the version and
sets it active; on RPC failure the orphaned object is removed. The read-only
`PdfTemplateViewer` renders pages from a short-lived signed URL with page
navigation and zoom.

Deferred by design (Tasks 011B–011C and later): field definitions, coordinate /
overlay editing, interactive sheet runtime, sheet field values. The character
workspace Character Sheet tab remains a placeholder; template PDF management lives
under `/characters/templates`.

## Objective

Implement private, immutable storage and read-only rendering for blank and class-specific character-sheet PDFs.

## Architectural rule

```text
Immutable PDF
  → Rendered page background
  → Field definitions
  → Character values
```

The original PDF is never modified.

## Scope

Implement:

- Private Supabase Storage bucket.
- GM-only upload.
- MIME, signature, size, and corruption validation.
- Immutable template versions.
- Page-count extraction.
- Multi-page rendering.
- Zoom and page navigation.
- Blank/class template association.
- Archival and safe deletion.
- RLS, tests, and documentation.

## Suggested schema

```text
sheet_template_versions
- id
- template_id
- version_number
- source_bucket
- source_object_path
- original_filename
- mime_type
- size_bytes
- checksum
- page_count
- status
- created_at
- created_by
```

Add `active_version_id` to `sheet_templates`.

## Storage

Suggested bucket:

```text
character-sheet-templates
```

Suggested path:

```text
{campaignId}/{templateId}/{versionId}/source.pdf
```

No permanent public URLs. New PDFs create new versions instead of replacing old files.

## Viewer

```text
PdfTemplateViewer
├── PageNavigation
├── ZoomControls
└── PdfPageCanvas
```

## Reference PDFs

The repository contains official reference character sheet PDFs under:

reference/official/

(Path corrected 2026-07-22: the earlier draft said `docs/references/official/`,
which does not exist. The canonical file is
`reference/official/Daggerheart - Gillus - Character Sheets US.pdf`. Only
`.reference-private/` is off-limits to builds/tests; `reference/` may be used as
a gated test input, guarded by a file-existence check so default runs stay
green.)

These PDFs are the canonical reference for implementing the PDF storage and rendering system.

During this task:

Preserve the original PDFs unchanged.
Support multi-page PDFs.
Allow templates to reference one or more pages from a source PDF.
Do not recreate or redesign the layouts.
The rendered character sheet should visually match the reference PDF exactly.

## Acceptance criteria

- Blank and class PDFs upload privately.
- Originals remain immutable.
- Multi-page rendering and zoom work.
- Versions are campaign-scoped and stable.
- Invalid files fail safely.
- Referenced versions cannot be silently deleted.
