import { defineTable } from "convex/server";
import { v } from "convex/values";

export const characterTables = {
  /**
   * Player characters. `sheet` is validated with `characterSheetSchema`
   * (src/lib/validation/characters.ts). The owner (a player, or the GM for an
   * unassigned character) and the GM can edit; everyone in the campaign can
   * read every sheet (user decision 2026-10-17).
   */
  characters: defineTable({
    campaignId: v.id("campaigns"),
    ownerId: v.id("users"),
    createdBy: v.id("users"),
    status: v.union(v.literal("active"), v.literal("dead"), v.literal("retired")),
    sheet: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_owner", ["ownerId"]),
};
