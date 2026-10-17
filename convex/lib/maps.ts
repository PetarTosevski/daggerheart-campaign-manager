import { ConvexError } from "convex/values";

import { checkMapState, initialMapState, mapStateSchema, type MapState } from "../../src/lib/world/map-state";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** The campaign's map state (initial state if never saved). Throws MAP_CORRUPT on bad data. */
export async function readMap(ctx: QueryCtx, campaign: Doc<"campaigns">): Promise<MapState> {
  const row = await ctx.db
    .query("maps")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
    .unique();
  if (!row) return initialMapState(campaign.frameId);
  const parsed = mapStateSchema.safeParse(row.data);
  if (!parsed.success) throw new ConvexError("MAP_CORRUPT");
  return parsed.data;
}

/** Validates and stores the campaign's map state. */
export async function writeMap(ctx: MutationCtx, campaignId: Id<"campaigns">, state: MapState): Promise<void> {
  const parsed = checkMapState(state);
  if (!parsed.ok) throw new ConvexError({ code: "INVALID", message: parsed.message });
  const row = await ctx.db
    .query("maps")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .unique();
  if (row) await ctx.db.patch(row._id, { data: parsed.data, updatedAt: Date.now() });
  else await ctx.db.insert("maps", { campaignId, data: parsed.data, updatedAt: Date.now() });
}
