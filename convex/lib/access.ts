import { ConvexError } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { permissionFor } from "./permissions";

/**
 * DEPRECATED shim over `permissionFor` (lib/permissions.ts) for modules not
 * yet on the wrappers in lib/functions.ts; H17 deletes this file. The role is
 * derived from the permission: owner is the GM, anything weaker a player.
 */

export { campaignRole, inviteEmail, type Role } from "./permissions";

/**
 * Loads a live campaign the user can see and their role in it. Without access
 * it throws `NOT_FOUND` (never revealing that the campaign exists); when
 * `gmOnly` is set, anyone short of owner gets `FORBIDDEN`.
 */
export async function loadCampaign(
  ctx: QueryCtx,
  user: Doc<"users">,
  campaignId: Id<"campaigns">,
  { gmOnly = false, includeDeleted = false } = {},
): Promise<{ campaign: Doc<"campaigns">; role: "gm" | "player" }> {
  const campaign = await ctx.db.get("campaigns", campaignId);
  if (campaign === null || (!includeDeleted && campaign.deletedAt !== undefined)) {
    throw new ConvexError("NOT_FOUND");
  }
  const permission = await permissionFor(ctx, user, { type: "campaign", campaign }, "owner");
  const role = permission === "owner" ? "gm" : permission === null ? null : "player";
  if (role === null || (campaign.deletedAt !== undefined && role !== "gm")) {
    throw new ConvexError("NOT_FOUND");
  }
  if (gmOnly && role !== "gm") throw new ConvexError("FORBIDDEN");
  return { campaign, role };
}

/** Shorthand for GM-only functions. */
export async function loadGmCampaign(ctx: QueryCtx, user: Doc<"users">, campaignId: Id<"campaigns">, opts = {}) {
  return (await loadCampaign(ctx, user, campaignId, { ...opts, gmOnly: true })).campaign;
}
