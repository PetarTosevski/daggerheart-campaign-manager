import { ConvexError } from "convex/values";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { isAllowedProfile, normalizeEmail, type Env } from "./allowlist";

export type SignInArgs = {
  existingUserId: Id<"users"> | null;
  profile: Record<string, unknown> & { email?: string; emailVerified?: boolean };
};

/**
 * Convex Auth's `createOrUpdateUser` callback. Runs on every sign-in and
 * account creation; only a verified, allowlisted email gets a user.
 */
export async function createOrUpdateGmUser(
  ctx: Pick<MutationCtx, "db">,
  args: SignInArgs,
  env: Env,
): Promise<Id<"users">> {
  if (!isAllowedProfile(args.profile, env)) {
    throw new ConvexError("FORBIDDEN");
  }
  if (args.existingUserId !== null) return args.existingUserId;

  const email = normalizeEmail(args.profile.email as string);
  const existing = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .unique();
  if (existing !== null) return existing._id;

  return await ctx.db.insert("users", {
    email,
    emailVerificationTime: Date.now(),
    ...(typeof args.profile.name === "string" ? { name: args.profile.name } : {}),
    ...(typeof args.profile.image === "string" ? { image: args.profile.image } : {}),
  });
}
