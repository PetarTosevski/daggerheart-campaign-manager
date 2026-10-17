import { ConvexError } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { normalizeEmail } from "./allowlist";

/** A user's role in a campaign: its creator is the GM; members and invitees are players. */
export type Role = "gm" | "player";

/**
 * The normalized email an invite may match, or null. Password sign-ups never
 * verify their address, so only a verified email (Google, e2e) counts;
 * otherwise anyone could register an invited address and join.
 */
export function inviteEmail(user: Doc<"users">): string | null {
  return user.email && user.emailVerificationTime !== undefined ? normalizeEmail(user.email) : null;
}

export async function campaignRole(
  ctx: QueryCtx,
  user: Doc<"users">,
  campaign: Doc<"campaigns">,
): Promise<Role | null> {
  if (campaign.ownerId === user._id) return "gm";
  const member = await ctx.db
    .query("campaignMembers")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaign._id).eq("userId", user._id))
    .unique();
  if (member !== null) return "player";
  const email = inviteEmail(user);
  if (email !== null) {
    const invite = await ctx.db
      .query("campaignInvites")
      .withIndex("by_campaign_email", (q) => q.eq("campaignId", campaign._id).eq("email", email))
      .first();
    if (invite !== null) return "player";
  }
  return null;
}

/**
 * Loads a live campaign the user can see and their role in it. Without access
 * it throws `NOT_FOUND` (never revealing that the campaign exists); when
 * `gmOnly` is set, a player gets `FORBIDDEN`.
 */
export async function loadCampaign(
  ctx: QueryCtx,
  user: Doc<"users">,
  campaignId: Id<"campaigns">,
  { gmOnly = false, includeDeleted = false } = {},
): Promise<{ campaign: Doc<"campaigns">; role: Role }> {
  const campaign = await ctx.db.get(campaignId);
  if (campaign === null || (!includeDeleted && campaign.deletedAt !== undefined)) {
    throw new ConvexError("NOT_FOUND");
  }
  const role = await campaignRole(ctx, user, campaign);
  if (role === null || (includeDeleted && campaign.deletedAt !== undefined && role !== "gm")) {
    throw new ConvexError("NOT_FOUND");
  }
  if (gmOnly && role !== "gm") throw new ConvexError("FORBIDDEN");
  return { campaign, role };
}

/** Shorthand for GM-only functions. */
export async function loadGmCampaign(ctx: QueryCtx, user: Doc<"users">, campaignId: Id<"campaigns">, opts = {}) {
  return (await loadCampaign(ctx, user, campaignId, { ...opts, gmOnly: true })).campaign;
}
