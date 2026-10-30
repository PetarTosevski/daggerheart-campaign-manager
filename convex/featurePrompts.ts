import { v } from "convex/values";

import { moveToken } from "../src/components/combat-map/tokens/geometry";
import { bandOf, tokenDistance } from "../src/lib/domain/combat-actions/distance";
import { checkMove } from "../src/lib/domain/combat-map/movement";
import { appError } from "../src/lib/errors/app-error";
import type { CharacterSheet } from "../src/lib/validation/characters";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { cardRollValidator, keepDice, keptDice, parseChoices } from "./lib/cardChoices";
import { needsChoiceValidator } from "./lib/cardRows";
import { buildRun, replaying, runCard } from "./lib/cardRunner";
import { assertCanAct, loadCharacter, readSheet } from "./lib/characterSheet";
import { attackScene } from "./lib/combatActions";
import { movementGrid } from "./lib/combatMovement";
import { openServerMove } from "./lib/combatRequests";
import { liveTargetCount, rollAndStoreCount, rolledFirstUse } from "./lib/featurePrompts";
import { featureSlot, partyFor, pickFeature, resolveFeatureUse, resolvedFeatureValidator, type FeatureUseRequest } from "./lib/featureRunner";
import { rollDie } from "./lib/dice";
import { campaignFearState } from "./lib/fear";
import { campaignQuery, keyedCampaignMutation } from "./lib/functions";
import { atLeast, type Permission } from "./lib/permissions";

/**
 * Feature uses the server decides in part (plan drawer-answers, tracer DA12; docs/tasks/TASK-DA-DA12.md). Players act for
 * a character they edit (their own; the GM any): campaign wrappers with `need: "view"`, then `loadCharacter(..., "edit")`,
 * so another player's character is FORBIDDEN and an outsider NOT_FOUND (CF2), as `combatFeatures`.
 *
 * - `rollCount` / `targetCount`: a target count rolled before the pick (CB p.31 Warden's Protection: "Once per long rest,
 *   spend 2 Hope to clear 2 Hit Points on 1d4 allies within Close range."; user 2026-10-29, dcm-d95): the server rolls the
 *   1d4 and stores it; the player then picks at most that many allies and uses the feature through
 *   `combatFeatures.useFeature`, which takes the stored roll (convex/lib/featureRunner.ts `resolveFeatureUse`). The client
 *   never sends the count.
 * - `charge`: CB p.59 Firbolg, Charge: "When you succeed on an Agility Roll to move from Far or Very Far range into Melee
 *   range with one or more targets, you can mark a Stress to deal 1d12 physical damage to all targets within Melee range."
 *   User 2026-10-29 / 2026-10-30 (dcm-bxp.99.19.16): roll first; before the roll the player picks the Melee square next to
 *   the target; on a success the server moves the token there, on a failure there is no move.
 *
 * What a player receives never holds an enemy's HP, Stress, thresholds or Difficulty (U1).
 */

async function editableHere(ctx: QueryCtx & { user: Doc<"users">; campaign: Doc<"campaigns"> }, characterId: Id<"characters">) {
  const { campaign, character } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
  if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
  return { campaign, character, sheet: readSheet(character.sheet) };
}

/** The limit keys of a feature are `feat:<featureId>[:<useId>][:<target>]` (convex/lib/featureRunner.ts). */
function limitUsed(sheet: CharacterSheet, featureId: string): boolean {
  const key = `feat:${featureId}`;
  return sheet.featureUses.some((u) => u.key === key || u.key.startsWith(`${key}:`));
}

// ---------------------------------------------------------------- a target count rolled first (Warden's Protection)

const countView = v.object({ requestId: v.id("combatRequests"), count: v.number(), expiresAt: v.number() });

/**
 * Rolls the target count of a `rolledFirst` use (Warden's Protection's 1d4) and stores it for the use. Refusals:
 * FEATURE_NOT_OWNED, FEATURE_NOT_COMBAT, FEATURE_EXHAUSTED (the limit is used), INVALID (no count to roll, or a roll of
 * this use still open: one roll until it is used or expires), CHARACTER_UNAVAILABLE.
 */
export const rollCount = keyedCampaignMutation({
  need: "view",
  rateLimit: "roll",
  args: { characterId: v.id("characters"), featureId: v.string(), useId: v.optional(v.string()) },
  returns: countView,
  handler: async (ctx, args) =>
    ctx.once("feature_roll_count", args, async () => {
      const { campaign, character, sheet } = await editableHere(ctx, args.characterId);
      assertCanAct(character, sheet);
      // Ownership and a usable (non-passive) use, as `useFeature` checks them.
      const pick = pickFeature({ sheet, campaign, featureId: args.featureId, useId: args.useId, times: 1, rollUsedExperience: false, party: [] });
      const use = rolledFirstUse(args.featureId, pick.use.id);
      if (limitUsed(sheet, args.featureId)) throw appError("FEATURE_EXHAUSTED");
      return rollAndStoreCount(ctx, { campaignId: campaign._id, character, sheet, featureId: args.featureId, use, userId: ctx.user._id });
    }),
});

/** The open, unexpired rolled count of a character's feature use (the drawer after a reload), or null. */
export const targetCount = campaignQuery({
  need: "view",
  args: { characterId: v.id("characters"), featureId: v.string(), useId: v.optional(v.string()) },
  returns: v.union(v.null(), countView),
  handler: async (ctx, args) => {
    const { campaign } = await editableHere(ctx, args.characterId);
    const use = rolledFirstUse(args.featureId, args.useId);
    const row = await liveTargetCount(ctx, campaign._id, args.characterId, args.featureId, use.id);
    return row === null ? null : { requestId: row._id, count: row.payload.count, expiresAt: row.payload.expiresAt };
  },
});

// ---------------------------------------------------------------- Charge (Firbolg, CB p.59)

const CHARGE = "ancestry:firbolg:charge";

const squareValidator = v.object({ x: v.number(), y: v.number() });

/** Whether two square footprints overlap. */
function overlaps(a: { x: number; y: number; size: number }, b: { x: number; y: number; size: number }): boolean {
  return a.x < b.x + b.size && a.x + a.size > b.x && a.y < b.y + b.size && a.y + a.size > b.y;
}

type ChargeArgs = { targetTokenId: Id<"combatTokens">; square: { x: number; y: number } };

/**
 * Checks the square before anything is rolled: the target is an enemy token at Far or Very Far range of the Firbolg's
 * token, the square is on the map, free of other tokens and in Melee range of the target, and the way there is not
 * blocked (the GM may charge through, as `combatTokens.move`). Returns the token's next placement.
 */
async function chargeSquare(ctx: QueryCtx & { campaign: Doc<"campaigns">; permission: Permission }, attacker: Doc<"combatTokens">, tokens: readonly Doc<"combatTokens">[], map: Doc<"combatMaps">, args: ChargeArgs) {
  const target = tokens.find((t) => t._id === args.targetTokenId);
  if (target === undefined || target.side !== "enemy") throw appError("COMBAT_TARGET_INVALID");
  const band = bandOf(tokenDistance(attacker, target));
  if (band !== "far" && band !== "veryFar") throw appError("INVALID", "Charge starts from Far or Very Far range of the target.");
  const { x, y } = args.square;
  const next = moveToken(attacker, x, y, map);
  if (!Number.isInteger(x) || !Number.isInteger(y) || next.x !== x || next.y !== y) throw appError("INVALID", "That square isn't on the map.");
  const size = Math.max(1, Math.min(3, Math.trunc(attacker.size) || 1));
  const at = { x, y, size };
  if (tokens.some((t) => t._id !== attacker._id && overlaps(at, { x: t.x, y: t.y, size: Math.max(1, Math.min(3, Math.trunc(t.size) || 1)) }))) throw appError("MOVE_BLOCKED");
  if (tokenDistance(at, target) !== 1) throw appError("INVALID", "Pick a square in Melee range of the target.");
  const { blocked } = checkMove(await movementGrid(ctx, ctx.campaign._id, map), attacker, next, size);
  if (blocked && !atLeast(ctx.permission, "owner")) throw appError("MOVE_BLOCKED");
  return { target, next };
}

/**
 * Charge (CB p.59). The player picks the target and a free square in Melee range of it before the roll; the server runs
 * the use as from that square (its targets are every enemy the Firbolg would see in Melee range there), rolls Agility
 * against the GM's Difficulty (`roll.difficulty`, required) and, on a success, moves the token to the square (the optional
 * Stress, `stress: true`, then deals 1d12 physical damage to each of those targets); on a failure the token stays. One
 * actionLog group: undo restores the sheets, the adversaries and the square (`serverMove`). Refusals: FEATURE_NOT_OWNED,
 * FEATURE_EXHAUSTED / FEATURE_COST_UNPAID, COMBAT_TARGET_INVALID (not an enemy, or not in sight from the square), INVALID
 * (not at Far / Very Far, a square off the map or out of Melee, no Difficulty), MOVE_BLOCKED (an occupied square, a
 * blocked way for a player), COMBAT_MAP_NOT_FOUND / COMBAT_TOKEN_NOT_FOUND, CHARACTER_UNAVAILABLE.
 */
export const charge = keyedCampaignMutation({
  need: "view",
  rateLimit: "roll",
  args: {
    characterId: v.id("characters"),
    mapId: v.id("combatMaps"),
    targetTokenId: v.id("combatTokens"),
    square: squareValidator,
    /** Mark a Stress for the 1d12 physical damage (the optional step, taken on a success). */
    stress: v.boolean(),
    roll: cardRollValidator,
  },
  returns: v.union(v.object({ status: v.literal("charged"), moved: v.boolean(), use: resolvedFeatureValidator }), needsChoiceValidator),
  handler: async (ctx, args) =>
    ctx.once("feature_charge", args, async () => {
      const { campaign, character, sheet } = await editableHere(ctx, args.characterId);
      assertCanAct(character, sheet);
      if (args.roll.difficulty === undefined) throw appError("INVALID", "Charge needs the GM's Difficulty for the Agility Roll.");
      const before = await attackScene(ctx, campaign, character, args.mapId);
      const attacker = before.attacker;
      const { target, next } = await chargeSquare(ctx, attacker, before.scene.tokens, before.map, args);
      const from = { x: attacker.x, y: attacker.y, face: attacker.face };
      const putBack = () => ctx.db.patch("combatTokens", attacker._id, from);

      // Run the use as from the square: the token stands there while the run is built (one transaction; a failure, a
      // refusal or a missing choice puts it back).
      await ctx.db.patch("combatTokens", attacker._id, next);
      const scene = await attackScene(ctx, campaign, character, args.mapId);
      const party = await partyFor(ctx, campaign._id, character._id, scene, (c) => readSheet(c.sheet));
      const pick = pickFeature({ sheet, campaign, featureId: CHARGE, useId: "main", times: 1, rollUsedExperience: (args.roll.experienceIds?.length ?? 0) > 0, party, serverMove: true });
      const choices = [{ id: "optional:stress", value: args.stress }];
      const req: FeatureUseRequest = { campaign, character, sheet, scene, pick, targetTokenIds: [], choices, roll: args.roll };
      const fear = await campaignFearState(ctx, campaign._id);
      const built = await buildRun(ctx, { campaign, character, sheet, scene, pick, targetTokenIds: [], choices: parseChoices(choices), roll: args.roll, gmFear: fear.fear, lastRollWithHope: false });
      // "into Melee range with one or more targets": the picked target must be one the Firbolg sees there.
      if (!built.targets.some((t) => t.tokenId === target._id) || built.outOfRange.length > 0) throw appError("COMBAT_TARGET_INVALID");
      const kept = await keptDice(ctx, featureSlot(req));
      const outcome = runCard(built, pick, kept ? replaying(kept, rollDie) : rollDie);
      if (outcome.kind === "needsChoice") {
        await keepDice(ctx, featureSlot(req), outcome.dice, ctx.user._id);
        await putBack();
        return { status: "needsChoice" as const, asks: outcome.asks };
      }
      const moved = outcome.plan.success;
      if (!moved) await putBack();
      const use = await resolveFeatureUse(ctx, { ...req, targetTokenIds: built.targets.map((t) => t.tokenId) }, built, outcome, ctx.user._id);
      if (moved) {
        const entry = await ctx.db.get("actionLog", use.entryId);
        const encounter = built.targets.find((t) => t.kind === "enemy");
        if (entry?.groupId !== undefined) {
          await openServerMove(ctx, {
            campaignId: campaign._id,
            ...(encounter?.kind === "enemy" ? { encounterId: encounter.encounter._id } : {}),
            mapId: before.map._id,
            createdBy: ctx.user._id,
            payload: { schemaVersion: 1, kind: "serverMove", characterId: character._id, groupId: entry.groupId, tokenId: attacker._id, from, to: next },
          });
        }
      }
      return { status: "charged" as const, moved, use };
    }),
});
