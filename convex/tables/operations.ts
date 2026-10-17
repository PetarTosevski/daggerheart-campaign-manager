import { defineTable } from "convex/server";
import { v } from "convex/values";

export const operationTables = {
  /** Idempotency records: a retried request with the same key replays its result. */
  operations: defineTable({
    scopeKey: v.string(),
    idempotencyKey: v.string(),
    kind: v.string(),
    requestHash: v.string(),
    result: v.any(),
    campaignId: v.optional(v.id("campaigns")),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_scope_key", ["scopeKey", "idempotencyKey"])
    .index("by_campaign", ["campaignId"]),
};
