import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { env, internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { accountStatusRow, endSessions } from "./accountPurge";
import { ACCOUNT_DELETE_WAIT_MS } from "./adminAccountActions";
import { recordAdminChange } from "./lib/adminAudit";
import { appOwnerId } from "./lib/appOwner";
import {
  exchangeAppleAuthorizationCode,
  revokeAppleToken,
  saveAppleRefreshToken,
  takeAppleTokens,
  type AppleEnv,
  type AppleRevokeResult,
  type AppleToken,
} from "./lib/appleRevoke";
import { isAccountSuspended, userMutation } from "./lib/functions";

/**
 * Self-service account deletion (plan account-deletion DEL1, bead dcm-gdzi.8; App Store 5.1.1(v); user 2026-11-06).
 *
 * - `deleteMyAccount`: the caller's account is refused at once and signed out everywhere (its sessions and refresh
 *   tokens go), and the existing daily purge (`accountPurge`) erases it 30 days later, exactly as the owner's Delete
 *   account (AD14). Its stored Sign in with Apple tokens are revoked at once (`lib/appleRevoke.ts`; logged and skipped
 *   without the Apple env). The app owner can't delete their own account (OWNER_ACCOUNT_UNDELETABLE).
 * - Signing back in within the 30 days cancels it: the sign-in that a waiting deletion would refuse succeeds instead
 *   and clears it (`resumeSelfDeletedAccount`, called by every sign-in path in `convex/auth.ts`).
 * - Self-requested vs owner-imposed: a self-deletion is the `accountStatus` row the account wrote for itself
 *   (`by === userId`, which the owner's functions can never write: they refuse the owner's own account) with only
 *   `deleteAfter` set. When the owner suspends such an account (`suspendedAt`, `by` = owner) or schedules its deletion
 *   themselves, the row is the owner's, and sign-in is refused as before.
 */

/** The reason stored on the `accountStatus` row (the owner's account table shows it). */
export const SELF_DELETE_REASON = "Deleted by the account holder";

/** True for a row the account wrote for itself, still inside its 30 days (sign-in cancels it). */
export function isSelfDeletion(row: Doc<"accountStatus">, now: number): boolean {
  return row.by === row.userId && row.suspendedAt === undefined && row.deleteAfter !== undefined && row.deleteAfter > now;
}

/** Cancels the account's own waiting deletion; true when it did. Anything the owner set stays. */
export async function resumeSelfDeletedAccount(ctx: MutationCtx, userId: Id<"users">): Promise<boolean> {
  const row = await accountStatusRow(ctx, userId);
  if (row === null || !isSelfDeletion(row, Date.now())) return false;
  await ctx.db.delete("accountStatus", row._id);
  await recordAdminChange(ctx, userId, { action: "account.restore", field: "self.signIn", target: userId });
  return true;
}

/** Schedules the revocation of the account's stored Apple tokens (taken off its login rows). */
export async function scheduleAppleRevocation(ctx: MutationCtx, userId: Id<"users">): Promise<void> {
  const tokens = await takeAppleTokens(ctx, userId);
  if (tokens.length > 0) await ctx.scheduler.runAfter(0, internal.accountSelfDelete.revokeAppleTokens, { tokens });
}

/** Delete my account: refused and signed out now, erased after 30 days unless the person signs in again. */
export const deleteMyAccount = userMutation({
  args: {},
  returns: v.object({ deleteAfter: v.number() }),
  handler: async (ctx) => {
    const userId = ctx.user._id;
    if (userId === (await appOwnerId(ctx))) throw appError("OWNER_ACCOUNT_UNDELETABLE");
    // The wrapper refuses a suspended or to-be-deleted account, so there is no row yet.
    const now = Date.now();
    const deleteAfter = now + ACCOUNT_DELETE_WAIT_MS;
    const row = await accountStatusRow(ctx, userId);
    const fields = { deleteAfter, reason: SELF_DELETE_REASON, by: userId, updatedAt: now };
    if (row === null) await ctx.db.insert("accountStatus", { userId, ...fields });
    else await ctx.db.patch("accountStatus", row._id, fields);
    await scheduleAppleRevocation(ctx, userId);
    await endSessions(ctx, userId);
    await recordAdminChange(ctx, userId, { action: "account.delete", field: "self", target: userId });
    return { deleteAfter };
  },
});

/**
 * Asked by `convex/auth.ts` after a credentials sign-in (password, e2e, Apple) of an existing account: cancels the
 * account's own waiting deletion, then answers whether the sign-in may go on (false: suspended or deleted by the owner).
 */
export const signInAllowed = internalMutation({
  args: { userId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { userId }) => {
    const id = ctx.db.normalizeId("users", userId);
    if (id === null) return true;
    await resumeSelfDeletedAccount(ctx, id);
    return !(await isAccountSuspended(ctx, id));
  },
});

const appleTokenValidator = v.object({ clientId: v.string(), refreshToken: v.string() });

/** Revokes Apple tokens one by one; a failure is logged and the rest still go (deletion never waits on Apple). */
export const revokeAppleTokens = internalAction({
  args: { tokens: v.array(appleTokenValidator) },
  returns: v.array(v.union(v.literal("revoked"), v.literal("skipped"), v.literal("failed"))),
  handler: async (_ctx, { tokens }) => {
    const results: AppleRevokeResult[] = [];
    for (const token of tokens) results.push(await revokeAppleToken(token, appleEnv()));
    return results;
  },
});

/**
 * Keeps the refresh token of a native Apple sign-in so deletion can revoke it: the phone's Apple provider schedules
 * this with the sign-in's one-time `authorizationCode` and the token's audience (the bundle id).
 */
export const rememberAppleSignIn = internalAction({
  args: { userId: v.id("users"), clientId: v.string(), authorizationCode: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { userId, clientId, authorizationCode }): Promise<boolean> => {
    const refreshToken = await exchangeAppleAuthorizationCode({ clientId, authorizationCode }, appleEnv());
    if (refreshToken === null) return false;
    return ctx.runMutation(internal.accountSelfDelete.saveAppleToken, { userId, token: { clientId, refreshToken } });
  },
});

export const saveAppleToken = internalMutation({
  args: { userId: v.id("users"), token: appleTokenValidator },
  returns: v.boolean(),
  handler: (ctx, { userId, token }: { userId: Id<"users">; token: AppleToken }) => saveAppleRefreshToken(ctx, userId, token),
});

/** The Apple variables from the Convex env (declared in `convex/convex.config.ts`; read at call time, CF19). */
function appleEnv(): AppleEnv {
  const all = env as unknown as Record<string, string | undefined>;
  return {
    APPLE_TEAM_ID: all.APPLE_TEAM_ID,
    APPLE_KEY_ID: all.APPLE_KEY_ID,
    APPLE_PRIVATE_KEY: all.APPLE_PRIVATE_KEY,
    APPLE_CLIENT_SECRET: all.APPLE_CLIENT_SECRET,
  };
}
