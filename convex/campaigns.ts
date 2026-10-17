import { ConvexError, v } from "convex/values";

import {
  campaignNameKey,
  createCampaignSchema,
  startingLevel,
} from "../src/lib/validation/campaigns";
import { frameHasMechanic } from "../src/lib/frames/index";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { campaignRole, loadCampaign, loadGmCampaign, type Role } from "./lib/access";
import { normalizeEmail } from "./lib/allowlist";
import { requireUser } from "./lib/auth";
import { ownerScope, withIdempotency } from "./lib/operations";
import { customFrameValidator, frameIdValidator } from "./schema";

async function summarise(ctx: QueryCtx, campaign: Doc<"campaigns">, role: Role, lastOpenedAt: number) {
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
    /** When this user last opened it (the GM's own time for GMs). */
    lastOpenedAt,
    fear: state?.fear ?? 0,
    role,
  };
}

export type CampaignSummary = Awaited<ReturnType<typeof summarise>>;

/** Campaigns the user runs (GM) or plays in (member or invited), most recently opened first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const owned = await ctx.db
      .query("campaigns")
      .withIndex("by_owner_lastOpened", (q) => q.eq("ownerId", user._id))
      .filter((q) => q.eq(q.field("deletedAt"), undefined))
      .collect();
    const rows: { campaign: Doc<"campaigns">; role: Role; lastOpenedAt: number }[] = owned.map((c) => ({
      campaign: c,
      role: "gm",
      lastOpenedAt: c.lastOpenedAt,
    }));
    const seen = new Set(owned.map((c) => c._id));
    const memberships = await ctx.db
      .query("campaignMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const m of memberships) {
      const c = await ctx.db.get(m.campaignId);
      if (c && c.deletedAt === undefined && !seen.has(c._id)) {
        rows.push({ campaign: c, role: "player", lastOpenedAt: m.lastOpenedAt });
        seen.add(c._id);
      }
    }
    if (user.email) {
      const invites = await ctx.db
        .query("campaignInvites")
        .withIndex("by_email", (q) => q.eq("email", normalizeEmail(user.email!)))
        .collect();
      for (const i of invites) {
        const c = await ctx.db.get(i.campaignId);
        if (c && c.deletedAt === undefined && !seen.has(c._id)) {
          rows.push({ campaign: c, role: "player", lastOpenedAt: i.createdAt });
          seen.add(c._id);
        }
      }
    }
    rows.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    return Promise.all(rows.map((r) => summarise(ctx, r.campaign, r.role, r.lastOpenedAt)));
  },
});

/** Removes the user's email invites to a campaign once they are a member. */
export async function deleteInvites(ctx: MutationCtx, campaignId: Id<"campaigns">, user: Doc<"users">) {
  if (!user.email) return;
  const invites = await ctx.db
    .query("campaignInvites")
    .withIndex("by_campaign_email", (q) => q.eq("campaignId", campaignId).eq("email", normalizeEmail(user.email!)))
    .collect();
  for (const invite of invites) await ctx.db.delete(invite._id);
}

/** One campaign by id (a raw URL segment), or null if it is unknown, deleted or not visible to the user. */
export const get = query({
  args: { campaignId: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const campaignId = ctx.db.normalizeId("campaigns", args.campaignId);
    if (campaignId === null) return null;
    const campaign = await ctx.db.get(campaignId);
    if (campaign === null || campaign.deletedAt !== undefined) return null;
    const role = await campaignRole(ctx, user, campaign);
    if (role === null) return null;
    let lastOpenedAt = campaign.lastOpenedAt;
    if (role === "player") {
      const member = await ctx.db
        .query("campaignMembers")
        .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaign._id).eq("userId", user._id))
        .unique();
      lastOpenedAt = member?.lastOpenedAt ?? campaign.createdAt;
    }
    return summarise(ctx, campaign, role, lastOpenedAt);
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
    const user = await requireUser(ctx);
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
        if (frameHasMechanic(input.frameId, "campaignTime")) {
          await ctx.db.insert("campaignTime", { campaignId, week: 1, cycle: "DAY", cycleDay: 1 });
        }
        return { campaignId };
      },
    );
  },
});

/**
 * Marks the campaign as the user's most recently opened (drives "Continue").
 * For an invited player, opening the campaign accepts the invite: it becomes
 * a member row.
 */
export const markOpened = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireUser(ctx);
    const { role } = await loadCampaign(ctx, user, campaignId);
    const now = Date.now();
    if (role === "gm") {
      await ctx.db.patch(campaignId, { lastOpenedAt: now });
      return;
    }
    const member = await ctx.db
      .query("campaignMembers")
      .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaignId).eq("userId", user._id))
      .unique();
    if (member) {
      await ctx.db.patch(member._id, { lastOpenedAt: now });
    } else {
      await ctx.db.insert("campaignMembers", { campaignId, userId: user._id, joinedAt: now, lastOpenedAt: now });
      await deleteInvites(ctx, campaignId, user);
    }
  },
});

/** Deletes a campaign (GM only). Recoverable with `restore`. */
export const remove = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireUser(ctx);
    await loadGmCampaign(ctx, user, campaignId);
    await ctx.db.patch(campaignId, { deletedAt: Date.now() });
  },
});

export const restore = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireUser(ctx);
    const campaign = await loadGmCampaign(ctx, user, campaignId, { includeDeleted: true });
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
