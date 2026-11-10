import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { MapStyle } from "./validators/combatMaps";

// The user's settings row and the default map style, read by convex/settings.ts, campaigns and combatMaps (dcm-uh6r:
// light, so those modules no longer load the settings module's schemas).

/**
 * dcm-bxp.89 added the Settings slider; dcm-bxp.135 (user 2026-10-22) made Sprites the default: a GM who never chose
 * (no stored field) gets Sprites for new maps. Existing maps keep their stored style.
 */
export const DEFAULT_MAP_STYLE: MapStyle = "sprites";

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
