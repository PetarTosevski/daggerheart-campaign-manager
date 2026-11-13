import { defineTable } from "convex/server";
import { v } from "convex/values";

import {
  combatCellFields,
  combatExploredFields,
  combatMapFields,
  combatObjectFields,
  combatTokenFields,
} from "../lib/validators/combatMaps";
import { combatWallFields } from "../lib/combatMapWalls";

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
  combatMaps: defineTable({
    ...combatMapFields,
    /**
     * Underwater (optional rule, CB p.168; plan rule-switches OE): the GM marked this map's scene Underwater
     * (`combatScenes.setUnderwater`). Widened; absent = not underwater. Written only by that mutation.
     */
    underwater: v.optional(v.boolean()),
    /**
     * The scene's breath countdown (a dashboard `countdowns` row, unarmed, kind "breath"), set while `underwater`. Its
     * value lives in the countdown row (it changes on every PC action roll, rule 6), never here.
     */
    breathCountdownId: v.optional(v.id("countdowns")),
  })
    .index("by_campaign_updated", ["campaignId", "updatedAt"])
    .index("by_campaign_live", ["campaignId", "live"]),

  /** A map's objects (trees, tents, campfires, wall torches…), one row each (CD8), at most MAX_COMBAT_OBJECTS per map. */
  combatMapObjects: defineTable(combatObjectFields).index("by_map", ["mapId"]),

  /**
   * Drawn walls (plan map-editor ME4): one row per wall run (a freeform polyline of one kind: wall, door, window,
   * secret door, low wall, one-way), at most MAX_WALL_RUNS per map (convex/lib/combatMapWalls.ts). Movement, vision
   * and attack sight read them through `by_map`; they go with their map (`deleteMapChildren`).
   */
  combatMapWalls: defineTable(combatWallFields).index("by_map", ["mapId"]),

  /** Hand-painted cells per layer (terrain, sight blockers, fog marks), in tiles of CELL_TILE_ROWS rows. */
  combatMapCells: defineTable(combatCellFields).index("by_map_layer_tile", ["mapId", "layer", "tile"]),

  /** Tokens on a map (R4), at most MAX_COMBAT_TOKENS per map. A move or turn writes only its row. */
  combatTokens: defineTable({
    ...combatTokenFields,
    /**
     * Underwater (plan rule-switches OE, CB p.168: "unless it makes sense for a character to easily fight underwater,
     * like a Siren or Shark"): the GM marked this creature as fighting easily underwater; its attack rolls get no
     * Underwater disadvantage. Widened; absent = false. Written only by `combatScenes.setFightsUnderwater`.
     */
    fightsUnderwater: v.optional(v.boolean()),
    /**
     * Underwater (optional rule, CB p.168: "For any creatures that can't breathe underwater, you can use a countdown"; plan
     * rule-switches OE2, user 2026-11-06): the GM marked this PC as breathing underwater; its action rolls don't tick the
     * breath countdown and never mark the out-of-breath Stress. Widened; absent = false. Written only by
     * `combatScenes.setBreathesUnderwater`.
     */
    breathesUnderwater: v.optional(v.boolean()),
  }).index("by_map", ["mapId"]),

  /** Explored squares per (map, character) (R11). Changes on every move, so it stays out of `combatMaps` (CD10). */
  combatExplored: defineTable(combatExploredFields).index("by_map_character", ["mapId", "characterId"]),
};
