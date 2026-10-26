import { defineTable } from "convex/server";
import { v } from "convex/values";

import { crawlHexFields, mapTokenFields } from "../lib/validators/maps";

export const mapTables = {
  /**
   * The campaign's World map (D6): one row per campaign. `data` is read by
   * `storedMap` (convex/lib/maps.ts): version 2 (`schemaVersion: 2`,
   * `mapScalarsSchema`) holds only the map's scalars; version 1 (no
   * `schemaVersion`) is a whole `MapState` from before the split, turned into
   * rows by `migrations/maps:splitMaps` or by the first edit. `data` stays
   * `v.any()` until that migration has run everywhere (widen → migrate →
   * narrow, CD4); then it narrows to the version 2 validator.
   */
  maps: defineTable({
    campaignId: v.id("campaigns"),
    data: v.any(),
    updatedAt: v.number(),
  }).index("by_campaign", ["campaignId"]),

  /** The map's markers, one row each; `tokenId` is the marker's id in the map (codex pins refer to it). */
  mapTokens: defineTable({
    campaignId: v.id("campaigns"),
    tokenId: v.number(),
    ...mapTokenFields,
  }).index("by_campaign_token", ["campaignId", "tokenId"]),

  /** Journey to Horizon hex crawl: one row per hex the GM or the party touched. */
  mapHexes: defineTable({
    campaignId: v.id("campaigns"),
    ...crawlHexFields,
  })
    .index("by_campaign_q_r", ["campaignId", "q", "r"])
    // The players' view reads only explored hexes (plus the party's neighbourhood by point lookups).
    .index("by_campaign_explored", ["campaignId", "explored"]),

  /**
   * Painted terrain in tiles of TERRAIN_TILE_ROWS grid rows (`cells`: that
   * many rows of TERRAIN_CODES). A missing tile is the frame's suggested terrain.
   */
  mapTerrain: defineTable({
    campaignId: v.id("campaigns"),
    tile: v.number(),
    cells: v.string(),
  }).index("by_campaign_tile", ["campaignId", "tile"]),
};
