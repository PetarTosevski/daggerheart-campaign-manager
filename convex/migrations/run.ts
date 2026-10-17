import { migrations } from "../lib/migrations";

/**
 * Runs any migration by its full function name (`migrations/<file>:<export>`),
 * batched and resumable (CD5). Add `--prod` for production.
 *
 * Dry run (runs one batch, then throws so nothing is committed, and prints
 * what it would have done):
 *   npx convex run migrations/run:run '{fn: "migrations/uploads:moveMapUploads", dryRun: true}'
 *
 * Run (continues batch by batch in the background):
 *   npx convex run migrations/run:run '{fn: "migrations/uploads:moveMapUploads"}'
 *
 * Resume: run the same command again. A failed or canceled migration
 * continues from its last cursor; a finished one is skipped. `reset: true`
 * starts over from the beginning (safe only because migrations here are
 * idempotent).
 *
 * Status and cancel (component functions):
 *   npx convex run --component migrations lib:getStatus --watch
 *   npx convex run --component migrations lib:cancel '{name: "migrations/uploads:moveMapUploads"}'
 *
 * A series defined with `migrations.runner([...])` (such as
 * `migrations/uploads:moveUploadsToFiles`) takes the same `dryRun` and
 * `reset` arguments and runs its migrations in order.
 */
export const run = migrations.runner();
