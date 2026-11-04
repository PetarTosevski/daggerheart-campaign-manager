import { v } from "convex/values";

import type { Id } from "./_generated/dataModel";
import { undoEntry } from "./lib/actionLog";
import { fearFor } from "./lib/fearVisibility";
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
  /** `fearReverted` is absent for a player while "Players see the GM's Fear" is off (dcm-jh6d.62). */
  returns: v.object({ undone: v.array(v.id("actionLog")), fearReverted: v.optional(v.number()) }),
  handler: async (ctx, { entryId }): Promise<{ undone: Id<"actionLog">[]; fearReverted?: number }> => {
    const result = await ctx.once("action_undo", { entryId }, () => undoEntry(ctx, ctx.user, entryId, { kinds: ["rest"], message: "" }));
    // The row stays (marked undone), so its campaign decides what the caller may see of the Fear it took back.
    const row = await ctx.db.get("actionLog", entryId);
    const campaign = row === null ? null : await ctx.db.get("campaigns", row.campaignId);
    return campaign === null ? { undone: result.undone } : fearFor(ctx, ctx.user, campaign, result, "fearReverted");
  },
});
