/**
 * The GM's End scene button (RF1). CB 107: "At the GM's discretion, a scene
 * continues until the current narrative situation has played out."
 *
 * - `end`: for every active PC, clears scene-length effects
 *   (`expire(sheet, "scene")`). Session end still clears them too
 *   (convex/sessions.ts). Ending with no scene effects writes nothing.
 * Like session end, it writes one undoable `actionLog` group (kind
 * `session`): a row per changed PC plus a campaign row "Scene ended"; undo the
 * campaign row to restore every sheet.
 */
import { v } from "convex/values";

import { expire } from "../src/lib/domain/characters/expiry";
import { appError } from "../src/lib/errors/app-error";
import { logAction, newGroupId } from "./lib/actionLog";
import { readSheet, saveSheet } from "./lib/characterSheet";
import { keyedGmMutation } from "./lib/functions";

/** One party: a handful of characters (a group holds at most 50 rows, one is the campaign's). Mirrors sessions.ts. */
const PARTY_MAX = 49;

export const end = keyedGmMutation({
  args: {},
  returns: v.object({
    /** Scene effects ended across the party. */
    ended: v.number(),
    /** The campaign row of the group (undo it to undo the whole End), or null when nothing changed. */
    entryId: v.union(v.id("actionLog"), v.null()),
  }),
  handler: async (ctx) =>
    ctx.once("scene_end", {}, async () => {
      const campaignId = ctx.campaign._id;
      const rows = await ctx.db
        .query("characters")
        .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
        .take(PARTY_MAX + 1);
      if (rows.length > PARTY_MAX) throw appError("INVALID", `A scene can update at most ${PARTY_MAX} characters; remove some from the campaign.`);

      const changes = rows
        .filter((character) => character.status === "active")
        .flatMap((character) => {
          try {
            const sheet = readSheet(character.sheet);
            const next = expire(sheet, "scene");
            const ended = sheet.effects.length - next.effects.length;
            return ended > 0 ? [{ character, sheet, next, ended }] : [];
          } catch {
            return []; // a corrupt sheet is left alone
          }
        });
      if (changes.length === 0) return { ended: 0, entryId: null };

      const groupId = newGroupId();
      const actorId = ctx.user._id;
      for (const { character, sheet, next } of changes) {
        await saveSheet(ctx, character._id, next);
        await logAction(ctx, { campaignId, characterId: character._id, actorId, kind: "session", visibility: "public", summary: `${sheet.name}: scene end`, groupId, before: sheet, undoable: true });
      }
      const ended = changes.reduce((sum, c) => sum + c.ended, 0);
      const entryId = await logAction(ctx, {
        campaignId,
        actorId,
        kind: "session",
        visibility: "public",
        summary: `Scene ended; ${ended} scene effect${ended === 1 ? "" : "s"} ended`,
        groupId,
        undoable: true,
      });
      return { ended, entryId };
    }),
});
