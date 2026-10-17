import { defineTable } from "convex/server";
import { v } from "convex/values";

import { customFrameValidator, frameIdValidator, tomeValidator } from "../lib/validators/campaigns";

export { customFrameValidator, frameIdValidator };

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
    /** Creation time, or the GM's last open before `campaignOpens`: the fallback `campaigns.list` sorts by. Never patched. */
    lastOpenedAt: v.number(),
    /** Set when the GM deletes the campaign; cleared by undo. */
    deletedAt: v.optional(v.number()),
    /** Code players use to join; the GM can rotate it. Set on create (older campaigns: when first shown). */
    joinCode: v.optional(v.string()),
    /** GM switches for optional rules (see `src/lib/frames/options.ts`); unset keys use the frame default. */
    options: v.optional(v.record(v.string(), v.boolean())),
    /** Custom frame only: the GM's own tome chapters (plain text). */
    tome: v.optional(tomeValidator),
  })
    .index("by_owner_deletedAt_lastOpened", ["ownerId", "deletedAt", "lastOpenedAt"])
    .index("by_owner_deletedAt_nameKey", ["ownerId", "deletedAt", "nameKey"])
    .index("by_joinCode", ["joinCode"])
    /** Finds campaigns deleted long enough ago to purge (CD18). */
    .index("by_deletedAt", ["deletedAt"]),

  /**
   * When a user (GM or player) last opened a campaign. Kept off the campaign
   * document, which many queries read (CD10); `markOpened` writes it at most
   * every few minutes.
   */
  campaignOpens: defineTable({
    userId: v.id("users"),
    campaignId: v.id("campaigns"),
    lastOpenedAt: v.number(),
  })
    .index("by_user_campaign", ["userId", "campaignId"])
    .index("by_user_lastOpened", ["userId", "lastOpenedAt"]),

  /** Players of a campaign. The campaign's creator (`ownerId`) is its GM and has no row. */
  campaignMembers: defineTable({
    campaignId: v.id("campaigns"),
    userId: v.id("users"),
    joinedAt: v.number(),
    /** Join time, or the player's last open before `campaignOpens`: the fallback `campaigns.list` sorts by. */
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
