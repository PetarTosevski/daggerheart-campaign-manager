import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { loadCharacter, readSheet } from "./lib/characterSheet";
import { targetHints, targetHintValidator, weaponIn, weaponSlotValidator } from "./lib/combatActions";
import { loadCombatMap } from "./lib/combatMaps";
import { loadScene, viewOf } from "./lib/combatVision";
import { campaignQuery } from "./lib/functions";
import type { Loaded } from "./lib/rolls";

/**
 * The Combat HUD's attack reads (plan combat-actions, CA3 / SD5; moved out of `combatActions.ts` by dcm-uh6r so the
 * Attack bar's subscriptions do not load the attack resolver the mutations need). Same wrappers, arguments and returns
 * as before.
 *
 * - `targets`: the enemy tokens the character sees, with band, range, line of sight and cover only (U1, CF6).
 *
 * `riders` moved on to `combatRidersReads.ts` (dcm-uh6r, speed pass 4), so neither read loads the other's tables.
 *
 * What a player receives never holds an enemy's HP, Stress, thresholds or Difficulty (U1).
 */

/** The character the caller edits, in this campaign, with its sheet (NOT_FOUND / FORBIDDEN otherwise). */
async function attacker(ctx: QueryCtx & { user: Doc<"users">; campaign: Doc<"campaigns"> }, characterId: Id<"characters">): Promise<Loaded> {
  const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
  if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
  return { campaign, character, sheet: readSheet(character.sheet), gm: permission === "owner" };
}

/**
 * The enemy tokens the character's token sees on the live map that can be attacked, each with only its Defined Range
 * band, whether it is within the weapon's range (`slot`, default primary), line of sight and cover (U1, CF6). Empty
 * when the map is not live or the character has no token on it.
 */
export const targets = campaignQuery({
  need: "view",
  args: { characterId: v.id("characters"), mapId: v.id("combatMaps"), slot: v.optional(weaponSlotValidator) },
  returns: v.array(targetHintValidator),
  handler: async (ctx, { characterId, mapId, slot }) => {
    const { character, sheet } = await attacker(ctx, characterId);
    const map = await loadCombatMap(ctx, ctx.campaign._id, mapId);
    if (!map.live) return [];
    const scene = await loadScene(ctx, ctx.campaign, map);
    const viewer = viewOf(scene, character);
    if (viewer === null) return [];
    return targetHints(ctx, ctx.campaign, { map, scene, viewer, attacker: scene.tokens[viewer.index]! }, weaponIn(sheet, slot ?? "primary"), { sheet, characterId: character._id });
  },
});
