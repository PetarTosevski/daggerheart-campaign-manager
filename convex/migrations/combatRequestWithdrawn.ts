import { migrations } from "../lib/migrations";

/**
 * dcm-bxp.99.32.17: `combatRequests.status` gained `withdrawn` (widen), and `combatWithdraw.withdraw` writes it. Before
 * that, HD3 stored a player's withdrawal as `declined` with `resolvedBy` the withdrawing user (a GM decline carries the
 * GM's id). This moves those rows: a `sanction` row, `declined`, whose `resolvedBy` is its `createdBy`, becomes
 * `withdrawn`. Caveat (harmless): a GM who declined a sanction they created themselves looks the same. Charges waiting
 * for their Difficulty are left alone: a new Charge ask by the same player also closes the old one with `createdBy`.
 * No narrow step: the widening is additive.
 *
 * Idempotent (only `declined` rows match), so `reset: true` is safe. Run once per deployment:
 *   npx convex run migrations/run:run '{fn: "migrations/combatRequestWithdrawn:markWithdrawn", dryRun: true}'
 *   npx convex run migrations/run:run '{fn: "migrations/combatRequestWithdrawn:markWithdrawn"}'
 */
export const markWithdrawn = migrations.define({
  table: "combatRequests",
  migrateOne: async (_ctx, row) => {
    if (row.kind !== "sanction" || row.status !== "declined" || row.resolvedBy === undefined || row.resolvedBy !== row.createdBy) return;
    return { status: "withdrawn" as const };
  },
});
