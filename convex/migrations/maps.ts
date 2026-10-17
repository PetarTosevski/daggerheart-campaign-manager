import { splitMapRow } from "../lib/maps";
import { migrations } from "../lib/migrations";

/**
 * Splits every version 1 `maps` document (one whole `MapState`) into rows:
 * scalars stay on the `maps` row as version 2, markers go to `mapTokens`,
 * hexes to `mapHexes` and painted terrain to `mapTerrain` tiles (H10).
 * A map reads the same before and after. Idempotent: a version 2 row is
 * skipped, so `reset: true` is safe. One map per batch, because a map can
 * become up to ~4,500 rows. Run once per deployment (see `run.ts`):
 *   npx convex run migrations/run:run '{fn: "migrations/maps:splitMaps", dryRun: true}'
 *   npx convex run migrations/run:run '{fn: "migrations/maps:splitMaps"}'
 * Afterwards `maps.data` can narrow to the version 2 validator.
 */
export const splitMaps = migrations.define({
  table: "maps",
  batchSize: 1,
  migrateOne: async (ctx, row) => {
    await splitMapRow(ctx, row);
  },
});
