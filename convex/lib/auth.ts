import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import { env, type QueryCtx } from "../_generated/server";
import { isAllowedEmail } from "./allowlist";

/**
 * The first authorisation gate: every public query and mutation calls this
 * (campaign functions then check the caller's role in `lib/access.ts`).
 * Throws `UNAUTHENTICATED` without a session and `FORBIDDEN` when the stored
 * user is no longer on the sign-up allowlist.
 */
export async function requireUser(ctx: QueryCtx): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new ConvexError("UNAUTHENTICATED");
  const user = await ctx.db.get(userId);
  if (user === null || !isAllowedEmail(user.email, env)) {
    throw new ConvexError("FORBIDDEN");
  }
  return user;
}
