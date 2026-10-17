import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { FRAME_IDS } from "../src/lib/frames/index";

export const frameIdValidator = v.union(...FRAME_IDS.map((id) => v.literal(id)));

export const customFrameValidator = v.object({
  pitch: v.string(),
  tones: v.array(v.string()),
  themes: v.string(),
  touchstones: v.string(),
  partySize: v.number(),
  startingTier: v.number(),
  background: v.string(),
});

export default defineSchema({
  ...authTables,

  campaigns: defineTable({
    ownerId: v.id("users"),
    frameId: frameIdValidator,
    name: v.string(),
    /** `name.trim().toLowerCase()`: names are unique per GM. */
    nameKey: v.string(),
    tier: v.number(),
    level: v.number(),
    /** Only for `frameId: "custom"`: the GM's own pitch, tones and art. */
    custom: v.optional(customFrameValidator),
    createdAt: v.number(),
    lastOpenedAt: v.number(),
    /** Set when the GM deletes the campaign; cleared by undo. */
    deletedAt: v.optional(v.number()),
  })
    .index("by_owner_lastOpened", ["ownerId", "lastOpenedAt"])
    .index("by_owner_nameKey", ["ownerId", "nameKey"]),

  campaignState: defineTable({
    campaignId: v.id("campaigns"),
    fear: v.number(),
  }).index("by_campaign", ["campaignId"]),

  settings: defineTable({
    ownerId: v.id("users"),
    tableName: v.string(),
    gmName: v.string(),
    accent: v.string(),
  }).index("by_owner", ["ownerId"]),

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
});
