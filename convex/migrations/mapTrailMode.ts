import { LEGACY_TRAIL_MODES, trailMethod, type LegacyTrailMode } from "../../src/lib/domain/travel/index";
import { migrations } from "../lib/migrations";

type StoredOptions = { trail?: unknown; rules?: { trail?: unknown } & Record<string, unknown> } & Record<string, unknown>;

/**
 * PD1: the party trail's pace is a travel method. Rewrites a stored flat
 * km/day pace (`options.trail` "20", "40", "60" → "foot", "80" → "mount") and
 * drops the folded-in trail table (`options.rules.trail`) from every `maps`
 * row, version 1 or 2 (both keep `options` at the top of `data`). Reads
 * already treat both this way, so a map reads the same before and after.
 * Idempotent: a row with nothing to rewrite is left alone, so `reset: true`
 * is safe. Run once per deployment (see `run.ts`):
 *   npx convex run migrations/run:run '{fn: "migrations/mapTrailMode:rewriteTrailMode", dryRun: true}'
 *   npx convex run migrations/run:run '{fn: "migrations/mapTrailMode:rewriteTrailMode"}'
 * Afterwards `options.trail` in `mapStateSchema` (src/lib/world/map-state.ts)
 * can narrow to the travel methods, and `travelRulesValidator` can drop `trail`.
 */
export const rewriteTrailMode = migrations.define({
  table: "maps",
  migrateOne: (_ctx, row) => {
    const data = row.data as { options?: StoredOptions } | null;
    const options = data?.options;
    if (!options) return;
    const legacy = (LEGACY_TRAIL_MODES as readonly unknown[]).includes(options.trail);
    const oldTable = options.rules !== undefined && "trail" in options.rules;
    if (!legacy && !oldTable) return;
    const next: StoredOptions = { ...options };
    if (legacy) next.trail = trailMethod(options.trail as LegacyTrailMode);
    if (oldTable) {
      const rules = { ...options.rules };
      delete rules.trail;
      next.rules = rules;
    }
    return { data: { ...data, options: next } };
  },
});
