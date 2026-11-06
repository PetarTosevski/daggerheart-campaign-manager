import { v } from "convex/values";

import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { PURGE_REQUESTED_AT } from "./campaigns";
import { PURGE_AFTER_MS } from "./cleanup";
import { recordAdminChange } from "./lib/adminAudit";
import { normalizeEmail } from "./lib/allowlist";
import { takeAppleTokens } from "./lib/appleRevoke";

/**
 * Erasing deleted accounts (config AD14, Q28 b, N11; rule 8). The owner's Delete account (`adminAccountActions`)
 * suspends the account at once and sets `accountStatus.deleteAfter` 30 days ahead; Undo clears it. A daily cron
 * (`purgeDueAccounts`) then erases each account past its `deleteAfter`, one after another, through the batched,
 * self-rescheduling `purgeAccount`:
 *
 * 1. `live`: each campaign the account created goes to its earliest co-GM (who becomes its creator) when it has one,
 *    else it is deleted as its GM's Delete would (`deletedAt`), so it keeps the usual restore window.
 * 2. `deleted`: each of its deleted campaigns gets `internal.cleanup.purgeCampaign` scheduled for the end of that
 *    window (the campaign purge cron is off, so nothing else would purge it).
 * 3. `rows`: its own rows: memberships, opens, invites to its email, preferences, UI state, drafts, hand folds, upload
 *    notices, Lorekeeper day counters, tester row, GM settings, sharing grants, logins, sessions; then the user and its
 *    `accountStatus` row. Before the logins go, any Sign in with Apple token still stored on them is revoked
 *    (`internal.accountSelfDelete.revokeAppleTokens`; a self-deletion revoked it already, DEL1).
 *
 * The account holder can also delete their own account (`accountSelfDelete`, DEL1): the same 30-day wait, and signing
 * back in within it cancels the deletion.
 *
 * Its characters in other people's campaigns are kept (N11): with no member row the party shows them as "Former
 * player", and that campaign's GM can retire or delete them. Audit rows keep the account's id only (never its email).
 * The purge stops as soon as the deletion is undone.
 */

/** Rows (or campaigns, in the `live` phase) one run handles. */
export const ACCOUNT_PURGE_BATCH = 200;
/** Campaigns one run hands over or deletes: each is a few reads and writes. */
export const ACCOUNT_PURGE_CAMPAIGNS = 20;
/** The most co-GMs and players read to find a campaign's successor (bounded by the players cap). */
const ROSTER_READ = 200;
/** A deleted campaign's purge runs this long after its window ends, so `purgeCampaign`'s age check surely passes. */
const PURGE_MARGIN_MS = 60_000;
/** A login's codes and a session's refresh tokens per run. */
const AUTH_CHILDREN = 50;

const phaseValidator = v.union(v.literal("live"), v.literal("deleted"), v.literal("rows"));
type Phase = "live" | "deleted" | "rows";

type Budget = { left: number };

/** The account's `accountStatus` row, or null. */
export function accountStatusRow(ctx: MutationCtx, userId: Id<"users">): Promise<Doc<"accountStatus"> | null> {
  return ctx.db
    .query("accountStatus")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
}

/**
 * Signs the account out everywhere (AD14): deletes its sessions and their refresh tokens, bounded. A token minted
 * before still works until it expires, but every wrapper refuses a suspended account with ACCOUNT_SUSPENDED.
 */
export async function endSessions(ctx: MutationCtx, userId: Id<"users">, budget: Budget = { left: ACCOUNT_PURGE_BATCH }): Promise<void> {
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .take(Math.max(0, budget.left));
  for (const session of sessions) {
    const tokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
      .take(AUTH_CHILDREN);
    for (const token of tokens) await ctx.db.delete("authRefreshTokens", token._id);
    budget.left -= tokens.length;
    if (tokens.length === AUTH_CHILDREN) return; // more tokens: the session goes on the next run
    await ctx.db.delete("authSessions", session._id);
    budget.left--;
    if (budget.left <= 0) return;
  }
}

/** Starts erasing the oldest account past its `deleteAfter`; `purgeAccount` calls this again when it is done. */
export const purgeDueAccounts = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const due = await ctx.db
      .query("accountStatus")
      .withIndex("by_deleteAfter", (q) => q.gte("deleteAfter", 0).lte("deleteAfter", Date.now()))
      .first();
    if (due !== null) await ctx.scheduler.runAfter(0, internal.accountPurge.purgeAccount, { userId: due.userId, sweep: true });
    return null;
  },
});

/** The co-GM who takes over a campaign: the earliest to join, or null when it has none. */
async function successor(ctx: MutationCtx, campaignId: Id<"campaigns">): Promise<Doc<"campaignMembers"> | null> {
  const members = await ctx.db
    .query("campaignMembers")
    .withIndex("by_campaign_user", (q) => q.eq("campaignId", campaignId))
    .take(ROSTER_READ);
  const coGms = members.filter((m) => m.role === "coGm").sort((a, b) => a.joinedAt - b.joinedAt);
  return coGms[0] ?? null;
}

/** A name the new creator has no live campaign with (names are unique per GM): the same, or "Name (2)", "(3)" … */
async function freeName(ctx: MutationCtx, ownerId: Id<"users">, name: string): Promise<{ name: string; nameKey: string }> {
  for (let n = 1; n <= 50; n++) {
    const candidate = n === 1 ? name : `${name} (${n})`;
    const nameKey = candidate.trim().toLowerCase();
    const taken = await ctx.db
      .query("campaigns")
      .withIndex("by_owner_deletedAt_nameKey", (q) => q.eq("ownerId", ownerId).eq("deletedAt", undefined).eq("nameKey", nameKey))
      .first();
    if (taken === null) return { name: candidate, nameKey };
  }
  const fallback = `${name} (${Date.now()})`;
  return { name: fallback, nameKey: fallback.trim().toLowerCase() };
}

/** Phase `live`: hands over or deletes up to `ACCOUNT_PURGE_CAMPAIGNS` live campaigns; true when none is left. */
async function settleLiveCampaigns(ctx: MutationCtx, userId: Id<"users">, actorId: Id<"users">): Promise<boolean> {
  const campaigns = await ctx.db
    .query("campaigns")
    .withIndex("by_owner_deletedAt_lastOpened", (q) => q.eq("ownerId", userId).eq("deletedAt", undefined))
    .take(ACCOUNT_PURGE_CAMPAIGNS);
  for (const campaign of campaigns) {
    const next = await successor(ctx, campaign._id);
    if (next === null) {
      // N11: no co-GM, so it is deleted as its GM's Delete would; `deleted` schedules its purge after the window.
      await ctx.db.patch("campaigns", campaign._id, { deletedAt: Date.now() });
      await recordAdminChange(ctx, actorId, { action: "campaign.delete", target: campaign._id });
      continue;
    }
    // N11: the co-GM becomes its creator (the creator has no member row).
    await ctx.db.delete("campaignMembers", next._id);
    const named = await freeName(ctx, next.userId, campaign.name);
    await ctx.db.patch("campaigns", campaign._id, { ownerId: next.userId, ...named });
    await recordAdminChange(ctx, actorId, { action: "account.delete", field: "campaign.handedOver", target: campaign._id, to: next.userId });
  }
  return campaigns.length < ACCOUNT_PURGE_CAMPAIGNS;
}

/**
 * Phase `deleted`: schedules the purge of a page of the account's deleted campaigns for the end of each one's restore
 * window (one already being purged, `PURGE_REQUESTED_AT`, is skipped). Returns the next cursor, or null when done.
 */
async function scheduleDeletedPurges(ctx: MutationCtx, userId: Id<"users">, cursor: string | null): Promise<string | null> {
  const page = await ctx.db
    .query("campaigns")
    .withIndex("by_owner_deletedAt_lastOpened", (q) => q.eq("ownerId", userId).gt("deletedAt", PURGE_REQUESTED_AT))
    .paginate({ numItems: ACCOUNT_PURGE_CAMPAIGNS, cursor });
  const now = Date.now();
  for (const campaign of page.page) {
    const wait = Math.max(0, (campaign.deletedAt ?? now) + PURGE_AFTER_MS - now) + PURGE_MARGIN_MS;
    await ctx.scheduler.runAfter(wait, internal.cleanup.purgeCampaign, { campaignId: campaign._id });
  }
  return page.isDone ? null : page.continueCursor;
}

/** Deletes rows of one table while counting them against the budget. */
async function deleteAll<T extends TableNames>(ctx: MutationCtx, budget: Budget, table: T, rows: Doc<T>[]): Promise<void> {
  for (const row of rows) {
    await ctx.db.delete(table, row._id);
    budget.left--;
  }
}

/**
 * Phase `rows`: the account's own rows, each step deleting until it is empty or the budget is spent. Every step reads
 * by an index on the user (or its email), so each run picks up where the last one stopped.
 */
function rowSteps(user: Doc<"users"> | null, userId: Id<"users">): ((ctx: MutationCtx, budget: Budget) => Promise<void>)[] {
  const email = user?.email === undefined ? null : normalizeEmail(user.email);
  return [
    async (ctx, b) => deleteAll(ctx, b, "campaignMembers", await ctx.db.query("campaignMembers").withIndex("by_user", (q) => q.eq("userId", userId)).take(b.left)),
    async (ctx, b) => deleteAll(ctx, b, "campaignOpens", await ctx.db.query("campaignOpens").withIndex("by_user_campaign", (q) => q.eq("userId", userId)).take(b.left)),
    async (ctx, b) => {
      if (email === null) return;
      await deleteAll(ctx, b, "campaignInvites", await ctx.db.query("campaignInvites").withIndex("by_email", (q) => q.eq("email", email)).take(b.left));
    },
    async (ctx, b) => deleteAll(ctx, b, "userPreferences", await ctx.db.query("userPreferences").withIndex("by_user", (q) => q.eq("userId", userId)).take(b.left)),
    async (ctx, b) => deleteAll(ctx, b, "userUiState", await ctx.db.query("userUiState").withIndex("by_user_key", (q) => q.eq("userId", userId)).take(b.left)),
    async (ctx, b) => deleteAll(ctx, b, "userDrafts", await ctx.db.query("userDrafts").withIndex("by_user_kind_campaign", (q) => q.eq("userId", userId)).take(b.left)),
    async (ctx, b) => deleteAll(ctx, b, "handFolds", await ctx.db.query("handFolds").withIndex("by_user_character", (q) => q.eq("userId", userId)).take(b.left)),
    async (ctx, b) => deleteAll(ctx, b, "uploadNotices", await ctx.db.query("uploadNotices").withIndex("by_user", (q) => q.eq("userId", userId)).take(b.left)),
    async (ctx, b) => deleteAll(ctx, b, "lorekeeperUsage", await ctx.db.query("lorekeeperUsage").withIndex("by_user_period", (q) => q.eq("userId", userId)).take(b.left)),
    async (ctx, b) => deleteAll(ctx, b, "appTesters", await ctx.db.query("appTesters").withIndex("by_user", (q) => q.eq("userId", userId)).take(b.left)),
    async (ctx, b) => deleteAll(ctx, b, "settings", await ctx.db.query("settings").withIndex("by_owner", (q) => q.eq("ownerId", userId)).take(b.left)),
    async (ctx, b) =>
      deleteAll(
        ctx,
        b,
        "grants",
        await ctx.db
          .query("grants")
          .withIndex("by_principal_type", (q) => q.eq("principalKind", "user").eq("principalId", userId))
          .take(b.left),
      ),
    // Apple tokens still stored on the logins (the owner's Delete account): revoked before the rows go.
    async (ctx) => {
      const tokens = await takeAppleTokens(ctx, userId);
      if (tokens.length > 0) await ctx.scheduler.runAfter(0, internal.accountSelfDelete.revokeAppleTokens, { tokens });
    },
    // Logins, each with its verification codes.
    async (ctx, b) => {
      const accounts = await ctx.db.query("authAccounts").withIndex("userIdAndProvider", (q) => q.eq("userId", userId)).take(b.left);
      for (const account of accounts) {
        const codes = await ctx.db.query("authVerificationCodes").withIndex("accountId", (q) => q.eq("accountId", account._id)).take(AUTH_CHILDREN);
        await deleteAll(ctx, b, "authVerificationCodes", codes);
        if (codes.length === AUTH_CHILDREN || b.left <= 0) return;
        await deleteAll(ctx, b, "authAccounts", [account]);
        if (b.left <= 0) return;
      }
    },
    async (ctx, b) => endSessions(ctx, userId, b),
  ];
}

/**
 * Erases one account past its `deleteAfter` (see the module comment), in batched runs that reschedule themselves.
 * Stops at once if the deletion was undone. Only a run started by `purgeDueAccounts` (`sweep`) goes on to the next
 * due account.
 */
export const purgeAccount = internalMutation({
  args: {
    userId: v.id("users"),
    phase: v.optional(phaseValidator),
    cursor: v.optional(v.string()),
    sweep: v.optional(v.boolean()),
  },
  returns: v.null(),
  handler: async (ctx, { userId, phase = "live", cursor, sweep }) => {
    const status = await accountStatusRow(ctx, userId);
    if (status?.deleteAfter === undefined || status.deleteAfter > Date.now()) return null;
    const again = (next: Phase, nextCursor?: string) =>
      ctx.scheduler.runAfter(0, internal.accountPurge.purgeAccount, { userId, phase: next, cursor: nextCursor, sweep });

    if (phase === "live") {
      const done = await settleLiveCampaigns(ctx, userId, status.by);
      await again(done ? "deleted" : "live");
      return null;
    }
    if (phase === "deleted") {
      const next = await scheduleDeletedPurges(ctx, userId, cursor ?? null);
      await (next === null ? again("rows") : again("deleted", next));
      return null;
    }

    const user = await ctx.db.get("users", userId);
    const budget: Budget = { left: ACCOUNT_PURGE_BATCH };
    for (const step of rowSteps(user, userId)) {
      await step(ctx, budget);
      if (budget.left <= 0) {
        await again("rows");
        return null;
      }
    }
    if (user !== null) await ctx.db.delete("users", userId);
    await ctx.db.delete("accountStatus", status._id);
    await recordAdminChange(ctx, status.by, { action: "account.delete", field: "erased", target: userId });
    if (sweep === true) await ctx.scheduler.runAfter(0, internal.accountPurge.purgeDueAccounts, {});
    return null;
  },
});
