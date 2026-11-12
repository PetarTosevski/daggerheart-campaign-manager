import { defineTable } from "convex/server";
import { v } from "convex/values";

import { restChoiceFields, restFields } from "../lib/validators/rests";
import { countdownRestModeValidator } from "./countdowns";

/**
 * One countdown's rest tick as the ended rest rolled it (plan rest-ticks, RT1): the setting's mode, the ticks it gives
 * and what they came from (the PCs counted, the die rolled). Automatic and Reminder alike, so a Reminder ticks exactly
 * this amount and a reload never rerolls. Both rows of a chase pair carry the same roll.
 */
export const restTickResultValidator = v.object({
  countdownId: v.id("countdowns"),
  mode: countdownRestModeValidator,
  amount: v.number(),
  pcs: v.optional(v.number()),
  die: v.optional(v.object({ sides: v.number(), rolled: v.number() })),
});

export const restTables = {
  /**
   * Party rests (D5, decision 10): the GM starts one, players choose, the GM
   * finishes or interrupts it. Campaign-scoped: purged with its campaign. An ended short rest keeps its downtime dice
   * and Oasis holders (`dice`, `oasisHolders`; DA5, HF 27) for the player-picked reroll, and the holders who closed their
   * Oasis panel (`oasisClosed`; DA15).
   * `restTicks` (rest-ticks RT1, widened; rows before it have none): the countdown rest ticks the ended rest rolled,
   * bounded by the 100 dashboard countdowns the rest reads (CD8). Cleared by undo.
   *
   * - `by_campaign_status_started`: the open rest (`status: "open"`, at most one).
   * - `by_campaign_started`: rests newest first, to count short rests since the last long one (CB 105).
   */
  rests: defineTable({ ...restFields, restTicks: v.optional(v.array(restTickResultValidator)) })
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
