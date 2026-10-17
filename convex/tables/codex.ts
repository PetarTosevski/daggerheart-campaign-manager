import { defineTable } from "convex/server";
import { v } from "convex/values";

export const codexTables = {
  /**
   * Characters & Locations entries (D7), one row each; `data` is validated by
   * the codex module. Players see only entries marked known, revealed images
   * and the allegiance shown to them; GM notes never leave the server.
   */
  codexEntries: defineTable({
    campaignId: v.id("campaigns"),
    kind: v.union(v.literal("character"), v.literal("location")),
    data: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_campaign_kind", ["campaignId", "kind"]),
};
