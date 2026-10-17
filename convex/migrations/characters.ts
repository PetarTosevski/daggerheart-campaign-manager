import { ConvexError } from "convex/values";

import { SHEET_VERSION } from "../../src/lib/validation/characters";
import { readSheet, storedSheet } from "../characters";
import { migrations } from "../lib/migrations";

/**
 * Rewrites every character sheet stored before versioning as the current
 * version: `schemaVersion`, and stable ids on inventory items and Experiences
 * (the same ids `readSheet` shows for an unmigrated sheet). Idempotent: a
 * current sheet is skipped, so `reset: true` is safe. A sheet that fails to
 * read is left as it is (and logged) for a manual repair. Run once per
 * deployment (see `run.ts` for dry run and resume):
 *   npx convex run migrations/run:run '{fn: "migrations/characters:versionSheets"}'
 */
export const versionSheets = migrations.define({
  table: "characters",
  migrateOne: async (_ctx, row) => {
    const raw: unknown = row.sheet;
    if (typeof raw === "object" && raw !== null && (raw as { schemaVersion?: unknown }).schemaVersion === SHEET_VERSION) return;
    try {
      return { sheet: storedSheet(readSheet(raw)) };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      console.warn(`Character ${row._id} has an unreadable sheet; left unmigrated.`);
      return;
    }
  },
});
