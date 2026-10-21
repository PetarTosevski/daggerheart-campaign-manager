import { v } from "convex/values";

import { DEFAULT_ACCENT, settingsSchema } from "../src/lib/validation/campaigns";
import { parseSettingsBackup } from "../src/lib/validation/settings-backup";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { userMutation, userQuery } from "./lib/functions";

const DEFAULTS = { tableName: "", gmName: "", accent: DEFAULT_ACCENT };

const expansionsValidator = v.object({ hopeAndFear: v.optional(v.boolean()) });

const settingsView = v.object({
  tableName: v.string(),
  gmName: v.string(),
  accent: v.string(),
  /** Defaults for new campaigns; an unset key keeps each frame's own default. */
  expansions: expansionsValidator,
});

export const settingsRow = (ctx: QueryCtx, user: Doc<"users">) =>
  ctx.db
    .query("settings")
    .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
    .unique();

/** The user's app settings (table name, GM name, accent colour, expansion defaults). */
export const get = userQuery({
  args: {},
  returns: settingsView,
  handler: async (ctx) => {
    const row = await settingsRow(ctx, ctx.user);
    if (row === null) return { ...DEFAULTS, expansions: {} };
    return { tableName: row.tableName, gmName: row.gmName, accent: row.accent, expansions: row.expansions ?? {} };
  },
});

export const update = userMutation({
  args: {
    tableName: v.optional(v.string()),
    gmName: v.optional(v.string()),
    accent: v.optional(v.string()),
    /** `null` clears the key: new campaigns go back to each frame's own default. */
    expansions: v.optional(v.object({ hopeAndFear: v.union(v.boolean(), v.null()) })),
  },
  returns: v.null(),
  handler: async (ctx, { expansions, ...patch }) => {
    const row = await settingsRow(ctx, ctx.user);
    const current = row ? { tableName: row.tableName, gmName: row.gmName, accent: row.accent } : DEFAULTS;
    const settings = {
      ...settingsSchema.parse({ ...current, ...patch }),
      ...(expansions
        ? { expansions: expansions.hopeAndFear === null ? {} : { hopeAndFear: expansions.hopeAndFear } }
        : {}),
    };
    if (row === null) {
      await ctx.db.insert("settings", { ownerId: ctx.user._id, ...settings });
    } else {
      await ctx.db.patch("settings", row._id, settings);
    }
    return null;
  },
});

/**
 * Restores a pasted settings backup (TitleMenu "Saved data", D12 H17). The text is parsed here, not trusted from the
 * client: `parseSettingsBackup` checks the backup format, dispatches on `schemaVersion` and refuses unknown fields, and
 * its `ZodError` becomes `INVALID`. A refused backup changes nothing. The backup replaces every setting.
 */
export const restore = userMutation({
  args: { text: v.string() },
  returns: v.null(),
  handler: async (ctx, { text }) => {
    const { expansions, ...rest } = parseSettingsBackup(text);
    const settings = {
      ...rest,
      expansions: expansions.hopeAndFear === undefined ? {} : { hopeAndFear: expansions.hopeAndFear },
    };
    const row = await settingsRow(ctx, ctx.user);
    if (row === null) {
      await ctx.db.insert("settings", { ownerId: ctx.user._id, ...settings });
    } else {
      await ctx.db.patch("settings", row._id, settings);
    }
    return null;
  },
});

/** "Reset settings…": deletes the caller's settings row, so `get` returns the defaults again. Campaigns are untouched. */
export const reset = userMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const row = await settingsRow(ctx, ctx.user);
    if (row !== null) await ctx.db.delete("settings", row._id);
    return null;
  },
});
