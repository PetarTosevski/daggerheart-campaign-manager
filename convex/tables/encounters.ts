import { defineTable } from "convex/server";

import { customAdversaryFields, encounterAdversaryFields, encounterFields } from "../lib/validators/encounters";

export const encounterTables = {
  /**
   * The GM's encounters (D8): drafts for prep, at most one running, ended ones kept. GM-only. At most
   * MAX_ENCOUNTERS per campaign (convex/lib/encounters.ts), checked with an index `.take`.
   */
  encounters: defineTable(encounterFields).index("by_campaign_status_updated", ["campaignId", "status", "updatedAt"]),

  /**
   * One row per adversary instance in an encounter (CD8, CD10): an HP or Stress click writes only its row.
   * At most MAX_INSTANCES per encounter. `by_campaign` serves the purge.
   */
  encounterAdversaries: defineTable(encounterAdversaryFields)
    .index("by_encounter_order", ["encounterId", "order"])
    .index("by_campaign", ["campaignId"]),

  /** A campaign's custom stat blocks (open question 6: yes, tracer A5), at most MAX_CUSTOM per campaign. GM-only. */
  customAdversaries: defineTable(customAdversaryFields).index("by_campaign_name", ["campaignId", "name"]),
};
