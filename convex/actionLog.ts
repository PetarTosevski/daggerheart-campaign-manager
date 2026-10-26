import { v } from "convex/values";

import { undoEntry } from "./lib/actionLog";
import { keyedUserMutation } from "./lib/functions";

/**
 * Undoes an action log row and its group (D5): the row's actor or the GM,
 * only while nothing newer happened to its characters (else UNDO_STALE; see
 * `undoEntry`). Restores the `before` sheets and takes back the Fear the
 * action gained. Rest rows are refused: `rests.undo` also reopens the rest.
 * The feed that lists rows is `feed.list` (T1).
 */
export const undo = keyedUserMutation({
  args: { entryId: v.id("actionLog") },
  returns: v.object({ undone: v.array(v.id("actionLog")), fearReverted: v.number() }),
  handler: async (ctx, { entryId }) =>
    ctx.once("action_undo", { entryId }, () => undoEntry(ctx, ctx.user, entryId, { kinds: ["rest"], message: "Undo a rest from the rest panel." })),
});
