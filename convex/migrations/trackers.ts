import { ANDALURIA_TRACKER_KEY } from "../../src/lib/frames/trackers/andaluria";
import { FIVE_BANNERS_KEY } from "../../src/lib/frames/trackers/five-banners";
import { HORIZON_TRACKER_KEY } from "../../src/lib/frames/trackers/horizon";
import { WEREDRAGON_TRACKER_KEY } from "../../src/lib/frames/trackers/weredragon";
import { migrations } from "../lib/migrations";
import { TRACKER_SCHEMA_VERSION } from "../lib/trackers";

/** The keys of the frame trackers in `convex/trackers/` (character extras share the table but are not versioned yet). */
const TRACKER_KEYS = new Set([ANDALURIA_TRACKER_KEY, WEREDRAGON_TRACKER_KEY, HORIZON_TRACKER_KEY, FIVE_BANNERS_KEY, "colossus", "ageOfUmbra"]);

/**
 * Stamps `schemaVersion: 1` on frame tracker blobs written before versioning
 * (CD3). Readers already treat a missing version as 1, so this only makes the
 * stored data explicit. Idempotent: a versioned or non-object blob is skipped.
 *   npx convex run migrations/run:run '{fn: "migrations/trackers:stampSchemaVersion", dryRun: true}'
 */
export const stampSchemaVersion = migrations.define({
  table: "frameTrackers",
  migrateOne: (_ctx, row) => {
    const data: unknown = row.data;
    if (!TRACKER_KEYS.has(row.key) || typeof data !== "object" || data === null || Array.isArray(data) || "schemaVersion" in data) return;
    return { data: { ...data, schemaVersion: TRACKER_SCHEMA_VERSION } };
  },
});
