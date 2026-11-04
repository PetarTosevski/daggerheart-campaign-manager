import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { internalMutation } from "./_generated/server";
import { recordAdminChange } from "./lib/adminAudit";
import { normalizeEmail } from "./lib/allowlist";
import { appConfigRow } from "./lib/appOwner";

/**
 * Names the app owner (superadmin, config AD0, Q16 a). Internal, so only someone with the deployment's admin key can
 * run it:
 *
 *     npx convex run adminSetup:setOwner '{"email": "you@example.com"}'
 *
 * It resolves the account by a VERIFIED email once (CF3: an unverified look-alike account never becomes owner) and
 * stores that user's id in `appConfig.ownerId`; later email changes do not move the role. Running it again with
 * another email hands the role over. Writes an `owner.set` audit row.
 */
export const setOwner = internalMutation({
  args: { email: v.string() },
  returns: v.object({ userId: v.id("users") }),
  handler: async (ctx, { email }) => {
    const wanted = normalizeEmail(email);
    if (wanted === "") throw appError("INVALID", "Give the owner's email.");
    const matches = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", wanted))
      .take(10);
    const verified = matches.filter((user) => user.emailVerificationTime !== undefined);
    if (verified.length === 0) throw appError("NOT_FOUND", "No account with that verified email. Sign in once and confirm the email first.");
    if (verified.length > 1) throw appError("INVALID", "More than one verified account has that email.");
    const owner = verified[0];

    const row = await appConfigRow(ctx);
    const now = Date.now();
    const previous = row?.ownerId;
    if (row === null) await ctx.db.insert("appConfig", { key: "app", ownerId: owner._id, updatedAt: now });
    else await ctx.db.patch("appConfig", row._id, { ownerId: owner._id, updatedAt: now });
    await recordAdminChange(ctx, owner._id, {
      action: "owner.set",
      ...(previous !== undefined ? { from: previous } : {}),
      to: owner._id,
      target: owner._id,
    });
    return { userId: owner._id };
  },
});
