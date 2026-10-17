import { ConvexError, v } from "convex/values";

import {
  campaignNameKey,
  createCampaignSchema,
  startingLevel,
} from "../src/lib/validation/campaigns";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireGm } from "./lib/auth";
import { ownerScope, withIdempotency } from "./lib/operations";
import { customFrameValidator, frameIdValidator } from "./schema";

/** Loads a campaign the GM owns, or throws `NOT_FOUND` (also for other owners). */
export async function loadOwnedCampaign(
  ctx: QueryCtx,
  ownerId: Id<"users">,
  campaignId: Id<"campaigns">,
  { includeDeleted = false } = {},
): Promise<Doc<"campaigns">> {
  const campaign = await ctx.db.get(campaignId);
  if (
    campaign === null ||
    campaign.ownerId !== ownerId ||
    (!includeDeleted && campaign.deletedAt !== undefined)
  ) {
    throw new ConvexError("NOT_FOUND");
  }
  return campaign;
}

async function summarise(ctx: QueryCtx, campaign: Doc<"campaigns">) {
  const state = await ctx.db
    .query("campaignState")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
    .unique();
  return {
    _id: campaign._id,
    frameId: campaign.frameId,
    name: campaign.name,
    tier: campaign.tier,
    level: campaign.level,
    custom: campaign.custom ?? null,
    createdAt: campaign.createdAt,
    lastOpenedAt: campaign.lastOpenedAt,
    fear: state?.fear ?? 0,
  };
}

export type CampaignSummary = Awaited<ReturnType<typeof summarise>>;

/** The GM's campaigns, most recently opened first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireGm(ctx);
    const campaigns = await ctx.db
      .query("campaigns")
      .withIndex("by_owner_lastOpened", (q) => q.eq("ownerId", user._id))
      .order("desc")
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    return Promise.all(campaigns.map((c) => summarise(ctx, c)));
  },
});

/** One campaign by id (a raw URL segment), or null if it is unknown, deleted or not the GM's. */
export const get = query({
  args: { campaignId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireGm(ctx);
    const campaignId = ctx.db.normalizeId("campaigns", args.campaignId);
    if (campaignId === null) return null;
    const campaign = await ctx.db.get(campaignId);
    if (campaign === null || campaign.ownerId !== user._id || campaign.deletedAt !== undefined) {
      return null;
    }
    return summarise(ctx, campaign);
  },
});

export const create = mutation({
  args: {
    frameId: frameIdValidator,
    name: v.string(),
    custom: v.optional(customFrameValidator),
    idempotencyKey: v.string(),
  },
  handler: async (ctx, { idempotencyKey, ...raw }) => {
    const user = await requireGm(ctx);
    const parsed = createCampaignSchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConvexError({ code: "INVALID", message: parsed.error.issues[0]?.message });
    }
    const input = parsed.data;
    return withIdempotency(
      ctx,
      {
        scopeKey: ownerScope(user._id),
        key: idempotencyKey,
        kind: "campaign_create",
        request: input,
        createdBy: user._id,
      },
      async () => {
        const nameKey = campaignNameKey(input.name);
        const clash = await ctx.db
          .query("campaigns")
          .withIndex("by_owner_nameKey", (q) => q.eq("ownerId", user._id).eq("nameKey", nameKey))
          .filter((q) => q.eq(q.field("deletedAt"), undefined))
          .first();
        if (clash !== null) {
          throw new ConvexError({ code: "NAME_TAKEN", message: "You already have a campaign with that name." });
        }
        const tier = input.custom?.startingTier ?? 1;
        const now = Date.now();
        const campaignId = await ctx.db.insert("campaigns", {
          ownerId: user._id,
          frameId: input.frameId,
          name: input.name,
          nameKey,
          tier,
          level: startingLevel(tier),
          custom: input.custom,
          createdAt: now,
          lastOpenedAt: now,
        });
        await ctx.db.insert("campaignState", { campaignId, fear: 0 });
        return { campaignId };
      },
    );
  },
});

/** Marks the campaign as the most recently opened (drives "Continue"). */
export const markOpened = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireGm(ctx);
    await loadOwnedCampaign(ctx, user._id, campaignId);
    await ctx.db.patch(campaignId, { lastOpenedAt: Date.now() });
  },
});

/** Deletes a campaign from the GM's list. Recoverable with `restore`. */
export const remove = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireGm(ctx);
    await loadOwnedCampaign(ctx, user._id, campaignId);
    await ctx.db.patch(campaignId, { deletedAt: Date.now() });
  },
});

export const restore = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireGm(ctx);
    const campaign = await loadOwnedCampaign(ctx, user._id, campaignId, { includeDeleted: true });
    if (campaign.deletedAt === undefined) return;
    const clash = await ctx.db
      .query("campaigns")
      .withIndex("by_owner_nameKey", (q) => q.eq("ownerId", user._id).eq("nameKey", campaign.nameKey))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .first();
    if (clash !== null) {
      throw new ConvexError({ code: "NAME_TAKEN", message: "Another campaign now uses that name." });
    }
    await ctx.db.patch(campaignId, { deletedAt: undefined });
  },
});
