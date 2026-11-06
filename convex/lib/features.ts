import { v } from "convex/values";

import type { FeatureMode } from "../../src/lib/admin/config";
import {
  DEFAULT_FEATURE_MODE,
  FEATURE_KEYS,
  featureInfo,
  modeAllows,
  type FeatureAudience,
  type FeatureFlags,
  type FeatureKey,
} from "../../src/lib/admin/features";
import { appError } from "../../src/lib/errors/app-error";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isAppOwner } from "./appOwner";

/**
 * Feature switches (config AD9, Q25 b). `featureOn` is the ONLY server check whether a feature is on for a caller;
 * server code that gates a feature (AF1) calls it (or `requireFeature`, which throws `FEATURE_OFF`), never reads
 * `featureSwitches` itself. A missing switch row means `everyone`. Inert features (Journal, Share links; N2 a) are
 * always on: their switch is saved but does nothing yet.
 */

export const featureKeyValidator = v.union(...FEATURE_KEYS.map((key) => v.literal(key)));

/** `features.mine`: one boolean per feature. */
export const featureFlagsValidator = v.object({
  journal: v.boolean(),
  dice3d: v.boolean(),
  phoneLayout: v.boolean(),
  lorekeeperWeb: v.boolean(),
  spriteTokens: v.boolean(),
  shareLinks: v.boolean(),
});

/** The saved switch row for a feature, or null (= everyone). */
export async function featureSwitchRow(ctx: QueryCtx, key: FeatureKey): Promise<Doc<"featureSwitches"> | null> {
  return ctx.db
    .query("featureSwitches")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}

/** The saved mode for a feature, `everyone` when none is saved. */
export async function featureMode(ctx: QueryCtx, key: FeatureKey): Promise<FeatureMode> {
  return (await featureSwitchRow(ctx, key))?.mode ?? DEFAULT_FEATURE_MODE;
}

/** Whether `user` is on the owner's tester list (`appTesters`). False signed out. */
export async function isTester(ctx: QueryCtx, user: Doc<"users"> | null): Promise<boolean> {
  if (user === null) return false;
  const row = await ctx.db
    .query("appTesters")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .first();
  return row !== null;
}

/**
 * Resolves the caller's audience lazily: the owner and tester reads happen only when a mode needs them, and at most
 * once each.
 */
function audienceFor(ctx: QueryCtx, user: Doc<"users"> | null) {
  let owner: Promise<boolean> | undefined;
  let tester: Promise<boolean> | undefined;
  return async (mode: FeatureMode): Promise<boolean> => {
    const who: FeatureAudience = { isOwner: false, isTester: false };
    if (mode === "owner" || mode === "testers") {
      owner ??= isAppOwner(ctx, user);
      who.isOwner = await owner;
    }
    if (mode === "testers" && !who.isOwner) {
      tester ??= isTester(ctx, user);
      who.isTester = await tester;
    }
    return modeAllows(mode, who);
  };
}

/**
 * Whether `key` is on for `user` (the wrapper's `ctx.user`, from `ctx.auth`; null signed out). The only server check.
 */
export async function featureOn(ctx: QueryCtx, user: Doc<"users"> | null, key: FeatureKey): Promise<boolean> {
  if (featureInfo(key).inert) return true;
  return audienceFor(ctx, user)(await featureMode(ctx, key));
}

/** `featureOn`, or `FEATURE_OFF`. */
export async function requireFeature(ctx: QueryCtx, user: Doc<"users"> | null, key: FeatureKey): Promise<void> {
  if (!(await featureOn(ctx, user, key))) throw appError("FEATURE_OFF");
}

/** Every feature's on / off for `user` (one indexed read per feature, plus the owner / tester reads when needed). */
export async function featuresFor(ctx: QueryCtx, user: Doc<"users"> | null): Promise<FeatureFlags> {
  const allows = audienceFor(ctx, user);
  const flags = {} as FeatureFlags;
  for (const key of FEATURE_KEYS) {
    flags[key] = featureInfo(key).inert ? true : await allows(await featureMode(ctx, key));
  }
  return flags;
}
