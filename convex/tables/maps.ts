import { defineTable } from "convex/server";
import { v } from "convex/values";

export const mapTables = {
  /** The campaign's World map (D6): one row, `data` validated by `mapStateSchema` (src/lib/world/map-state.ts). */
  maps: defineTable({
    campaignId: v.id("campaigns"),
    data: v.any(),
    updatedAt: v.number(),
  }).index("by_campaign", ["campaignId"]),
};
