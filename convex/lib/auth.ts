import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";

import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { isAllowedEmail } from "./allowlist";

/**
 * The real authorisation gate: every public query and mutation calls this.
 * Throws `UNAUTHENTICATED` without a session and `FORBIDDEN` when the stored
 * user is no longer on the GM allowlist.
 */
export async function requireGm(ctx: QueryCtx): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new ConvexError("UNAUTHENTICATED");
  const user = await ctx.db.get(userId);
  if (user === null || !isAllowedEmail(user.email, process.env)) {
    throw new ConvexError("FORBIDDEN");
  }
  return user;
}
