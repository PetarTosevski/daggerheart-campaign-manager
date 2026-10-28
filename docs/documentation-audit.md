# Documentation Audit

> **Historical (pre-Convex).** This review is not a description of the current
> app. It names files that are not in this repository, including
> `docs/architecture.md` and `docs/product-spec.md`. Do not create those files
> from this audit. The shipped app is Next.js and Convex on Vercel, not
> Supabase. Tasks 001–005 are not the current task list.

## Scope

Reviewed:

- `AGENTS.md`
- Architecture and data-model documents
- Product and game-interpretation documents
- House rules and Witherwild notes
- Rules index and SRD
- Open questions
- Implementation priorities
- Tasks 001–005
- Task README
- `.gitignore`

The application source, `package.json`, migrations, and test results were not
included. Implementation claims could not be verified.

## Material issues corrected

1. `AGENTS.md` pointed to Markdown files under `reference/` even though they are
   under `docs/`.
2. The rules-reading workflow did not require inspection of existing code and
   migrations before implementation.
3. The implementation-priority checklist marked Phase 1 complete while all task
   files remained Draft.
4. The task README named `003-campaign-shell.md`, but the supplied file is
   `003-phase-one-schema.md`.
5. The official campaign frame spelling was left unresolved despite the SRD
   identifying it as **The Witherwild**.
6. `campaign-house-rules.md` said “Homebrew: None” while defining several
   homebrew rules.
7. Food rules were simultaneously recorded as decisions and listed as fully
   unresolved.
8. `game-interpretation.md` was too sparse to govern transactional behavior.
9. `rules-index.md` contained empty references and did not index the supplied
   SRD.
10. The Witherwild-specific token and weekly day/night mechanics were absent
    from the planned application interpretation.
11. `.gitignore` ignored only the private rulebook and omitted common secrets,
    dependencies, build artifacts, and local Supabase state.
12. Architecture and data-model documents did not clearly distinguish intended
    design from the schema and code that actually exist.

## Files added or materially revised

- `AGENTS.md`
- `.gitignore`
- `docs/architecture.md`
- `docs/campaign-house-rules.md`
- `docs/data-model.md`
- `docs/game-interpretation.md`
- `docs/glossary.md`
- `docs/implementation-priorities.md`
- `docs/open-questions.md`
- `docs/product-spec.md`
- `docs/rules-index.md`
- `docs/witherwild-notes.md`
- `docs/tasks/README.md`
- `docs/tasks/001-project-bootstrap.md`
- `docs/tasks/002-authentication.md`
- `docs/tasks/003-phase-one-schema.md`
- `docs/tasks/004-fear-tracker.md`
- `docs/tasks/005-countdown-tracker.md`

## Required next evidence

For a full implementation-aware update, provide or let the coding agent inspect:

- Source tree
- `package.json`
- Lockfile
- Supabase migrations
- Supabase configuration
- Generated database types
- Authentication implementation
- Test configuration and output
- Deployment configuration

Until then, Tasks 001–005 should remain `Review`, not `Complete`.
