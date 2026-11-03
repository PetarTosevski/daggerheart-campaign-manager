import { validate } from "convex-helpers/validators";
import { ConvexError } from "convex/values";

import { SHEET_VERSION } from "../../src/lib/validation/character-constants";
import { readSheet, storedSheet } from "../characters";
import { migrations } from "../lib/migrations";
import { storedSheetValidator } from "../lib/validators/characters";

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

/**
 * Why a stored sheet would fail `storedSheetValidator`, or null when it conforms (dcm-bxp.28): the check the narrow
 * step (`characters.sheet: v.any()` -> `storedSheetValidator`) needs every row to pass, or the schema push fails.
 */
export function sheetNarrowingProblem(raw: unknown): string | null {
  try {
    validate(storedSheetValidator, raw, { throw: true });
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/**
 * The narrowing audit (dcm-bxp.28, CD4): writes nothing, and logs each character whose stored sheet fails
 * `storedSheetValidator` (an unmigrated or unreadable sheet). Run it on every deployment after `versionSheets`, and
 * narrow `characters.sheet` only once it logs nothing anywhere. Read-only, so `reset: true` is always safe:
 *   npx convex run migrations/run:run '{fn: "migrations/characters:auditSheets", reset: true}'
 */
export const auditSheets = migrations.define({
  table: "characters",
  migrateOne: (_ctx, row) => {
    const problem = sheetNarrowingProblem(row.sheet);
    if (problem !== null) console.warn(`Character ${row._id} can't narrow yet: ${problem}`);
  },
});
