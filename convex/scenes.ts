/**
 * The GM's End scene button on the dashboard (RF1). CB 107: "At the GM's discretion, a scene continues until the
 * current narrative situation has played out."
 *
 * - `end`: runs `endScene` from convex/combatScenes.ts, the same scene end as the Combat Map's and the Encounter tab's
 *   End scene (plan drawer-answers DA4): for every active PC, scene-length effects and feature limits, the Unstoppable
 *   Die, the active stance and Walk Between Worlds' tokens end (`expire(sheet, "scene")`), and the campaign's live map
 *   areas that last until the scene close. Session end still does all of it too (convex/sessions.ts). Ending with
 *   nothing on the sheets writes no log rows.
 * It writes one undoable `actionLog` group (kind `session`): a row per changed PC plus a campaign row "Scene ended";
 * undo the campaign row to restore every sheet.
 */
import { v } from "convex/values";

import { endScene } from "./combatScenes";
import { keyedGmMutation } from "./lib/functions";

export const end = keyedGmMutation({
  args: {},
  returns: v.object({
    /** Scene effects, feature limits and states ended across the party. */
    ended: v.number(),
    /** The campaign row of the group (undo it to undo the whole End), or null when nothing changed. */
    entryId: v.union(v.id("actionLog"), v.null()),
  }),
  handler: async (ctx) =>
    ctx.once("scene_end", {}, async () => {
      const { ended, entryId } = await endScene(ctx, ctx.campaign, ctx.user._id);
      return { ended, entryId };
    }),
});
