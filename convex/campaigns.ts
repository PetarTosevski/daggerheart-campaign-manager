import { v, type Infer } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { campaignMessages } from "../src/lib/errors/campaigns";
import { frameHasMechanic } from "../src/lib/frames/index";
import { isCampaignOptionId, optionsFor, resolveOptions } from "../src/lib/frames/options";
import { campaignNameKey, createCampaignSchema, startingLevel } from "../src/lib/validation/campaigns";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { normalizeEmail } from "./lib/allowlist";
import { playersSeeHands } from "./lib/cardHand";
import { seedCodex } from "./lib/codex";
import { campaignFearState } from "./lib/fear";
import {
  campaignMutation,
  campaignQuery,
  gmMutation,
  keyedUserMutation,
  maybeUserQuery,
  userMutation,
  userQuery,
} from "./lib/functions";
import { atLeast, campaignAccess, inviteEmail, permissionFor, type Role } from "./lib/permissions";
import {
  campaignSummaryValidator,
  customFrameValidator,
  frameIdValidator,
  tomeChapterValidator,
} from "./lib/validators/campaigns";
import { settingsRow } from "./settings";

/**
 * What `get` returns: the campaign summary without GM Fear (PF7). Fear changes on every click, and the whole campaign
 * page reads `get`; Fear has its own query (`fear` below), so a Fear click re-sends only that.
 */
const summaryValidator = campaignSummaryValidator.omit("fear");

export type CampaignSummary = Infer<typeof summaryValidator>;

/**
 * What `list` returns per campaign: the summary plus its Fear, which Load Campaign shows on every card. Only the title
 * menu subscribes to `list` (never a campaign page), so a Fear click inside a campaign does not re-send it.
 */
export type CampaignListItem = Infer<typeof campaignSummaryValidator>;

async function withFear(ctx: QueryCtx, summary: CampaignSummary): Promise<CampaignListItem> {
  const state = await ctx.db
    .query("campaignState")
    .withIndex("by_campaign", (q) => q.eq("campaignId", summary._id))
    .unique();
  return { ...summary, fear: state?.fear ?? 0 };
}

/** `markOpened` skips the write when the stored open is younger than this. */
export const OPEN_THROTTLE_MS = 5 * 60 * 1000;

async function summarise(ctx: QueryCtx, campaign: Doc<"campaigns">, role: Role, lastOpenedAt: number): Promise<CampaignSummary> {
  // A table's players: a handful (bounded read).
  const members = await ctx.db
    .query("campaignMembers")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaign._id))
    .take(100);
  return {
    _id: campaign._id,
    frameId: campaign.frameId,
    name: campaign.name,
    tier: campaign.tier,
    level: campaign.level,
    custom: campaign.custom ?? null,
    tome: campaign.tome ?? null,
    options: resolveOptions(campaign.frameId, campaign.options),
    createdAt: campaign.createdAt,
    lastOpenedAt,
    players: members.length,
    role,
  };
}

/** When the user last opened the campaign (`campaignOpens`), or `fallback` if they have not since opens moved there. */
async function openedAt(ctx: QueryCtx, userId: Id<"users">, campaignId: Id<"campaigns">, fallback: () => number | Promise<number>) {
  const open = await ctx.db
    .query("campaignOpens")
    .withIndex("by_user_campaign", (q) => q.eq("userId", userId).eq("campaignId", campaignId))
    .unique();
  return open?.lastOpenedAt ?? (await fallback());
}

/**
 * The most campaigns Load Campaign lists. Each summary costs a few reads, so an unbounded list hit Convex's 4096-read
 * limit for an account with hundreds of campaigns (the e2e GM, 2026-10-20). Each source is read newest first.
 */
const LIST_MAX = 100;

/** Campaigns the user runs (GM) or plays in (member or invited), most recently opened first; at most `LIST_MAX`. */
export const list = userQuery({
  args: {},
  returns: v.array(campaignSummaryValidator),
  handler: async (ctx) => {
    const user = ctx.user;
    const owned = await ctx.db
      .query("campaigns")
      .withIndex("by_owner_deletedAt_lastOpened", (q) => q.eq("ownerId", user._id).eq("deletedAt", undefined))
      .order("desc")
      .take(LIST_MAX);
    const rows: { campaign: Doc<"campaigns">; role: Role; fallback: number }[] = owned.map((c) => ({
      campaign: c,
      role: "gm",
      fallback: c.lastOpenedAt,
    }));
    const seen = new Set(owned.map((c) => c._id));
    const memberships = await ctx.db
      .query("campaignMembers")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(LIST_MAX);
    for (const m of memberships) {
      const c = await ctx.db.get("campaigns", m.campaignId);
      if (c && c.deletedAt === undefined && !seen.has(c._id)) {
        rows.push({ campaign: c, role: "player", fallback: m.lastOpenedAt });
        seen.add(c._id);
      }
    }
    const email = inviteEmail(user);
    if (email !== null) {
      const invites = await ctx.db
        .query("campaignInvites")
        .withIndex("by_email", (q) => q.eq("email", email))
        .order("desc")
        .take(LIST_MAX);
      for (const i of invites) {
        const c = await ctx.db.get("campaigns", i.campaignId);
        if (c && c.deletedAt === undefined && !seen.has(c._id)) {
          rows.push({ campaign: c, role: "player", fallback: i.createdAt });
          seen.add(c._id);
        }
      }
    }
    const opened = await Promise.all(
      rows.map(async (r) => ({ ...r, lastOpenedAt: await openedAt(ctx, user._id, r.campaign._id, () => r.fallback) })),
    );
    opened.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    return Promise.all(
      opened.slice(0, LIST_MAX).map(async (r) => withFear(ctx, await summarise(ctx, r.campaign, r.role, r.lastOpenedAt))),
    );
  },
});

/** Removes the user's email invites to a campaign once they are a member. */
export async function deleteInvites(ctx: MutationCtx, campaignId: Id<"campaigns">, user: Doc<"users">) {
  if (!user.email) return;
  const invites = await ctx.db
    .query("campaignInvites")
    .withIndex("by_campaign_email", (q) => q.eq("campaignId", campaignId).eq("email", normalizeEmail(user.email!)))
    .collect();
  for (const invite of invites) await ctx.db.delete("campaignInvites", invite._id);
}

/** One campaign by id (a raw URL segment), or null if it is unknown, deleted, not visible to the user, or they are signed out. */
export const get = maybeUserQuery({
  args: { campaignId: v.string() },
  returns: v.union(summaryValidator, v.null()),
  handler: async (ctx, args) => {
    const user = ctx.user;
    const campaignId = ctx.db.normalizeId("campaigns", args.campaignId);
    if (user === null || campaignId === null) return null;
    const access = await campaignAccess(ctx, user, campaignId, "owner");
    if (access === null) return null;
    const { campaign } = access;
    const role: Role = access.permission === "owner" ? "gm" : "player";
    const lastOpenedAt = await openedAt(ctx, user._id, campaign._id, async () => {
      if (role === "gm") return campaign.lastOpenedAt;
      const member = await ctx.db
        .query("campaignMembers")
        .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaign._id).eq("userId", user._id))
        .unique();
      return member?.lastOpenedAt ?? campaign.createdAt;
    });
    return summarise(ctx, campaign, role, lastOpenedAt);
  },
});

/**
 * The campaign's GM Fear (0–12), every member. Its own small query so a Fear change re-sends only this, not the campaign
 * summary that the whole campaign page reads (PF7).
 */
export const fear = campaignQuery({
  need: "view",
  args: {},
  returns: v.number(),
  handler: async (ctx) => (await campaignFearState(ctx, ctx.campaign._id)).fear,
});

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

/** A join code no campaign uses yet. */
export async function freshJoinCode(ctx: QueryCtx): Promise<string> {
  let code = newJoinCode();
  while (await ctx.db.query("campaigns").withIndex("by_joinCode", (q) => q.eq("joinCode", code)).first()) {
    code = newJoinCode();
  }
  return code;
}

/** The owner's live campaign with this name key, if any (names are unique per GM among live campaigns). */
function liveNamesake(ctx: QueryCtx, ownerId: Id<"users">, nameKey: string) {
  return ctx.db
    .query("campaigns")
    .withIndex("by_owner_deletedAt_nameKey", (q) => q.eq("ownerId", ownerId).eq("deletedAt", undefined).eq("nameKey", nameKey))
    .first();
}

/**
 * Creates a campaign with its Fear state, campaign time (if the frame has
 * it), join code and the frame's starting characters (all secret). Rate-limited per user.
 */
export const create = keyedUserMutation({
  rateLimit: "createCampaign",
  args: {
    frameId: frameIdValidator,
    name: v.string(),
    custom: v.optional(customFrameValidator),
  },
  returns: v.object({ campaignId: v.id("campaigns") }),
  handler: async (ctx, raw) => {
    const input = createCampaignSchema.parse(raw);
    const user = ctx.user;
    return ctx.once("campaign_create", input, async () => {
      const nameKey = campaignNameKey(input.name);
      if ((await liveNamesake(ctx, user._id, nameKey)) !== null) {
        throw appError("NAME_TAKEN", campaignMessages.NAME_TAKEN);
      }
      const tier = input.custom?.startingTier ?? 1;
      const now = Date.now();
      // XS1: the GM's Expansions setting, when set, decides Hope & Fear for frames that offer it.
      const hopeAndFear = (await settingsRow(ctx, user))?.expansions?.hopeAndFear;
      const offersHopeAndFear = optionsFor(input.frameId).some((o) => o.id === "hopeAndFear");
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
        joinCode: await freshJoinCode(ctx),
        ...(hopeAndFear !== undefined && offersHopeAndFear ? { options: { hopeAndFear } } : {}),
      });
      await ctx.db.insert("campaignState", { campaignId, fear: 0 });
      if (frameHasMechanic(input.frameId, "campaignTime")) {
        await ctx.db.insert("campaignTime", { campaignId, week: 1, cycle: "DAY", cycleDay: 1 });
      }
      await seedCodex(ctx, campaignId, input.frameId);
      return { campaignId };
    });
  },
});

/**
 * Records that the user opened the campaign (drives "Continue" and the list
 * order) in `campaignOpens`, at most once per `OPEN_THROTTLE_MS`; it never
 * writes the campaign document. For an invited player, opening the campaign
 * accepts the invite: it becomes a member row.
 */
export const markOpened = campaignMutation({
  need: "view",
  enough: "owner",
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const { user, campaign } = ctx;
    const now = Date.now();
    if (ctx.permission !== "owner") {
      const member = await ctx.db
        .query("campaignMembers")
        .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaign._id).eq("userId", user._id))
        .unique();
      const email = member === null ? inviteEmail(user) : null;
      const invite =
        email === null
          ? null
          : await ctx.db
              .query("campaignInvites")
              .withIndex("by_campaign_email", (q) => q.eq("campaignId", campaign._id).eq("email", email))
              .first();
      if (invite !== null) {
        await ctx.db.insert("campaignMembers", { campaignId: campaign._id, userId: user._id, joinedAt: now, lastOpenedAt: now });
        await deleteInvites(ctx, campaign._id, user);
      }
    }
    const open = await ctx.db
      .query("campaignOpens")
      .withIndex("by_user_campaign", (q) => q.eq("userId", user._id).eq("campaignId", campaign._id))
      .unique();
    if (open === null) {
      await ctx.db.insert("campaignOpens", { userId: user._id, campaignId: campaign._id, lastOpenedAt: now });
    } else if (now - open.lastOpenedAt >= OPEN_THROTTLE_MS) {
      await ctx.db.patch("campaignOpens", open._id, { lastOpenedAt: now });
    }
    return null;
  },
});

/** Deletes a campaign (GM only). Recoverable with `restore` until the purge. */
export const remove = gmMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.db.patch("campaigns", ctx.campaign._id, { deletedAt: Date.now() });
    return null;
  },
});

/**
 * Undoes `remove` (GM only). Not a campaign wrapper, because those treat a
 * deleted campaign as missing; a deleted campaign is `NOT_FOUND` to anyone
 * who does not own it.
 */
export const restore = userMutation({
  args: { campaignId: v.id("campaigns") },
  returns: v.null(),
  handler: async (ctx, { campaignId }) => {
    const campaign = await ctx.db.get("campaigns", campaignId);
    if (campaign === null) throw appError("NOT_FOUND");
    const permission = await permissionFor(ctx, ctx.user, { type: "campaign", campaign }, "owner");
    const owner = atLeast(permission, "owner");
    if (permission === null || (campaign.deletedAt !== undefined && !owner)) throw appError("NOT_FOUND");
    if (!owner) throw appError("FORBIDDEN");
    if (campaign.deletedAt === undefined) return null;
    // Being deleted permanently: part of its data may already be gone, so it can't come back.
    if (campaign.deletedAt === PURGE_REQUESTED_AT) throw appError("NOT_FOUND");
    if ((await liveNamesake(ctx, campaign.ownerId, campaign.nameKey)) !== null) {
      throw appError("NAME_TAKEN", "Another campaign now uses that name.");
    }
    await ctx.db.patch("campaigns", campaign._id, { deletedAt: undefined });
    return null;
  },
});

/**
 * The `deletedAt` that marks a campaign its GM asked to delete permanently (`purge`). It is older than any real
 * deletion, so `internal.cleanup.purgeCampaign` (which purges only campaigns deleted more than `PURGE_AFTER_MS` ago)
 * accepts it, and `listDeleted` and `restore` treat the campaign as gone at once.
 */
export const PURGE_REQUESTED_AT = 1;

/** The most deleted campaigns Load Campaign lists. */
const DELETED_LIST_MAX = 50;

const deletedCampaignValidator = v.object({
  _id: v.id("campaigns"),
  name: v.string(),
  frameId: frameIdValidator,
  createdAt: v.number(),
  deletedAt: v.number(),
});

export type DeletedCampaign = Infer<typeof deletedCampaignValidator>;

/** The caller's own deleted campaigns (restorable or deletable for good), most recently deleted first; at most 50. */
export const listDeleted = userQuery({
  args: {},
  returns: v.array(deletedCampaignValidator),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("campaigns")
      .withIndex("by_owner_deletedAt_lastOpened", (q) => q.eq("ownerId", ctx.user._id).gt("deletedAt", PURGE_REQUESTED_AT))
      .order("desc")
      .take(DELETED_LIST_MAX);
    return rows.map((c) => ({ _id: c._id, name: c.name, frameId: c.frameId, createdAt: c.createdAt, deletedAt: c.deletedAt ?? 0 }));
  },
});

/**
 * Deletes a deleted campaign for good (its GM only; bead dcm-bxp.30): marks it `PURGE_REQUESTED_AT` and schedules the
 * batched `internal.cleanup.purgeCampaign`. Like `restore`, not a campaign wrapper: a deleted campaign is `NOT_FOUND`
 * to anyone who does not own it. A live campaign is `INVALID` (delete it first); asking again while the purge runs is
 * a no-op.
 */
export const purge = userMutation({
  args: { campaignId: v.id("campaigns") },
  returns: v.null(),
  handler: async (ctx, { campaignId }) => {
    const campaign = await ctx.db.get("campaigns", campaignId);
    if (campaign === null) throw appError("NOT_FOUND");
    const permission = await permissionFor(ctx, ctx.user, { type: "campaign", campaign }, "owner");
    const owner = atLeast(permission, "owner");
    if (permission === null || (campaign.deletedAt !== undefined && !owner)) throw appError("NOT_FOUND");
    if (!owner) throw appError("FORBIDDEN");
    if (campaign.deletedAt === undefined) throw appError("INVALID", "Delete the campaign before deleting it permanently.");
    if (campaign.deletedAt === PURGE_REQUESTED_AT) return null;
    await ctx.db.patch("campaigns", campaign._id, { deletedAt: PURGE_REQUESTED_AT });
    await ctx.scheduler.runAfter(0, internal.cleanup.purgeCampaign, { campaignId: campaign._id });
    return null;
  },
});

export const TOME_TEXT_MAX = 20000;

/** Saves one chapter of a custom campaign's tome. GM only; players read it. */
export const updateTome = gmMutation({
  args: { chapter: tomeChapterValidator, text: v.string() },
  returns: v.null(),
  handler: async (ctx, { chapter, text }) => {
    const campaign = ctx.campaign;
    if (campaign.frameId !== "custom") {
      throw appError("INVALID", "Only a custom campaign has a tome you write yourself.");
    }
    if (text.length > TOME_TEXT_MAX) {
      throw appError("INVALID", `Keep each chapter under ${TOME_TEXT_MAX} characters.`);
    }
    const tome = campaign.tome ?? { overview: "", incident: "", mechanics: "" };
    await ctx.db.patch("campaigns", campaign._id, { tome: { ...tome, [chapter]: text } });
    return null;
  },
});

/** Switches an optional rule for the campaign. GM only. */
export const setOption = gmMutation({
  args: { option: v.string(), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { option, enabled }) => {
    const campaign = ctx.campaign;
    if (!isCampaignOptionId(option) || !optionsFor(campaign.frameId).some((o) => o.id === option)) {
      throw appError("INVALID", "That rule isn't available in this campaign.");
    }
    await ctx.db.patch("campaigns", campaign._id, { options: { ...(campaign.options ?? {}), [option]: enabled } });
    return null;
  },
});

/**
 * The GM's switch "Players can see each other's cards" (F7-H4, dcm-bxp.99.24; on by default): the campaign's typed
 * `playersSeeHands` field (F8-I1, dcm-bxp.99.27). GM only.
 */
export const setPlayersSeeHands = gmMutation({
  args: { enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { enabled }) => {
    const campaign = ctx.campaign;
    if (playersSeeHands(campaign) === enabled) return null;
    await ctx.db.patch("campaigns", campaign._id, { playersSeeHands: enabled });
    return null;
  },
});
