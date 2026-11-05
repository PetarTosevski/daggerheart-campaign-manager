import { migrations } from "../lib/migrations";

/**
 * dcm-bxp.82.14: decided Lorekeeper limit requests expire a year after `decidedAt` (`by_status_decidedAt`,
 * convex/adminRetention.ts `expireLimitRequests`). `decide` always writes `decidedAt`; this guards rows an older
 * writer may have left without it: an approved or declined row with no `decidedAt` gets its `createdAt`, so the
 * retention job still reaches it (the migrate step of widen → migrate → narrow, rule 7). There is no narrow: the
 * field stays optional because pending rows have none.
 *
 * Idempotent (a pending row, or one with the field, is skipped), so `reset: true` is safe. Run once per deployment:
 *   npx convex run migrations/run:run '{fn: "migrations/limitRequestDecidedAt:backfillDecidedAt", dryRun: true}'
 *   npx convex run migrations/run:run '{fn: "migrations/limitRequestDecidedAt:backfillDecidedAt"}'
 */
export const backfillDecidedAt = migrations.define({
  table: "lorekeeperLimitRequests",
  migrateOne: async (_ctx, row) => {
    if (row.status === "pending" || row.decidedAt !== undefined) return;
    return { decidedAt: row.createdAt };
  },
});
