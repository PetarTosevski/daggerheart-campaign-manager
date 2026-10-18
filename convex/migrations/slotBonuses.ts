import { ConvexError } from "convex/values";

import { applySlotBonuses as withSlotBonuses, slotBonusKeys } from "../../src/lib/domain/characters/slots";
import { readSheet, storedSheet } from "../lib/characterSheet";
import { migrations } from "../lib/migrations";

/**
 * Gives existing characters the feature slots they never got (SS1, user decision 8): At Ease,
 * Battlemage, Endurance and High Stamina raise `hpMax`/`stressMax` once, and the applied keys go
 * into `sheet.slotBonuses`, so a second run (or `reset: true`) changes nothing. A photo-imported
 * character (oldest action log row is its `import`) copied its maximums from the paper sheet,
 * which already counts the slots: its keys are recorded without raising anything. A sheet that
 * fails to read is left as it is (and logged). Run once per deployment (see `run.ts`):
 *   npx convex run migrations/run:run '{fn: "migrations/slotBonuses:applySlotBonuses"}'
 */
export const applySlotBonuses = migrations.define({
  table: "characters",
  migrateOne: async (ctx, row) => {
    let sheet;
    try {
      sheet = readSheet(row.sheet);
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      console.warn(`Character ${row._id} has an unreadable sheet; slot bonuses not applied.`);
      return;
    }
    const applied = sheet.slotBonuses ?? [];
    const missing = slotBonusKeys(sheet).filter((k) => !applied.includes(k));
    if (missing.length === 0) return;
    const first = await ctx.db
      .query("actionLog")
      .withIndex("by_character_at", (q) => q.eq("characterId", row._id))
      .first();
    const next = first?.kind === "import" ? { ...sheet, slotBonuses: [...applied, ...missing] } : withSlotBonuses(sheet);
    return { sheet: storedSheet(next) };
  },
});

