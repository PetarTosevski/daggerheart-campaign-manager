import { defineTable } from "convex/server";

import { combatRequestFields } from "../lib/validators/combatRequests";

export const combatRequestTables = {
  /**
   * Requests waiting for someone at the table (plan combat-actions, AA0): a player's out-of-range action waiting for
   * the GM's sanction (Q1, kind `sanction`) and an adversary hit waiting in its reaction window (Q13, kind
   * `incomingHit`), and the extra Minions a PC's attack may defeat, waiting for the attacker's pick (Q6, CB p.201, kind
   * `minionOffer`, CA3). Open rows close (declined) when their encounter ends or is deleted. A table of its own because it grows with every hit (rule 6). Campaign-scoped: purged with its
   * campaign; resolved and declined rows are also swept a day after `resolvedAt` (rule 8, `expireCombatRequests`).
   *
   * - `by_campaign_status`: a campaign's open requests (the GM's queue, a player's own requests, the open hit of a
   *   character), oldest first; the purge (campaign prefix).
   * - `by_status_resolved`: the retention cron's range (`status` resolved | declined, `resolvedAt` before the cutoff).
   */
  combatRequests: defineTable(combatRequestFields)
    .index("by_campaign_status", ["campaignId", "status"])
    .index("by_status_resolved", ["status", "resolvedAt"]),
};
