import { ConvexError } from "convex/values";

import { MAX_MAP_JSON, initialMapState, mapStateSchema, type MapState } from "../../src/lib/world/map-state";
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
  const parsed = mapStateSchema.safeParse(state);
  if (!parsed.success) throw new ConvexError({ code: "INVALID", message: parsed.error.issues[0]?.message ?? "Invalid map." });
  if (JSON.stringify(parsed.data).length > MAX_MAP_JSON) {
    throw new ConvexError({ code: "INVALID", message: "The map is too large. Shorten some notes or remove markers." });
  }
  const row = await ctx.db
    .query("maps")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .unique();
  if (row) await ctx.db.patch(row._id, { data: parsed.data, updatedAt: Date.now() });
  else await ctx.db.insert("maps", { campaignId, data: parsed.data, updatedAt: Date.now() });
}

/** URL of an uploaded map recorded for this campaign, or null (bad id, someone else's file, or gone). */
export async function mapUploadUrl(ctx: QueryCtx, campaignId: Id<"campaigns">, storageId: string): Promise<string | null> {
  const id = ctx.db.system.normalizeId("_storage", storageId);
  if (id === null) return null;
  const row = await ctx.db
    .query("mapUploads")
    .withIndex("by_storage", (q) => q.eq("storageId", id))
    .unique();
  if (row === null || row.campaignId !== campaignId) return null;
  return ctx.storage.getUrl(id).catch(() => null);
}

/** Deletes an uploaded map file, only when it was recorded as this campaign's upload. */
export async function deleteOwnMapUpload(ctx: MutationCtx, campaignId: Id<"campaigns">, storageId: string): Promise<void> {
  const id = ctx.db.system.normalizeId("_storage", storageId);
  if (id === null) return;
  const row = await ctx.db
    .query("mapUploads")
    .withIndex("by_storage", (q) => q.eq("storageId", id))
    .unique();
  if (row === null || row.campaignId !== campaignId) return;
  await ctx.db.delete(row._id);
  await ctx.storage.delete(id).catch(() => undefined);
}
