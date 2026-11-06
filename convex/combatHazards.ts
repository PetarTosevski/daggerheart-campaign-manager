import { v } from "convex/values";

import { HAZARDS, hazardLine, rollHazard, type HazardKind } from "../src/lib/domain/hazards";
import { appError } from "../src/lib/errors/app-error";
import { logAction, newGroupId } from "./lib/actionLog";
import { bandsOnMap, openIncomingHit, partyMembers } from "./lib/incomingHits";
import { loadCombatToken } from "./lib/combatMaps";
import { rollDie } from "./lib/dice";
import { keyedGmMutation } from "./lib/functions";
import { ruleMode } from "./lib/ruleModes";

/**
 * Falling and collision damage (optional rule, CB p.168; plan rule-switches OFA, docs/tasks/TASK-RULES-OFA.md; user answer
 * Q10 a, 2026-11-05: "GM button in the token menu; the app rolls and applies through the normal hit path (collision
 * direct)").
 *
 * - `fall({ tokenId, kind })` (the GM, keyed): rolls the book's damage for a PC's token (`src/lib/domain/hazards.ts`:
 *   Very Close 1d10+3, Close 1d20+5, Far or Very Far 1d100+15 physical; collision 1d20+5 direct physical) and opens the
 *   normal incoming hit on that PC (`openIncomingHit`, attacker kind `hazard`): the Armor Slot prompt unless direct, the
 *   PC's and allies' answers, and the campaign's rule modes (A1, D4, Massive Damage, …). The roll is on a GM-only row
 *   ("or death at the GM's discretion" for Far or Very Far); the public row names the fall with no number (Q14). One undo
 *   of the group reverts it all. MECHANIC_DISABLED while the optional rule is off; COMBAT_TOKEN_NOT_FOUND for a token of
 *   another campaign; COMBAT_TARGET_INVALID for a token that is not an active PC's.
 */

const hazardKindValidator = v.union(v.literal("veryClose"), v.literal("close"), v.literal("far"), v.literal("collision"));

/** The public row's words (no number, Q14). */
const PUBLIC_WORDS: Record<HazardKind, string> = {
  veryClose: "falls from Very Close range",
  close: "falls from Close range",
  far: "falls from Far or Very Far range",
  collision: "collides at a dangerous speed",
};

export const fall = keyedGmMutation({
  args: { tokenId: v.id("combatTokens"), kind: hazardKindValidator },
  returns: v.object({
    groupId: v.string(),
    requestId: v.id("combatRequests"),
    /** The rolled damage before armor. */
    damage: v.number(),
    /** The hit resolved at once (nobody had to answer). */
    resolved: v.boolean(),
  }),
  handler: async (ctx, { tokenId, kind }) =>
    ctx.once("combat_hazard_fall", { tokenId, kind }, async () => {
      if (!ruleMode(ctx.campaign, "fallingDamage")) throw appError("MECHANIC_DISABLED", "Falling and collision damage is off in this campaign.");
      const token = await loadCombatToken(ctx, ctx.campaign._id, tokenId);
      if (token.ref.kind !== "pc") throw appError("COMBAT_TARGET_INVALID", "Only a PC's token can fall.");
      const characterId = token.ref.characterId;
      const party = await partyMembers(ctx, ctx.campaign._id);
      const target = party.find((m) => m.character._id === characterId);
      if (!target) throw appError("COMBAT_TARGET_INVALID", "That character isn't in play.");
      const hazard = HAZARDS[kind];
      const roll = rollHazard(kind, rollDie);
      const groupId = newGroupId();
      const log = { campaignId: ctx.campaign._id, actorId: ctx.user._id, groupId };
      await logAction(ctx, { ...log, kind: "combat", visibility: "gm", summary: `${target.sheet.name}: ${hazardLine(kind, roll.total)}`, roll, undoable: true });
      await logAction(ctx, { ...log, kind: "combat", visibility: "public", summary: `${target.sheet.name} ${PUBLIC_WORDS[kind]}`, undoable: true });
      const map = await ctx.db.get("combatMaps", token.mapId);
      const mapId = map?.live ? map._id : undefined;
      const { requestId, resolution } = await openIncomingHit(ctx, {
        campaignId: ctx.campaign._id,
        ...(mapId ? { mapId } : {}),
        createdBy: ctx.user._id,
        groupId,
        attacker: { kind: "hazard", hazard: kind, label: hazard.phrase },
        targetCharacterId: characterId,
        targetTokenId: token._id,
        hit: { amount: roll.total, type: "physical", direct: hazard.direct, forcedArmor: 0, critical: false },
        party,
        bands: await bandsOnMap(ctx, mapId),
      });
      return { groupId, requestId, damage: roll.total, resolved: resolution !== null };
    }),
});
