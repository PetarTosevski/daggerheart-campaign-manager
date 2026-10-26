import { v } from "convex/values";

import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { logAction } from "./lib/actionLog";
import { assertCanAct, loadCharacter, readSheet } from "./lib/characterSheet";
import {
  attackDuality,
  attackRollFields,
  attackScene,
  beforeOf,
  checkTargets,
  equippedWeapon,
  pendingAttackValidator,
  resolveAttack,
  resolvedAttackValidator,
  targetHints,
  targetHintValidator,
  weaponIn,
  weaponSlotValidator,
  type AttackRoll,
} from "./lib/combatActions";
import { loadCombatMap } from "./lib/combatMaps";
import { loadScene, viewOf } from "./lib/combatVision";
import { closeRequest, encounterRunning, groupOffer, openSanction } from "./lib/combatRequests";
import { featureScope } from "./lib/featureScope";
import { campaignQuery, keyedCampaignMutation } from "./lib/functions";
import { prepareDuality, rules, type Loaded } from "./lib/rolls";
import type { AdversaryBefore } from "./lib/validators/actionLog";

/**
 * Weapon attacks on enemy tokens from the Combat Map (plan combat-actions, tracer CA3; docs/tasks/TASK-CA-CA3.md).
 * Players act for a character they edit (their own; the GM any): campaign wrappers with `need: "view"` and then
 * `loadCharacter(..., "edit")`, so another player's character is FORBIDDEN and an outsider NOT_FOUND (CF2).
 *
 * - `attack`: one Duality roll against every target's Difficulty, damage on any hit, HP marked on the encounter
 *   instances, one undoable actionLog group (public: hit / miss; GM: damage, severity, HP). A target out of the
 *   weapon's range turns the attack into a GM sanction (Q1); no line of sight refuses it (Q2).
 * - `targets`: the enemy tokens the character sees, with band, range, line of sight and cover only (U1, CF6).
 * - `pickMinions`: the attacker picks the extra Minions their damage defeats (Q6, CB p.201), once.
 *
 * What a player receives never holds an enemy's HP, Stress, thresholds or Difficulty (U1): the returns validators
 * below have no such field, and the public row's summary names only Hit / Miss / Defeated.
 */

/** The character the caller edits, in this campaign, with its sheet (NOT_FOUND / FORBIDDEN otherwise). */
async function attacker(ctx: QueryCtx & { user: Doc<"users">; campaign: Doc<"campaigns"> }, characterId: Id<"characters">): Promise<Loaded> {
  const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
  if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
  return { campaign, character, sheet: readSheet(character.sheet), gm: permission === "owner" };
}

/** The stored roll options back as the attack's arguments (every field optional in the sanction, AA0). */
function rollOf(args: AttackRoll): AttackRoll {
  return {
    ...(args.trait !== undefined ? { trait: args.trait } : {}),
    modifier: args.modifier,
    experienceIds: args.experienceIds,
    advantage: args.advantage,
    disadvantage: args.disadvantage,
    help: args.help,
    options: args.options,
    ...(args.damageOptions !== undefined ? { damageOptions: args.damageOptions } : {}),
    ...(args.slayerDice !== undefined ? { slayerDice: args.slayerDice } : {}),
    ...(args.tideTokens !== undefined ? { tideTokens: args.tideTokens } : {}),
  };
}

/**
 * Attacks enemy tokens with the primary or secondary weapon. The attacker is the character's PC token on the live map
 * (COMBAT_MAP_NOT_FOUND, COMBAT_TOKEN_NOT_FOUND); every target must be seen with a clear line (COMBAT_NO_LINE_OF_SIGHT)
 * and be an enemy token of a running encounter's undefeated instance (COMBAT_TARGET_INVALID). When any target is out of
 * the weapon's range the attack waits for the GM (`pending`, a `combatRequests` sanction): nothing is rolled or paid
 * until `combatRequests.sanction` approves it. Otherwise it resolves now (`resolveAttack`).
 */
export const attack = keyedCampaignMutation({
  need: "view",
  rateLimit: "roll",
  args: {
    characterId: v.id("characters"),
    mapId: v.id("combatMaps"),
    targetTokenIds: v.array(v.id("combatTokens")),
    slot: weaponSlotValidator,
    ...attackRollFields,
  },
  returns: v.union(resolvedAttackValidator, pendingAttackValidator),
  handler: async (ctx, args) =>
    ctx.once("combat_attack", args, async () => {
      const { characterId, mapId, targetTokenIds, slot, ...options } = args;
      const loaded = await attacker(ctx, characterId);
      const scene = await attackScene(ctx, ctx.campaign, loaded.character, mapId);
      const weapon = equippedWeapon(loaded.sheet, slot);
      const targets = await checkTargets(ctx, ctx.campaign, scene, weapon, targetTokenIds);
      const roll = rollOf(options);
      const outOfRange = targets.filter((t) => !t.check.inRange);
      if (outOfRange.length === 0) return resolveAttack(ctx, { loaded, actorId: ctx.user._id, scene, weapon, slot, targets, roll });

      // Q1: wait for the GM. Refuse now what the approval would refuse anyway (a character who can't act, unpaid costs).
      assertCanAct(loaded.character, loaded.sheet);
      rules(() => prepareDuality(loaded.sheet, attackDuality(weapon, roll, targets.some((t) => t.sight.cover)), featureScope(ctx.campaign), null));
      const bands = outOfRange.map((t) => ({ tokenId: t.token._id, band: t.check.band }));
      const requestId = await openSanction(ctx, {
        campaignId: ctx.campaign._id,
        encounterId: targets[0]!.encounter._id,
        mapId: scene.map._id,
        createdBy: ctx.user._id,
        payload: { schemaVersion: 1, kind: "sanction", characterId, action: { kind: "attack", slot, targetTokenIds, roll }, outOfRange: bands },
      });
      return { status: "pending" as const, requestId, outOfRange: bands };
    }),
});

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
    return targetHints(ctx, ctx.campaign, { map, scene, viewer, attacker: scene.tokens[viewer.index]! }, weaponIn(sheet, slot ?? "primary"));
  },
});

const pickResult = v.object({
  status: v.union(v.literal("resolved"), v.literal("declined")),
  /** Minions defeated by this pick. */
  defeated: v.number(),
  /** Picked tokens and whether their instance is now defeated (Q6). No stat. */
  targets: v.array(v.object({ tokenId: v.id("combatTokens"), defeated: v.boolean() })),
});

/**
 * The attacker picks the extra Minions their attack defeats (Q6). CB p.201, "Minion (X)": "For every X damage a PC deals
 * to this adversary, defeat an additional Minion within range the attack would succeed against. … Tell the attacking PC
 * which other Minions within range the attack would succeed against and let them choose which Minions they defeat."
 *
 * `entryId` is the attack's public row; `instanceIds` names one id per Minion (repeat a group's id for several of its
 * Minions), at most the offer's `extra`, each within its candidate's `available`. Once: the offer closes (a second call
 * is REQUEST_NOT_OPEN). An empty list passes. Logged into the attack's group, so undoing the attack undoes the pick.
 */
export const pickMinions = keyedCampaignMutation({
  need: "view",
  args: { entryId: v.id("actionLog"), instanceIds: v.array(v.id("encounterAdversaries")) },
  returns: pickResult,
  handler: async (ctx, { entryId, instanceIds }) =>
    ctx.once("combat_pick_minions", { entryId, instanceIds }, async () => {
      const entry = await ctx.db.get("actionLog", entryId);
      if (entry === null || entry.campaignId !== ctx.campaign._id || entry.kind !== "combat" || entry.visibility !== "public") throw appError("NOT_FOUND");
      if (entry.groupId === undefined || entry.characterId === undefined) throw appError("NOT_FOUND");
      const { character, sheet } = await attacker(ctx, entry.characterId);
      const offer = await groupOffer(ctx, ctx.campaign._id, entry.groupId);
      if (offer === null || offer.payload.kind !== "minionOffer") throw appError("REQUEST_NOT_OPEN");
      if (!(await encounterRunning(ctx, offer))) {
        await closeRequest(ctx, offer._id, "declined", ctx.user._id);
        return { status: "declined" as const, defeated: 0, targets: [] };
      }
      const payload = offer.payload;
      if (instanceIds.length > payload.extra) throw appError("COMBAT_TARGET_INVALID");
      const counts = new Map<Id<"encounterAdversaries">, number>();
      for (const id of instanceIds) counts.set(id, (counts.get(id) ?? 0) + 1);
      const picks = await applyPicks(ctx, payload.candidates, counts);
      await closeRequest(ctx, offer._id, "resolved", ctx.user._id);
      if (picks.length === 0) return { status: "resolved" as const, defeated: 0, targets: [] };

      const publicParts = picks.map((p) => `${p.label}${p.defeated ? ": Defeated" : ""}`);
      const gmParts = picks.map((p) => `${p.label}: ${p.count} Minion${p.count === 1 ? "" : "s"} (${p.hp}/${p.hpMax} HP)${p.defeated ? ", defeated" : ""}`);
      await logAction(ctx, {
        campaignId: ctx.campaign._id,
        characterId: character._id,
        actorId: ctx.user._id,
        kind: "combat",
        visibility: "public",
        summary: `${sheet.name} defeats ${instanceIds.length} more Minion${instanceIds.length === 1 ? "" : "s"} → ${publicParts.join(", ")}`,
        groupId: entry.groupId,
        undoable: true,
      });
      await logAction(ctx, {
        campaignId: ctx.campaign._id,
        actorId: ctx.user._id,
        kind: "combat",
        visibility: "gm",
        summary: `${sheet.name} picks Minions → ${gmParts.join("; ")}`,
        groupId: entry.groupId,
        adversaryBefore: picks.map((p) => p.before),
        undoable: true,
      });
      return { status: "resolved" as const, defeated: instanceIds.length, targets: picks.map((p) => ({ tokenId: p.tokenId, defeated: p.defeated })) };
    }),
});

type Pick = { tokenId: Id<"combatTokens">; label: string; count: number; hp: number; hpMax: number; defeated: boolean; before: AdversaryBefore };

/** Marks one HP per picked Minion on each candidate instance; COMBAT_TARGET_INVALID for a pick the offer doesn't allow. */
async function applyPicks(
  ctx: MutationCtx & { campaign: Doc<"campaigns"> },
  candidates: readonly { instanceId: Id<"encounterAdversaries">; tokenId: Id<"combatTokens">; available: number }[],
  counts: ReadonlyMap<Id<"encounterAdversaries">, number>,
): Promise<Pick[]> {
  const picks: Pick[] = [];
  const now = Date.now();
  for (const [instanceId, count] of counts) {
    const candidate = candidates.find((c) => c.instanceId === instanceId);
    const instance = await ctx.db.get("encounterAdversaries", instanceId);
    if (candidate === undefined || instance === null || instance.campaignId !== ctx.campaign._id) throw appError("COMBAT_TARGET_INVALID");
    const remaining = instance.stats.hpMax - instance.hp;
    if (count > candidate.available || count > remaining || instance.defeated) throw appError("COMBAT_TARGET_INVALID");
    const hp = instance.hp + count;
    const defeated = hp >= instance.stats.hpMax;
    await ctx.db.patch("encounterAdversaries", instance._id, { hp, defeated, updatedAt: now });
    picks.push({ tokenId: candidate.tokenId, label: instance.label, count, hp, hpMax: instance.stats.hpMax, defeated, before: beforeOf(instance) });
  }
  return picks;
}
