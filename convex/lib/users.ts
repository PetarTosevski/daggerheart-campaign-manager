import { appError } from "../../src/lib/errors/app-error";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { normalizeEmail } from "./allowlist";

export const PASSWORD_PROVIDER_ID = "password";

export type SignInArgs = {
  existingUserId: Id<"users"> | null;
  provider?: { id: string };
  profile: Record<string, unknown> & { email?: string; emailVerified?: boolean };
};

/**
 * Convex Auth's `createOrUpdateUser` callback. Runs on every sign-in, account creation and code verification.
 * Sign-up is open; what keeps accounts apart is whether the email is verified.
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
 */
export async function createOrUpdateUser(
  ctx: Pick<MutationCtx, "db">,
  args: SignInArgs,
): Promise<Id<"users">> {
  const isPassword = args.provider?.id === PASSWORD_PROVIDER_ID;
  const verified = args.profile.emailVerified === true;

  if (args.existingUserId !== null) {
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
