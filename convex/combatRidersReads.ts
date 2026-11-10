import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { loadCharacter, readSheet } from "./lib/characterSheet";
import { hostOf, riderOptions, riderOptionValidator, weaponIn, weaponSlotValidator } from "./lib/combatActions";
import { campaignQuery } from "./lib/functions";
import type { Loaded } from "./lib/rolls";

/**
 * The Attack bar's rider read (plan combat-actions, SD5). Moved out of `combatActionsReads.ts` by dcm-uh6r (speed pass 4):
 * `targets` there needs the vision scene and the adversaries' riders, `riders` here the cards' and features' effects, so
 * each subscription loads only its own half (bundles: riders 2.46 -> 1.45 MB, targets 2.46 -> 2.26 MB). Same wrapper,
 * arguments and returns as before.
 *
 * - `riders`: the riders that ride on the character's attack (the character's own sheet only).
 */

/** The character the caller edits, in this campaign, with its sheet (NOT_FOUND / FORBIDDEN otherwise). */
async function attacker(ctx: QueryCtx & { user: Doc<"users">; campaign: Doc<"campaigns"> }, characterId: Id<"characters">): Promise<Loaded> {
  const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
  if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
  return { campaign, character, sheet: readSheet(character.sheet), gm: permission === "owner" };
}

/**
 * SD5: the riders that ride on the character's attack with the weapon in `slot` (default primary): every rider use of a
 * loadout card and of a held feature whose trigger fits a weapon attack, with its phase, costs, limit, readiness and the
 * choices it asks (numbers, options, situations to confirm, extra targets). The character's own sheet only (U1, CF6).
 */
export const riders = campaignQuery({
  need: "view",
  args: { characterId: v.id("characters"), slot: v.optional(weaponSlotValidator) },
  returns: v.array(riderOptionValidator),
  handler: async (ctx, { characterId, slot }) => {
    const { sheet } = await attacker(ctx, characterId);
    const weapon = weaponIn(sheet, slot ?? "primary");
    if (weapon === undefined) return [];
    return riderOptions(sheet, ctx.campaign, hostOf(weapon, slot ?? "primary", undefined));
  },
});
