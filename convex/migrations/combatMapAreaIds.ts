import { withAreaIds } from "../../src/lib/combat-map/fallback-layout";
import { migrations } from "../lib/migrations";

/**
 * Map editor ME3 (dcm-5rhs.3): gives every area of every `combatMaps` row a stable id, unique within its map, so one
 * area can be edited by intent. Ids follow `withAreaIds` (src/lib/combat-map/fallback-layout.ts): "a" + a counter,
 * kept where an area already has a unique one, so a map the generator saved after the widen keeps its ids. Patches
 * only `areas` and only when an id changed; `updatedAt` stays, so a generation running meanwhile still saves.
 * Batched by the migrations component (one batch of maps per transaction) and idempotent, so `reset: true` is safe.
 * Run once per deployment (see `run.ts`), dry run first:
 *   npx convex run migrations/run:run '{fn: "migrations/combatMapAreaIds:fillAreaIds", dryRun: true}'
 *   npx convex run migrations/run:run '{fn: "migrations/combatMapAreaIds:fillAreaIds"}'
 * Afterwards `id` in `combatAreaValidator` (convex/lib/validators/combatMaps.ts) narrows to required (docs/tasks/TASK-ME3.md).
 */
export const fillAreaIds = migrations.define({
  table: "combatMaps",
  batchSize: 50,
  migrateOne: (_ctx, map) => {
    const areas = withAreaIds(map.areas);
    if (areas.every((area, i) => area.id === map.areas[i].id)) return;
    return { areas };
  },
});
