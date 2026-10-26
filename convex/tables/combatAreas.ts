import { defineTable } from "convex/server";

import { combatAreaFields } from "../lib/validators/combatMaps";

export const combatAreaTables = {
  /**
   * Live map areas drawn by features (plan sheet-drawer SD0, Q14): circles whose members are read from token positions
   * at each roll, and Dark Cloud's sight blocker. Campaign-scoped (purged with its campaign); an ended area is swept a
   * day after `endedAt` (rule 8, `expireCombatAreas`).
   *
   * - `by_map`: the areas drawn on a map (the map layer, the vision engine, membership at a roll).
   * - `by_campaign`: a campaign's areas (scene and session end, the purge).
   * - `by_status_ended`: the retention cron's range (`status` ended, `endedAt` before the cutoff).
   */
  combatAreas: defineTable(combatAreaFields)
    .index("by_map", ["mapId"])
    .index("by_campaign", ["campaignId"])
    .index("by_status_ended", ["status", "endedAt"]),
};
