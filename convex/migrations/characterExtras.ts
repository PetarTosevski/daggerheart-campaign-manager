import { beastFeastStateSchema } from "../../src/lib/frames/extras/beast-feast";
import { beastformStateSchema } from "../../src/lib/frames/extras/beastform";
import { castleHighStateSchema } from "../../src/lib/frames/extras/castle-high";
import { EXTRAS, type Extra } from "../../src/lib/frames/extras/common";
import { companionStateSchema } from "../../src/lib/frames/extras/companion";
import { motherboardStateSchema } from "../../src/lib/frames/extras/motherboard";
import type { CharacterExtraRow } from "../lib/validators/characterExtras";
import { migrations } from "../lib/migrations";

const SCHEMAS = {
  beastform: beastformStateSchema,
  companion: companionStateSchema,
  motherboard: motherboardStateSchema,
  beastFeast: beastFeastStateSchema,
  castleHigh: castleHighStateSchema,
} as const;

const KEY = /^character:([^:]+):([^:]+)$/;

/**
 * Moves every character extra stored in `frameTrackers` under
 * `character:<characterId>:<extra>` into `characterExtras`, then deletes the
 * old row (H14). The campaign-level `beastFeast.cookbook` and every other
 * tracker stay. A row whose character is gone (or lives in another campaign)
 * is deleted; a row that already has a `characterExtras` row is deleted (the
 * table's row is newer); a row that fails its schema is left as it is (and
 * logged) for a manual repair. Idempotent, so `reset: true` is safe.
 *   npx convex run migrations/run:run '{fn: "migrations/characterExtras:moveFromTrackers", dryRun: true}'
 */
export const moveFromTrackers = migrations.define({
  table: "frameTrackers",
  migrateOne: async (ctx, row) => {
    const match = KEY.exec(row.key);
    if (match === null) return;
    const [, rawId, rawExtra] = match;
    if (!(EXTRAS as readonly string[]).includes(rawExtra)) return;
    const extra = rawExtra as Extra;
    const characterId = ctx.db.normalizeId("characters", rawId);
    const character = characterId === null ? null : await ctx.db.get("characters", characterId);
    if (character === null || character.campaignId !== row.campaignId) {
      await ctx.db.delete("frameTrackers", row._id);
      return;
    }
    const existing = await ctx.db
      .query("characterExtras")
      .withIndex("by_character_extra", (q) => q.eq("characterId", character._id).eq("extra", extra))
      .unique();
    if (existing === null) {
      const parsed = SCHEMAS[extra].safeParse(row.data);
      if (!parsed.success) {
        console.warn(`Tracker ${row._id} (${row.key}) does not match its schema; left unmigrated.`);
        return;
      }
      // The schema matches the row's `data` validator for this `extra`.
      const moved = {
        campaignId: row.campaignId,
        characterId: character._id,
        extra,
        schemaVersion: 1,
        data: parsed.data,
        updatedAt: row.updatedAt,
      } as CharacterExtraRow;
      await ctx.db.insert("characterExtras", moved);
    }
    await ctx.db.delete("frameTrackers", row._id);
  },
});
