import { v } from "convex/values";

import { DEFAULT_ACCENT, settingsSchema } from "../src/lib/validation/campaigns";
import { parseSettingsBackup } from "../src/lib/validation/settings-backup";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { userMutation, userQuery } from "./lib/functions";
import { mapStyleValidator, type MapStyle } from "./lib/validators/combatMaps";

const DEFAULTS = { tableName: "", gmName: "", accent: DEFAULT_ACCENT };

/**
 * dcm-bxp.89 added the Settings slider; dcm-bxp.135 (user 2026-10-22) made Sprites the default: a GM who never chose
 * (no stored field) gets Sprites for new maps. Existing maps keep their stored style.
 */
export const DEFAULT_MAP_STYLE: MapStyle = "sprites";

const expansionsValidator = v.object({ hopeAndFear: v.optional(v.boolean()) });

const settingsView = v.object({
  tableName: v.string(),
  gmName: v.string(),
  accent: v.string(),
  /** Defaults for new campaigns; an unset key keeps each frame's own default. */
  expansions: expansionsValidator,
  /** The style new blank maps get (dcm-bxp.89); Sprites unless the GM picked Classic (dcm-bxp.135). */
  defaultMapStyle: mapStyleValidator,
});

export const settingsRow = (ctx: QueryCtx, user: Doc<"users">) =>
  ctx.db
    .query("settings")
    .withIndex("by_owner", (q) => q.eq("ownerId", user._id))
    .unique();

/**
 * The style a new blank map of this GM gets (dcm-bxp.89): their Settings slider, else Sprites (dcm-bxp.135). Read by
 * `combatMaps.create` only; existing maps keep their stored style (sprite packs E3).
 */
export async function defaultMapStyleOf(ctx: QueryCtx, user: Doc<"users">): Promise<MapStyle> {
  return (await settingsRow(ctx, user))?.defaultMapStyle ?? DEFAULT_MAP_STYLE;
}

/** The user's app settings (table name, GM name, accent colour, expansion defaults, default map style). */
export const get = userQuery({
  args: {},
  returns: settingsView,
  handler: async (ctx) => {
    const row = await settingsRow(ctx, ctx.user);
    if (row === null) return { ...DEFAULTS, expansions: {}, defaultMapStyle: DEFAULT_MAP_STYLE };
    return {
      tableName: row.tableName,
      gmName: row.gmName,
      accent: row.accent,
      expansions: row.expansions ?? {},
      defaultMapStyle: row.defaultMapStyle ?? DEFAULT_MAP_STYLE,
    };
  },
});

export const update = userMutation({
  args: {
    tableName: v.optional(v.string()),
    gmName: v.optional(v.string()),
    accent: v.optional(v.string()),
    /** `null` clears the key: new campaigns go back to each frame's own default. */
    expansions: v.optional(v.object({ hopeAndFear: v.union(v.boolean(), v.null()) })),
    /** The style new blank maps get (dcm-bxp.89, the Settings slider). */
    defaultMapStyle: v.optional(mapStyleValidator),
  },
  returns: v.null(),
  handler: async (ctx, { expansions, defaultMapStyle, ...patch }) => {
    const row = await settingsRow(ctx, ctx.user);
    const current = row ? { tableName: row.tableName, gmName: row.gmName, accent: row.accent } : DEFAULTS;
    const settings = {
      ...settingsSchema.parse({ ...current, ...patch }),
      ...(expansions
        ? { expansions: expansions.hopeAndFear === null ? {} : { hopeAndFear: expansions.hopeAndFear } }
        : {}),
      ...(defaultMapStyle === undefined ? {} : { defaultMapStyle }),
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
 * its `ZodError` becomes `INVALID`. A refused backup changes nothing. The backup replaces every setting: a backup made
 * before the default map style existed puts it back to the default, Sprites (dcm-bxp.135).
 */
export const restore = userMutation({
  args: { text: v.string() },
  returns: v.null(),
  handler: async (ctx, { text }) => {
    const { expansions, defaultMapStyle, ...rest } = parseSettingsBackup(text);
    const settings = {
      ...rest,
      expansions: expansions.hopeAndFear === undefined ? {} : { hopeAndFear: expansions.hopeAndFear },
    };
    const row = await settingsRow(ctx, ctx.user);
    if (row === null) {
      await ctx.db.insert("settings", { ownerId: ctx.user._id, ...settings, ...(defaultMapStyle === undefined ? {} : { defaultMapStyle }) });
    } else {
      // `undefined` removes the stored field (back to the default, Sprites).
      await ctx.db.patch("settings", row._id, { ...settings, defaultMapStyle });
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
