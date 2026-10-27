import { getAuthUserId } from "@convex-dev/auth/server";
import { appError } from "../../src/lib/errors/app-error";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * The signed-in user: null without a session, "forbidden" when the stored
 * user row is gone (a deleted user is refused on every call). Sign-up is open,
 * so there is no further gate.
 */
async function sessionUser(ctx: QueryCtx): Promise<Doc<"users"> | null | "forbidden"> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  const user = await ctx.db.get("users", userId);
  if (user === null) return "forbidden";
  return user;
}

/**
 * The first authorisation gate, used by the wrappers in `lib/functions.ts`:
 * the user, or null without a session. Throws `FORBIDDEN` for a deleted user.
 */
export async function getUser(ctx: QueryCtx): Promise<Doc<"users"> | null> {
  const user = await sessionUser(ctx);
  if (user === "forbidden") throw appError("FORBIDDEN");
  return user;
}

/**
 * The signed-in user or a throw: `UNAUTHENTICATED` without a session and
 * `FORBIDDEN` for a deleted user. Public functions use the wrappers in
 * `lib/functions.ts` instead.
 */
export async function requireUser(ctx: QueryCtx): Promise<Doc<"users">> {
  const user = await sessionUser(ctx);
  if (user === null) throw appError("UNAUTHENTICATED");
  if (user === "forbidden") throw appError("FORBIDDEN");
  return user;
}
