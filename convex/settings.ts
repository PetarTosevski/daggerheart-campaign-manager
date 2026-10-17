import { v } from "convex/values";

import { DEFAULT_ACCENT, settingsSchema } from "../src/lib/validation/campaigns";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { userMutation, userQuery } from "./lib/functions";

const DEFAULTS = { tableName: "", gmName: "", accent: DEFAULT_ACCENT };

const settingsView = v.object({ tableName: v.string(), gmName: v.string(), accent: v.string() });

const settingsRow = (ctx: QueryCtx, user: Doc<"users">) =>
  ctx.db
    .query("settings")
    .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
    .unique();

/** The user's app settings (table name, GM name, accent colour). */
export const get = userQuery({
  args: {},
  returns: settingsView,
  handler: async (ctx) => {
    const row = await settingsRow(ctx, ctx.user);
    if (row === null) return DEFAULTS;
    return { tableName: row.tableName, gmName: row.gmName, accent: row.accent };
  },
});

export const update = userMutation({
  args: {
    tableName: v.optional(v.string()),
    gmName: v.optional(v.string()),
    accent: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, patch) => {
    const row = await settingsRow(ctx, ctx.user);
    const current = row ? { tableName: row.tableName, gmName: row.gmName, accent: row.accent } : DEFAULTS;
    const settings = settingsSchema.parse({ ...current, ...patch });
    if (row === null) {
      await ctx.db.insert("settings", { ownerId: ctx.user._id, ...settings });
    } else {
      await ctx.db.patch("settings", row._id, settings);
    }
    return null;
  },
});
