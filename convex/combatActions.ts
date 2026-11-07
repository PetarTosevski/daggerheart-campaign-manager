import { v } from "convex/values";

import { resolveTableSettings } from "../src/lib/config/campaign-settings";
import type { Range } from "../src/lib/domain/card-effects/types";
import { RANGE_ORDER } from "../src/lib/domain/combat-actions/distance";
import { appError } from "../src/lib/errors/app-error";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { logAction } from "./lib/actionLog";
import { assertCanAct, loadCharacter, readSheet } from "./lib/characterSheet";
import {
  addedOutOfRange,
  answerRiderPick,
  attackDuality,
  attackRollFields,
  attackScene,
  awaitingAttackValidator,
  beforeOf,
  checkAttackTargets,
  coverApplies,
  equippedWeapon,
  hostOf,
  pendingAttackValidator,
  pickRiders,
  resolveAttack,
  resolvedAttackValidator,
  rollFromStored,
  setupReach,
  weaponSlotValidator,
  withoutTargets,
  type AttackRoll,
} from "./lib/combatActions";
import { closeRequest, encounterRunning, groupOffer, loadOpenRequest, openSanction } from "./lib/combatRequests";
import { afterRollChoiceValidator, MAX_RIDERS_PER_ATTACK, riderPickChoiceValidator, riderValidator, type ForcedAttackPayload } from "./lib/validators/combatRequests";
import { featureScope } from "./lib/featureScope";
import { assertMayAct } from "./lib/spotlight";
import { keyedCampaignMutation, keyedGmMutation } from "./lib/functions";
import { fearFor } from "./lib/fearVisibility";
import { duality, editable, prepareDuality, rules, type Loaded } from "./lib/rolls";
import { rollDie } from "./lib/dice";
import { outcomeSucceeds } from "./lib/rollAftermath";
import { ruleModesOf } from "./lib/ruleModes";
import { traitIdValidator } from "./lib/validators/characters";
import { rollValidator, type AdversaryBefore } from "./lib/validators/actionLog";

/**
 * Weapon attacks on enemy tokens from the Combat Map (plan combat-actions, tracer CA3; docs/tasks/TASK-CA-CA3.md).
 * Players act for a character they edit (their own; the GM any): campaign wrappers with `need: "view"` and then
 * `loadCharacter(..., "edit")`, so another player's character is FORBIDDEN and an outsider NOT_FOUND (CF2).
 *
 * - `attack`: one Duality roll against every target's Difficulty, damage on any hit, HP marked on the encounter
 *   instances, one undoable actionLog group (public: hit / miss; GM: damage, severity, HP). A target out of the
 *   weapon's range turns the attack into a GM sanction (Q1); no line of sight refuses it (Q2).
 * - `targets` (combatActionsReads.ts, dcm-uh6r): the enemy tokens the character sees, with band, range, line of sight and
 *   cover only (U1, CF6); `riders` there too.
 * - `pickMinions`: the attacker picks the extra Minions their damage defeats (Q6, CB p.201), once.
 * - Plan rule-switches OP, optional rule "Conflict between PCs" (CB p.168; off by default): `attack` also takes another
 *   PC's token (against their Evasion; the damage opens their incoming-hit window), and `contest` is the GM's Contest
 *   (the instigator's action roll against the target's reaction total). docs/tasks/TASK-RULES-OP.md.
 *
 * What a player receives never holds an enemy's HP, Stress, thresholds or Difficulty (U1): the returns validators
 * below have no such field, and the public row's summary names only Hit / Miss / Defeated.
 */

const BAND_LABEL: Record<Range, string> = { melee: "Melee", veryClose: "Very Close", close: "Close", far: "Far", veryFar: "Very Far" };

/**
 * Config R2 (Q2 a; CB p.103 "Anything beyond a character's Very Far range is Out of Range and usually can't be
 * targeted"): whether an out-of-range target refuses this action instead of opening a GM sanction. Only with the table
 * setting `outOfRange: "refuse"` and only for a player: the GM or a co-GM acting for a PC (`gm`, the caller's
 * character permission is "owner") keeps today's sanction ("ask").
 */
export function refusesOutOfRange(campaign: Doc<"campaigns">, gm: boolean): boolean {
  return !gm && resolveTableSettings(campaign.tableSettings).outOfRange === "refuse";
}

/** COMBAT_TARGET_OUT_OF_RANGE naming the farthest band a target is at (thrown before anything is paid or logged). */
export function outOfRangeRefusal(targets: readonly { band: Range }[]) {
  const farthest = targets.reduce<Range>((far, t) => (RANGE_ORDER.indexOf(t.band) > RANGE_ORDER.indexOf(far) ? t.band : far), targets[0]?.band ?? "veryFar");
  return appError("COMBAT_TARGET_OUT_OF_RANGE", `Out of range: the target is at ${BAND_LABEL[farthest]} range, beyond this action's reach. The GM refuses out-of-range actions.`);
}

/** The character the caller edits, in this campaign, with its sheet (NOT_FOUND / FORBIDDEN otherwise). */
async function attacker(ctx: QueryCtx & { user: Doc<"users">; campaign: Doc<"campaigns"> }, characterId: Id<"characters">): Promise<Loaded> {
  const { campaign, character, permission } = await loadCharacter(ctx, ctx.user, characterId, "edit", "owner");
  if (campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
  return { campaign, character, sheet: readSheet(character.sheet), gm: permission === "owner" };
}

/**
 * E1.4b (dcm-uxsd): the open forced-attack request for this character, with its locked targets (the same set, any order).
 * NOT_FOUND for another campaign's or another kind of request, REQUEST_NOT_OPEN once answered or when its encounter
 * ended (declined then), INVALID for another character's or a changed target list.
 */
async function forcedRequest(ctx: MutationCtx & { user: Doc<"users">; campaign: Doc<"campaigns"> }, requestId: Id<"combatRequests">, characterId: Id<"characters">, targetTokenIds: readonly Id<"combatTokens">[]): Promise<{ row: Doc<"combatRequests">; payload: ForcedAttackPayload }> {
  const row = await loadOpenRequest(ctx, ctx.campaign._id, requestId);
  const payload = row.payload;
  if (payload.kind !== "forcedAttack") throw appError("NOT_FOUND");
  if (!(await encounterRunning(ctx, row))) {
    await closeRequest(ctx, row._id, "declined", ctx.user._id);
    throw appError("REQUEST_NOT_OPEN");
  }
  if (payload.characterId !== characterId) throw appError("INVALID", "That forced attack is another character's.");
  const locked = new Set<string>(payload.targetTokenIds);
  if (targetTokenIds.length !== locked.size || !targetTokenIds.every((id) => locked.has(id))) throw appError("INVALID", "A forced attack's targets are locked.");
  return { row, payload };
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
    ...(args.riseToTheChallenge !== undefined ? { riseToTheChallenge: args.riseToTheChallenge } : {}),
    // E1.3b (dcm-xbtw): the "Use as Spirit Weapon" box.
    ...(args.spiritWeapon !== undefined ? { spiritWeapon: args.spiritWeapon } : {}),
  };
}

/**
 * Attacks enemy tokens with the primary or secondary weapon. The attacker is the character's PC token on the live map
 * (COMBAT_MAP_NOT_FOUND, COMBAT_TOKEN_NOT_FOUND); every target must be seen with a clear line (COMBAT_NO_LINE_OF_SIGHT)
 * and be an enemy token of a running encounter's undefeated instance (COMBAT_TARGET_INVALID). When any target is out of
 * the weapon's range the attack waits for the GM (`pending`, a `combatRequests` sanction): nothing is rolled or paid
 * until `combatRequests.sanction` approves it. Otherwise it resolves now (`resolveAttack`). With "Conflict between PCs"
 * on, a PC target out of range waits the same way (ODR3; no encounter needed); the GM's "refuse" setting refuses it.
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
    /** SD5: riders taken with the attack (at most MAX_RIDERS_PER_ATTACK). */
    riders: v.optional(v.array(riderValidator)),
    /**
     * Plan lanes-2 wave 10, E1.4b (dcm-uxsd): the open `forcedAttack` request this attack answers (Beguiled, HF p.75). Its
     * targets are locked: `targetTokenIds` must be exactly the request's (else INVALID); the GM chose them, so no range
     * sanction is asked. The attack's rows join the forcing use's undo group and the request is resolved.
     */
    forcedRequestId: v.optional(v.id("combatRequests")),
    /**
     * E1.4b (dcm-kso9; user answer 2026-11-01): the option picked before rolling for a target's rider benefit (Lead by
     * Example, CB p.342: clear a Stress or gain a Hope). The attack uses the rider up, hit or miss. Not kept by a GM sanction.
     */
    benefit: v.optional(v.string()),
  },
  returns: v.union(resolvedAttackValidator, pendingAttackValidator, awaitingAttackValidator),
  // dcm-jh6d.62: a player's result loses `fearGained` while the GM's Fear is hidden.
  handler: async (ctx, args) =>
    fearFor(ctx, ctx.user, ctx.campaign, await ctx.once("combat_attack", args, async () => {
      const { characterId, mapId, targetTokenIds, slot, forcedRequestId, benefit, ...options } = args;
      let riders = args.riders ?? [];
      if (riders.length > MAX_RIDERS_PER_ATTACK) throw appError("INVALID", `At most ${MAX_RIDERS_PER_ATTACK} riders.`);
      const loaded = await attacker(ctx, characterId);
      const forced = forcedRequestId === undefined ? null : await forcedRequest(ctx, forcedRequestId, characterId, targetTokenIds);
      // S2 (plan rule-switches RS2): the PC's own attack waits while the GM holds the spotlight; an attack the GM forced
      // (Beguiled) is the GM's move and goes on.
      if (forced === null) await assertMayAct(ctx, ctx.campaign, loaded.character, "action", loaded.sheet.name);
      const scene = await attackScene(ctx, ctx.campaign, loaded.character, mapId);
      const weapon = equippedWeapon(loaded.sheet, slot);
      const roll = rollOf(options);
      const host = hostOf(weapon, slot, roll.trait);
      let picked = pickRiders(loaded.sheet, ctx.campaign, host, riders);
      // Config R2 (Q2 a): when the GM refuses out-of-range actions, a rider's extra targets out of its range are dropped
      // (a rider left with none is dropped, nothing paid) and the attack goes on without them.
      const refuse = forced === null && refusesOutOfRange(ctx.campaign, loaded.gm);
      if (refuse) {
        const dropped = new Set<string>(addedOutOfRange(scene, weapon, picked).map((a) => a.tokenId));
        if (dropped.size > 0) {
          riders = withoutTargets(riders, dropped);
          picked = pickRiders(loaded.sheet, ctx.campaign, host, riders);
        }
      }
      // E1.4b (dcm-lbai): a reach picked with the attack widens its own range check.
      // Plan rule-switches OP: with "Conflict between PCs" on (CB p.168), another PC's token is a target too (`pcs`).
      const { adversaries: targets, pcs } = await checkAttackTargets(ctx, ctx.campaign, scene, weapon, targetTokenIds, roll, setupReach(picked));
      const pcTargets = pcs.length > 0 ? { pcTargets: pcs } : {};
      if (forced !== null) {
        const result = await resolveAttack(ctx, { loaded, actorId: ctx.user._id, scene, weapon, slot, targets, ...pcTargets, roll, riders, groupId: forced.payload.groupId, ...(benefit !== undefined ? { benefit } : {}) });
        await closeRequest(ctx, forced.row._id, "resolved", ctx.user._id);
        return result;
      }
      const outOfRange = targets.filter((t) => !t.check.inRange);
      // Plan rule-switches ODR3 (OP2's note): a named PC out of range waits for the GM like an adversary target
      // (`combatRequests.sanction` re-checks the PCs and rolls against their Evasion).
      const farPcs = pcs.flatMap((p) => (p.check && !p.check.inRange ? [{ tokenId: p.token._id, check: p.check }] : []));
      // Config R2: the attack's own target out of range is refused (nothing rolled, paid or logged), a PC as an adversary.
      if (refuse && (outOfRange.length > 0 || farPcs.length > 0)) throw outOfRangeRefusal([...outOfRange.map((t) => t.check), ...farPcs.map((p) => p.check)]);
      // DA2 (combat-actions Q1, user 2026-10-30): a rider's extra target out of its range waits for the GM too.
      const added = addedOutOfRange(scene, weapon, picked);
      if (outOfRange.length === 0 && farPcs.length === 0 && added.length === 0) return resolveAttack(ctx, { loaded, actorId: ctx.user._id, scene, weapon, slot, targets, ...pcTargets, roll, riders, ...(benefit !== undefined ? { benefit } : {}) });

      // Q1: wait for the GM. Refuse now what the approval would refuse anyway (a character who can't act, unpaid costs,
      // a rider that doesn't ride on this attack).
      assertCanAct(loaded.character, loaded.sheet);
      rules(() => prepareDuality(loaded.sheet, attackDuality(weapon, roll, coverApplies(ctx.campaign, targets)), featureScope(ctx.campaign), null));
      const named = [...outOfRange.map((t) => ({ tokenId: t.token._id, band: t.check.band })), ...farPcs.map((p) => ({ tokenId: p.tokenId, band: p.check.band }))];
      const bands = [...named, ...added.filter((a) => !named.some((t) => t.tokenId === a.tokenId))];
      // OP2: an attack on PCs only belongs to no encounter.
      const encounterId = targets[0]?.encounter._id;
      const requestId = await openSanction(ctx, {
        campaignId: ctx.campaign._id,
        ...(encounterId !== undefined ? { encounterId } : {}),
        mapId: scene.map._id,
        createdBy: ctx.user._id,
        payload: {
          schemaVersion: 1,
          kind: "sanction",
          characterId,
          action: { kind: "attack", slot, targetTokenIds, roll, ...(riders.length > 0 ? { riders } : {}) },
          outOfRange: bands,
          ...(added.length > 0 ? { added: added.map((a) => a.tokenId) } : {}),
        },
      });
      return { status: "pending" as const, requestId, outOfRange: bands };
    }), "fearGained", ctx.permission),
});

/** One side of a Contest: the character, the trait it rolls and a modifier the GM types (the roll's other options stay off). */
const contestSide = v.object({ characterId: v.id("characters"), trait: traitIdValidator, modifier: v.number() });
const contestRoll = v.object({ entryId: v.id("actionLog"), roll: rollValidator });

/**
 * Plan rule-switches OP: the GM calls a Contest between two PCs (optional rule "Conflict between PCs", CB p.168: "On any
 * other kind of action roll, the instigator makes an action roll and the target makes a reaction roll. To succeed, the
 * instigator must beat a Difficulty equal to the total value of the reaction roll."). The server rolls the target's
 * reaction roll first, then the instigator's action roll with that total as its Difficulty; both are the characters' own
 * rolls as the dice box makes them (`duality`: Hope, Stress, the GM's Fear, countdown ticks and the spotlight for the
 * action roll; a reaction roll gains nothing, CB p.99), each its own undoable public row. The GM and co-GMs only (players
 * FORBIDDEN); MECHANIC_DISABLED while the rule is off; INVALID for one character on both sides; NOT_FOUND for another
 * campaign's character; a character who can't act (dead, away, unconscious) is refused by the roll.
 */
export const contest = keyedGmMutation({
  rateLimit: "roll",
  args: { instigator: contestSide, target: contestSide },
  returns: v.object({ difficulty: v.number(), success: v.boolean(), reaction: contestRoll, action: contestRoll }),
  handler: async (ctx, { instigator, target }) =>
    ctx.once("combat_contest", { instigator, target }, async () => {
      if (!ruleModesOf(ctx.campaign).pcConflict) throw appError("MECHANIC_DISABLED");
      if (instigator.characterId === target.characterId) throw appError("INVALID", "A Contest needs two characters.");
      const by = await editable(ctx, ctx.user, instigator.characterId);
      const against = await editable(ctx, ctx.user, target.characterId);
      if (by.campaign._id !== ctx.campaign._id || against.campaign._id !== ctx.campaign._id) throw appError("NOT_FOUND");
      const plain = { experienceIds: [], advantage: 0, disadvantage: 0, help: 0, attack: false, options: [] };
      const reaction = await duality(ctx, against, { kind: "reaction", trait: target.trait, modifier: target.modifier, ...plain }, rollDie, false);
      const difficulty = reaction.roll.total;
      const action = await duality(ctx, by, { kind: "action", trait: instigator.trait, modifier: instigator.modifier, difficulty, ...plain }, rollDie, false);
      return {
        difficulty,
        success: outcomeSucceeds(action.roll.outcome),
        reaction: { entryId: reaction.entryId, roll: reaction.roll },
        action: { entryId: action.entryId, roll: action.roll },
      };
    }),
});

/**
 * SD5 (Q1, CB p.107): answers an attack held after its roll: `use` one of its after-roll features (its costs and limit
 * apply; the roll is rerolled or changed, and the new result stands) or `pass`. The attacker's player or the GM (Resolve
 * now); another player is FORBIDDEN. The attack then resolves with the dice it already rolled, and the rows belong to
 * the player who attacked. A request whose encounter ended is declined. REQUEST_NOT_OPEN once answered; NOT_FOUND for
 * another campaign's or a non-after-roll request; INVALID for a feature the request doesn't offer.
 */
export const afterRoll = keyedCampaignMutation({
  need: "view",
  rateLimit: "roll",
  args: { requestId: v.id("combatRequests"), choice: afterRollChoiceValidator },
  returns: v.union(resolvedAttackValidator, v.object({ status: v.literal("declined") })),
  handler: async (ctx, { requestId, choice }) =>
    fearFor(ctx, ctx.user, ctx.campaign, await ctx.once("combat_after_roll", { requestId, choice }, async () => {
      const row = await loadOpenRequest(ctx, ctx.campaign._id, requestId);
      if (row.payload.kind !== "afterRoll") throw appError("NOT_FOUND");
      const p = row.payload;
      const loaded = await attacker(ctx, p.characterId);
      if (!(await encounterRunning(ctx, row)) || row.mapId === undefined) {
        await closeRequest(ctx, row._id, "declined", ctx.user._id);
        return { status: "declined" as const };
      }
      if (choice.kind === "use" && !p.options.some((o) => o.featureId === choice.featureId && (choice.useId === undefined || choice.useId === o.useId))) throw appError("INVALID", "That feature isn't offered on this roll.");
      const answer = choice.kind === "use" ? { ...choice, useId: choice.useId ?? p.options.find((o) => o.featureId === choice.featureId)!.useId } : choice;
      const scene = await attackScene(ctx, ctx.campaign, loaded.character, row.mapId);
      const weapon = equippedWeapon(loaded.sheet, p.action.slot);
      // Plan rule-switches OP: a held attack on PCs ("Conflict between PCs") checks them again too.
      const { adversaries: targets, pcs } = await checkAttackTargets(ctx, ctx.campaign, scene, weapon, p.action.targetTokenIds, rollFromStored(p.action.roll));
      const result = await resolveAttack(ctx, {
        loaded,
        actorId: row.createdBy,
        scene,
        weapon,
        slot: p.action.slot,
        targets,
        ...(pcs.length > 0 ? { pcTargets: pcs } : {}),
        roll: rollFromStored(p.action.roll),
        riders: p.action.riders ?? [],
        held: { dice: p.dice, answer },
        ...(p.action.waived ? { waived: p.action.waived } : {}),
      });
      if (result.status !== "resolved") throw appError("INVALID");
      await closeRequest(ctx, row._id, "resolved", ctx.user._id);
      return result;
    }), "fearGained", ctx.permission),
});

/**
 * DA2 (HF p.8 Death Strike: "When you deal Severe damage to a creature, you can mark a Stress to force them to mark an
 * additional Hit Point"; user 2026-10-30): answers a damage-phase rider prompt after an attack: `use` on the ONE creature
 * picked from its candidates (its cost paid now), or `pass`. The attacker's player or the GM; another player FORBIDDEN.
 * Logged into the attack's group (undoing the attack undoes it). A prompt whose encounter ended, or whose attack was
 * undone, is declined. REQUEST_NOT_OPEN once answered; NOT_FOUND for another campaign's or another kind of request.
 */
export const riderPick = keyedCampaignMutation({
  need: "view",
  args: { requestId: v.id("combatRequests"), choice: riderPickChoiceValidator },
  returns: v.object({ status: v.union(v.literal("resolved"), v.literal("passed"), v.literal("declined")) }),
  handler: async (ctx, { requestId, choice }) =>
    ctx.once("combat_rider_pick", { requestId, choice }, async () => {
      const row = await loadOpenRequest(ctx, ctx.campaign._id, requestId);
      if (row.payload.kind !== "riderPick") throw appError("NOT_FOUND");
      const loaded = await attacker(ctx, row.payload.characterId);
      if (!(await encounterRunning(ctx, row))) {
        await closeRequest(ctx, row._id, "declined", ctx.user._id);
        return { status: "declined" as const };
      }
      return { status: await answerRiderPick(ctx, loaded, row, choice, ctx.user._id) };
    }),
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
      const { character, sheet, gm } = await attacker(ctx, entry.characterId);
      const offer = await groupOffer(ctx, ctx.campaign._id, entry.groupId);
      if (offer === null || offer.payload.kind !== "minionOffer") throw appError("REQUEST_NOT_OPEN");
      if (!(await encounterRunning(ctx, offer))) {
        await closeRequest(ctx, offer._id, "declined", ctx.user._id);
        return { status: "declined" as const, defeated: 0, targets: [] };
      }
      const payload = offer.payload;
      // Rule switches RC1, D6 variant "GM picks the extra Minions" (not in the books, Q5 a): only the GM or a co-GM picks.
      if (payload.picker === "gm" && !gm) throw appError("FORBIDDEN", "The GM picks the extra Minions in this campaign.");
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
