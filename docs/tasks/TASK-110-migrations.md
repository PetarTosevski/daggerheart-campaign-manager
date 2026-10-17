# TASK-110: Migrations framework (hardening H06)

Data changes use `@convex-dev/migrations` (`convex/lib/migrations.ts` holds the shared instance; `convex/migrations/run.ts` is the runner). Blobs are read with `readVersioned` / `parseOrCorrupt` (`convex/lib/blobs.ts`): a document with no `schemaVersion` is read as version 1 and upgraded step by step; bad data throws the domain's `*_CORRUPT` code. Schema changes follow widen → migrate → narrow (docs/best-practices.md).

## Running a migration

- Dry run (one batch, rolled back, prints the changes):
  `npx convex run migrations/run:run '{fn: "migrations/uploads:moveMapUploads", dryRun: true}'`
- Run: the same without `dryRun`. A series: `npx convex run migrations/uploads:moveUploadsToFiles '{dryRun: true}'`, then without it.
- Resume: rerun the same command. A failed or cancelled migration continues from its stored cursor; a finished one is skipped. `reset: true` starts over (only for idempotent migrations).
- Status: `npx convex run --component migrations lib:getStatus --watch`
- Cancel: `npx convex run --component migrations lib:cancel '{name: "migrations/uploads:moveMapUploads"}'`
- Add `--prod` for production.

## Uploads

`migrations/uploads:moveUploadsToFiles` copies the deprecated `mapUploads`, `codexImages` and `portraitUploads` rows into `files` (batched, idempotent). Cloud dev ran the earlier version with 0 rows; dropping the deprecated tables is dcm-bxp.23.
