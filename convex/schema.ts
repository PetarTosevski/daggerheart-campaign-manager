import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import { COUNTDOWN_CATEGORIES, COUNTDOWN_STATUSES } from "../src/lib/domain/countdowns/index";
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

  /** Countdowns, legacy rules; no event history (user decision 2026-10-17). */
  countdowns: defineTable({
    campaignId: v.id("campaigns"),
    name: v.string(),
    description: v.string(),
    category: v.union(...COUNTDOWN_CATEGORIES.map((c) => v.literal(c))),
    startingValue: v.number(),
    currentValue: v.number(),
    status: v.union(...COUNTDOWN_STATUSES.map((s) => v.literal(s))),
    consequence: v.string(),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    /**
     * Set when a frame tracker owns the countdown (e.g. a Five Banners nation's
     * objective, a PC's Lycanthropy); such countdowns stay off the dashboard list.
     */
    ownerKey: v.optional(v.string()),
    kind: v.optional(v.string()),
    /** Frame-owned countdowns are GM-only until revealed. */
    revealed: v.optional(v.boolean()),
  }).index("by_campaign", ["campaignId"]),

  /**
   * State of a frame tracker (Five Banners relationships, Siphoning Track,
   * Doom Track…), one row per campaign and key. Each tracker module in
   * convex/trackers/ validates its own `data` and filters it for players.
   */
  frameTrackers: defineTable({
    campaignId: v.id("campaigns"),
    key: v.string(),
    data: v.any(),
    updatedAt: v.number(),
  }).index("by_campaign_key", ["campaignId", "key"]),

  /**
   * Player characters. `sheet` is validated with `characterSheetSchema`
   * (src/lib/validation/characters.ts). The owner (a player, or the GM for an
   * unassigned character) and the GM can edit; everyone in the campaign can
   * read every sheet (user decision 2026-10-17).
   */
  characters: defineTable({
    campaignId: v.id("campaigns"),
    ownerId: v.id("users"),
    createdBy: v.id("users"),
    status: v.union(v.literal("active"), v.literal("dead"), v.literal("retired")),
    sheet: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_owner", ["ownerId"]),

  /** Portrait files, recorded when uploaded so a sheet can only use (and delete) its own uploads. */
  portraitUploads: defineTable({
    storageId: v.id("_storage"),
    userId: v.id("users"),
    characterId: v.id("characters"),
    createdAt: v.number(),
  })
    .index("by_storage", ["storageId"])
    .index("by_character", ["characterId"]),

  /** The campaign's World map (D6): one row, `data` validated by `mapStateSchema` (src/lib/world/map-state.ts). */
  maps: defineTable({
    campaignId: v.id("campaigns"),
    data: v.any(),
    updatedAt: v.number(),
  }).index("by_campaign", ["campaignId"]),

  /** Uploaded World map images, recorded so a file belongs to one campaign and only its own uploads are served or deleted. */
  mapUploads: defineTable({
    storageId: v.id("_storage"),
    campaignId: v.id("campaigns"),
    uploadedBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_storage", ["storageId"])
    .index("by_campaign", ["campaignId"]),

  /**
   * Characters & Locations entries (D7), one row each; `data` is validated by
   * the codex module. Players see only entries marked known, revealed images
   * and the allegiance shown to them; GM notes never leave the server.
   */
  codexEntries: defineTable({
    campaignId: v.id("campaigns"),
    kind: v.union(v.literal("character"), v.literal("location")),
    data: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_campaign_kind", ["campaignId", "kind"]),

  /** Images attached to codex entries (Convex file storage), recorded so only the entry's own files are served or deleted. */
  codexImages: defineTable({
    storageId: v.id("_storage"),
    campaignId: v.id("campaigns"),
    entryId: v.id("codexEntries"),
    uploadedBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_storage", ["storageId"])
    .index("by_entry", ["entryId"]),

  /** Witherwild-only campaign time: one row per campaign whose frame has `campaignTime`. */
  campaignTime: defineTable({
    campaignId: v.id("campaigns"),
    week: v.number(),
    cycle: v.union(v.literal("DAY"), v.literal("NIGHT")),
    cycleDay: v.number(),
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
