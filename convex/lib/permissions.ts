import { ConvexError } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeEmail } from "./allowlist";

/**
 * The single authorization model (CF2). `permissionFor` decides every access:
 * the campaign wrappers in `lib/functions.ts` call it through `campaignAccess`,
 * and `lib/access.ts` is a shim over it until H17 removes that file.
 */

export type Permission = Doc<"grants">["permission"];

/** A user's role in a campaign: its creator is the GM; members and invitees are players. */
export type Role = "gm" | "player";

/** Something a permission applies to, with the campaign it lives in. */
export type Resource =
  | { type: "campaign"; campaign: Doc<"campaigns"> }
  | { type: "map"; campaign: Doc<"campaigns"> }
  | { type: "codexEntry"; campaign: Doc<"campaigns">; entry: Doc<"codexEntries"> }
  | { type: "character"; campaign: Doc<"campaigns">; character: Doc<"characters"> };

const RANK: Record<Permission, number> = { view: 1, edit: 2, owner: 3 };

/** Whether `permission` includes `need` (owner ⊃ edit ⊃ view). */
export function atLeast(permission: Permission | null, need: Permission): boolean {
  return permission !== null && RANK[permission] >= RANK[need];
}

function stronger(a: Permission | null, b: Permission | null): Permission | null {
  if (a === null) return b;
  if (b === null) return a;
  return RANK[a] >= RANK[b] ? a : b;
}

/**
 * The normalized email an invite may match, or null. Password sign-ups never
 * verify their address, so only a verified email (Google, e2e) counts;
 * otherwise anyone could register an invited address and join.
 */
export function inviteEmail(user: Doc<"users">): string | null {
  return user.email && user.emailVerificationTime !== undefined ? normalizeEmail(user.email) : null;
}

/**
 * The role half of `permissionFor`: no read for the GM, then at most two point
 * reads (membership, then invite). Call `permissionFor`, which also counts
 * grants; this stays exported only for `campaigns.list`/`get` until they move
 * onto the wrappers.
 */
export async function campaignRole(ctx: QueryCtx, user: Doc<"users">, campaign: Doc<"campaigns">): Promise<Role | null> {
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
 * Today's rules: the campaign's GM owns everything in it; a player (member or
 * invitee) views it and edits their own character.
 */
export function rolePermission(role: Role | null, resource: Resource, userId: Id<"users">): Permission | null {
  if (role === "gm") return "owner";
  if (role === "player") return resource.type === "character" && resource.character.ownerId === userId ? "edit" : "view";
  return null;
}

function resourceId(resource: Resource): string {
  if (resource.type === "codexEntry") return resource.entry._id;
  if (resource.type === "character") return resource.character._id;
  return resource.campaign._id;
}

/**
 * Whether the user acts for a campaign principal: they run it (and it is
 * live) or are a member of it. One or two point reads.
 */
async function actsFor(ctx: QueryCtx, user: Doc<"users">, principalId: string): Promise<boolean> {
  const campaignId = ctx.db.normalizeId("campaigns", principalId);
  if (campaignId === null) return false;
  const campaign = await ctx.db.get("campaigns", campaignId);
  if (campaign === null || campaign.deletedAt !== undefined) return false;
  if (campaign.ownerId === user._id) return true;
  const member = await ctx.db
    .query("campaignMembers")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaignId).eq("userId", user._id))
    .unique();
  return member !== null;
}

/**
 * The user's permission on a resource: the strongest of the role-derived one
 * (`rolePermission`) and any grant to the user, or to a campaign they run or
 * belong to, on the resource or on the campaign it lives in.
 *
 * The result is exact up to `need`: it returns as soon as `need` is reached,
 * so a GM costs no grant reads and a player asking for `view` only the
 * membership read. Otherwise, per target (the resource, then its campaign):
 * one `by_resource_principal` point lookup for a grant to the user, then the
 * target's grants to campaigns (a short range of the same index), each checked
 * with point reads of that campaign. It never reads all of the caller's
 * campaigns or memberships.
 */
export async function permissionFor(ctx: QueryCtx, user: Doc<"users">, resource: Resource, need: Permission = "owner"): Promise<Permission | null> {
  let best = rolePermission(await campaignRole(ctx, user, resource.campaign), resource, user._id);
  if (atLeast(best, need)) return best;
  const targets: { type: Resource["type"]; id: string }[] = [{ type: resource.type, id: resourceId(resource) }];
  if (resource.type !== "campaign") targets.push({ type: "campaign", id: resource.campaign._id });
  for (const target of targets) {
    const own = await ctx.db
      .query("grants")
      .withIndex("by_resource_principal", (q) =>
        q.eq("resourceType", target.type).eq("resourceId", target.id).eq("principalKind", "user").eq("principalId", user._id),
      )
      .unique();
    best = stronger(best, own?.permission ?? null);
    if (atLeast(best, need)) return best;
    // Grants from one resource to campaigns are a handful, so the range is small.
    const toCampaigns = await ctx.db
      .query("grants")
      .withIndex("by_resource_principal", (q) =>
        q.eq("resourceType", target.type).eq("resourceId", target.id).eq("principalKind", "campaign"),
      )
      .collect();
    for (const grant of toCampaigns) {
      if (atLeast(best, grant.permission) || !(await actsFor(ctx, user, grant.principalId))) continue;
      best = grant.permission;
      if (atLeast(best, need)) return best;
    }
  }
  return best;
}

/**
 * A live campaign and the user's permission on it (exact up to `enough`), or
 * null when it is missing, deleted, or the user has no access at all. The
 * campaign wrappers throw on null; `maybeUserQuery` handlers return null.
 */
export async function campaignAccess(
  ctx: QueryCtx,
  user: Doc<"users">,
  campaignId: Id<"campaigns">,
  enough: Permission = "view",
): Promise<{ campaign: Doc<"campaigns">; permission: Permission } | null> {
  const campaign = await ctx.db.get("campaigns", campaignId);
  if (campaign === null || campaign.deletedAt !== undefined) return null;
  const permission = await permissionFor(ctx, user, { type: "campaign", campaign }, enough);
  return permission === null ? null : { campaign, permission };
}

/**
 * `permissionFor`, requiring `need`: NOT_FOUND without any access (never
 * revealing the resource), FORBIDDEN when too weak. The result is exact up to
 * `enough` (pass "edit" when the caller also tells view from edit).
 * Legacy string payloads, for modules not yet on the wrappers.
 */
export async function requirePermission(ctx: QueryCtx, user: Doc<"users">, resource: Resource, need: Permission, enough: Permission = need): Promise<Permission> {
  const permission = await permissionFor(ctx, user, resource, enough);
  if (permission === null) throw new ConvexError("NOT_FOUND");
  if (!atLeast(permission, need)) throw new ConvexError("FORBIDDEN");
  return permission;
}

/** A live (not deleted) campaign, or NOT_FOUND. Access is checked separately (`requirePermission`). */
export async function liveCampaign(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"campaigns">> {
  const campaign = await ctx.db.get("campaigns", campaignId);
  if (campaign === null || campaign.deletedAt !== undefined) throw new ConvexError("NOT_FOUND");
  return campaign;
}

/** Sets a principal's permission on a resource: one row per (resource, principal); a new grant replaces the old one. */
export async function upsertGrant(
  ctx: MutationCtx,
  grant: Pick<Doc<"grants">, "resourceType" | "resourceId" | "principalKind" | "principalId" | "permission" | "createdBy">,
): Promise<Id<"grants">> {
  const existing = await ctx.db
    .query("grants")
    .withIndex("by_resource_principal", (q) =>
      q.eq("resourceType", grant.resourceType).eq("resourceId", grant.resourceId).eq("principalKind", grant.principalKind).eq("principalId", grant.principalId),
    )
    .unique();
  if (existing) {
    await ctx.db.patch("grants", existing._id, { permission: grant.permission, createdBy: grant.createdBy, createdAt: Date.now() });
    return existing._id;
  }
  return ctx.db.insert("grants", { ...grant, createdAt: Date.now() });
}
