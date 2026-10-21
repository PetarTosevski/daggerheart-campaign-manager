# TASK-D12-H16: Remove the deprecated upload tables (dcm-bxp.23)

Plan `.omc/plans/d12-hardening.yaml`, tracer H16 (wave 2). Bead dcm-bxp.23. User answer Q9: drop the old upload tables
and the one-time copy script now, re-checking dev first. This is the narrow step of widen -> migrate -> narrow
(best-practices rule 7): `files` was the widen, `migrations/uploads:moveUploadsToFiles` the migrate.

## Dev check at tracer start (2026-10-21, read-only)

Run from the main checkout (`CONVEX_DEPLOYMENT=dev:descriptive-dinosaur-608`):

```
$ npx convex data mapUploads --limit 1
There are no documents in this table.
$ npx convex data codexImages --limit 1
There are no documents in this table.
$ npx convex data portraitUploads --limit 1
There are no documents in this table.
```

All three empty. Prod is not deployed. The e2e backend is rebuilt from the schema by `pnpm e2e:setup`.

## Removed

- `convex/tables/files.ts`: the `portraitUploads`, `mapUploads` and `codexImages` table definitions. `convex/schema.ts`
  spreads `fileTables`, so it needs no edit.
- `convex/migrations/uploads.ts`: the one-time copy (`moveMapUploads`, `moveCodexImages`, `movePortraitUploads`,
  `moveUploadsToFiles`).
- `convex/cleanup.ts`: the campaign-purge branches that deleted legacy codex images, legacy portraits and map uploads;
  the orphan sweep now asks only `files` (`isClaimedByFile`).
- `convex/migrations/run.ts`: the usage examples now name `migrations/codex:splitText` and
  `migrations/sessions:backfillSessions`.
- `tests/convex/schema-guard.test.ts`: the three retention entries.
- `docs/data-model.md`: the `files` row and the daily sweep line no longer mention the old tables.

## Tests

- `tests/convex/migrations.test.ts`: the copy tests are gone. The two runner tests that only this file had (a dry run
  commits nothing; a run resumes from its cursor) now drive `migrations/codex:countEntries` on campaigns without a
  counter. Every other migration test lives in its own area file and is unchanged.
- `tests/convex/cleanup.test.ts`: the seeded campaign's codex image and portrait are now `files` rows (kinds
  `codexImage`, `portrait`), so the purge test still proves every kind of campaign file and its blob is deleted, and the
  orphan sweep test still proves claimed blobs survive.

## Orchestrator after merge

`npx convex codegen` (drops `migrations/uploads` from `convex/_generated/api.d.ts`), then `npx convex dev --once` on
the main checkout (dropping the empty tables is accepted), then close dcm-bxp.23.
