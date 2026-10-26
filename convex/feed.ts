import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { Doc } from "./_generated/dataModel";
import { campaignQuery, gmMutation } from "./lib/functions";
import { actionKindValidator, actionTargetValidator, rollValidator, visibilityValidator } from "./lib/validators/actionLog";

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
  /** An adversary action's public row (H3): the tokens it named, by id; the map flashes them. Players get only PC tokens. */
  targets: v.optional(v.array(actionTargetValidator)),
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
 * until it is revealed (decision 2), whatever the client asks for. Rows the GM
 * removed, and rows from before the GM last cleared the feed, are left out.
 */
export const list = campaignQuery({
  need: "view",
  enough: "owner",
  args: { paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(v.union(gmRow, playerRow)),
  handler: async (ctx, { paginationOpts }) => {
    const isGm = ctx.permission === "owner";
    const clearedAt = ctx.campaign.feedClearedAt ?? -1;
    const page = isGm
      ? await ctx.db
          .query("actionLog")
          .withIndex("by_campaign_at", (q) => q.eq("campaignId", ctx.campaign._id).gt("at", clearedAt))
          .order("desc")
          .paginate(paginationOpts)
      : await ctx.db
          .query("actionLog")
          .withIndex("by_campaign_visibility_at", (q) => q.eq("campaignId", ctx.campaign._id).eq("visibility", "public").gt("at", clearedAt))
          .order("desc")
          .paginate(paginationOpts);
    // Rows in a rest's group (e.g. a long rest's countdown notice) are undone with the rest, from the rest panel.
    const restGroups = new Set(page.page.filter((r) => r.kind === "rest" && r.groupId !== undefined).map((r) => r.groupId));
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
        // Adversary tokens flash for the GM only (H3 user answer).
        ...(row.targets !== undefined ? { targets: isGm ? row.targets : row.targets.filter((t) => t.side === "pc") } : {}),
        undone: row.undoneAt !== undefined,
        canUndo: row.undoable && row.kind !== "rest" && !(row.groupId !== undefined && restGroups.has(row.groupId)) && row.undoneAt === undefined && (isGm || row.actorId === ctx.user._id),
      };
      if (isGm) return { ...shown, visibility: row.visibility, revealable: row.kind === "gmRoll" && row.visibility === "gm" };
      // The index already holds only public rows; this keeps the player shape honest.
      return { ...shown, visibility: "public" as const };
    };
    // A removed row is skipped here, so a page can come back shorter than asked (removals are rare).
    return { ...page, page: page.page.filter((row) => row.removedAt === undefined && (isGm || row.visibility === "public")).map(view) };
  },
});

/**
 * Deletes one row from the feed for everyone (user 2026-10-20). Display only: it does not undo the action, and undo and
 * the "latest roll" checks still see the row. GM only; a row of another campaign is NOT_FOUND.
 */
export const remove = gmMutation({
  args: { entryId: v.id("actionLog") },
  returns: v.null(),
  handler: async (ctx, { entryId }) => {
    const row = await ctx.db.get("actionLog", entryId);
    if (row === null || row.campaignId !== ctx.campaign._id) throw appError("NOT_FOUND");
    if (row.removedAt === undefined) await ctx.db.patch("actionLog", entryId, { removedAt: Date.now() });
    return null;
  },
});

/** Clears the feed for everyone: only rows logged after now are shown (user 2026-10-20). Display only, as `remove`. GM only. */
export const clear = gmMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    await ctx.db.patch("campaigns", ctx.campaign._id, { feedClearedAt: Date.now() });
    return null;
  },
});
