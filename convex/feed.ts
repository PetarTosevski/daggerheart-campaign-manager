import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel";
import { campaignQuery } from "./lib/functions";
import { actionKindValidator, rollValidator, visibilityValidator } from "./lib/validators/actionLog";

/** What every feed row shows. Never the `before` snapshot: it holds the whole sheet, notes included. */
const common = {
  _id: v.id("actionLog"),
  at: v.number(),
  kind: actionKindValidator,
  summary: v.string(),
  roll: v.optional(rollValidator),
  characterId: v.optional(v.id("characters")),
  actorId: v.id("users"),
  /** GM Fear the row gained (positive) or removed. */
  fearDelta: v.optional(v.number()),
  undone: v.boolean(),
  /** The viewer is the row's actor or the GM, and the row is undoable and not undone (undo may still say UNDO_STALE). */
  canUndo: v.boolean(),
};

/** A player only ever receives public rows. */
const playerRow = v.object({ ...common, visibility: v.literal("public") });
/** The GM's rows include hidden GM free rolls, which `rolls.reveal` makes public. */
const gmRow = v.object({ ...common, visibility: visibilityValidator, revealable: v.boolean() });

/**
 * The roll feed (D5): the campaign's action log, newest first, one page at a
 * time. The GM reads every row (`by_campaign_at`); players read only public
 * rows (`by_campaign_visibility_at`), so a GM free roll stays hidden from them
 * until it is revealed (decision 2), whatever the client asks for.
 */
export const list = campaignQuery({
  need: "view",
  enough: "owner",
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.union(gmRow, playerRow)),
  handler: async (ctx, { paginationOpts }) => {
    const isGm = ctx.permission === "owner";
    const page = isGm
      ? await ctx.db
          .query("actionLog")
          .withIndex("by_campaign_at", (q) => q.eq("campaignId", ctx.campaign._id))
          .order("desc")
          .paginate(paginationOpts)
      : await ctx.db
          .query("actionLog")
          .withIndex("by_campaign_visibility_at", (q) => q.eq("campaignId", ctx.campaign._id).eq("visibility", "public"))
          .order("desc")
          .paginate(paginationOpts);
    const view = (row: Doc<"actionLog">) => {
      const shown = {
        _id: row._id,
        at: row.at,
        kind: row.kind,
        summary: row.summary,
        ...(row.roll !== undefined ? { roll: row.roll } : {}),
        ...(row.characterId !== undefined ? { characterId: row.characterId } : {}),
        actorId: row.actorId,
        ...(row.fearDelta !== undefined ? { fearDelta: row.fearDelta } : {}),
        undone: row.undoneAt !== undefined,
        canUndo: row.undoable && row.undoneAt === undefined && (isGm || row.actorId === ctx.user._id),
      };
      if (isGm) return { ...shown, visibility: row.visibility, revealable: row.kind === "gmRoll" && row.visibility === "gm" };
      // The index already holds only public rows; this keeps the player shape honest.
      return { ...shown, visibility: "public" as const };
    };
    return { ...page, page: page.page.filter((row) => isGm || row.visibility === "public").map(view) };
  },
});
