import { defineTable } from "convex/server";
import { v } from "convex/values";

import { characterExtraValidator } from "../lib/validators/characterExtras";
import { awayValidator, storedCharacterStatusValidator } from "../lib/validators/characters";

export const characterTables = {
  /**
   * Player characters. `sheet` is a versioned blob `{ schemaVersion, ...sheet }`
   * (`characterSheetSchema` in src/lib/validation/characters.ts), read only
   * through `readSheet` in convex/lib/characterSheet.ts, which upgrades older versions
   * (version 1 has no `schemaVersion`; `migrations/characters:versionSheets`
   * rewrites them). It stays `v.any()` until every deployment is migrated,
   * then narrows to `sheetValidator`. The owner (a player, or the GM for an
   * unassigned character) and the GM can edit; everyone in the campaign can
   * read every sheet (user decision 2026-10-17).
   */
  characters: defineTable({
    campaignId: v.id("campaigns"),
    ownerId: v.id("users"),
    createdBy: v.id("users"),
    /** `away` (D5, Castle High less-lethal, HF 127) comes with `away`; only death moves set it. */
    status: storedCharacterStatusValidator,
    away: v.optional(awayValidator),
    sheet: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_owner", ["ownerId"]),

  /**
   * A character's extras (beastform, companion, Motherboard wallet, Beast
   * Feast ingredients, Castle High skyshard): at most one row per character
   * and extra, `data` typed by `extra`. Read and written only through
   * convex/characterExtras.ts, whose access is the character's
   * (`permissionFor`). Before H14 they lived in `frameTrackers` under
   * `character:<id>:<extra>` keys; `migrations/characterExtras:moveFromTrackers`
   * moves them here. `characters.remove` deletes a character's rows through
   * `by_character_extra`; `by_campaign` serves the campaign purge (CD18).
   */
  characterExtras: defineTable(characterExtraValidator)
    .index("by_character_extra", ["characterId", "extra"])
    .index("by_campaign", ["campaignId"]),
};
