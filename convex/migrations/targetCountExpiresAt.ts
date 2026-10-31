import { migrations } from "../lib/migrations";

/**
 * Plan lanes-2, E2.3 (dcm-bxp.99.19.60; docs/tasks/TASK-LN3-E2.md). A `targetCount` request (Warden's Protection's 1d4,
 * CB p.31) lasts until it is used or the scene ends (convex/lib/featurePrompts.ts), so nothing reads its
 * `payload.expiresAt` any more; B2 widened the field to optional and stopped writing it. This clears it from old rows,
 * the middle step of widen → migrate → narrow (rule 7). The narrow (dropping the field from
 * `targetCountPayloadValidator`) comes after this ran on every deployment.
 *
 * Idempotent (a row without the field is skipped), so `reset: true` is safe. Run once per deployment (see `run.ts`):
 *   npx convex run migrations/run:run '{fn: "migrations/targetCountExpiresAt:clearExpiresAt", dryRun: true}'
 *   npx convex run migrations/run:run '{fn: "migrations/targetCountExpiresAt:clearExpiresAt"}'
 */
export const clearExpiresAt = migrations.define({
  table: "combatRequests",
  migrateOne: async (_ctx, row) => {
    const p = row.payload;
    if (p.kind !== "targetCount" || p.expiresAt === undefined) return;
    const payload = { ...p };
    delete payload.expiresAt;
    return { payload };
  },
});
