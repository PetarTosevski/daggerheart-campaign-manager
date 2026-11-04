import { defineTable } from "convex/server";

import {
  sessionCharacterStatFields,
  sessionFields,
  sessionLogFields,
  sessionLogOverrideFields,
  sessionPrepFields,
  sessionSpotlightFields,
} from "../lib/validators/sessions";

/**
 * The Sessions board (D10, plan `.omc/plans/d10-sessions.yaml`) and the Journal (plan `.omc/plans/journal.yaml`,
 * J0 adds the log overrides and the per-PC tally counters). Caps (convex/lib/validators/sessions.ts) are checked with
 * an index `.take`. Every row carries its `campaignId` and goes with the campaign's purge (convex/cleanup.ts);
 * deleting a session deletes its prep, log, spotlight, override and stats rows (`deleteSessionRows`,
 * convex/lib/sessions.ts).
 */
export const sessionTables = {
  /**
   * One row per session (B1), at most MAX_SESSIONS per campaign.
   * - `by_campaign_n`: the list newest first, the highest number (create), the count (cap).
   * - `by_campaign_status_n`: the live session (B6), the newest planned one (B8, B11), the played ones (B9).
   * - `by_campaign_started` / `by_campaign_ended`: 'did a session start or end after t' (SS3, dcm-bxp.48).
   */
  sessions: defineTable(sessionFields)
    .index("by_campaign_n", ["campaignId", "n"])
    .index("by_campaign_status_n", ["campaignId", "status", "n"])
    .index("by_campaign_started", ["campaignId", "startedAt"])
    .index("by_campaign_ended", ["campaignId", "endedAt"]),

  /** A session's GM-only prep and wrap-up notes, one row per session (CD10). `by_campaign` serves the purge. */
  sessionPrep: defineTable(sessionPrepFields).index("by_session", ["sessionId"]).index("by_campaign", ["campaignId"]),

  /** A session's log lines (CD8), read newest first by `by_session_at`. `by_campaign` serves the purge. */
  sessionLog: defineTable(sessionLogFields).index("by_session_at", ["sessionId", "at"]).index("by_campaign", ["campaignId"]),

  /** Spotlight counts per (session, character) (B4). `by_campaign` serves the purge. */
  sessionSpotlights: defineTable(sessionSpotlightFields)
    .index("by_session_character", ["sessionId", "characterId"])
    .index("by_campaign", ["campaignId"]),

  /**
   * Journal: the GM's hide / edit of a merged log line, one row per (session, source, sourceId), at most
   * MAX_LOG_OVERRIDES per session. `by_session_source` finds a line's override and lists a session's; `by_campaign`
   * serves the purge.
   */
  sessionLogOverrides: defineTable(sessionLogOverrideFields)
    .index("by_session_source", ["sessionId", "source", "sourceId"])
    .index("by_campaign", ["campaignId"]),

  /**
   * Journal (Q8): Hope spent and HP marked per (session, PC) while the session is live, at most the campaign's
   * character cap per session. `by_campaign` serves the purge.
   */
  sessionCharacterStats: defineTable(sessionCharacterStatFields)
    .index("by_session_character", ["sessionId", "characterId"])
    .index("by_campaign", ["campaignId"]),
};
