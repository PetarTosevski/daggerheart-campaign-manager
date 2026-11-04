import { v } from "convex/values";

import {
  ADMIN_AUDIT_ACTIONS,
  ADMIN_EXPORT_STATUSES,
  AT_LIMIT_MODES,
  CAP_KEYS,
  FEATURE_MODES,
  LIMIT_REQUEST_STATUSES,
  SIGN_UP_MODES,
} from "../../../src/lib/admin/config";

/** Validators of the app admin tables (config AD0; constants and defaults in `src/lib/admin/config.ts`). */

export const signUpModeValidator = v.union(...SIGN_UP_MODES.map((m) => v.literal(m)));

export const capKeyValidator = v.union(...CAP_KEYS.map((k) => v.literal(k)));

/** The owner's saved caps: every field optional (missing = `DEFAULT_CAPS`). */
export const capsValidator = v.object({
  campaignsPerGm: v.optional(v.number()),
  campaignsApp: v.optional(v.number()),
  charactersPerPlayer: v.optional(v.number()),
  playersPerCampaign: v.optional(v.number()),
});

export const atLimitValidator = v.union(...AT_LIMIT_MODES.map((m) => v.literal(m)));

/** The owner's saved Lorekeeper settings: every field optional (missing = env var, then `DEFAULT_LOREKEEPER`). */
export const lorekeeperSettingsValidator = v.object({
  monthlyUsd: v.optional(v.number()),
  campaignMonthlyUsd: v.optional(v.number()),
  dailyQuestions: v.optional(v.number()),
  dailyWebSearches: v.optional(v.number()),
  atLimit: v.optional(atLimitValidator),
  allowGmRequests: v.optional(v.boolean()),
  emailAt80: v.optional(v.boolean()),
});

export const featureModeValidator = v.union(...FEATURE_MODES.map((m) => v.literal(m)));

export const adminAuditActionValidator = v.union(...ADMIN_AUDIT_ACTIONS.map((a) => v.literal(a)));

/** A before / after value in the audit: a setting's value, never a key or a code. */
export const adminAuditValueValidator = v.union(v.string(), v.number(), v.boolean());

export const adminExportStatusValidator = v.union(...ADMIN_EXPORT_STATUSES.map((s) => v.literal(s)));

export const limitRequestStatusValidator = v.union(...LIMIT_REQUEST_STATUSES.map((s) => v.literal(s)));

/** A campaign's Lorekeeper numbers: what a GM asks for, or what the owner set (missing = the app defaults). */
export const campaignLimitNumbersValidator = v.object({
  dailyQuestions: v.optional(v.number()),
  dailyWebSearches: v.optional(v.number()),
  bookCount: v.optional(v.number()),
  bookPages: v.optional(v.number()),
});

/** The effective settings `readAppConfig` returns (defaults applied; `appAdmin.settings`'s `returns`). */
export const appSettingsValidator = v.object({
  signUpMode: signUpModeValidator,
  caps: v.object({
    campaignsPerGm: v.number(),
    campaignsApp: v.number(),
    charactersPerPlayer: v.number(),
    playersPerCampaign: v.number(),
  }),
  lorekeeper: v.object({
    monthlyUsd: v.number(),
    campaignMonthlyUsd: v.number(),
    dailyQuestions: v.number(),
    dailyWebSearches: v.number(),
    atLimit: atLimitValidator,
    allowGmRequests: v.boolean(),
    emailAt80: v.boolean(),
  }),
  spendAlertMonth: v.union(v.string(), v.null()),
});
