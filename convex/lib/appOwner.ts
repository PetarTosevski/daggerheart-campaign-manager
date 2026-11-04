import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * The app owner (superadmin, config AD0, Q16 a). The owner is one stored user id, `appConfig.ownerId`, written only by
 * the internal `adminSetup.setOwner` (run with the deployment's admin key, `npx convex run adminSetup:setOwner`).
 * Never an email matched at request time, never an env var, never a client flag.
 *
 * `isAppOwner` is the ONLY owner check in the app: the `appOwner*` wrappers in `lib/functions.ts` call it before every
 * admin handler, and the owner's exemptions (Lorekeeper caps, read-only mode, the read-only campaign view) call it too.
 */

/** The `appConfig` singleton, or null before anything was saved. */
export async function appConfigRow(ctx: QueryCtx): Promise<Doc<"appConfig"> | null> {
  return ctx.db
    .query("appConfig")
    .withIndex("by_key", (q) => q.eq("key", "app"))
    .unique();
}

/** The stored owner id, or null while no owner is set. */
export async function appOwnerId(ctx: QueryCtx): Promise<Id<"users"> | null> {
  return (await appConfigRow(ctx))?.ownerId ?? null;
}

/**
 * Whether `user` (the wrapper's `ctx.user`, from `ctx.auth`) is the app owner. False when signed out and while no
 * owner is set. The owner's email must still be verified: an account whose verification was removed loses the role.
 */
export async function isAppOwner(ctx: QueryCtx, user: Doc<"users"> | null): Promise<boolean> {
  if (user === null || user.emailVerificationTime === undefined) return false;
  const ownerId = await appOwnerId(ctx);
  return ownerId !== null && ownerId === user._id;
}
