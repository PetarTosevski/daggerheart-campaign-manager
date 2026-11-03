import { v } from "convex/values";

import { undoEntry } from "./lib/actionLog";
import { keyedUserMutation } from "./lib/functions";

/**
 * Undoes an action log row and its group (D5): the row's actor or the GM,
 * only while nothing newer happened to its characters (else UNDO_STALE). Once
 * the action rolled only the GM may undo it (a player gets UNDO_EXPIRED: the
 * player-undo rule, `groupRolled` in convex/lib/actionLog.ts). Restores the `before` sheets and takes back the Fear the
 * action gained. Rest rows are refused (UNDO_USE_REST): `rests.undo` also
 * reopens the rest.
 * The feed that lists rows is `feed.list` (T1).
 */
export const undo = keyedUserMutation({
  args: { entryId: v.id("actionLog") },
  returns: v.object({ undone: v.array(v.id("actionLog")), fearReverted: v.number() }),
  handler: async (ctx, { entryId }) =>
    ctx.once("action_undo", { entryId }, () => undoEntry(ctx, ctx.user, entryId, { kinds: ["rest"], message: "" })),
});
