import { defineTable } from "convex/server";

import {
  combatCellFields,
  combatExploredFields,
  combatMapFields,
  combatObjectFields,
  combatTokenFields,
} from "../lib/validators/combatMaps";

/**
 * The combat map (D9, plan `.omc/plans/d9-combat-map.yaml`). C0 creates every table; later tracers only add
 * functions. Caps (convex/lib/combatMaps.ts) are checked with an index `.take`. A campaign's maps and everything
 * on them go with its purge (convex/cleanup.ts); a map's child rows are reached through `mapId`.
 */
export const combatMapTables = {
  /**
   * One row per battle map, several per campaign (R2, at most MAX_COMBAT_MAPS). `by_campaign_updated` lists them
   * newest first; `by_campaign_live` finds the one the players see.
   */
  combatMaps: defineTable(combatMapFields)
    .index("by_campaign_updated", ["campaignId", "updatedAt"])
    .index("by_campaign_live", ["campaignId", "live"]),

  /** A map's objects (trees, tents, campfires, wall torches…), one row each (CD8), at most MAX_COMBAT_OBJECTS per map. */
  combatMapObjects: defineTable(combatObjectFields).index("by_map", ["mapId"]),

  /** Hand-painted cells per layer (terrain, sight blockers, fog marks), in tiles of CELL_TILE_ROWS rows. */
  combatMapCells: defineTable(combatCellFields).index("by_map_layer_tile", ["mapId", "layer", "tile"]),

  /** Tokens on a map (R4), at most MAX_COMBAT_TOKENS per map. A move or turn writes only its row. */
  combatTokens: defineTable(combatTokenFields).index("by_map", ["mapId"]),

  /** Explored squares per (map, character) (R11). Changes on every move, so it stays out of `combatMaps` (CD10). */
  combatExplored: defineTable(combatExploredFields).index("by_map_character", ["mapId", "characterId"]),
};
