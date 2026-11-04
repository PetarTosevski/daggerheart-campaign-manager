/**
 * Scene end for the Combat Map (plan sheet-drawer SD8, Q7; docs/tasks/TASK-SD-SD8.md). CB p.107, End of the Scene:
 * "At the GM's discretion, a scene continues until the current narrative situation has played out. … A battle scene
 * usually ends when one side has fled, surrendered, or been entirely defeated."
 *
 * A scene ends when the GM ends the running encounter (`encounters.end` calls `endScene`), when the GM presses End scene
 * on the Combat Map or the Encounter tab (`combatScenes.end`), or when the session ends (`expire(sheet, "session")`
 * ends the scene's sheet state too). Ending it:
 * - for every active PC `expire(sheet, "scene")`: effects and feature uses that last until the scene, the Unstoppable
 *   Die, the active stance and Walk Between Worlds' tokens (src/lib/domain/characters/expiry.ts);
 * - ends the campaign's live map areas that last until the scene (`combatAreas.expires` `scene`);
 * - forgets which adversaries the party has seen this scene (`combatSeen`, user 2026-11-03, convex/lib/spotlightSeen.ts);
 * - DA10: ends what ends with the stance (Grappling's Restrain on its instance, convex/lib/stanceDrop.ts); the campaign
 *   row carries the instances' `adversaryBefore`, so undo restores them.
 * The dashboard's End scene (`scenes.end`, RF1) runs the same `endScene`; the session end (`sessions.end`) closes the
 * `scene` and `session` areas through `endSceneAreas` (plan drawer-answers DA4).
 *
 * One mutation writes one undoable `actionLog` group (kind `session`, a row per changed PC and a campaign row "Scene
 * ended"); undoing the campaign row restores every sheet. Areas keep their own history (like trackers): undo does not
 * bring one back, the feature is used again.
 */
import { v } from "convex/values";

import { expire } from "../src/lib/domain/characters/expiry";
import { appError } from "../src/lib/errors/app-error";
import type { CharacterSheet } from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { logAction, newGroupId } from "./lib/actionLog";
import { MAX_CHARACTERS_PER_CAMPAIGN, readSheet, saveSheet } from "./lib/characterSheet";
import { keyedGmMutation } from "./lib/functions";
import { forgetSeen } from "./lib/spotlightSeen";
import { endStanceConditions, withoutStance } from "./lib/stanceDrop";
import type { AreaExpires } from "./lib/validators/combatMaps";

/** Sheets one scene end may change: an undo group holds at most 50 rows (convex/lib/actionLog.ts), one is the campaign's. */
const PARTY_MAX = 49;

/** Areas a scene end closes in one transaction (a campaign draws few at a time; ended ones are swept by the cron). */
const AREAS_MAX = 200;

export type SceneEnded = {
  /** Scene effects, feature limits and states (Unstoppable Die, stance) ended across the party. */
  ended: number;
  /** Live map areas closed. */
  areas: number;
  /** The campaign row of the group (undo it to undo the whole End), or null when nothing changed. */
  entryId: Id<"actionLog"> | null;
};

/** How many scene things `expire(…, "scene")` took off a sheet. */
function sceneThings(before: CharacterSheet, after: CharacterSheet): number {
  return (
    before.effects.length -
    after.effects.length +
    ((before.featureUses?.length ?? 0) - (after.featureUses?.length ?? 0)) +
    (before.classState.unstoppable !== undefined && after.classState.unstoppable === undefined ? 1 : 0) +
    (before.classState.martial?.active !== undefined && after.classState.martial?.active === undefined ? 1 : 0) +
    ((before.cardTokens?.length ?? 0) - (after.cardTokens?.length ?? 0))
  );
}

/**
 * Closes the campaign's live areas that last until the scene; returns how many. The session end passes
 * `["scene", "session"]`: it ends the scene too (Q7, CB p.107).
 */
export async function endSceneAreas(
  ctx: MutationCtx,
  campaignId: Id<"campaigns">,
  now: number,
  expires: readonly AreaExpires[] = ["scene"],
): Promise<number> {
  const rows = await ctx.db
    .query("combatAreas")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(AREAS_MAX);
  const live = rows.filter((a) => a.status === "active" && expires.includes(a.expires));
  for (const area of live) await ctx.db.patch("combatAreas", area._id, { status: "ended", endedAt: now });
  return live.length;
}

/**
 * Ends the scene for the campaign (the caller is the GM: an encounter end or the End scene button). Nothing to end
 * on the sheets writes no log rows.
 */
export async function endScene(ctx: MutationCtx, campaign: Doc<"campaigns">, actorId: Id<"users">): Promise<SceneEnded> {
  const campaignId = campaign._id;
  const rows = await ctx.db
    .query("characters")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaignId))
    .take(MAX_CHARACTERS_PER_CAMPAIGN);

  const changes = rows
    .filter((character) => character.status === "active")
    .flatMap((character) => {
      try {
        const sheet = readSheet(character.sheet);
        // DA10 (HF p.12): the stance drops at the scene's end, and what ends with it (Grappling's Restrain markers).
        const off = withoutStance(sheet);
        const next = expire(off.sheet, "scene");
        const ended = sceneThings(sheet, next);
        return ended > 0 ? [{ character, sheet, next, ended, markers: off.markers }] : [];
      } catch {
        return []; // a corrupt sheet is left alone
      }
    });
  if (changes.length > PARTY_MAX) throw appError("INVALID", `A scene can update at most ${PARTY_MAX} characters; remove some from the campaign.`);
  const areas = await endSceneAreas(ctx, campaignId, Date.now());
  // The next scene starts unseen: players learn a spotlighted adversary only once the party sees it again (user
  // 2026-11-03, convex/lib/spotlightSeen.ts). Outside the undo group, like the areas.
  await forgetSeen(ctx, campaignId);
  if (changes.length === 0) return { ended: 0, areas, entryId: null };

  const groupId = newGroupId();
  const released = await endStanceConditions(ctx, campaignId, changes.flatMap((c) => c.markers));
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
    summary: [`Scene ended; ${ended} scene effect${ended === 1 ? "" : "s"} and limit${ended === 1 ? "" : "s"} ended`, ...released.lines].join("; "),
    groupId,
    ...(released.before.length > 0 ? { adversaryBefore: released.before } : {}),
    undoable: true,
  });
  return { ended, areas, entryId };
}

/** The GM's End scene button on the Combat Map and the Encounter tab. */
export const end = keyedGmMutation({
  args: {},
  returns: v.object({
    ended: v.number(),
    areas: v.number(),
    entryId: v.union(v.id("actionLog"), v.null()),
  }),
  handler: async (ctx) => ctx.once("combat_scene_end", {}, () => endScene(ctx, ctx.campaign, ctx.user._id)),
});
