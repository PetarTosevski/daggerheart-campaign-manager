import { defineTable } from "convex/server";

import { actionLogFields } from "../lib/validators/actionLog";

export const actionLogTables = {
  /**
   * The action log (D5): the roll feed every member reads and the undo
   * journal. A table of its own, not `history` (GM-only audit of Fear,
   * countdowns and time): the feed needs per-row visibility and sheet
   * snapshots. Written only through `logAction` (convex/lib/actionLog.ts),
   * undone through `undoEntry`. Campaign-scoped: purged with its campaign.
   *
   * - `by_campaign_at`: the GM's feed, newest first; the purge.
   * - `by_campaign_visibility_at`: the players' feed (`visibility: "public"` only).
   * - `by_character_at`: a character's feed; undo's "latest row" check.
   * - `by_campaign_group`: the rows of one action, undone together.
   */
  actionLog: defineTable(actionLogFields)
    .index("by_campaign_at", ["campaignId", "at"])
    .index("by_campaign_visibility_at", ["campaignId", "visibility", "at"])
    .index("by_character_at", ["characterId", "at"])
    .index("by_campaign_group", ["campaignId", "groupId"]),
};
