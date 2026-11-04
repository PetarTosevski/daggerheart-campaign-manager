import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import { MAX_UPLOAD_NOTICES } from "./lib/files";
import { userMutation, userQuery } from "./lib/functions";
import { fileKindValidator } from "./tables/files";

/**
 * "That file isn't a real image, so it was removed" (dcm-vqs0). The byte check (`lib/files:rejectUpload`) writes a
 * notice for the uploader; their upload screen reads it here and the uploader dismisses it. Each caller sees only
 * their own notices, so no campaign check is needed.
 */

/** The caller's notices for one upload screen (`kind`, and the id it knows: see `uploadNotices.scope`), newest first. */
export const mine = userQuery({
  args: { kind: fileKindValidator, scope: v.string() },
  returns: v.array(v.object({ _id: v.id("uploadNotices"), createdAt: v.number() })),
  handler: async (ctx, { kind, scope }) => {
    const rows = await ctx.db
      .query("uploadNotices")
      .withIndex("by_user_scope", (q) => q.eq("userId", ctx.user._id).eq("kind", kind).eq("scope", scope))
      .order("desc")
      .take(MAX_UPLOAD_NOTICES);
    return rows.map((row) => ({ _id: row._id, createdAt: row.createdAt }));
  },
});

/** Dismisses one of the caller's notices. Already gone: nothing to do. Someone else's: NOT_FOUND. */
export const dismiss = userMutation({
  args: { noticeId: v.id("uploadNotices") },
  returns: v.null(),
  handler: async (ctx, { noticeId }) => {
    const notice = await ctx.db.get("uploadNotices", noticeId);
    if (notice === null) return null;
    if (notice.userId !== ctx.user._id) throw appError("NOT_FOUND");
    await ctx.db.delete("uploadNotices", noticeId);
    return null;
  },
});
