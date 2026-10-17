import { ConvexError, v } from "convex/values";

import { DEFAULT_ACCENT, settingsSchema } from "../src/lib/validation/campaigns";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./lib/auth";

const DEFAULTS = { tableName: "", gmName: "", accent: DEFAULT_ACCENT };

/** The GM's app settings (table name, GM name, accent colour). */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .unique();
    if (row === null) return DEFAULTS;
    return { tableName: row.tableName, gmName: row.gmName, accent: row.accent };
  },
});

export const update = mutation({
  args: {
    tableName: v.optional(v.string()),
    gmName: v.optional(v.string()),
    accent: v.optional(v.string()),
  },
  handler: async (ctx, patch) => {
    const user = await requireUser(ctx);
    const row = await ctx.db
      .query("settings")
      .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
      .unique();
    const current = row
      ? { tableName: row.tableName, gmName: row.gmName, accent: row.accent }
      : DEFAULTS;
    const parsed = settingsSchema.safeParse({ ...current, ...patch });
    if (!parsed.success) {
      throw new ConvexError({ code: "INVALID", message: parsed.error.issues[0]?.message });
    }
    if (row === null) {
      await ctx.db.insert("settings", { ownerId: user._id, ...parsed.data });
    } else {
      await ctx.db.patch(row._id, parsed.data);
    }
  },
});
