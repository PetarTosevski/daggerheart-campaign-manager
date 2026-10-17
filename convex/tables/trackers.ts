import { defineTable } from "convex/server";
import { v } from "convex/values";

export const trackerTables = {
  /**
   * State of a frame tracker (Five Banners relationships, Siphoning Track,
   * Doom Track…), one row per campaign and key. Each tracker module in
   * convex/trackers/ reads `data` through its schema (`readTracker`, which
   * throws TRACKER_CORRUPT), writes it with `schemaVersion` inside, and
   * filters it for players.
   */
  frameTrackers: defineTable({
    campaignId: v.id("campaigns"),
    key: v.string(),
    data: v.any(),
    updatedAt: v.number(),
  }).index("by_campaign_key", ["campaignId", "key"]),
};
