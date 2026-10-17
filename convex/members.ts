import { ConvexError, v } from "convex/values";
import { z } from "zod";

import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { loadCampaign, loadGmCampaign } from "./lib/access";
import { normalizeEmail } from "./lib/allowlist";
import { deleteInvites } from "./campaigns";
import { requireUser } from "./lib/auth";

// No 0/O/1/I/L so codes read clearly aloud and on paper.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

function newJoinCode(): string {
  // Rejection sampling keeps every character equally likely (256 % 31 ≠ 0).
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let code = "";
  const byte = new Uint8Array(1);
  while (code.length < CODE_LENGTH) {
    crypto.getRandomValues(byte);
    if (byte[0] < limit) code += CODE_ALPHABET[byte[0] % CODE_ALPHABET.length];
  }
  return code;
}

async function freshJoinCode(ctx: QueryCtx): Promise<string> {
  let code = newJoinCode();
  while (await ctx.db.query("campaigns").withIndex("by_joinCode", (q) => q.eq("joinCode", code)).first()) {
    code = newJoinCode();
  }
  return code;
}

export function normalizeJoinCode(code: string): string {
  return code.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

const emailSchema = z.email("Enter a valid email address.");

function displayName(user: Doc<"users"> | null): string {
  if (!user) return "Unknown player";
  return user.name?.trim() || user.email?.split("@")[0] || "Player";
}

async function members(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  const rows = await ctx.db
    .query("campaignMembers")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .collect();
  return Promise.all(
    rows.map(async (m) => {
      const user = await ctx.db.get(m.userId);
      return { userId: m.userId, name: displayName(user), email: user?.email ?? null, joinedAt: m.joinedAt };
    }),
  );
}

/** The table: the GM and the players, for everyone in the campaign. Emails only for the GM. */
export const roster = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireUser(ctx);
    const { campaign, role } = await loadCampaign(ctx, user, campaignId);
    const gm = await ctx.db.get(campaign.ownerId);
    const players = await members(ctx, campaignId);
    return {
      gm: { userId: campaign.ownerId, name: displayName(gm) },
      players: players.map((p) => (role === "gm" ? p : { ...p, email: null })),
    };
  },
});

/** GM view of who can join: pending email invites and the join code. */
export const access = query({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireUser(ctx);
    const campaign = await loadGmCampaign(ctx, user, campaignId);
    const invites = await ctx.db
      .query("campaignInvites")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
      .collect();
    return {
      joinCode: campaign.joinCode ?? null,
      invites: invites.map((i) => ({ _id: i._id, email: i.email, createdAt: i.createdAt })),
    };
  },
});

export const invite = mutation({
  args: { campaignId: v.id("campaigns"), email: v.string() },
  handler: async (ctx, { campaignId, email: raw }) => {
    const user = await requireUser(ctx);
    const campaign = await loadGmCampaign(ctx, user, campaignId);
    const parsed = emailSchema.safeParse(raw.trim());
    if (!parsed.success) throw new ConvexError({ code: "INVALID", message: parsed.error.issues[0]?.message });
    const email = normalizeEmail(parsed.data);
    if (email === normalizeEmail(user.email ?? "")) {
      throw new ConvexError({ code: "INVALID", message: "You're already the GM of this campaign." });
    }
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (existingUser) {
      const member = await ctx.db
        .query("campaignMembers")
        .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaign._id).eq("userId", existingUser._id))
        .unique();
      if (member) throw new ConvexError({ code: "INVALID", message: "That player is already in the campaign." });
    }
    const pending = await ctx.db
      .query("campaignInvites")
      .withIndex("by_campaign_email", (q) => q.eq("campaignId", campaignId).eq("email", email))
      .first();
    if (pending) return pending._id;
    return ctx.db.insert("campaignInvites", { campaignId, email, invitedBy: user._id, createdAt: Date.now() });
  },
});

export const revokeInvite = mutation({
  args: { inviteId: v.id("campaignInvites") },
  handler: async (ctx, { inviteId }) => {
    const user = await requireUser(ctx);
    const invite = await ctx.db.get(inviteId);
    if (invite === null) return;
    await loadGmCampaign(ctx, user, invite.campaignId);
    await ctx.db.delete(inviteId);
  },
});

async function removeAccess(ctx: MutationCtx, campaignId: Id<"campaigns">, userId: Id<"users">) {
  const member = await ctx.db
    .query("campaignMembers")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaignId).eq("userId", userId))
    .unique();
  if (member) await ctx.db.delete(member._id);
  // An invite would grant access again, so it goes too.
  const user = await ctx.db.get(userId);
  if (user?.email) {
    const invites = await ctx.db
      .query("campaignInvites")
      .withIndex("by_campaign_email", (q) => q.eq("campaignId", campaignId).eq("email", normalizeEmail(user.email!)))
      .collect();
    for (const i of invites) await ctx.db.delete(i._id);
  }
}

export const removePlayer = mutation({
  args: { campaignId: v.id("campaigns"), userId: v.id("users") },
  handler: async (ctx, { campaignId, userId }) => {
    const user = await requireUser(ctx);
    const campaign = await loadGmCampaign(ctx, user, campaignId);
    await removeAccess(ctx, campaignId, userId);
    // The removed player may still know the code; replace it.
    if (campaign.joinCode) await ctx.db.patch(campaignId, { joinCode: await freshJoinCode(ctx) });
  },
});

/** A player leaves a campaign. The GM cannot leave their own campaign (they delete it instead). */
export const leave = mutation({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, { campaignId }) => {
    const user = await requireUser(ctx);
    const { role } = await loadCampaign(ctx, user, campaignId);
    if (role === "gm") throw new ConvexError({ code: "INVALID", message: "The GM can't leave their own campaign." });
    await removeAccess(ctx, campaignId, user._id);
  },
});

/** Shows (creating on first use) or replaces the campaign's join code. GM only. */
export const rotateJoinCode = mutation({
  args: { campaignId: v.id("campaigns"), replace: v.optional(v.boolean()) },
  handler: async (ctx, { campaignId, replace }) => {
    const user = await requireUser(ctx);
    const campaign = await loadGmCampaign(ctx, user, campaignId);
    if (campaign.joinCode && !replace) return campaign.joinCode;
    const code = await freshJoinCode(ctx);
    await ctx.db.patch(campaignId, { joinCode: code });
    return code;
  },
});

/** Joins the campaign with this code as a player. Joining twice is harmless. */
export const joinByCode = mutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const user = await requireUser(ctx);
    const joinCode = normalizeJoinCode(code);
    const campaign = joinCode
      ? await ctx.db.query("campaigns").withIndex("by_joinCode", (q) => q.eq("joinCode", joinCode)).first()
      : null;
    if (campaign === null || campaign.deletedAt !== undefined) {
      throw new ConvexError({ code: "INVALID", message: "No campaign uses that code. Check it with your GM." });
    }
    if (campaign.ownerId === user._id) return { campaignId: campaign._id };
    const existing = await ctx.db
      .query("campaignMembers")
      .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaign._id).eq("userId", user._id))
      .unique();
    if (!existing) {
      const now = Date.now();
      await ctx.db.insert("campaignMembers", { campaignId: campaign._id, userId: user._id, joinedAt: now, lastOpenedAt: now });
      await deleteInvites(ctx, campaign._id, user);
    }
    return { campaignId: campaign._id };
  },
});
