import { defineTable } from "convex/server";
import { v } from "convex/values";

import { FRAME_IDS } from "../../src/lib/frames/index";

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

export const campaignTables = {
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
    /** Code players use to join; the GM can rotate it. Unset until first shown. */
    joinCode: v.optional(v.string()),
    /** GM switches for optional rules (see `src/lib/frames/options.ts`); unset keys use the frame default. */
    options: v.optional(v.record(v.string(), v.boolean())),
    /** Custom frame only: the GM's own tome chapters (plain text). */
    tome: v.optional(v.object({ overview: v.string(), incident: v.string(), mechanics: v.string() })),
  })
    .index("by_owner_lastOpened", ["ownerId", "lastOpenedAt"])
    .index("by_owner_nameKey", ["ownerId", "nameKey"])
    .index("by_joinCode", ["joinCode"]),

  /** Players of a campaign. The campaign's creator (`ownerId`) is its GM and has no row. */
  campaignMembers: defineTable({
    campaignId: v.id("campaigns"),
    userId: v.id("users"),
    joinedAt: v.number(),
    lastOpenedAt: v.number(),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_user", ["userId"])
    .index("by_campaign_user", ["campaignId", "userId"]),

  /** Email invites. An invited account counts as a player; opening the campaign turns it into a member row. */
  campaignInvites: defineTable({
    campaignId: v.id("campaigns"),
    email: v.string(),
    invitedBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_email", ["email"])
    .index("by_campaign_email", ["campaignId", "email"]),

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
};
