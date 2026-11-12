import { restTicksOf } from "../../src/lib/domain/countdowns/rest-ticks";
import { migrations } from "../lib/migrations";

/**
 * Plan rest-ticks RT1 (bead dcm-674k), rule 7 "migrate": a long-term countdown's long-rest behaviour moves from the
 * legacy `armed` + `restMode` to `onLongRest`. Each long-term row with legacy state gets the mapped setting (`armed:
 * true` -> fixed 1, `restMode` absent = Automatic; unarmed -> none), unless it already has `onLongRest`, and loses
 * `armed` and `restMode`. `restTicksOf` reads both shapes the same, so a row ticks identically before and after.
 * Other modes are left alone (their `armed` means "ticks on rolls"). Idempotent: a migrated row has nothing left to
 * rewrite, so `reset: true` is safe. Run once per deployment (see `run.ts`):
 *   npx convex run migrations/run:run '{fn: "migrations/countdownRestTicks:moveLongTermRest", dryRun: true}'
 *   npx convex run migrations/run:run '{fn: "migrations/countdownRestTicks:moveLongTermRest"}'
 * Afterwards (narrow, a follow-up bead): drop `restMode` from the table, and the legacy branch of `restTicksOf`.
 */
export const moveLongTermRest = migrations.define({
  table: "countdowns",
  migrateOne: (_ctx, row) => {
    if (row.mode !== "longTerm" || (row.armed === undefined && row.restMode === undefined)) return;
    const long = restTicksOf(row).long;
    return { ...(long !== null ? { onLongRest: long } : {}), armed: undefined, restMode: undefined };
  },
});
