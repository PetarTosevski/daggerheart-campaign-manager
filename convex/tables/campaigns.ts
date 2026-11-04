import { defineTable } from "convex/server";
import { v } from "convex/values";

import {
  customFrameValidator,
  frameIdValidator,
  memberRoleValidator,
  storedTableSettingsValidator,
  tomeValidator,
} from "../lib/validators/campaigns";
import { mapStyleValidator } from "../lib/validators/combatMaps";
import { draftKindValidator, textSizeValidator, uiStateKeyValidator, uiStateValueValidator } from "../lib/validators/preferences";

export { customFrameValidator, frameIdValidator };

/** A campaign's time of day and a map's light (dcm-bxp.54, R8): day, dim (badge) or night (lights only). */
export const timeOfDayValidator = v.union(v.literal("day"), v.literal("dim"), v.literal("night"));

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
    /**
     * The GM's switch "Players can see each other's cards" (F7-H4, dcm-bxp.99.24); unset = on. F8-I1 moved it here from
     * the `options` key of the same name (`migrations/handSharing:moveSwitch`).
     */
    playersSeeHands: v.optional(v.boolean()),
    /** Custom frame only: the GM's own tome chapters (plain text). */
    tome: v.optional(tomeValidator),
    /** When the GM last cleared the roll feed (`feed.clear`): the feed shows only rows after it. */
    feedClearedAt: v.optional(v.number()),
    /**
     * The GM's time of day (dcm-bxp.54): Day / Dim / Night, the light every map of the campaign follows. Unset = day.
     * Not used in a frame with campaign time (the Witherwild), where the time phase decides (`lightOf`).
     * Written by `campaigns.setTimeOfDay` only.
     */
    timeOfDay: v.optional(timeOfDayValidator),
    /**
     * The Campaign settings' table switches (config S0): a typed object of optional fields; an unset field (or no
     * object) uses `TABLE_SETTING_DEFAULTS` (`src/lib/config/campaign-settings.ts`). `campaigns.get` resolves it.
     */
    tableSettings: v.optional(storedTableSettingsValidator),
    /** When the creator archived the campaign (config Q9 a): read-only for everyone; cleared by unarchive. */
    archivedAt: v.optional(v.number()),
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
    /** `coGm`: a co-GM (config G1, Q8 b); unset = a player. Only the creator sets it. */
    role: v.optional(memberRoleValidator),
  })
    .index("by_user", ["userId"])
    .index("by_campaign_user", ["campaignId", "userId"]),

  /** Email invites. An invited account counts as a player; opening the campaign turns it into a member row. */
  campaignInvites: defineTable({
    campaignId: v.id("campaigns"),
    email: v.string(),
    invitedBy: v.id("users"),
    createdAt: v.number(),
    /** `coGm`: the creator invited this email straight in as co-GM (Q8 b); accepted in `markOpened`. Unset = a player. */
    role: v.optional(memberRoleValidator),
  })
    .index("by_email", ["email"])
    .index("by_campaign_email", ["campaignId", "email"]),

  campaignState: defineTable({
    campaignId: v.id("campaigns"),
    fear: v.number(),
    /** When the live session started (D5 decision 12; since D10 written by the Sessions board's start, cleared by end). */
    sessionStartedAt: v.optional(v.number()),
    /**
     * XC1: the `sessionStartedAt` of the session in which the GM allows more than
     * one active character per player. Applies only while it equals the running
     * session's; `sessions.end` clears it.
     */
    extraCharactersSession: v.optional(v.number()),
    /**
     * D10: the campaign's live session (`sessions` row with status "live", B6). `sessionStartedAt` and
     * `extraCharactersSession` stay the cached "live since" that XC1 and SS3 read; start and end write all three in
     * the same mutation (convex/sessions.ts).
     */
    liveSessionId: v.optional(v.id("sessions")),
  }).index("by_campaign", ["campaignId"]),

  settings: defineTable({
    ownerId: v.id("users"),
    tableName: v.string(),
    gmName: v.string(),
    accent: v.string(),
    /** XS1: defaults for new campaigns; an unset key keeps each frame's own default. */
    expansions: v.optional(v.object({ hopeAndFear: v.optional(v.boolean()) })),
    /** dcm-bxp.89: the style new blank maps get (Settings slider); absent = Classic. Existing maps keep theirs (E3). */
    defaultMapStyle: v.optional(mapStyleValidator),
  }).index("by_owner", ["ownerId"]),

  /**
   * A user's preferences (config S0; the Preferences popover): one row per user, saved to the account (Q15 b). An
   * unset field uses `PREFERENCE_DEFAULTS` (`src/lib/config/preferences.ts`). Kept off `settings`, which the title menu
   * reads (CD10).
   */
  userPreferences: defineTable({
    userId: v.id("users"),
    dice3d: v.optional(v.boolean()),
    diceSound: v.optional(v.boolean()),
    /** 0-100. */
    diceVolume: v.optional(v.number()),
    reduceMotion: v.optional(v.boolean()),
    textSize: v.optional(textSizeValidator),
    spotlightPing: v.optional(v.boolean()),
    /** When this browser's old saved values were moved here (tracer IMP). */
    legacyImportedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  /**
   * A user's UI state (config S0, Q15 b): one row per key (`UI_STATE_KEYS`), so a flip of the token names or a sort
   * order never rewrites the preferences row (CD10, rule 6). A missing row is the key's default.
   */
  userUiState: defineTable({
    userId: v.id("users"),
    key: uiStateKeyValidator,
    value: uiStateValueValidator,
    updatedAt: v.number(),
  }).index("by_user_key", ["userId", "key"]),

  /**
   * Unsent drafts (config S0, Q15 b): the character wizard (per campaign) and the custom frame form (no campaign).
   * `data` is JSON text of at most `DRAFT_MAX_BYTES`, parsed with zod on the client, with its `schemaVersion` (rule 7).
   * Purged with its campaign; drafts expire after 90 days (P2's cron).
   */
  userDrafts: defineTable({
    userId: v.id("users"),
    kind: draftKindValidator,
    campaignId: v.optional(v.id("campaigns")),
    schemaVersion: v.number(),
    data: v.string(),
    updatedAt: v.number(),
  })
    .index("by_user_kind_campaign", ["userId", "kind", "campaignId"])
    .index("by_campaign", ["campaignId"]),

  /**
   * A folded hand on the Combat Map ("Hide cards", config S0): a row = folded, per user and character. Bounded per
   * campaign (members x characters); purged with the campaign.
   */
  handFolds: defineTable({
    userId: v.id("users"),
    campaignId: v.id("campaigns"),
    characterId: v.id("characters"),
    updatedAt: v.number(),
  })
    .index("by_user_character", ["userId", "characterId"])
    .index("by_campaign", ["campaignId"]),
};
