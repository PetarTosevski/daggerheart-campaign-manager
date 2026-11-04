import { defineTable } from "convex/server";
import { v } from "convex/values";

export const playForTables = {
  /**
   * The GM's "Play for this character" switch (plan drawer-answers DA6, user answers 2026-10-30): one row per (campaign,
   * GM, character) while the switch is on, none while it is off. Shared by the map Hand and the sheet drawer and kept on
   * the server, so it follows the GM to every device. At most one row per character for each GM of the campaign.
   * Campaign-scoped: purged with its campaign.
   *
   * - `by_campaign_user_character`: the GM's switches in a campaign, and one character's (the purge reads its prefix).
   */
  playFor: defineTable({
    campaignId: v.id("campaigns"),
    userId: v.id("users"),
    characterId: v.id("characters"),
  }).index("by_campaign_user_character", ["campaignId", "userId", "characterId"]),
};
