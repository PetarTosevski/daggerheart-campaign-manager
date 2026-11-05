import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { accountStatusRow, endSessions } from "./accountPurge";
import { recordAdminChange } from "./lib/adminAudit";
import { normalizeEmail } from "./lib/allowlist";
import { appOwnerId } from "./lib/appOwner";
import { appOwnerMutation, appOwnerQuery } from "./lib/functions";
import { accountStatusValidator } from "./lib/validators/admin";

/**
 * App admin, Accounts: suspend and delete accounts (config AD14, Q28 b; the user's N11 answers of 2026-11-04).
 * Owner only: every function is an `appOwner*` builder. Every step writes one `adminAudit` row.
 *
 * - Suspend: the account is signed out everywhere (its sessions and refresh tokens are deleted) and refused by every
 *   wrapper and at sign-in with ACCOUNT_SUSPENDED; nothing is deleted, and its campaigns stay playable for the others.
 *   Lift suspension undoes it at any time.
 * - Delete account: suspended at once the same way, and erased 30 days later by `accountPurge` (its campaigns go to a
 *   co-GM or are deleted with the restore window; its characters in other campaigns stay as "former player"). Undo
 *   cancels it until then.
 * - Safeguards: Suspend and Delete need a reason and the account's email typed again (`confirmEmail`; INVALID when it
 *   differs); the owner's own account (the app owner) can never be targeted (FORBIDDEN). Lift and Undo take only the id.
 * - A step that changes nothing (suspending a suspended account, undoing nothing) writes nothing and returns null.
 */

/** A reason is required, at most this many characters (after trimming). */
export const ACCOUNT_REASON_MAX = 300;
/** Delete account waits this long, with Undo, before the account is erased (N11). */
export const ACCOUNT_DELETE_WAIT_MS = 30 * 24 * 60 * 60 * 1000;
/** The most suspended / to-be-deleted accounts `statuses` returns (only such accounts have a row). */
export const ACCOUNT_STATUS_MAX = 200;

/** The account to act on: it exists and is neither the caller nor the app owner. */
async function targetAccount(ctx: MutationCtx, callerId: Id<"users">, userId: Id<"users">): Promise<Doc<"users">> {
  const user = await ctx.db.get("users", userId);
  if (user === null) throw appError("NOT_FOUND");
  if (userId === callerId || userId === (await appOwnerId(ctx))) {
    throw appError("FORBIDDEN", "The owner's account can't be suspended or deleted.");
  }
  return user;
}

/** The trimmed reason, or INVALID when it is empty or too long. */
function checkedReason(reason: string): string {
  const text = reason.trim();
  if (text === "") throw appError("INVALID", "Give a reason.");
  if (text.length > ACCOUNT_REASON_MAX) throw appError("INVALID", `A reason is at most ${ACCOUNT_REASON_MAX} characters.`);
  return text;
}

/** INVALID unless `confirmEmail` is the account's email (case and spaces aside). */
function checkConfirmEmail(user: Doc<"users">, confirmEmail: string): void {
  if (user.email === undefined || normalizeEmail(confirmEmail) !== normalizeEmail(user.email)) {
    throw appError("INVALID", "Type the account's email exactly to confirm.");
  }
}

/** Writes the account's status row (inserting it when missing). */
async function writeStatus(
  ctx: MutationCtx,
  row: Doc<"accountStatus"> | null,
  userId: Id<"users">,
  fields: { suspendedAt?: number; deleteAfter?: number; reason: string; by: Id<"users"> },
): Promise<void> {
  const updatedAt = Date.now();
  if (row === null) await ctx.db.insert("accountStatus", { userId, ...fields, updatedAt });
  else await ctx.db.patch("accountStatus", row._id, { ...fields, updatedAt });
}

/** Clears one of the two marks; the row goes when neither is left. */
async function clearMark(ctx: MutationCtx, row: Doc<"accountStatus">, mark: "suspendedAt" | "deleteAfter"): Promise<void> {
  const other = mark === "suspendedAt" ? row.deleteAfter : row.suspendedAt;
  if (other === undefined) await ctx.db.delete("accountStatus", row._id);
  else await ctx.db.patch("accountStatus", row._id, { [mark]: undefined, updatedAt: Date.now() });
}

const confirmedArgs = { userId: v.id("users"), reason: v.string(), confirmEmail: v.string() };

/** Suspend: signed out everywhere, can't sign in or use the app; nothing is deleted (N11). */
export const suspend = appOwnerMutation({
  args: confirmedArgs,
  returns: v.null(),
  handler: async (ctx, { userId, reason, confirmEmail }) => {
    const user = await targetAccount(ctx, ctx.user._id, userId);
    const text = checkedReason(reason);
    checkConfirmEmail(user, confirmEmail);
    const row = await accountStatusRow(ctx, userId);
    if (row?.suspendedAt !== undefined) return null;
    await writeStatus(ctx, row, userId, { suspendedAt: Date.now(), reason: text, by: ctx.user._id });
    await endSessions(ctx, userId);
    await recordAdminChange(ctx, ctx.user._id, { action: "account.suspend", target: userId, to: text });
    return null;
  },
});

/** Lift suspension. A deletion waiting for its 30 days stays (Undo cancels that). */
export const unsuspend = appOwnerMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await targetAccount(ctx, ctx.user._id, userId);
    const row = await accountStatusRow(ctx, userId);
    if (row?.suspendedAt === undefined) return null;
    await clearMark(ctx, row, "suspendedAt");
    await recordAdminChange(ctx, ctx.user._id, { action: "account.unsuspend", target: userId });
    return null;
  },
});

/** Delete account: refused at once like a suspension, erased after 30 days unless undone (N11). */
export const scheduleDelete = appOwnerMutation({
  args: confirmedArgs,
  returns: v.null(),
  handler: async (ctx, { userId, reason, confirmEmail }) => {
    const user = await targetAccount(ctx, ctx.user._id, userId);
    const text = checkedReason(reason);
    checkConfirmEmail(user, confirmEmail);
    const row = await accountStatusRow(ctx, userId);
    if (row?.deleteAfter !== undefined) return null;
    const deleteAfter = Date.now() + ACCOUNT_DELETE_WAIT_MS;
    await writeStatus(ctx, row, userId, { deleteAfter, reason: text, by: ctx.user._id });
    await endSessions(ctx, userId);
    await recordAdminChange(ctx, ctx.user._id, { action: "account.delete", field: "scheduled", target: userId, to: text });
    return null;
  },
});

/** Undo a waiting deletion. A suspension set by hand before it stays. */
export const cancelDelete = appOwnerMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await targetAccount(ctx, ctx.user._id, userId);
    const row = await accountStatusRow(ctx, userId);
    if (row?.deleteAfter === undefined) return null;
    await clearMark(ctx, row, "deleteAfter");
    await recordAdminChange(ctx, ctx.user._id, { action: "account.restore", target: userId });
    return null;
  },
});

/** Every suspended or to-be-deleted account, for the account table's row marks (at most `ACCOUNT_STATUS_MAX`). */
export const statuses = appOwnerQuery({
  args: {},
  returns: v.array(accountStatusValidator),
  handler: async (ctx) => {
    const rows = await ctx.db.query("accountStatus").withIndex("by_user").take(ACCOUNT_STATUS_MAX);
    return rows.map((row) => ({ userId: row.userId, suspended: row.suspendedAt !== undefined, deleteAfter: row.deleteAfter ?? null }));
  },
});
