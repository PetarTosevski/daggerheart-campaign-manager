import { v } from "convex/values";

import { undoEntry } from "./lib/actionLog";
import { keyedUserMutation } from "./lib/functions";

/**
 * Undoes an action log row and its group (D5): the row's actor or the GM,
 * only while it is still each character's latest live row (else UNDO_STALE).
 * Restores the `before` sheets and takes back the Fear the action gained.
 * The feed that lists rows is `feed.list` (T1).
 */
export const undo = keyedUserMutation({
  args: { entryId: v.id("actionLog") },
  returns: v.object({ undone: v.array(v.id("actionLog")), fearReverted: v.number() }),
  handler: async (ctx, { entryId }) => ctx.once("action_undo", { entryId }, () => undoEntry(ctx, ctx.user, entryId)),
});
