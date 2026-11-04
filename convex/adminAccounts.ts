import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";

import { DEFAULT_SIGN_UP_MODE, type CapKey } from "../src/lib/admin/config";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { recordAdminChange } from "./lib/adminAudit";
import { readAppConfig } from "./lib/appConfig";
import { appConfigRow, isAppOwner } from "./lib/appOwner";
import { appOwnerMutation, appOwnerQuery } from "./lib/functions";
import { capKeyValidator, signUpModeValidator } from "./lib/validators/admin";

/**
 * App admin, Accounts tab (config AD3, docs/tasks/TASK-CONFIG-AD3.md). Owner only: every function is an `appOwner*`
 * builder, so anyone else is refused (UNAUTHENTICATED / FORBIDDEN) before the handler runs. Single-field intents
 * (rule 12); every change writes one `adminAudit` row; a change to the value already saved writes nothing.
 * No "Who can create a campaign", no GM approval, no "Make GM" (user decision).
 */

/** The lowest and highest value a cap can be set to (AD3 acceptance). */
export const CAP_MIN = 1;
export const CAP_MAX = 1000;

/** Most accounts in one page of the account table; a bigger `numItems` is clamped (bounded reads, rule 5). */
export const ACCOUNTS_PAGE_MAX = 50;
/** Campaign names shown per account. */
export const ACCOUNT_CAMPAIGN_NAMES = 5;
/**
 * Explicit bound on the per-account reads (owned campaigns, memberships): deleted campaigns are skipped in code, so a
 * little more than the names shown is read. Past it, `moreCampaigns` is set.
 */
export const ADMIN_READ_BOUND = 20;

/** The `appConfig` row, created with only the key when nothing was saved yet. */
async function configRowForWrite(ctx: MutationCtx): Promise<Doc<"appConfig">> {
  const row = await appConfigRow(ctx);
  if (row !== null) return row;
  const id = await ctx.db.insert("appConfig", { key: "app", updatedAt: Date.now() });
  return (await ctx.db.get(id))!;
}

/** "Invite link only" / "Open" / "Closed" for new accounts (Q18 a; AD4 enforces it). */
export const setSignUpMode = appOwnerMutation({
  args: { mode: signUpModeValidator },
  returns: v.null(),
  handler: async (ctx, { mode }) => {
    const row = await configRowForWrite(ctx);
    const from = row.signUpMode ?? DEFAULT_SIGN_UP_MODE;
    if (from === mode) return null;
    await ctx.db.patch(row._id, { signUpMode: mode, updatedAt: Date.now() });
    await recordAdminChange(ctx, ctx.user._id, { action: "signUpMode.set", from, to: mode });
    return null;
  },
});

/** One of the four caps (Q19 a; AD5a / AD5b enforce them): a whole number from 1 to 1000. */
export const setCap = appOwnerMutation({
  args: { cap: capKeyValidator, value: v.number() },
  returns: v.null(),
  handler: async (ctx, { cap, value }) => {
    if (!Number.isInteger(value) || value < CAP_MIN || value > CAP_MAX) {
      throw appError("INVALID", `A limit is a whole number from ${CAP_MIN} to ${CAP_MAX}.`);
    }
    const from = (await readAppConfig(ctx)).caps[cap];
    if (from === value) return null;
    const row = await configRowForWrite(ctx);
    const caps: Partial<Record<CapKey, number>> = { ...row.caps, [cap]: value };
    await ctx.db.patch(row._id, { caps, updatedAt: Date.now() });
    await recordAdminChange(ctx, ctx.user._id, { action: "cap.set", field: cap, from, to: value });
    return null;
  },
});

const accountValidator = v.object({
  userId: v.id("users"),
  name: v.union(v.string(), v.null()),
  email: v.union(v.string(), v.null()),
  /** Owner (the app owner), GM (runs a campaign that is not deleted) or Player. */
  role: v.union(v.literal("owner"), v.literal("gm"), v.literal("player")),
  /** Up to `ACCOUNT_CAMPAIGN_NAMES` names: the campaigns they run first, then the ones they play in. */
  campaigns: v.array(v.string()),
  /** More campaigns than the names shown. */
  moreCampaigns: v.boolean(),
  /** Their newest campaign open (`campaignOpens`), or null when they never opened one. */
  lastSeen: v.union(v.number(), v.null()),
  tester: v.boolean(),
  createdAt: v.number(),
});

/** One row of the account table: picks only these fields (never a password, a key or a session). */
async function accountRow(ctx: QueryCtx, user: Doc<"users">) {
  const owned = await ctx.db
    .query("campaigns")
    .withIndex("by_owner_deletedAt_lastOpened", (q) => q.eq("ownerId", user._id).eq("deletedAt", undefined))
    .order("desc")
    .take(ADMIN_READ_BOUND);
  const memberships = await ctx.db
    .query("campaignMembers")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .take(ADMIN_READ_BOUND);
  const played: string[] = [];
  for (const member of memberships) {
    const campaign = await ctx.db.get(member.campaignId);
    if (campaign !== null && campaign.deletedAt === undefined) played.push(campaign.name);
  }
  const names = [...owned.map((c) => c.name), ...played];
  const newestOpen = await ctx.db
    .query("campaignOpens")
    .withIndex("by_user_lastOpened", (q) => q.eq("userId", user._id))
    .order("desc")
    .first();
  const tester = await ctx.db
    .query("appTesters")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .first();
  const role: "owner" | "gm" | "player" = (await isAppOwner(ctx, user)) ? "owner" : owned.length > 0 ? "gm" : "player";
  return {
    userId: user._id,
    name: user.name ?? null,
    email: user.email ?? null,
    role,
    campaigns: names.slice(0, ACCOUNT_CAMPAIGN_NAMES),
    moreCampaigns: names.length > ACCOUNT_CAMPAIGN_NAMES || memberships.length === ADMIN_READ_BOUND,
    lastSeen: newestOpen?.lastOpenedAt ?? null,
    tester: tester !== null,
    createdAt: user._creationTime,
  };
}

/** The account table, newest accounts first, at most `ACCOUNTS_PAGE_MAX` per page. */
export const accounts = appOwnerQuery({
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(accountValidator),
  handler: async (ctx, { paginationOpts }) => {
    const numItems = Math.max(1, Math.min(ACCOUNTS_PAGE_MAX, Math.floor(paginationOpts.numItems) || 1));
    const page = await ctx.db
      .query("users")
      .withIndex("by_creation_time")
      .order("desc")
      .paginate({ ...paginationOpts, numItems });
    const rows = [];
    for (const user of page.page) rows.push(await accountRow(ctx, user));
    return { ...page, page: rows };
  },
});

async function existingUser(ctx: QueryCtx, userId: Id<"users">): Promise<Doc<"users">> {
  const user = await ctx.db.get(userId);
  if (user === null) throw appError("NOT_FOUND");
  return user;
}

/** Adds an account to the testers (feature switches' "Testers", AD9). Already a tester: nothing changes. */
export const addTester = appOwnerMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await existingUser(ctx, userId);
    const row = await ctx.db
      .query("appTesters")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (row !== null) return null;
    await ctx.db.insert("appTesters", { userId, addedAt: Date.now(), addedBy: ctx.user._id });
    await recordAdminChange(ctx, ctx.user._id, { action: "tester.add", target: userId });
    return null;
  },
});

/** Removes an account from the testers. Not a tester: nothing changes. */
export const removeTester = appOwnerMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("appTesters")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .take(ADMIN_READ_BOUND);
    if (rows.length === 0) return null;
    for (const row of rows) await ctx.db.delete(row._id);
    await recordAdminChange(ctx, ctx.user._id, { action: "tester.remove", target: userId });
    return null;
  },
});
