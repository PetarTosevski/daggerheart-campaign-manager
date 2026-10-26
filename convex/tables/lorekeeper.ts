import { defineTable } from "convex/server";
import { v } from "convex/values";

import {
  answerPhaseValidator,
  askResolutionValidator,
  conversationVisibilityValidator,
  failureCodeValidator,
  messageRoleValidator,
  messageStatusValidator,
  partsValidator,
  reservationValidator,
  usageKindValidator,
  usageValidator,
} from "../lib/validators/lorekeeper";

/**
 * The Lorekeeper (D13, plan `.omc/plans/d13-lorekeeper.yaml`, analysis section 2). Books and chunks are one set
 * per deployment, written only by the internal ingest (L2) and never returned whole to a client; everything else
 * belongs to one campaign and goes with its purge (`convex/cleanup.ts`). Conversations are kept until their asker
 * deletes them (Q10): no retention job deletes them. Usage counters expire after 13 months
 * (`convex/lorekeeperRetention.ts`).
 */
export const lorekeeperTables = {
  /** A rulebook (or the frame / house-rules pseudo-book). At most about 20 rows. */
  lorekeeperBooks: defineTable({
    /** "core", "hopeFear", "frame:<frameId>" or "houseRules" (validators/lorekeeper.ts). */
    key: v.string(),
    title: v.string(),
    subtitle: v.string(),
    /** The cover's token name (a spine gradient in lorekeeper.css). */
    cover: v.string(),
    /** Printed pages covered. */
    pages: v.number(),
    chunkCount: v.number(),
    ingestedAt: v.number(),
    /** The chunking format (CHUNK_SCHEMA_VERSION), so a re-ingest can be detected. */
    schemaVersion: v.number(),
  }).index("by_key", ["key"]),

  /** A page-tagged piece of book text (at most 4,000 chars). Read only by internal functions. */
  lorekeeperChunks: defineTable({
    bookId: v.id("lorekeeperBooks"),
    /** The printed page. */
    page: v.number(),
    /** The section path, e.g. "Core Mechanics → Duality Dice". */
    section: v.string(),
    text: v.string(),
    /** Order within the book. */
    ord: v.number(),
  })
    .index("by_book_page", ["bookId", "page"])
    .searchIndex("search_text", { searchField: "text", filterFields: ["bookId"] }),

  /** The GM's per-campaign book switch. No row means the default (on for core, hopeFear and the campaign's frame). */
  lorekeeperLibrary: defineTable({
    campaignId: v.id("campaigns"),
    bookId: v.id("lorekeeperBooks"),
    enabled: v.boolean(),
    updatedAt: v.number(),
  }).index("by_campaign_book", ["campaignId", "bookId"]),

  /** One asker's conversation. Readable by the campaign unless private (Q3); deleted only by its asker (Q10). */
  lorekeeperConversations: defineTable({
    campaignId: v.id("campaigns"),
    userId: v.id("users"),
    /** The first question, cut to 80 chars. */
    title: v.string(),
    visibility: conversationVisibilityValidator,
    /** The 'If the books don’t say' toggle: true = 'Search the internet too' (the board's default). */
    webSearch: v.boolean(),
    messageCount: v.number(),
    lastAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_campaign_user_last", ["campaignId", "userId", "lastAt"])
    .index("by_campaign_visibility_last", ["campaignId", "visibility", "lastAt"]),

  /** A question or an answer. Answer rows are patched while they stream (analysis 4, option A). */
  lorekeeperMessages: defineTable({
    conversationId: v.id("lorekeeperConversations"),
    campaignId: v.id("campaigns"),
    /** The asker (also on answer rows). */
    userId: v.id("users"),
    role: messageRoleValidator,
    status: messageStatusValidator,
    /** The question, or the answer's prose so far (at most 6,000 chars). */
    text: v.string(),
    parts: v.optional(partsValidator),
    errorCode: v.optional(failureCodeValidator),
    usage: v.optional(usageValidator),
    /** The model that wrote the final answer. */
    model: v.optional(v.string()),
    /** Q2: Sonnet found nothing and Opus answered ('Checked again with a stronger model'). */
    checkedAgain: v.optional(v.boolean()),
    /** L11: the answer's phase while it runs (books → retry → web → done); absent on older rows. */
    phase: v.optional(answerPhaseValidator),
    /** What caps.reserve booked for this answer (answer rows only). */
    reserved: v.optional(reservationValidator),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_campaign_user_status", ["campaignId", "userId", "status"])
    .index("by_status_updated", ["status", "updatedAt"]),

  /** A table ruling the GM pinned (at most 50 per campaign). */
  lorekeeperRulings: defineTable({
    campaignId: v.id("campaigns"),
    title: v.string(),
    text: v.string(),
    sessionId: v.optional(v.id("sessions")),
    fromMessageId: v.optional(v.id("lorekeeperMessages")),
    pinnedBy: v.id("users"),
    pinnedAt: v.number(),
    updatedAt: v.number(),
  }).index("by_campaign_pinned", ["campaignId", "pinnedAt"]),

  /** A player's 'Ask the GM' on one of their answers (Q8); open while resolvedAt is unset. */
  lorekeeperAsks: defineTable({
    campaignId: v.id("campaigns"),
    messageId: v.id("lorekeeperMessages"),
    askedBy: v.id("users"),
    askedAt: v.number(),
    resolvedAt: v.optional(v.number()),
    resolution: v.optional(askResolutionValidator),
    rulingId: v.optional(v.id("lorekeeperRulings")),
  })
    .index("by_campaign_open", ["campaignId", "resolvedAt"])
    .index("by_message", ["messageId"]),

  /**
   * Cost counters (Q9, CD14), apart from the documents many queries read (CD10). One row per counter and period:
   * kind "user" (userId, UTC day "YYYY-MM-DD"), "campaign" (campaignId, UTC month "YYYY-MM") or "deployment"
   * (month). Ids are fields, not encoded keys (CD6). Campaign rows go with the campaign; every row expires after
   * 13 months.
   */
  lorekeeperUsage: defineTable({
    kind: usageKindValidator,
    userId: v.optional(v.id("users")),
    campaignId: v.optional(v.id("campaigns")),
    period: v.string(),
    questions: v.number(),
    /** US dollars × 1,000,000: reservations plus settled costs. */
    costMicros: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user_period", ["userId", "period"])
    .index("by_campaign_period", ["campaignId", "period"])
    .index("by_kind_period", ["kind", "period"])
    .index("by_updated", ["updatedAt"]),
};
