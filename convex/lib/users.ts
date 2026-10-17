import { ConvexError } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { isAllowedEmail, isAllowedProfile, normalizeEmail, type Env } from "./allowlist";

export const PASSWORD_PROVIDER_ID = "password";

export type SignInArgs = {
  existingUserId: Id<"users"> | null;
  provider?: { id: string };
  profile: Record<string, unknown> & { email?: string; emailVerified?: boolean };
};

/**
 * Convex Auth's `createOrUpdateUser` callback. Runs on every sign-in and
 * account creation.
 * - Google / e2e: a verified, allowlisted email; an existing user with that
 *   email is reused (the provider proved ownership of the address).
 * - Password: an allowlisted email. The address is not verified, so a new
 *   password account is refused when a user with that email already exists;
 *   otherwise registering someone's email would take over their account.
 */
export async function createOrUpdateUser(
  ctx: Pick<MutationCtx, "db">,
  args: SignInArgs,
  env: Env,
): Promise<Id<"users">> {
  const isPassword = args.provider?.id === PASSWORD_PROVIDER_ID;
  const allowed = isPassword
    ? isAllowedEmail(args.profile.email, env)
    : isAllowedProfile(args.profile, env);
  if (!allowed) throw new ConvexError("FORBIDDEN");
  if (args.existingUserId !== null) return args.existingUserId;

  const email = normalizeEmail(args.profile.email as string);
  const existing = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .unique();
  if (existing !== null) {
    if (isPassword) throw new ConvexError("EMAIL_IN_USE");
    if (existing.emailVerificationTime === undefined) {
      // A password account was registered for this address before its owner
      // proved ownership; whoever chose that password must not keep access.
      const accounts = await ctx.db
        .query("authAccounts")
        .withIndex("userIdAndProvider", (q) => q.eq("userId", existing._id).eq("provider", PASSWORD_PROVIDER_ID))
        .collect();
      for (const account of accounts) await ctx.db.delete(account._id);
      // End any session the password holder already has.
      const sessions = await ctx.db
        .query("authSessions")
        .withIndex("userId", (q) => q.eq("userId", existing._id))
        .collect();
      for (const session of sessions) await ctx.db.delete(session._id);
      await ctx.db.patch(existing._id, { emailVerificationTime: Date.now() });
    }
    return existing._id;
  }
  if (isPassword) {
    return await ctx.db.insert("users", {
      email,
      ...(typeof args.profile.name === "string" && args.profile.name.trim()
        ? { name: args.profile.name.trim() }
        : {}),
    });
  }

  return await ctx.db.insert("users", {
    email,
    emailVerificationTime: Date.now(),
    ...(typeof args.profile.name === "string" ? { name: args.profile.name } : {}),
    ...(typeof args.profile.image === "string" ? { image: args.profile.image } : {}),
  });
}
