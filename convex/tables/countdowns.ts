import { defineTable } from "convex/server";
import { v } from "convex/values";

import {
  COUNTDOWN_CATEGORIES,
  COUNTDOWN_HIDEABLE_FIELDS,
  COUNTDOWN_STATUSES,
} from "../../src/lib/domain/countdowns/index";

/** Who sees a dashboard countdown (CV1): private, or public with some fields hidden from players. */
export const countdownVisibilityValidator = v.union(
  v.object({ mode: v.literal("private") }),
  v.object({ mode: v.literal("public"), hidden: v.array(v.union(...COUNTDOWN_HIDEABLE_FIELDS.map((f) => v.literal(f)))) }),
);

export const countdownTables = {
  /** Countdowns, legacy rules; every change is recorded in `history` (dcm-bxp.26). */
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
    /** Dashboard countdowns only (frame-owned ones use `revealed`). Absent = everything public. */
    visibility: v.optional(countdownVisibilityValidator),
  })
    /** The dashboard list: `ownerKey` undefined, i.e. countdowns no frame tracker owns. */
    .index("by_campaign_owner", ["campaignId", "ownerKey"]),

  /** Witherwild-only campaign time: one row per campaign whose frame has `campaignTime`. */
  campaignTime: defineTable({
    campaignId: v.id("campaigns"),
    week: v.number(),
    cycle: v.union(v.literal("DAY"), v.literal("NIGHT")),
    cycleDay: v.number(),
  }).index("by_campaign", ["campaignId"]),
};
