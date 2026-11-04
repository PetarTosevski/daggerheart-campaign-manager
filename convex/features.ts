import { v } from "convex/values";

import { DEFAULT_FEATURE_MODE, FEATURES } from "../src/lib/admin/features";
import { recordAdminChange } from "./lib/adminAudit";
import { featureFlagsValidator, featureKeyValidator, featureSwitchRow, featuresFor } from "./lib/features";
import { appOwnerMutation, appOwnerQuery, maybeUserQuery } from "./lib/functions";
import { featureModeValidator } from "./lib/validators/admin";

/**
 * Feature switches (config AD9, Q25 b; docs/tasks/TASK-CONFIG-AD9.md). The owner sets each feature to Off / Only me /
 * Testers / Everyone (`list`, `setMode`: owner only, FORBIDDEN for anyone else); every client reads which features
 * are on for itself (`mine`). Server code asks `featureOn` (`convex/lib/features.ts`).
 */

/**
 * Which features are on for the caller: one boolean per feature, for the caller alone. Signed out = only the
 * features switched to Everyone. Never reveals a mode, the tester list, the owner or anyone else.
 */
export const mine = maybeUserQuery({
  args: {},
  returns: featureFlagsValidator,
  handler: async (ctx) => featuresFor(ctx, ctx.user),
});

/** Every feature's saved mode and when it last changed (null = never saved, so Everyone), in the board's order. */
export const list = appOwnerQuery({
  args: {},
  returns: v.array(
    v.object({
      key: featureKeyValidator,
      mode: featureModeValidator,
      changedAt: v.union(v.null(), v.number()),
    }),
  ),
  handler: async (ctx) => {
    const rows = [];
    for (const { key } of FEATURES) {
      const row = await featureSwitchRow(ctx, key);
      rows.push({ key, mode: row?.mode ?? DEFAULT_FEATURE_MODE, changedAt: row?.changedAt ?? null });
    }
    return rows;
  },
});

/** Sets one feature's mode (a single-field intent). Audited as `feature.set`; choosing the current mode changes nothing. */
export const setMode = appOwnerMutation({
  args: { key: featureKeyValidator, mode: featureModeValidator },
  returns: v.null(),
  handler: async (ctx, { key, mode }) => {
    const row = await featureSwitchRow(ctx, key);
    if (row !== null && row.mode === mode) return null;
    const from = row?.mode ?? DEFAULT_FEATURE_MODE;
    const now = Date.now();
    if (row === null) await ctx.db.insert("featureSwitches", { key, mode, changedAt: now, changedBy: ctx.user._id });
    else await ctx.db.patch("featureSwitches", row._id, { mode, changedAt: now, changedBy: ctx.user._id });
    await recordAdminChange(ctx, ctx.user._id, { action: "feature.set", field: key, from, to: mode });
    return null;
  },
});
