import { defineTable } from "convex/server";
import { v } from "convex/values";

import {
  adminAuditActionValidator,
  adminAuditValueValidator,
  adminExportStatusValidator,
  campaignLimitNumbersValidator,
  capsValidator,
  featureModeValidator,
  limitRequestStatusValidator,
  lorekeeperSettingsValidator,
  signUpModeValidator,
} from "../lib/validators/admin";

/**
 * App admin (config plan Part B, AD0; `.omc/plans/config-briefs.md` "Owner (superadmin) identification"). The owner
 * is one stored id (`appConfig.ownerId`), set only by the internal `adminSetup.setOwner`; `convex/lib/appOwner.ts`
 * is the only check. Every missing setting means its default (`convex/lib/appConfig.ts`), so nothing changes until
 * the owner saves something. Retention: `adminAudit`, `adminExports` and decided `lorekeeperLimitRequests` expire
 * (`convex/adminRetention.ts`); the other tables are tiny or go with their campaign.
 */
export const adminTables = {
  /** The app's settings: one row, `key: "app"`. Never holds a key, a secret or an env value. */
  appConfig: defineTable({
    key: v.literal("app"),
    /** The app owner (superadmin). Set only by `adminSetup.setOwner` (deployment admin key). */
    ownerId: v.optional(v.id("users")),
    signUpMode: v.optional(signUpModeValidator),
    caps: v.optional(capsValidator),
    lorekeeper: v.optional(lorekeeperSettingsValidator),
    /** The UTC month ("YYYY-MM") the 80% spend email was last sent (AD7, once a month). */
    spendAlertMonth: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  /**
   * Read-only mode (AD10, Q31): one tiny row, `key: "app"`, kept apart from `appConfig` so config edits never
   * conflict with the read every mutation makes once AD10 lands.
   */
  appStatus: defineTable({
    key: v.literal("app"),
    readOnly: v.boolean(),
    /** The banner text, at most 200 characters (AD10). */
    message: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  /** Feature switches (AD9, Q25): one row per feature key; no row = `everyone`. */
  featureSwitches: defineTable({
    key: v.string(),
    mode: featureModeValidator,
    changedAt: v.number(),
    changedBy: v.id("users"),
  }).index("by_key", ["key"]),

  /** The owner's testers (AD3, AD9): one row per tester. */
  appTesters: defineTable({
    userId: v.id("users"),
    addedAt: v.number(),
    addedBy: v.id("users"),
  }).index("by_user", ["userId"]),

  /**
   * Recent changes (Q26 a): every admin change plus campaigns created / deleted, kept 365 days
   * (`adminRetention.expireAudit`). `from` / `to` are setting values, never keys or codes.
   */
  adminAudit: defineTable({
    at: v.number(),
    /** Who did it (the owner; for `campaign.*` events the GM). */
    actorId: v.id("users"),
    action: adminAuditActionValidator,
    /** The setting changed (`cap.set`: the cap key; `feature.set`: the feature key). */
    field: v.optional(v.string()),
    from: v.optional(adminAuditValueValidator),
    to: v.optional(adminAuditValueValidator),
    /** The id acted on, as a string (a user, a campaign, a request). */
    target: v.optional(v.string()),
  }).index("by_at", ["at"]),

  /** "Export everything as JSON" (AD11, Q30 a): the temporary file, deleted after an hour (`adminRetention`). */
  adminExports: defineTable({
    requestedBy: v.id("users"),
    status: adminExportStatusValidator,
    fileId: v.optional(v.id("_storage")),
    createdAt: v.number(),
  }).index("by_createdAt", ["createdAt"]),

  /**
   * A suspended or to-be-deleted account (AD14, Q28 b, N11): one row per user, only while the account is suspended or
   * waiting for deletion; no row = a normal account. `suspendedAt` set = suspended by hand (Lift suspension clears it);
   * `deleteAfter` set = deletion scheduled (refused like a suspension until then; Undo clears it, `accountPurge` erases
   * the account after it). The row is deleted when both are clear, and with the account.
   */
  accountStatus: defineTable({
    userId: v.id("users"),
    suspendedAt: v.optional(v.number()),
    /** When `accountPurge` erases the account: 30 days after the owner chose Delete account. */
    deleteAfter: v.optional(v.number()),
    /** The owner's reason for the latest step, at most `ACCOUNT_REASON_MAX` characters (adminAccountActions.ts). */
    reason: v.string(),
    /** Who took the latest step (the app owner). */
    by: v.id("users"),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    // The daily purge reads the accounts past their `deleteAfter` (unset sorts first, so `gte 0` skips them).
    .index("by_deleteAfter", ["deleteAfter"]),

  /**
   * A campaign's Lorekeeper numbers set by the owner (Q21 changed, Q24; AD12 writes, AD6 applies). No row, or a
   * missing field, = the app defaults.
   */
  lorekeeperCampaignLimits: defineTable({
    campaignId: v.id("campaigns"),
    dailyQuestions: v.optional(v.number()),
    dailyWebSearches: v.optional(v.number()),
    bookCount: v.optional(v.number()),
    bookPages: v.optional(v.number()),
    setBy: v.id("users"),
    updatedAt: v.number(),
  }).index("by_campaign", ["campaignId"]),

  /**
   * A GM's request for higher Lorekeeper limits (Q21 changed, N10): one pending per campaign; the owner approves
   * with their own numbers or declines. Decided requests expire after 365 days (`adminRetention`).
   */
  lorekeeperLimitRequests: defineTable({
    campaignId: v.id("campaigns"),
    requestedBy: v.id("users"),
    wants: campaignLimitNumbersValidator,
    /** At most `LIMIT_REQUEST_REASON_MAX` (src/lib/admin/config.ts) characters, checked by the writer (AD12). */
    reason: v.string(),
    status: limitRequestStatusValidator,
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
    decidedBy: v.optional(v.id("users")),
  })
    .index("by_status_createdAt", ["status", "createdAt"])
    .index("by_campaign_status", ["campaignId", "status"]),
};
