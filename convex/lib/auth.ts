import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";

import { appError } from "../../src/lib/errors/app-error";
import type { Doc } from "../_generated/dataModel";
import { env, type QueryCtx } from "../_generated/server";
import { isAllowedEmail } from "./allowlist";

/**
 * The signed-in user: null without a session, "forbidden" when the stored
 * user is gone or no longer on the sign-up allowlist (the allowlist is
 * re-read on every call: removing an address revokes access at once).
 */
async function sessionUser(ctx: QueryCtx): Promise<Doc<"users"> | null | "forbidden"> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const user = await ctx.db.get("users", userId);
  if (user === null || !isAllowedEmail(user.email, env)) return "forbidden";
  return user;
}

/**
 * The first authorisation gate, used by the wrappers in `lib/functions.ts`:
 * the user, or null without a session. Throws `FORBIDDEN` for a revoked user.
 */
export async function getUser(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const user = await sessionUser(ctx);
  if (user === "forbidden") throw appError("FORBIDDEN");
  return user;
}

/**
 * Legacy gate for functions not yet on the wrappers (string payloads, which
 * their tests still assert). Throws `UNAUTHENTICATED` without a session and
 * `FORBIDDEN` for a revoked user. New code uses `userQuery`/`userMutation`.
 */
export async function requireUser(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await sessionUser(ctx);
  if (user === null) throw new ConvexError("UNAUTHENTICATED");
  if (user === "forbidden") throw new ConvexError("FORBIDDEN");
  return user;
}
