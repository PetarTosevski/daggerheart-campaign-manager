import { defineTable } from "convex/server";

import { restChoiceFields, restFields } from "../lib/validators/rests";

export const restTables = {
  /**
   * Party rests (D5, decision 10): the GM starts one, players choose, the GM
   * finishes or interrupts it. Campaign-scoped: purged with its campaign.
   *
   * - `by_campaign_status_started`: the open rest (`status: "open"`, at most one).
   * - `by_campaign_started`: rests newest first, to count short rests since the last long one (CB 105).
   */
  rests: defineTable(restFields)
    .index("by_campaign_status_started", ["campaignId", "status", "startedAt"])
    .index("by_campaign_started", ["campaignId", "startedAt"]),

  /**
   * Each character's moves for one rest: one row per (rest, character), written
   * by that character's owner or the GM (CD6 ids as fields, CD10 one writer per row).
   */
  restChoices: defineTable(restChoiceFields)
    .index("by_rest_character", ["restId", "characterId"])
    .index("by_campaign", ["campaignId"]),
};
