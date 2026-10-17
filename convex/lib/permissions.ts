import { ConvexError } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { campaignRole, type Role } from "./access";

export type Permission = Doc<"grants">["permission"];

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

/** The principals a user acts as: themselves, and every live campaign they run or belong to. */
async function principals(ctx: QueryCtx, user: Doc<"users">): Promise<{ kind: "user" | "campaign"; id: string }[]> {
  const owned = await ctx.db
    .query("campaigns")
    .withIndex("by_owner_lastOpened", (q) => q.eq("ownerId", user._id))
    .collect();
  const memberships = await ctx.db
    .query("campaignMembers")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  return [
    { kind: "user", id: user._id },
    ...owned.filter((c) => c.deletedAt === undefined).map((c) => ({ kind: "campaign" as const, id: c._id })),
    ...memberships.map((m) => ({ kind: "campaign" as const, id: m.campaignId })),
  ];
}

/**
 * The user's permission on a resource: the strongest of the role-derived one
 * (`rolePermission`) and any grant to the user, or to a campaign they run or
 * belong to, on the resource or on the campaign it lives in. Grant lookups are
 * point lookups per principal, skipped when the role already gives `need`
 * (or owner).
 */
export async function permissionFor(ctx: QueryCtx, user: Doc<"users">, resource: Resource, need: Permission = "owner"): Promise<Permission | null> {
  let best = rolePermission(await campaignRole(ctx, user, resource.campaign), resource, user._id);
  if (atLeast(best, need)) return best;
  const targets: { type: Resource["type"]; id: string }[] = [{ type: resource.type, id: resourceId(resource) }];
  if (resource.type !== "campaign") targets.push({ type: "campaign", id: resource.campaign._id });
  for (const p of await principals(ctx, user)) {
    for (const target of targets) {
      const grant = await ctx.db
        .query("grants")
        .withIndex("by_resource_principal", (q) =>
          q.eq("resourceType", target.type).eq("resourceId", target.id).eq("principalKind", p.kind).eq("principalId", p.id),
        )
        .unique();
      best = stronger(best, grant?.permission ?? null);
      if (best === "owner") return best;
    }
  }
  return best;
}

/**
 * `permissionFor`, requiring `need`: NOT_FOUND without any access (never
 * revealing the resource), FORBIDDEN when too weak. The result is exact up to
 * `enough` (pass "edit" when the caller also tells view from edit).
 */
export async function requirePermission(ctx: QueryCtx, user: Doc<"users">, resource: Resource, need: Permission, enough: Permission = need): Promise<Permission> {
  const permission = await permissionFor(ctx, user, resource, enough);
  if (permission === null) throw new ConvexError("NOT_FOUND");
  if (!atLeast(permission, need)) throw new ConvexError("FORBIDDEN");
  return permission;
}

/** A live (not deleted) campaign, or NOT_FOUND. Access is checked separately (`requirePermission`). */
export async function liveCampaign(ctx: QueryCtx, campaignId: Id<"campaigns">): Promise<Doc<"campaigns">> {
  const campaign = await ctx.db.get(campaignId);
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
    await ctx.db.patch(existing._id, { permission: grant.permission, createdBy: grant.createdBy, createdAt: Date.now() });
    return existing._id;
  }
  return ctx.db.insert("grants", { ...grant, createdAt: Date.now() });
}
