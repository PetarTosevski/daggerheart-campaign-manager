import { appError } from "../../src/lib/errors/app-error";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { normalizeJoinCode } from "../members";
import { normalizeEmail } from "./allowlist";
import { readAppConfig } from "./appConfig";
import { isAccountSuspended, readAppStatus } from "./functions";

export const PASSWORD_PROVIDER_ID = "password";

export type SignInArgs = {
  existingUserId: Id<"users"> | null;
  provider?: { id: string };
  profile: Record<string, unknown> & { email?: string; emailVerified?: boolean; joinCode?: string };
};

/** The refusal of a new account (config AD4), as an error code. */
export type SignUpRefusal = "SIGN_UP_CLOSED" | "SIGN_UP_INVITE_ONLY";

/** The longest join code accepted from the sign-up params before normalising (real codes are far shorter). */
const MAX_JOIN_CODE_INPUT = 64;

/** The join code carried in the sign-up params (the password form passes the one of a /join/<code> link), or null. */
export function signUpJoinCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > MAX_JOIN_CODE_INPUT) return null;
  const code = normalizeJoinCode(raw);
  return code === "" ? null : code;
}

/**
 * Whether the owner's sign-up mode (config AD4, Q18 a) refuses a NEW account for `email`; null when it is allowed.
 * - Read-only mode (AD10) or `closed`: `SIGN_UP_CLOSED`.
 * - `invite`: allowed for an email with a pending invite to a live campaign, or when `joinCode` is the code of a live
 *   campaign; otherwise `SIGN_UP_INVITE_ONLY`.
 * - `open` (the default): allowed.
 * The answer depends only on the mode, the invites and the code, never on whether the email has an account, so
 * callers can ask it before looking the email up (`auth.ts` does, so a refused sign-up reveals nothing).
 */
export async function signUpRefusal(
  ctx: QueryCtx,
  email: string,
  joinCode: string | null,
): Promise<SignUpRefusal | null> {
  if ((await readAppStatus(ctx)).readOnly) return "SIGN_UP_CLOSED";
  const { signUpMode } = await readAppConfig(ctx);
  if (signUpMode === "open") return null;
  if (signUpMode === "closed") return "SIGN_UP_CLOSED";
  // A handful of invites per email at most; a deleted campaign's invite does not count.
  const invites = await ctx.db
    .query("campaignInvites")
    .withIndex("by_email", (q) => q.eq("email", normalizeEmail(email)))
    .take(20);
  for (const invite of invites) {
    const campaign = await ctx.db.get(invite.campaignId);
    if (campaign !== null && campaign.deletedAt === undefined) return null;
  }
  if (joinCode !== null) {
    const campaign = await ctx.db
      .query("campaigns")
      .withIndex("by_joinCode", (q) => q.eq("joinCode", joinCode))
      .first();
    if (campaign !== null && campaign.deletedAt === undefined) return null;
  }
  return "SIGN_UP_INVITE_ONLY";
}

/**
 * Convex Auth's `createOrUpdateUser` callback. Runs on every sign-in, account creation and code verification.
 * Who may sign up follows the owner's sign-up mode (below); what keeps accounts apart is whether the email is verified.
 * - Existing account (`existingUserId`): returned as is. When the profile says the email is now verified (the code
 *   was entered, or Google vouched), the user is marked verified here, because this callback replaces Convex
 *   Auth's default one, which would have done it.
 * - Google / e2e: a verified email is required. An existing user with that email is reused only when verified; a
 *   user held by an UNVERIFIED password account loses that password login, its codes and sessions, and is verified.
 * - Password sign-up: the account starts unverified (no `emailVerificationTime`, no session until the code is
 *   entered). An email whose user is VERIFIED and has no password account (a Google user) gets a pending password
 *   account on that SAME user: nothing on the user changes, and the account cannot sign in until the emailed code
 *   marks it verified (the library sends a code instead of a session for an unverified account). Any other existing
 *   user is refused with `EMAIL_TAKEN`. (An abandoned unverified password account is replaced earlier, in `auth.ts`.)
 * The email is normalised to lower case.
 *
 * Suspended accounts (config AD14, N11): any sign-in or link that lands on a suspended account, or one waiting for
 * deletion, is refused with `ACCOUNT_SUSPENDED`.
 *
 * Sign-up mode (config AD4): only the insert of a NEW user is gated, by `signUpRefusal` (the password profile carries
 * the join code; Google carries none, so in invite mode Google creates only invited emails). Signing in, verifying,
 * and reusing or linking an existing user (the app owner's included) are never refused here.
 */
export async function createOrUpdateUser(
  ctx: MutationCtx,
  args: SignInArgs,
): Promise<Id<"users">> {
  const isPassword = args.provider?.id === PASSWORD_PROVIDER_ID;
  const verified = args.profile.emailVerified === true;

  if (args.existingUserId !== null) {
    // AD14 (N11): a suspended account, or one waiting for deletion, can't sign in.
    if (await isAccountSuspended(ctx, args.existingUserId)) throw appError("ACCOUNT_SUSPENDED");
    if (verified) {
      const user = await ctx.db.get(args.existingUserId);
      if (user !== null && user.emailVerificationTime === undefined) {
        await ctx.db.patch(user._id, { emailVerificationTime: Date.now() });
      }
    }
    return args.existingUserId;
  }

  const rawEmail = args.profile.email;
  if (typeof rawEmail !== "string" || normalizeEmail(rawEmail) === "") throw appError("INVALID");
  const email = normalizeEmail(rawEmail);
  if (!isPassword && !verified) throw appError("FORBIDDEN");

  const existing = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .unique();
  if (existing !== null) {
    // AD14: signing in to (or linking a new login to) a suspended account is refused too.
    if (await isAccountSuspended(ctx, existing._id)) throw appError("ACCOUNT_SUSPENDED");
    if (isPassword) {
      if (existing.emailVerificationTime === undefined) throw appError("EMAIL_TAKEN");
      const held = await ctx.db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q) => q.eq("userId", existing._id).eq("provider", PASSWORD_PROVIDER_ID))
        .first();
      if (held !== null) throw appError("EMAIL_TAKEN");
      return existing._id;
    }
    if (existing.emailVerificationTime === undefined) {
      // A password account was registered for this address before its owner proved ownership; whoever chose that
      // password must not keep access.
      const accounts = await ctx.db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q) => q.eq("userId", existing._id).eq("provider", PASSWORD_PROVIDER_ID))
        .take(10);
      for (const account of accounts) {
        const codes = await ctx.db
          .query("authVerificationCodes")
          .withIndex("accountId", (q) => q.eq("accountId", account._id))
          .take(10);
        for (const code of codes) await ctx.db.delete(code._id);
        await ctx.db.delete(account._id);
      }
      // End any session the password holder already has.
      const sessions = await ctx.db
        .query("authSessions")
        .withIndex("userId", (q) => q.eq("userId", existing._id))
        .take(100);
      for (const session of sessions) await ctx.db.delete(session._id);
      await ctx.db.patch(existing._id, { emailVerificationTime: Date.now() });
    }
    return existing._id;
  }

  const refusal = await signUpRefusal(ctx, email, isPassword ? signUpJoinCode(args.profile.joinCode) : null);
  if (refusal !== null) throw appError(refusal);

  const name = typeof args.profile.name === "string" ? args.profile.name.trim() : "";
  if (isPassword) {
    return await ctx.db.insert("users", { email, ...(name ? { name } : {}) });
  }
  return await ctx.db.insert("users", {
    email,
    emailVerificationTime: Date.now(),
    ...(name ? { name } : {}),
    ...(typeof args.profile.image === "string" ? { image: args.profile.image } : {}),
  });
}
