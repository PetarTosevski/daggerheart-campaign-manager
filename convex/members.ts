import { v, type Infer } from "convex/values";
import { z } from "zod";

import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { deleteInvites, freshJoinCode, pendingInvite } from "./campaigns";
import { normalizeEmail } from "./lib/allowlist";
import { scheduleInviteEmail } from "./lib/inviteEmail";
import { campaignMutation, campaignQuery, creatorMutation, gmMutation, gmQuery, userMutation } from "./lib/functions";
import { atLeast, campaignAccess, permissionFor, removalNeed } from "./lib/permissions";

/** Whether the caller is the campaign's creator (`permissionFor`'s `creator` rank; config G1, Q7 a). */
async function isCreator(ctx: QueryCtx, user: Doc<"users">, campaign: Doc<"campaigns">): Promise<boolean> {
  return atLeast(await permissionFor(ctx, user, { type: "campaign", campaign }, "creator"), "creator");
}

export function normalizeJoinCode(code: string): string {
  return code.replace(/[^a-z0-9]/gi, "").toUpperCase();
}

const emailSchema = z.email("Enter a valid email address.");

function displayName(user: Doc<"users"> | null): string {
  if (!user) return "Unknown player";
  return user.name?.trim() || user.email?.split("@")[0] || "Player";
}

const seat = { userId: v.id("users"), name: v.string() };
/** `coGm`: the member is a co-GM (config G1); display data only, access is `permissionFor`'s. */
const playerRow = { ...seat, joinedAt: v.number(), coGm: v.boolean() };

/**
 * The roster's two shapes (CF6). Only the GM's rows carry emails; a player's
 * rows have no email field, so a leaked email fails validation. Clients narrow
 * on `viewer` before reading `email`.
 */
const rosterReturns = v.union(
  v.object({
    viewer: v.literal("gm"),
    gm: v.object(seat),
    players: v.array(v.object({ ...playerRow, email: v.union(v.string(), v.null()) })),
  }),
  v.object({
    viewer: v.literal("player"),
    gm: v.object(seat),
    players: v.array(v.object(playerRow)),
  }),
);

/** One table's players are a handful; this bounds the read. */
const ROSTER_MAX = 200;

async function members(ctx: QueryCtx, campaignId: Id<"campaigns">) {
  const rows = await ctx.db
    .query("campaignMembers")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaignId))
    .take(ROSTER_MAX);
  // The user rows in one batch (PF10), not one awaited get after another.
  return Promise.all(
    rows.map(async (m) => {
      const user = await ctx.db.get("users", m.userId);
      return {
        row: { userId: m.userId, name: displayName(user), joinedAt: m.joinedAt, coGm: m.role === "coGm" },
        email: user?.email ?? null,
      };
    }),
  );
}

/** The table: the GM and the players, for everyone in the campaign. Emails only for the GM. */
export const roster = campaignQuery({
  need: "view",
  enough: "owner",
  args: {},
  returns: rosterReturns,
  handler: async (ctx): Promise<Infer<typeof rosterReturns>> => {
    const gm = { userId: ctx.campaign.ownerId, name: displayName(await ctx.db.get("users", ctx.campaign.ownerId)) };
    const players = await members(ctx, ctx.campaign._id);
    if (ctx.permission === "owner") {
      return { viewer: "gm" as const, gm, players: players.map((p) => ({ ...p.row, email: p.email })) };
    }
    return { viewer: "player" as const, gm, players: players.map((p) => p.row) };
  },
});

/** GM view of who can join: pending email invites (`asCoGm` for a co-GM invite, Q8 b) and the join code. */
const accessReturns = v.object({
  joinCode: v.union(v.string(), v.null()),
  invites: v.array(v.object({ _id: v.id("campaignInvites"), email: v.string(), createdAt: v.number(), asCoGm: v.boolean() })),
});

export const access = gmQuery({
  args: {},
  returns: accessReturns,
  handler: async (ctx) => {
    // One table's pending invites: a handful of rows.
    const invites = await ctx.db
      .query("campaignInvites")
      .withIndex("by_campaign_email", (q) => q.eq("campaignId", ctx.campaign._id))
      .collect();
    return {
      joinCode: ctx.campaign.joinCode ?? null,
      invites: invites.map((i) => ({ _id: i._id, email: i.email, createdAt: i.createdAt, asCoGm: i.role === "coGm" })),
    };
  },
});

/**
 * Invites an email to the campaign (the GM or a co-GM). With `asCoGm: true` (Q8 b) the invite makes them a co-GM when
 * they accept it (`campaigns.markOpened`); until then they are an invited player. Only the creator invites as co-GM or
 * changes a pending invite's role (Q7 a): anyone else gets CO_GM_CREATOR_ONLY. Inviting a pending address again with
 * the same role returns the pending invite.
 */
export const invite = gmMutation({
  rateLimit: "invite",
  args: { email: v.string(), asCoGm: v.optional(v.boolean()) },
  returns: v.id("campaignInvites"),
  handler: async (ctx, { email: raw, asCoGm }) => {
    const campaignId = ctx.campaign._id;
    const email = normalizeEmail(emailSchema.parse(raw.trim()));
    const role = asCoGm === true ? ("coGm" as const) : undefined;
    if (email === normalizeEmail(ctx.user.email ?? "")) throw appError("INVALID", "You're already a GM of this campaign.");
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (existingUser) {
      // Identity, not access: the creator is never a member or an invitee of their own campaign.
      if (existingUser._id === ctx.campaign.ownerId) throw appError("INVALID", "That's the GM who created this campaign.");
      const member = await ctx.db
        .query("campaignMembers")
        .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaignId).eq("userId", existingUser._id))
        .unique();
      if (member) throw appError("INVALID", "That player is already in the campaign.");
    }
    const pending = await ctx.db
      .query("campaignInvites")
      .withIndex("by_campaign_email", (q) => q.eq("campaignId", campaignId).eq("email", email))
      .first();
    const creator = role !== undefined || (pending !== null && pending.role !== role) ? await isCreator(ctx, ctx.user, ctx.campaign) : false;
    if (role !== undefined && !creator) throw appError("CO_GM_CREATOR_ONLY");
    if (pending) {
      if (pending.role === role) return pending._id;
      // Turning a pending co-GM invite into a player one (or back) is managing co-GMs: the creator only.
      if (!creator) throw appError("CO_GM_CREATOR_ONLY");
      await ctx.db.patch("campaignInvites", pending._id, { role });
      return pending._id;
    }
    const inviteId = await ctx.db.insert("campaignInvites", {
      campaignId,
      email,
      invitedBy: ctx.user._id,
      createdAt: Date.now(),
      ...(role === undefined ? {} : { role }),
    });
    // The row is stored first; the email is best effort (limits, e2e and unverified accounts skip it, a failed send is only logged).
    await scheduleInviteEmail(ctx, { inviteId, campaignId, email });
    return inviteId;
  },
});

export const revokeInvite = userMutation({
  args: { inviteId: v.id("campaignInvites") },
  returns: v.null(),
  handler: async (ctx, { inviteId }) => {
    const invite = await ctx.db.get("campaignInvites", inviteId);
    if (invite === null) return null;
    // The client sends only the invite; its campaign decides who may revoke it.
    const access = await campaignAccess(ctx, ctx.user, invite.campaignId, "owner");
    if (access === null) throw appError("NOT_FOUND");
    if (access.permission !== "owner") throw appError("FORBIDDEN");
    await ctx.db.delete("campaignInvites", inviteId);
    return null;
  },
});

/** A member's hand folds in one campaign: their folded characters there, a handful (bounded read). */
const HAND_FOLDS_MAX = 500;

async function removeAccess(ctx: MutationCtx, campaignId: Id<"campaigns">, userId: Id<"users">) {
  const member = await ctx.db
    .query("campaignMembers")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaignId).eq("userId", userId))
    .unique();
  if (member) await ctx.db.delete("campaignMembers", member._id);
  // An invite would grant access again, so it goes too.
  const user = await ctx.db.get("users", userId);
  if (user) await deleteInvites(ctx, campaignId, user);
  // Their hand folds in this campaign go with them (config G1). The user's folds across campaigns, bounded.
  const folds = await ctx.db
    .query("handFolds")
    .withIndex("by_user_character", (q) => q.eq("userId", userId))
    .take(HAND_FOLDS_MAX);
  for (const fold of folds) if (fold.campaignId === campaignId) await ctx.db.delete("handFolds", fold._id);
}

/**
 * Removes a member (the GM or a co-GM). A player needs `owner`; a co-GM needs `creator` (Q7 a: a co-GM removes players,
 * not other co-GMs; CO_GM_CREATOR_ONLY otherwise); the creator can't be removed (INVALID). `removalNeed` decides.
 */
export const removePlayer = gmMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const need = await removalNeed(ctx, ctx.campaign, userId);
    if (need === null) throw appError("INVALID", "The GM who created the campaign can't be removed.");
    if (need === "creator" && !(await isCreator(ctx, ctx.user, ctx.campaign))) throw appError("CO_GM_CREATOR_ONLY");
    await removeAccess(ctx, ctx.campaign._id, userId);
    // The removed player may still know the code; replace it.
    if (ctx.campaign.joinCode) await ctx.db.patch("campaigns", ctx.campaign._id, { joinCode: await freshJoinCode(ctx) });
    return null;
  },
});

/**
 * Makes a member a co-GM (`coGm: true`) or a player again (`false`). The creator only (Q7 a). Not a member (an
 * invitee, the creator, a stranger's id) → CO_GM_NOT_MEMBER. Setting the role it already has is a no-op.
 */
export const setCoGm = creatorMutation({
  args: { userId: v.id("users"), coGm: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { userId, coGm }) => {
    const member = await ctx.db
      .query("campaignMembers")
      .withIndex("by_campaign_user", (q) => q.eq("campaignId", ctx.campaign._id).eq("userId", userId))
      .unique();
    if (member === null) throw appError("CO_GM_NOT_MEMBER");
    const role = coGm ? ("coGm" as const) : undefined;
    if (member.role === role) return null;
    await ctx.db.patch("campaignMembers", member._id, { role });
    return null;
  },
});

/**
 * A player or a co-GM leaves a campaign. The creator cannot leave their own campaign (they delete it instead). Allowed
 * on an archived campaign: leaving changes nothing in it.
 */
export const leave = campaignMutation({
  need: "view",
  archived: "allow",
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    if (await isCreator(ctx, ctx.user, ctx.campaign)) throw appError("INVALID", "The GM can't leave their own campaign.");
    await removeAccess(ctx, ctx.campaign._id, ctx.user._id);
    return null;
  },
});


/** Shows (creating on first use) or replaces the campaign's join code. GM only. */
export const rotateJoinCode = gmMutation({
  args: { replace: v.optional(v.boolean()) },
  returns: v.string(),
  handler: async (ctx, { replace }) => {
    if (ctx.campaign.joinCode && !replace) return ctx.campaign.joinCode;
    const code = await freshJoinCode(ctx);
    await ctx.db.patch("campaigns", ctx.campaign._id, { joinCode: code });
    return code;
  },
});

const joinReturns = v.union(
  v.object({ ok: v.literal(true), campaignId: v.id("campaigns") }),
  v.object({ ok: v.literal(false), code: v.literal("BAD_CODE"), message: v.string() }),
);

/**
 * Joins the campaign with this code as a player. Joining twice is harmless.
 * A wrong code is returned, not thrown: a throw would roll back the rate-limit
 * token consumed in the same transaction, so guesses would never be counted.
 */
export const joinByCode = userMutation({
  rateLimit: "joinByCode",
  args: { code: v.string() },
  returns: joinReturns,
  handler: async (ctx, { code }): Promise<Infer<typeof joinReturns>> => {
    const user = ctx.user;
    const joinCode = normalizeJoinCode(code);
    const campaign = joinCode
      ? await ctx.db.query("campaigns").withIndex("by_joinCode", (q) => q.eq("joinCode", joinCode)).first()
      : null;
    if (campaign === null || campaign.deletedAt !== undefined) {
      return { ok: false as const, code: "BAD_CODE" as const, message: "No campaign uses that code. Check it with your GM." };
    }
    if (campaign.ownerId === user._id) return { ok: true as const, campaignId: campaign._id };
    const existing = await ctx.db
      .query("campaignMembers")
      .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaign._id).eq("userId", user._id))
      .unique();
    if (!existing) {
      const now = Date.now();
      // A pending co-GM invite to their verified email is accepted here too (as in `campaigns.markOpened`, Q8 b).
      const role = (await pendingInvite(ctx, campaign._id, user))?.role;
      await ctx.db.insert("campaignMembers", {
        campaignId: campaign._id,
        userId: user._id,
        joinedAt: now,
        lastOpenedAt: now,
        ...(role === undefined ? {} : { role }),
      });
      await deleteInvites(ctx, campaign._id, user);
    }
    return { ok: true as const, campaignId: campaign._id };
  },
});
