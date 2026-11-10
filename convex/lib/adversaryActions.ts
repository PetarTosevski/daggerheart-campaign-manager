/**
 * Adversary attacks and features against PCs (plan combat-actions, tracer AA2; docs/tasks/TASK-CA-AA2.md): the steps
 * behind `adversaryActions.attack` and `adversaryActions.useFeature`. Callers are GM wrappers. The rules are AA1's pure
 * engine (src/lib/domain/adversary-actions, src/lib/domain/adversary-effects/run.ts) and the AE-* feature tables; this
 * module loads the instance and the scene, asks for Fear, runs the plan with the server's dice, writes what it changes
 * and logs one undoable actionLog group. Every hit PC gets an incoming hit (./incomingHits.ts) that waits for armor and
 * ally reactions.
 *
 * User answers (binding, quoted in the task doc): Q12 / Q16 the GM acts from the Encounter tab or the map with the same
 * rules; Q14 players see that they were hit, never the roll; Q15 every adversary feature automated (SRD features without
 * an effect entry yet, and custom adversaries' features, run as manual GM prompts); Q18 (a) no live map: any party PC,
 * no range or line of sight; Q19 (a) Fear only on the GM's tap: a Fear cost, an Experience and a second spotlight answer
 * `confirmFear` until `spendFear` covers them; optional reactions are opt-in (default No); Fear gains (Momentum) are
 * automatic. U4: the GM undoes the group (the PCs' sheets, the instances, the Fear).
 *
 * Rules (printed pages): AR1 CB p.160 d20 + ATK vs Evasion, Fear for an Experience; AR2 CB p.148 natural 20; AR6 CB
 * p.153-154, p.194 spotlight and Fear; AR7 CB p.161 one roll for every target; AR8 CB p.195 reactions; AR9 CB p.201 Group
 * Attack; AR10 CB p.199 Horde; Q2 cover gives the roll disadvantage (CB p.104).
 */
import { ConvexError } from "convex/values";

import { pickAdversaryUse, rangeGate, standardAttackEffect, STANDARD_ATTACK_USE, upfrontFear, type AdversaryPlan, type AdversaryPlanStep, type AdversaryRunContext } from "../../src/lib/domain/adversary-effects/run";
import type { AdversaryFeatureEffect } from "../../src/lib/domain/adversary-effects/types";
import { adversaryAttack, adversaryDamage, criticalBonus, gmControlledWeaponAttack } from "../../src/lib/domain/adversary-actions/attack";
import { underwaterDisadvantage } from "../../src/lib/domain/combat-map/light";
import { getWeapon } from "../../src/lib/srd/index";
import type { TraitId } from "../../src/lib/srd/types";
import {
  actorWithSubject,
  areaWords,
  featureReady,
  fillsFromMap,
  namedByGm,
  hiddenCondition,
  hiddenTargetNote,
  keptDie,
  passiveSummary,
  pcTarget,
  preRollFits,
  splitTargetEdge,
  vulnerableTargetNote,
  type AdversaryEvent,
  type RollFacts,
  type TriggeredUse,
} from "../../src/lib/domain/adversary-actions/index";
import { rangeAsk } from "../../src/lib/domain/card-effects/rule-notes";
import type { ModeOf } from "../../src/lib/rules/registry";
import { runFeature } from "../../src/lib/domain/feature-effects/run";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import { resolveOptions } from "../../src/lib/frames/options";
import { featureFearCost } from "../../src/lib/domain/adversaries/index";
import type { PlanStep } from "../../src/lib/domain/card-effects/run";
import type { Cost, Range, TargetSpec } from "../../src/lib/domain/card-effects/types";
import { applyDamageTo, applyHpTo, applyStressTo, lineOfSight, rangeCheck, tokenDistance, type Combatant } from "../../src/lib/domain/combat-actions/index";
import { applySpotlight } from "../../src/lib/domain/encounters/spotlight";
import type { RollRecord } from "../../src/lib/domain/duality";
import { appError } from "../../src/lib/errors/app-error";
import type { CharacterSheet, FeatureUse } from "../../src/lib/validation/characters";
import { CARD_TOKENS_MAX, MAX_SHEET_CREATURE_TOKEN_KINDS } from "../../src/lib/validation/character-constants";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAction, newGroupId } from "./actionLog";
import {
  GM_CONTROLLED,
  gmControlOf,
  adversaryInstanceEffect,
  conditionInstanceEffect,
  endInstanceConditions,
  adversaryEndRoll,
  formInstanceEffect,
  instanceStatsOf,
  withoutClearedConditions,
  adversaryOnlyPrompts,
  adversaryState,
  attackedRidersOn,
  beforeOf,
  blockOf,
  instanceModifiers,
  instanceUses,
  isAttackUse,
  instanceBearerRiders,
  loadActor,
  mapCreatures,
  optionalIds,
  riderStepsText,
  selfRiderSteps,
  ridersOf,
  runOrThrow,
  selfCombatant,
  spotlightFearFor,
  storedUses,
  triggered,
  type Block,
  type BlockFeature,
  type Prompt,
} from "./adversaryFeatures";
import { answeringFeatures, featureActor, featureChoices, featureReplayActor, seededRng, SPENT_DICE } from "./adversaryHits";
import { actorSheetAfter, handfulsOf, pcCombatant, writeSheetChanges } from "./cardRunner";
import { endAdversaryConditions, withAdversaryConditionMarkers } from "./cardRows";
import { openForcedAttacks } from "./forcedAttacks";
import type { EndOccurrence, EndRoll } from "../../src/lib/domain/characters/expiry";
import { saveSheet } from "./characterSheet";
import { logUnshakable, unshake } from "./unshakable";
import { closeRequest } from "./combatRequests";
import { liveCombatMap, tokensOnMap } from "./combatMaps";
import { holdForAllyPicks, pickDice } from "./allyPickHold";
import { loadScene, type Scene } from "./combatVision";
import { MAX_INSTANCES } from "./encounters";
import { campaignFearState, gainFear, spendFear } from "./fear";
import {
  assertPicked,
  attackerInstanceId,
  bandsOnMap,
  featureRefusal,
  openIncomingHit,
  partyMembers,
  writeAttackerChanges,
  type AnswerChoice,
  type BandBetween,
  type HitDraft,
  type HitResolution,
  type PartyMember,
} from "./incomingHits";
import { rollDie } from "./dice";
import { criticalDamageNote } from "../../src/lib/domain/dice/index";
import { postRuleNote, ruleMode } from "./ruleModes";
import { fearByHandText, hordeNote, unconsciousTargetText } from "../../src/lib/domain/adversary-actions/rule-notes";
import { crossedBy, pathMoveRange } from "../../src/lib/domain/adversary-actions/path-targets";
import { moveToken } from "../../src/components/combat-map/tokens/geometry";
import { isUntargetableUnconscious } from "../../src/lib/domain/characters/index";
import { tierRuleActive } from "../../src/lib/frames/trackers/horizon";
import { loadTracker } from "./trackers";
import { horizonTracker } from "../trackers/horizon";
import { moveToGm, spotlightAdversary } from "./spotlight";
import type { ActionTarget, AdversaryBefore, StoredRoll } from "./validators/actionLog";
import { MAX_GM_PROMPTS_PER_USE, type CombatResponse, type HitRider, type PreRollPayload } from "./validators/combatRequests";
import { ENCOUNTER_CONDITIONS, MAX_CREATURE_TOKEN_KINDS, type EncounterCondition, type InstanceEffect } from "./validators/encounters";

// The stat block, limits, riders and the runner's helpers moved to ./adversaryFeatures.ts (AA2c, CH9); same names here.
export { adversaryOnlyPrompts, adversaryState, beforeOf, blockOf, instanceUses, ridersOf, selfCombatant, type Block, type Prompt } from "./adversaryFeatures";

/** The most creatures one action names in each list (targets, picked, allies, follow-up); bounds the hit rows (CD8). */
export const MAX_ACTION_TARGETS = 20;
/** The most Minions a Group Attack counts. */
const MAX_GROUP = 30;
/** Lane E7, round 2: the most further links of a repeating follow-up (Rip & Tear) one action takes. */
const MAX_CHAIN = 10;

const ENCOUNTER_SET = new Set<string>(ENCOUNTER_CONDITIONS);

// ---------------------------------------------------------------- the scene

/** The live map around the adversary, when it has a token there; else none (Q18: party list, no range, no sight). */
type MapScene = { scene: Scene; selfToken: Doc<"combatTokens"> };

type ActionScene = { map: MapScene | null; party: PartyMember[]; bands: BandBetween };

async function actionScene(ctx: QueryCtx, campaign: Doc<"campaigns">, instance: Doc<"encounterAdversaries">): Promise<ActionScene> {
  const party = await partyMembers(ctx, campaign._id);
  const live = await liveCombatMap(ctx, campaign._id);
  if (live === null) return { map: null, party, bands: () => undefined };
  const scene = await loadScene(ctx, campaign, live);
  const selfToken = scene.tokens.find((t) => t.ref.kind === "adversary" && t.ref.adversaryId === instance._id);
  return { map: selfToken ? { scene, selfToken } : null, party, bands: await bandsOnMap(ctx, live._id) };
}

/**
 * Plan rule-switches OE: the disadvantage Underwater gives an adversary's attack roll (`underwaterDisadvantage`): the rule
 * on, the adversary's token on the live map, the map marked Underwater, the token not marked "fights underwater".
 */
export function underwaterAttackDisadvantage(campaign: Doc<"campaigns">, scene: { map: ActionScene["map"] }): number {
  if (scene.map === null) return 0;
  return underwaterDisadvantage(ruleMode(campaign, "underwater") && scene.map.scene.map.underwater === true, scene.map.selfToken.fightsUnderwater === true);
}

/**
 * Plan rule-switches ODR3 (user 2026-11-06; ODR2's `rangeGate`): with Defined Ranges off a triggered use gated by a range
 * ("When a PC within Close range makes an action roll": Ill Omen, HF p.95) neither runs on its own nor is offered; the
 * GM is asked who is in range instead (`asks`, one `rangeAsk` per use, headed by the feature and the adversary). On:
 * every use, no question.
 */
export function rangeGatedUses(uses: readonly TriggeredUse[], definedRanges: boolean, label: string): { uses: TriggeredUse[]; asks: string[] } {
  if (definedRanges) return { uses: [...uses], asks: [] };
  const kept: TriggeredUse[] = [];
  const asks: string[] = [];
  for (const t of uses) {
    const range = rangeGate(t.effect, t.use.id);
    if (range === null) kept.push(t);
    else asks.push(rangeAsk(`${t.effect.feature} (${label})`, range));
  }
  return { uses: kept, asks };
}

/**
 * Plan rule-switches WF, W3 Tier 3 Dark-Hearted (Journey to Horizon, HF p.177: "After you mark 5 boxes in this tier,
 * adversaries gain the following feature: Dark-Hearted - Passive: Spend a Fear to give the adversary advantage on its next
 * roll"): active in Journey to Horizon with the Doom Track in Book or Every N sessions, once 5 Tier 3 boxes are marked.
 */
export async function darkHeartedActive(ctx: QueryCtx, campaign: Doc<"campaigns">): Promise<boolean> {
  if (campaign.frameId !== horizonTracker.frameId || ruleMode(campaign, "doomTrack") === "manual") return false;
  return tierRuleActive(await loadTracker(ctx, campaign._id, horizonTracker), 3);
}

/**
 * ODR3: the runner's flag for the campaign's Defined Ranges (absent = on, so only off is spread in). Plan rule-switches WR:
 * also R10 `criticalDamage` when Manual (a natural 20's damage rolled like a normal hit; the GM's note: `criticalDamageNote`).
 */
function rangesFlag(campaign: Doc<"campaigns">): { definedRanges?: false; criticalDamage?: "manual"; fearFeatures?: "manual"; experienceFear?: "manual"; hordes?: "manual" } {
  return {
    ...(ruleMode(campaign, "definedRanges") ? {} : { definedRanges: false as const }),
    ...(ruleMode(campaign, "criticalDamage") === "manual" ? { criticalDamage: "manual" as const } : {}),
    // Plan rule-switches WF: F5 / F4 Manual, the runner takes no Fear for the use's costs or an Experience.
    ...(ruleMode(campaign, "fearFeatures") === "manual" ? { fearFeatures: "manual" as const } : {}),
    ...(ruleMode(campaign, "adversaryExperienceFear") === "manual" ? { experienceFear: "manual" as const } : {}),
    // WF: D7 Manual, the standard attack keeps its printed damage at half HP (`hordeNote`).
    ...(ruleMode(campaign, "hordes") === "manual" ? { hordes: "manual" as const } : {}),
  };
}



type PcPick = { kind: "pc"; member: PartyMember; token: Doc<"combatTokens"> | null; combatant: Combatant; band?: Range };
type AdversaryPick = { kind: "adversary"; instance: Doc<"encounterAdversaries">; combatant: Combatant };
type Pick = PcPick | AdversaryPick;

/**
 * The creatures one list names: character ids, PC token ids (with a live map) or instance ids of the same encounter
 * (allies). With `sight`, a PC needs the adversary's line of sight on the map (Q2); `cover` reports whether any is in
 * cover. COMBAT_TARGET_INVALID for anything else (another campaign's, a PC not on the map, a defeated adversary).
 */
/**
 * dcm-y3mf: the creatures an "all targets within <range>" use reaches on the live map: PC tokens (and, for `side: "any"`,
 * the encounter's other standing adversaries) within the range of the adversary's token and in its line of sight. Ids
 * as `resolveCreatures` reads them (character / instance ids), nearest first.
 */
function inRangeOnMap(map: MapScene, spec: { side: TargetSpec["side"]; range: TargetSpec["range"] }, others: readonly Doc<"encounterAdversaries">[], selfId: Id<"encounterAdversaries">, skip: ReadonlySet<string> = new Set()): string[] {
  const range = spec.range === "weapon" ? "melee" : spec.range;
  const standing = new Set(others.filter((o) => o._id !== selfId && !o.defeated).map((o) => o._id as string));
  const out: { id: string; d: number }[] = [];
  for (const token of map.scene.tokens) {
    const id = token.ref.kind === "pc" ? (token.ref.characterId as string) : token.ref.kind === "adversary" && spec.side === "any" && standing.has(token.ref.adversaryId) ? (token.ref.adversaryId as string) : null;
    if (id === null || skip.has(id) || out.some((o) => o.id === id)) continue;
    if (!rangeCheck(map.selfToken, token, range).inRange) continue;
    if (!lineOfSight(map.scene.prepared, map.selfToken, token, map.scene.visionObjects).lineOfSight) continue;
    out.push({ id, d: tokenDistance(map.selfToken, token) });
  }
  return out
    .sort((a, b) => a.d - b.d)
    .slice(0, MAX_ACTION_TARGETS)
    .map((o) => o.id);
}

async function resolveCreatures(
  ctx: QueryCtx,
  base: { encounter: Doc<"encounters">; self: Doc<"encounterAdversaries">; block: Block; scene: ActionScene },
  ids: readonly string[],
  sight: boolean,
): Promise<{ picks: Pick[]; cover: boolean }> {
  if (ids.length > MAX_ACTION_TARGETS) throw appError("COMBAT_TARGET_INVALID", `At most ${MAX_ACTION_TARGETS} creatures.`);
  const picks: Pick[] = [];
  let cover = false;
  const { map, party } = base.scene;
  for (const raw of ids) {
    const characterId = ctx.db.normalizeId("characters", raw);
    const tokenId = ctx.db.normalizeId("combatTokens", raw);
    const instanceId = ctx.db.normalizeId("encounterAdversaries", raw);
    let member: PartyMember | undefined;
    if (characterId) member = party.find((m) => m.character._id === characterId);
    else if (tokenId && map) {
      const token = map.scene.tokens.find((t) => t._id === tokenId);
      if (token?.ref.kind === "pc") {
        const id = token.ref.characterId;
        member = party.find((m) => m.character._id === id);
      }
    } else if (instanceId) {
      const instance = instanceId === base.self._id ? base.self : await ctx.db.get("encounterAdversaries", instanceId);
      if (instance === null || instance.encounterId !== base.encounter._id || instance.defeated) throw appError("COMBAT_TARGET_INVALID");
      if (!picks.some((p) => p.kind === "adversary" && p.instance._id === instance._id)) {
        const block = instance._id === base.self._id ? base.block : await blockOf(ctx, instance);
        if (block === null) throw appError("COMBAT_TARGET_INVALID");
        picks.push({ kind: "adversary", instance, combatant: selfCombatant(instance, block) });
      }
      continue;
    }
    if (!member) throw appError("COMBAT_TARGET_INVALID");
    if (picks.some((p) => p.kind === "pc" && p.member.character._id === member.character._id)) continue;
    let token: Doc<"combatTokens"> | null = null;
    let band: Range | undefined;
    if (map) {
      token = map.scene.tokens.find((t) => t.ref.kind === "pc" && t.ref.characterId === member.character._id) ?? null;
      if (token === null) throw appError("COMBAT_TARGET_INVALID", "That character has no token on the map.");
      band = rangeCheck(map.selfToken, token, "melee").band;
      if (sight) {
        const seen = lineOfSight(map.scene.prepared, map.selfToken, token, map.scene.visionObjects);
        if (!seen.lineOfSight) throw appError("COMBAT_NO_LINE_OF_SIGHT");
        cover ||= seen.cover;
      }
    }
    picks.push({ kind: "pc", member, token, combatant: pcCombatant(member.character._id, member.sheet), ...(band ? { band } : {}) });
  }
  return { picks, cover };
}

/** The other Minions of a Group Attack (CB p.201): undefeated instances of the same stat block, one combatant per Minion. */
async function groupOf(ctx: QueryCtx, instance: Doc<"encounterAdversaries">, others: readonly Doc<"encounterAdversaries">[], self: Combatant): Promise<Combatant[]> {
  const same = (a: Doc<"encounterAdversaries">) =>
    a.source.kind === instance.source.kind && (a.source.kind === "srd" ? instance.source.kind === "srd" && a.source.adversaryId === instance.source.adversaryId : instance.source.kind === "custom" && a.source.customId === instance.source.customId);
  const minions = (a: Doc<"encounterAdversaries">) => (a.minionCount !== undefined ? Math.max(0, a.stats.hpMax - a.hp) : 1);
  const out: Combatant[] = [];
  for (let k = 1; k < minions(instance); k++) out.push({ ...self, id: `${instance._id}#${k}` });
  for (const a of others) {
    if (a._id === instance._id || a.defeated || !same(a)) continue;
    for (let k = 0; k < minions(a); k++) out.push({ ...self, id: k === 0 ? a._id : `${a._id}#${k}` });
  }
  void ctx;
  return out.slice(0, MAX_GROUP - 1);
}

// ---------------------------------------------------------------- applying plans

export type Offer = { feature: string; useId: string; trigger: string };

/** What one action changes, gathered from its plans (the main use, opted-in reactions, automatic uses) before writing. */
class Work {
  selfAfter: Combatant;
  tokensAfter: number;
  fearDelta = 0;
  readonly sheets = new Map<string, { member: PartyMember; after: CharacterSheet }>();
  readonly allies = new Map<string, { instance: Doc<"encounterAdversaries">; after: Combatant }>();
  readonly hits: { targetId: Id<"characters">; hit: HitDraft; riders: HitRider[] }[] = [];
  readonly prompts: Prompt[] = [];
  readonly gm: string[] = [];
  readonly spotlit = new Set<string>();
  /** Lane E7, round 2 (dcm-gx3): the modifiers of itself and its allies after the plans' `effect` steps on them, by instance id. */
  readonly instanceEffects = new Map<string, InstanceEffect[]>();
  /** Lane E7 round 3 (dcm-n3mp): named tokens on itself and its allies after the plans' `creatureTokens` steps, by instance id. */
  readonly creatureTokens = new Map<string, Map<string, number>>();
  /** Lane E7 round 3 (dcm-f70y): forced attacks the plans asked for (Words of Discord, Beguiled), run after the commit. */
  readonly forcedAttacks: { attackerIds: string[]; againstIds: string[] }[] = [];
  /** The use's option picks (a `moveLimit` wind direction reads them). */
  options?: Readonly<Record<string, readonly string[]>>;
  /** The instance's limited uses this scene (the runs' `featureUses`), and the ones this action recorded. */
  readonly baseUses: FeatureUse[];
  readonly addedUses: FeatureUse[] = [];

  constructor(
    readonly instance: Doc<"encounterAdversaries">,
    readonly block: Block,
    readonly party: readonly PartyMember[],
    readonly encounterInstances: readonly Doc<"encounterAdversaries">[],
    readonly encounter: Doc<"encounters">,
    /** AA2c: the live session (`campaignState.sessionStartedAt`); session-limited uses of it still count. */
    readonly session?: number,
  ) {
    this.selfAfter = selfCombatant(instance, block);
    this.tokensAfter = instance.tokens ?? 0;
    this.baseUses = instanceUses(instance, encounter, session);
  }

  /** Plan lanes-2 E7.4 (dcm-thwj): conditions an end took off an instance that is neither itself nor an ally of the plans. */
  readonly conditionsAfter = new Map<string, { conditions: string[]; tags: string[] }>();

  /**
   * Plan lanes-2 E7.4 (dcm-thwj): the stored condition ends this action set off, before the commit.
   * - `roll` (its attack or action roll): its own modifiers whose bearer `endsOnRoll` holds; the modifiers it gave other
   *   instances and the markers it gave PCs (cardRows.ts) whose caster `endsOnRoll` holds.
   * - the HP each instance marked in the plans (itself, allies): its own `endsOn` (`takeDamage`, `majorDamage`, ...) and the
   *   caster side of what it gave (`endsOnCaster`: Envelop's "until the Shark takes Severe damage", CB p.215).
   * A PC whose hit still waits keeps its markers until the hit lands (the end runs on the sheet as it is now).
   */
  settleEnds(roll: EndRoll | null) {
    const selfId = this.instance._id as string;
    const all = [this.instance, ...this.encounterInstances.filter((a) => a._id !== this.instance._id)];
    const stateOf = (a: Doc<"encounterAdversaries">) => {
      const id = a._id as string;
      const c = id === selfId ? this.selfAfter : this.allies.get(id)?.after;
      const held = this.conditionsAfter.get(id);
      return {
        effects: this.instanceEffects.get(id) ?? a.effects ?? [],
        conditions: c ? [...c.conditions] : (held?.conditions ?? [...a.conditions]),
        tags: c ? [...(c.tags ?? [])] : (held?.tags ?? [...(a.tags ?? [])]),
      };
    };
    const write = (a: Doc<"encounterAdversaries">, next: ReturnType<typeof endInstanceConditions>) => {
      if (next.ended.length === 0) return;
      const id = a._id as string;
      this.instanceEffects.set(id, [...next.effects]);
      if (id === selfId) this.selfAfter = { ...this.selfAfter, conditions: [...next.conditions], tags: [...next.tags] };
      else {
        const ally = this.allies.get(id);
        if (ally) ally.after = { ...ally.after, conditions: [...next.conditions], tags: [...next.tags] };
        else this.conditionsAfter.set(id, { conditions: [...next.conditions], tags: [...next.tags] });
      }
      for (const c of next.ended) this.gm.push(`${a.label} is no longer ${c}`);
    };
    const pcSide = (casterId: string, occ: EndOccurrence) => {
      for (const member of this.party) {
        const id = member.character._id as string;
        const sheet = this.sheets.get(id)?.after ?? member.sheet;
        const r = endAdversaryConditions(sheet, occ, { role: "caster", casterId });
        if (r.ended.length === 0) continue;
        this.sheets.set(id, { member, after: r.sheet });
        this.gm.push(...r.lines);
      }
    };
    if (roll !== null) {
      const occ: EndOccurrence = { kind: "roll", roll };
      write(this.instance, endInstanceConditions(stateOf(this.instance), occ, { role: "bearer" }));
      for (const a of all) if (a._id !== this.instance._id) write(a, endInstanceConditions(stateOf(a), occ, { role: "caster", casterId: selfId }));
      pcSide(selfId, occ);
    }
    for (const a of all) {
      const id = a._id as string;
      const after = id === selfId ? this.selfAfter : this.allies.get(id)?.after;
      const marked = after ? after.hp - a.hp : 0;
      if (!after || marked <= 0) continue;
      const occ: EndOccurrence = { kind: "damageTaken", severity: marked >= 3 ? "severe" : marked === 2 ? "major" : "minor", hpMarked: marked, lastHp: after.hp >= after.hpMax };
      write(a, endInstanceConditions(stateOf(a), occ, { role: "bearer" }));
      for (const b of all) if (b._id !== a._id) write(b, endInstanceConditions(stateOf(b), occ, { role: "caster", casterId: id }));
      pcSide(id, occ);
    }
  }

  nameOf(id: string): string {
    if (id === this.instance._id) return this.instance.label;
    const m = this.party.find((p) => p.character._id === id);
    if (m) return m.sheet.name;
    return this.encounterInstances.find((a) => a._id === id.split("#")[0])?.label ?? "someone";
  }

  /**
   * Folds one plan in: the adversary itself, Fear, PCs marked directly, allies, hits for the window, prompts. A PC with a
   * hit waiting gets this plan's other marks on them as the hit's riders (AA2b; user answer 2026-10-22: Bite's
   * Restrained moves with the damage to whoever takes it): conditions, effects, Hope, Stress and forced HP land when the
   * hit resolves, on the PC who took it; a forced Armor Slot from a later plan (Rending Chomp) joins the hit's `forcedArmor`.
   */
  absorb(plan: AdversaryPlan, feature: string) {
    this.selfAfter = plan.self.after;
    this.tokensAfter = plan.self.tokens.after;
    this.fearDelta += plan.gmFearDelta;
    // Limited uses this plan recorded (every run starts from the instance's stored uses, AA2b).
    for (const u of plan.self.featureUses.slice(this.baseUses.length)) this.addedUses.push(u);
    for (const hit of plan.incoming) {
      const member = this.party.find((m) => m.character._id === hit.targetId);
      if (!member) continue;
      const prior = this.hits.find((h) => h.targetId === member.character._id);
      if (prior) {
        // Plan lanes-2 E7.4 (dcm-spj0): a 0-damage window opened for forced HP takes the real hit's type and directness.
        const placeholder = prior.hit.amount === 0;
        prior.hit.amount += hit.amount;
        prior.hit.direct = placeholder ? hit.direct : prior.hit.direct || hit.direct;
        prior.hit.forcedArmor += hit.forcedArmor;
        if (placeholder) {
          prior.hit.type = hit.type;
          prior.hit.critical = hit.critical;
          if (hit.attackTotal !== undefined) prior.hit.attackTotal = hit.attackTotal;
        } else if (prior.hit.type !== hit.type) prior.hit.type = "both";
      } else {
        this.hits.push({ targetId: member.character._id, hit: { amount: hit.amount, type: hit.type, direct: hit.direct, forcedArmor: hit.forcedArmor, critical: hit.critical, ...(hit.attackTotal !== undefined ? { attackTotal: hit.attackTotal } : {}) }, riders: [] });
      }
    }
    const pending = (id: string) => this.hits.find((h) => h.targetId === id);
    const inPlan = new Set(plan.incoming.map((h) => h.targetId));
    const marks = (id: string, track: "stress" | "hp" | "armor", noBenefit?: boolean, reduceWithHope?: boolean) =>
      plan.steps.reduce(
        (n, s) =>
          n +
          (s.kind === "mark" && s.targetId === id && s.track === track && (noBenefit === undefined || (s.noBenefit === true) === noBenefit) && (reduceWithHope === undefined || (s.reduceWithHope === true) === reduceWithHope)
            ? s.amount
            : 0),
        0,
      );
    for (const c of plan.creatures) {
      if (c.id === this.instance._id) continue;
      const member = this.party.find((m) => m.character._id === c.id);
      if (member) {
        const sheet = this.sheets.get(c.id)?.after ?? member.sheet;
        const hit = pending(c.id);
        if (hit) {
          // Stress and forced HP ride with the hit; a forced Armor Slot of a later plan joins its `forcedArmor` (CB p.195).
          let armor = c.after.armor ?? sheet.armorMarked;
          if (!inPlan.has(c.id)) {
            const forced = Math.min(marks(c.id, "armor", true), Math.max(0, armor - (c.before.armor ?? 0)));
            hit.hit.forcedArmor += forced;
            armor -= forced;
          }
          const stress = marks(c.id, "stress");
          // E2.3 (dcm-nnbl, Doom / Tentacle Rays, HF p.75): HP from a `markHp` with `reduceWith: "hope"` ride apart, so
          // the PC may spend Hope to mark fewer of them.
          const hp = marks(c.id, "hp", undefined, false);
          const hopeHp = marks(c.id, "hp", undefined, true);
          if (stress > 0) hit.riders.push({ kind: "stress", amount: stress });
          if (hp > 0) hit.riders.push({ kind: "hp", amount: hp });
          if (hopeHp > 0) hit.riders.push({ kind: "hp", amount: hopeHp, reduceWithHope: true });
          if (armor !== sheet.armorMarked) this.sheets.set(c.id, { member, after: { ...sheet, armorMarked: armor } });
          continue;
        }
        // Plan lanes-2 E7.4 (dcm-spj0; Doom, HF p.75: "they can spend any number of Hope to reduce the number of HP marked
        // this way"): forced HP the PC may buy down with Hope and no hit waiting open a window of their own (a 0-damage hit
        // carrying the HP as its rider; E2.3 makes its target a responder), so the Hope is always offered. The rest of
        // the plan's marks on them land now.
        const hopeHp = marks(c.id, "hp", undefined, true);
        if (hopeHp > 0) {
          this.hits.push({ targetId: member.character._id, hit: { amount: 0, type: "physical", direct: true, forcedArmor: 0, critical: false }, riders: [{ kind: "hp", amount: hopeHp, reduceWithHope: true }] });
          this.sheets.set(c.id, { member, after: { ...sheet, hp: Math.min(sheet.hpMax, Math.max(sheet.hp, c.after.hp - hopeHp)), stress: Math.min(sheet.stressMax, c.after.stress), armorMarked: c.after.armor ?? sheet.armorMarked } });
          continue;
        }
        this.sheets.set(c.id, { member, after: { ...sheet, hp: Math.min(sheet.hpMax, c.after.hp), stress: Math.min(sheet.stressMax, c.after.stress), armorMarked: c.after.armor ?? sheet.armorMarked } });
        continue;
      }
      const ally = this.encounterInstances.find((a) => a._id === c.id);
      if (ally) this.allies.set(c.id, { instance: ally, after: c.after });
    }
    // Lane E7, round 2 (dcm-gx3): an `effect` on itself or an ally (Enraged's +1 Difficulty, Claw Swipe and the feature
    // swap, HF p.65) becomes an instance modifier the engine reads.
    for (const s of plan.steps) {
      if (s.kind !== "effect") continue;
      const owner = s.targetId === this.instance._id ? this.instance : this.encounterInstances.find((a) => a._id === s.targetId);
      if (owner === undefined) continue;
      const current = this.instanceEffects.get(owner._id) ?? owner.effects ?? [];
      this.instanceEffects.set(owner._id, adversaryInstanceEffect(current, plan.adversaryId, plan.feature, s, this.options));
    }
    // Lane E7 round 3 (dcm-f70y): the runner's lasting steps on instances and the forced attacks.
    const ownerOf = (id: string) => (id === this.instance._id ? this.instance : this.encounterInstances.find((a) => a._id === id));
    for (const s of plan.steps) {
      if (s.kind === "changeForm") {
        // dcm-3ag5 (Transform, HF p.142-143): the instance takes the other stat block; its marks stay.
        const owner = ownerOf(s.targetId);
        if (owner === undefined) continue;
        this.instanceEffects.set(owner._id, formInstanceEffect(this.instanceEffects.get(owner._id) ?? owner.effects ?? [], s.adversaryId, plan.feature));
        this.gm.push(`${owner.label} changes form`);
      } else if (s.kind === "condition") {
        // dcm-iedr / dcm-b77: a condition on an instance keeps its entry's mods and ends as a modifier tied to it.
        const owner = ownerOf(s.targetId);
        if (owner === undefined) continue;
        const next = conditionInstanceEffect(this.instanceEffects.get(owner._id) ?? owner.effects ?? [], `adv:${plan.adversaryId}/${plan.feature}`, plan.feature, this.instance._id, s, this.options);
        if (next !== null) this.instanceEffects.set(owner._id, next);
      } else if (s.kind === "creatureTokens") {
        // dcm-n3mp: named tokens on an instance are stored; on a PC the sheet has no field yet (follow-up), so the GM notes them.
        const owner = ownerOf(s.targetId);
        if (owner === undefined) {
          // Plan lanes-2 E7.4 (dcm-wiwi): on a PC the tokens go on the sheet (`creatureTokens`, V4; Encumber's bramble
          // tokens, CB p.218); a PC with a hit waiting gets them now too (they are no mark the hit could reduce).
          const member = this.party.find((m) => m.character._id === s.targetId);
          if (member === undefined) {
            this.gm.push(`${this.nameOf(s.targetId)}: ${s.name} ${s.before} -> ${s.after} (note it on the sheet)`);
            continue;
          }
          const sheet = this.sheets.get(s.targetId)?.after ?? member.sheet;
          this.sheets.set(s.targetId, { member, after: withSheetCreatureTokens(sheet, s.name, s.after) });
          this.gm.push(`${member.sheet.name}: ${s.name} ${s.before} -> ${Math.max(0, s.after)}`);
          continue;
        }
        const held = this.creatureTokens.get(owner._id) ?? new Map((owner.creatureTokens ?? []).map((t) => [t.name, t.count]));
        held.set(s.name, Math.max(0, s.after));
        this.creatureTokens.set(owner._id, held);
      } else if (s.kind === "forcedAttack") {
        this.forcedAttacks.push({ attackerIds: [...s.attackerIds], againstIds: [...s.againstIds] });
      }
    }
    // Lane E7, round 2 (dcm-iedr): what a condition's entry adds that the stored condition can't hold yet, for the GM.
    for (const d of plan.conditionDetails) {
      const name = d.condition.kind === "standard" ? d.condition.condition : d.condition.tag;
      const ends = [
        ...(d.endsOnCaster ?? []).map((e) => `${this.instance.label} ${e === "takeSevere" ? "takes Severe damage" : e === "majorDamage" ? "takes Major damage or more" : e}`),
        ...(d.endsOnRoll ? [`${d.endsOnRoll.by === "caster" ? this.instance.label : "they"} make ${d.endsOnRoll.roll === "any" ? "a" : `a ${d.endsOnRoll.roll}`} roll${d.endsOnRoll.result && d.endsOnRoll.result !== "any" ? ` (${d.endsOnRoll.result})` : ""}`] : []),
      ];
      if (ends.length > 0) this.gm.push(`${name} on ${this.nameOf(d.targetId)} ends when ${ends.join(" or ")}`);
      if (d.escape) this.gm.push(`${name} on ${this.nameOf(d.targetId)}: they can try to escape`);
    }
    // Conditions, effects and Hope on PCs (Restrained on a hit, a sheet effect), with the feature as the effect's source.
    const cardSteps = plan.steps.filter((s): s is PlanStep => s.kind !== "summon" && s.kind !== "countdown" && s.kind !== "spotlight");
    const touched = new Set(plan.steps.flatMap((s) => ("targetId" in s && ["condition", "clearCondition", "effect", "hope"].includes(s.kind) ? [s.targetId] : [])));
    for (const id of touched) {
      const member = this.party.find((m) => m.character._id === id);
      if (!member) continue;
      const sheet = this.sheets.get(id)?.after ?? member.sheet;
      // Plan lanes-2, E7.4 (dcm-1alq): a condition with an end the server runs (`endsOnCaster`: Envelop, Hold Them Down,
      // Encumber; `endsOnRoll`: Slowed, Rattled) carries its `ac:<n>` marker (cardRows.ts), so the end finds it.
      const after = withAdversaryConditionMarkers(writeSheetChanges(sheet, cardSteps, id, `${plan.adversaryId}/${plan.feature}`, feature, false, false), id, {
        casterId: this.instance._id,
        casterName: this.instance.label,
        adversaryId: plan.adversaryId,
        feature: plan.feature,
        details: plan.conditionDetails,
      });
      const hit = pending(id);
      if (hit) {
        hit.riders.push(...ridersOf(sheet, after, cardSteps, id));
        continue;
      }
      this.sheets.set(id, { member, after });
    }
    // Lane E7 (dcm-vkp): "can only mark one target at a time" (Judgment, CB p.236): a new use takes what the feature put on
    // the other PCs off them (its effects and tags; a standard condition carries no source and stays for the GM).
    const used = this.block.effects.find((e) => e.feature === plan.feature)?.uses.find((u) => u.id === plan.useId);
    if (used?.exclusive && touched.size > 0) {
      const cardId = `${plan.adversaryId}/${plan.feature}`;
      for (const member of this.party) {
        const id = member.character._id;
        if (touched.has(id)) continue;
        const sheet = this.sheets.get(id)?.after ?? member.sheet;
        const after = writeSheetChanges(sheet, [], id, cardId, feature, true, false);
        if (after.effects.length === sheet.effects.length) continue;
        this.sheets.set(id, { member, after });
        this.gm.push(`${feature}: ${member.sheet.name} is no longer marked`);
      }
    }
    for (const step of plan.steps) {
      const p = this.promptOf(step);
      if (p) this.prompts.push(p);
    }
    // AA2b (AE-t2-core note 2): adversary-only steps in a PC save's branches come back as their own prompts.
    for (const save of plan.saves ?? []) {
      const who = save.targetIds.map((id) => this.nameOf(id)).join(", ");
      for (const [branch, list] of [["fails", save.step.onFail], ["succeeds", save.step.onSuccess]] as const) {
        for (const p of adversaryOnlyPrompts(list)) this.prompts.push({ kind: p.kind, text: `If ${who} ${branch}: ${p.text}` });
      }
    }
    for (const id of plan.group) this.spotlit.add(id.split("#")[0]!);
    // Lane E7 (dcm-702): a `deathMove` step (CRONCH!, HF p.70) names its PCs here too.
    for (const id of plan.deathMoves) this.gm.push(`${this.nameOf(id)} must make a death move`);
    // Lane E7 (dcm-icd, dcm-145): who fled the scene (the GM removes them; QUESTIONS in TASK-LN-E7.md) and who came back.
    for (const id of plan.fled) this.gm.push(`${this.nameOf(id)} flees the scene`);
    for (const id of plan.revived) this.gm.push(`${this.nameOf(id)} comes back`);
  }

  private promptOf(step: AdversaryPlanStep): Prompt | null {
    const names = (ids: readonly string[]) => (ids.length > 0 ? ` (${ids.map((id) => this.nameOf(id)).join(", ")})` : "");
    switch (step.kind) {
      case "prompt":
        if (step.prompt === "pcSave" && step.step?.kind === "save") {
          const d = step.step.difficulty;
          const difficulty = d.kind === "fixed" ? d.value : this.selfAfter.difficulty;
          const trait = step.step.trait === undefined ? "" : ` ${[step.step.trait].flat().join(" or ")}`;
          return { kind: "pcSave", text: `${names(step.targetIds).slice(2, -1)}:${trait} Reaction Roll (${difficulty ?? "GM"}); apply the result on the sheet` };
        }
        return { kind: step.prompt === "move" ? "move" : step.prompt === "manual" ? "manual" : "choice", text: `${step.text}${names(step.targetIds)}` };
      case "summon":
        // Lane E7 (dcm-145): Drain and Multiply's Horde HP (CB p.218); dcm-v27: a second token of itself.
        return {
          kind: "summon",
          text: `Summon ${step.count} ${step.duplicate ? `more of ${this.instance.label}` : step.label}${step.range ? ` within ${step.range}` : ""}${step.hp !== undefined ? ` with ${step.hp} HP` : ""}${step.note ? `: ${step.note}` : ""}`,
        };
      case "countdown":
        // Lane E7 (dcm-m5s): an increasing / decreasing countdown (CB p.163) and its event at 0.
        return {
          kind: "countdown",
          text: `Countdown ${step.label}: ${step.op}${step.direction ? ` (${step.direction})` : ""}${step.start ? ` at ${step.start}` : ""}${step.amount ? ` by ${step.amount}` : ""}${step.onZero ? `; at 0: ${step.onZero}` : ""}${step.note ? ` (${step.note})` : ""}`,
        };
      case "spotlight":
        return step.who === "self" ? null : { kind: "spotlight", text: `Spotlight ${step.who}${step.count ? ` x${step.count}` : ""}${step.within ? ` within ${step.within}` : ""}${step.name ? ` (${step.name})` : ""}` };
      default:
        return null;
    }
  }
}

/**
 * Lane E7 round 3: the modifiers to write for an instance: the work's (or the stored ones) without those tied to a
 * condition it no longer has; undefined when nothing changes.
 */
function settledEffects(instance: Doc<"encounterAdversaries">, changed: InstanceEffect[] | undefined, conditions: readonly string[], tags: readonly string[]): InstanceEffect[] | undefined {
  const base = changed ?? instance.effects ?? [];
  const kept = withoutClearedConditions(base, conditions, tags);
  return changed !== undefined || kept.length !== base.length ? kept : undefined;
}

/** Lane E7 round 3 (dcm-n3mp): the run context's `creatureTokens`: every instance's named tokens by instance id. */
export function creatureTokensOf(instances: readonly { _id: string; creatureTokens?: { name: string; count: number }[] }[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const a of instances) if (a.creatureTokens && a.creatureTokens.length > 0) out[a._id] = Object.fromEntries(a.creatureTokens.map((t) => [t.name, t.count]));
  return out;
}

/**
 * Plan lanes-2 E7.4 (dcm-wiwi): the sheet with `count` tokens of `name` (`creatureTokens`, V4: at most
 * `MAX_SHEET_CREATURE_TOKEN_KINDS` kinds, 0..99 each); 0 takes the kind off.
 */
export function withSheetCreatureTokens(sheet: CharacterSheet, name: string, count: number): CharacterSheet {
  const key = name.slice(0, 40);
  const n = Math.max(0, Math.min(CARD_TOKENS_MAX, Math.trunc(count)));
  const rest = (sheet.creatureTokens ?? []).filter((t) => t.name !== key);
  const next = n > 0 ? [...rest, { name: key, count: n }].slice(-MAX_SHEET_CREATURE_TOKEN_KINDS) : rest;
  if (next.length === 0) {
    const { creatureTokens: _gone, ...without } = sheet;
    void _gone;
    return without;
  }
  return { ...sheet, creatureTokens: next };
}

/** Plan lanes-2 E7.4 (dcm-wiwi): the run context's `creatureTokens` of the PCs, read from their sheets. */
export function sheetCreatureTokensOf(party: readonly { character: { _id: string }; sheet: { creatureTokens?: CharacterSheet["creatureTokens"] } }[]): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const m of party) if (m.sheet.creatureTokens && m.sheet.creatureTokens.length > 0) out[m.character._id] = Object.fromEntries(m.sheet.creatureTokens.map((t) => [t.name, t.count]));
  return out;
}

/**
 * Lane E7 round 3 (dcm-n3mp): the run context's `goldOf`, each PC's gold in handfuls, a bag being 10 (CB p.104), as the
 * card runner counts it (`handfulsOf`; dcm-sgn7: bags were left out, so a `gold` number in bags read 0).
 */
export function partyGoldOf(party: readonly { character: { _id: string }; sheet: { gold: CharacterSheet["gold"] } }[]): Record<string, number> {
  return Object.fromEntries(party.map((m) => [m.character._id, handfulsOf(m.sheet)]));
}

/** Lane E7 round 3 (dcm-n3mp): named tokens as the instance stores them (empty names dropped, capped). */
function storedCreatureTokens(held: ReadonlyMap<string, number>): { name: string; count: number }[] {
  return [...held].filter(([, count]) => count > 0).map(([name, count]) => ({ name: name.slice(0, 40), count })).slice(0, MAX_CREATURE_TOKEN_KINDS);
}

/** Writes the work: the instance (and spotlight), allies, PC sheets with their public rows. Returns the instances' before-states. */
async function commit(ctx: MutationCtx, w: Work, log: { campaignId: Id<"campaigns">; actorId: Id<"users">; groupId: string }, spotlight: { gmTurn: number } | null): Promise<AdversaryBefore[]> {
  const now = Date.now();
  // AA2c: a recorded limited use goes into the before-state, so undo gives it back.
  const s = w.selfAfter;
  const selfConditions = [...new Set(s.conditions.filter((c): c is EncounterCondition => ENCOUNTER_SET.has(c)))];
  const selfTags = [...new Set(s.tags ?? [])].slice(0, 20);
  // Lane E7 round 3: modifiers tied to a condition it no longer has go with the condition.
  const selfEffects = settledEffects(w.instance, w.instanceEffects.get(w.instance._id), selfConditions, selfTags);
  const before: AdversaryBefore[] = [{ ...beforeOf(w.instance), ...(w.addedUses.length > 0 ? { featureUses: w.instance.featureUses ?? [] } : {}), ...(selfEffects ? { effects: w.instance.effects ?? [] } : {}) }];
  // A Transform's form brings its own maximums (instanceStatsOf); the stored stats otherwise.
  const selfStats = instanceStatsOf({ stats: w.instance.stats, effects: selfEffects ?? w.instance.effects });
  const hp = Math.max(0, Math.min(selfStats.hpMax, s.hp));
  const selfTokens = w.creatureTokens.get(w.instance._id);
  await ctx.db.patch("encounterAdversaries", w.instance._id, {
    hp,
    stress: Math.max(0, Math.min(selfStats.stressMax, s.stress)),
    defeated: hp >= selfStats.hpMax || (w.instance.defeated && s.defeated),
    conditions: selfConditions,
    tags: selfTags,
    tokens: Math.max(0, w.tokensAfter),
    ...(selfEffects ? { effects: selfEffects } : {}),
    ...(selfTokens ? { creatureTokens: storedCreatureTokens(selfTokens) } : {}),
    ...(w.addedUses.length > 0 ? { featureUses: storedUses(w.instance, w.encounter, w.block, w.addedUses, w.session) } : {}),
    ...(spotlight ? applySpotlight({ spotlights: w.instance.spotlights, spotlightTurn: w.instance.spotlightTurn }, spotlight.gmTurn) : {}),
    updatedAt: now,
  });
  for (const { instance, after } of w.allies.values()) {
    const conditions = [...new Set(after.conditions.filter((c): c is EncounterCondition => ENCOUNTER_SET.has(c)))];
    const tags = [...new Set(after.tags ?? [])].slice(0, 20);
    const effects = settledEffects(instance, w.instanceEffects.get(instance._id), conditions, tags);
    before.push({ ...beforeOf(instance), ...(effects ? { effects: instance.effects ?? [] } : {}) });
    const stats = instanceStatsOf({ stats: instance.stats, effects: effects ?? instance.effects });
    const tokens = w.creatureTokens.get(instance._id);
    const ahp = Math.max(0, Math.min(stats.hpMax, after.hp));
    await ctx.db.patch("encounterAdversaries", instance._id, {
      hp: ahp,
      stress: Math.max(0, Math.min(stats.stressMax, after.stress)),
      defeated: ahp >= stats.hpMax || (instance.defeated && after.defeated),
      conditions,
      tags,
      ...(effects ? { effects } : {}),
      ...(tokens ? { creatureTokens: storedCreatureTokens(tokens) } : {}),
      updatedAt: now,
    });
  }
  // Lane E7, round 2 (dcm-gx3): an ally that only gained a modifier (round 3: or named tokens).
  for (const id of new Set([...w.instanceEffects.keys(), ...w.creatureTokens.keys(), ...w.conditionsAfter.keys()])) {
    if (id === w.instance._id || w.allies.has(id)) continue;
    const instance = w.encounterInstances.find((a) => a._id === id);
    if (!instance) continue;
    const effects = w.instanceEffects.get(id);
    const tokens = w.creatureTokens.get(id);
    // Plan lanes-2 E7.4 (dcm-thwj): a condition an end took off it.
    const held = w.conditionsAfter.get(id);
    const conditions = held ? [...new Set(held.conditions.filter((c): c is EncounterCondition => ENCOUNTER_SET.has(c)))] : undefined;
    before.push({ ...beforeOf(instance), ...(effects ? { effects: instance.effects ?? [] } : {}) });
    await ctx.db.patch("encounterAdversaries", instance._id, {
      ...(effects ? { effects } : {}),
      ...(tokens ? { creatureTokens: storedCreatureTokens(tokens) } : {}),
      ...(held && conditions ? { conditions, tags: [...new Set(held.tags)].slice(0, 20) } : {}),
      updatedAt: now,
    });
  }
  // Group Attack (CB p.201): the other Minions are spotlighted with it.
  if (spotlight) {
    for (const id of w.spotlit) {
      const other = w.encounterInstances.find((a) => a._id === id);
      if (!other || other._id === w.instance._id) continue;
      await ctx.db.patch("encounterAdversaries", other._id, { ...applySpotlight({ spotlights: other.spotlights, spotlightTurn: other.spotlightTurn }, spotlight.gmTurn), updatedAt: now });
    }
  }
  for (const { member, after: written } of w.sheets.values()) {
    // DA10: Unshakable (CB p.59) on the Stress the feature marked without a hit (a hit's Stress rides with it).
    const shaken = unshake(member.sheet, written, Math.max(0, written.stress - member.sheet.stress));
    const after = shaken.sheet;
    await saveSheet(ctx, member.character._id, after);
    await logUnshakable(ctx, { campaignId: log.campaignId, characterId: member.character._id, actorId: log.actorId, name: member.sheet.name, groupId: log.groupId, kind: "adversary" }, shaken.roll);
    await logAction(ctx, {
      campaignId: log.campaignId,
      characterId: member.character._id,
      actorId: log.actorId,
      kind: "adversary",
      visibility: "public",
      summary: `${w.instance.label}'s action changed ${member.sheet.name}'s sheet`,
      groupId: log.groupId,
      before: member.sheet,
      undoable: true,
    });
  }
  return before;
}

/** Fear the work gained or spent, applied to the GM's Fear; returns what actually changed (the row's `fearDelta`). */
async function applyFear(ctx: MutationCtx, campaignId: Id<"campaigns">, delta: number): Promise<number> {
  if (delta < 0) {
    await spendFear(ctx, campaignId, -delta, "feature");
    return delta;
  }
  if (delta > 0) return (await gainFear(ctx, campaignId, delta)).gained;
  return 0;
}

// ---------------------------------------------------------------- the action

export type ActionArgs = {
  instanceId: string;
  /** Unset for the standard attack. */
  feature?: string;
  useId?: string;
  targets: string[];
  picked?: string[];
  allies?: string[];
  followUp?: string[];
  /** Lane E7, round 2 (dcm-e16o, dcm-7az): the creatures of each further link of a repeating follow-up (Rip & Tear). */
  chain?: string[][];
  /** Lane E7, round 2 (dcm-e16o, dcm-q0a): the allies who pay to raise a save's Difficulty (Enchanting Song's other Sirens). */
  raisers?: string[];
  /** For a reaction or automatic use fired by hand: who set it off. */
  trigger?: { sourceId?: string; subjectId?: string; amount?: number };
  options?: { id: string; values: string[] }[];
  optionals?: string[];
  situations?: string[];
  eitherCosts?: number[];
  splits?: { id: string; amount: number }[];
  advantage?: number;
  disadvantage?: number;
  /** An Experience added for a Fear (CB p.160). */
  experience?: string;
  /** Fear the GM agreed to spend (Q19). */
  spendFear?: number;
  /** Lane E7 round 3 (dcm-eut): PC feature ids whose disadvantage buy-off the attacker pays for this attack. */
  buyOffs?: string[];
  /** Reactions the GM opted into for this attack (Heavy Hitter, …), by feature name (Q19: default No). */
  reactions?: string[];
  /** WF, W3 Tier 3 Dark-Hearted: advantage on this roll for 1 Fear (HF p.177). */
  darkHearted?: boolean;
  /** WF: a "path" feature's destination square (the token moves there; the line's creatures are its targets). */
  destination?: { x: number; y: number };
};

export type TargetOutcome = { characterId?: Id<"characters">; instanceId?: Id<"encounterAdversaries">; hit: boolean; requestId?: Id<"combatRequests">; damage?: number; resolved: boolean; deathMove?: boolean };

export type ConfirmFear = { status: "confirmFear"; fear: number; spotlight: number; feature: number; experience: number; darkHearted?: number };
export type ActionResult = {
  status: "resolved";
  groupId: string;
  entryId: Id<"actionLog">;
  roll: StoredRoll | null;
  success: boolean;
  targets: TargetOutcome[];
  fearDelta: number;
  prompts: Prompt[];
  offers: Offer[];
  /** SD4 (Q2): the attack waits, unrolled, for before-roll answers in this `preRoll` request. */
  held?: Id<"combatRequests">;
  /** FH-AP: nothing applied yet; the use waits for the PCs' own picks in this `allyPick` request. */
  picks?: Id<"combatRequests">;
};

/** SD4: the tag Draining Bane leaves on the adversary (HF p.14, "While Drained"). */
export const DRAINED = "Drained";

/** SD4: a held attack's replay (Q2): its action group and what the before-roll answers changed. */
export type Replay = {
  groupId: string;
  /**
   * DA1: disadvantage sources against this attack, by character id (Harrowing Invocation: "give them disadvantage on the
   * roll", HF p.14). They count only against the PCs it protected (user 2026-10-30), not for the whole roll.
   */
  disadvantageAgainst: Record<string, number>;
  /** +Evasion against this attack, by character id (Keen Defenses: "equal to your tier"). */
  evasion: Record<string, number>;
  /** Harrowing Invocation's PCs: if the roll fails against any of them, the attacker marks a Stress (user 2026-10-30). */
  harrowed: { subjects: string[] } | null;
};

type Rng = (sides: number) => number;
type Rolled = { sides: number; value: number };

/**
 * DA1: the server's dice with the attack roll's d20s already rolled: the first d20 calls (the attack roll, CB p.161) take
 * `preset` in order (a Drained attacker's d12s, HF p.14), every later die rolls, and is written to `record` when given.
 * With `replay`, later dice repeat those values while the sides match (a second run shares the first run's damage dice).
 */
function presetDice(preset: readonly number[], record?: Rolled[], replay?: readonly Rolled[]): Rng {
  const queue = [...preset];
  const again = [...(replay ?? [])];
  return (sides: number) => {
    if (sides === 20 && queue.length > 0) return queue.shift()!;
    let value: number;
    if (again.length > 0 && again[0]!.sides === sides) value = again.shift()!.value;
    else {
      again.length = 0;
      value = rollDie(sides);
    }
    record?.push({ sides, value });
    return value;
  };
}

/**
 * The attack roll as the GM row stores it: a Drained attacker's attack dice are d12s (HF p.14, SD4 follow-up: the record
 * said d20); `second`, the die only targets with their own disadvantage read (DA1), is listed after the kept die,
 * dropped and with role "extra" (the roll's own advantage / disadvantage stays as rolled for every other reader).
 */
function attackRecord(record: RollRecord, drained: boolean, second: number | null): RollRecord {
  const attackDie = (d: RollRecord["dice"][number]) => d.sides === 20 && d.role !== "damage";
  let dice = drained ? record.dice.map((d) => (attackDie(d) ? { ...d, sides: 12 } : d)) : record.dice;
  if (second !== null && record.dice.filter(attackDie).length === 1) dice = [dice[0]!, { sides: drained ? 12 : 20, value: second, role: "extra", dropped: true }, ...dice.slice(1)];
  return dice === record.dice ? record : { ...record, dice };
}

/**
 * dcm-f3l7 (user answer 2026-11-02): CB p.103 Hidden, "While Hidden, any rolls against you have disadvantage"; Cloaked
 * (CB p.42) is Hidden with more benefits. One own source per target (DA1/DA17: it counts against that target only and
 * once with Sturdy or Harrowing). The same reading as a PC's attack (`conditionEdge`, convex/lib/combatActions.ts).
 */
function hiddenAgainst(conditions: readonly string[]): number {
  return conditions.includes("hidden") || conditions.includes("cloaked") ? 1 : 0;
}

/**
 * Disadvantage sources a PC target puts on an attack against them, by this attacker: a Hidden (or Cloaked) PC
 * (dcm-f3l7, CB p.103), and a PC's passives (CB p.68 Sturdy, at 1 HP left).
 */
function targetDisadvantage(
  p: Pick,
  instance: Doc<"encounterAdversaries">,
  gated: { selfToken?: Doc<"combatTokens">; paidOff: readonly string[]; offers: BuyOffer[] },
  /** Rule switches RC2, C1 (CB p.102): Manual = Hidden / Cloaked give no disadvantage by themselves (the GM gets a note). */
  conditionDice: ModeOf<"conditionDice"> = "book",
): number {
  if (p.kind !== "pc") return 0;
  const hidden = conditionDice === "manual" ? 0 : hiddenAgainst(p.member.sheet.conditions);
  // Lane E7 round 3 (dcm-eut): the distance for a `from: "melee"` gate (no map: unknown, the gate doesn't count) and the
  // buy-offs the GM paid for this attack (Defensive stance, HF p.12: "unless the attacker marks a Stress").
  const distance = gated.selfToken && p.token ? tokenDistance(gated.selfToken, p.token) : undefined;
  const info = { tags: instance.tags ?? [], ...(distance !== undefined ? { distance } : {}) };
  // Every buy-off on offer (none paid), then the disadvantage left after the paid ones.
  for (const b of pcTarget(p.member.character._id, p.member.sheet, 0, info).buyOff ?? []) {
    gated.offers.push({ characterId: p.member.character._id, featureId: b.featureId, costs: b.costs, paid: gated.paidOff.includes(b.featureId) });
  }
  return hidden + (pcTarget(p.member.character._id, p.member.sheet, 0, { ...info, paidOff: gated.paidOff }).disadvantage ?? 0);
}

/**
 * Plan rule-switches RFA (user 2026-11-06), C1 Book: CB p.102 "While you are Vulnerable, all rolls targeting you have
 * advantage". A Vulnerable PC target gives the attack one advantage against that PC only (per target, like Hidden's
 * disadvantage, `splitTargetEdge`). Manual: none (the GM gets a note, `vulnerableTargetNote`).
 */
function targetAdvantage(p: Pick, conditionDice: ModeOf<"conditionDice"> = "book"): number {
  return p.kind === "pc" && conditionDice !== "manual" && p.member.sheet.conditions.includes("vulnerable") ? 1 : 0;
}

/** Lane E7 round 3 (dcm-eut): a disadvantage on this attack the attacker may buy off (the GM passes `buyOffs` to pay). */
type BuyOffer = { characterId: string; featureId: string; costs: readonly Cost[]; paid: boolean };

/** The Stress a set of buy-off costs asks of the attacker (other resources are the GM's by hand). */
const buyOffStress = (costs: readonly Cost[]) => costs.reduce((n, c) => n + (c.kind === "stress" && c.amount.kind === "fixed" ? c.amount.value : 0), 0);

/**
 * A second run's target-only results joined to the first run (DA1): the hits, damage, marks, conditions and prompts of
 * the targets `ids`; the attacker's own changes, costs and Fear stay the first run's (paid once).
 */
function joinTargets(a: AdversaryPlan, b: AdversaryPlan, ids: ReadonlySet<string>): AdversaryPlan {
  const mine = (s: AdversaryPlanStep) => {
    if ("targetId" in s && typeof s.targetId === "string") return ids.has(s.targetId);
    if ("targetIds" in s && Array.isArray(s.targetIds)) return s.targetIds.length > 0 && s.targetIds.every((id: string) => ids.has(id));
    return false;
  };
  const saves = [...(a.saves ?? []), ...(b.saves ?? []).filter((s) => s.targetIds.every((id) => ids.has(id)))];
  return {
    ...a,
    steps: [...a.steps, ...b.steps.filter(mine)],
    hits: [...a.hits, ...b.hits.filter((h) => ids.has(h.id))],
    success: a.success || b.success,
    creatures: [...a.creatures, ...b.creatures.filter((c) => ids.has(c.id))],
    incoming: [...a.incoming, ...b.incoming.filter((h) => ids.has(h.targetId))],
    deathMoves: [...a.deathMoves, ...b.deathMoves.filter((id) => ids.has(id))],
    ...(saves.length > 0 ? { saves } : {}),
  };
}

/** An attack holds for before-roll answers only with what `heldAttackValidator` keeps (no picks, splits or trigger). */
function holdable(args: ActionArgs): boolean {
  const empty = (list: readonly unknown[] | undefined) => (list?.length ?? 0) === 0;
  return args.trigger === undefined && empty(args.picked) && empty(args.allies) && empty(args.followUp) && empty(args.options) && empty(args.optionals) && empty(args.situations) && empty(args.eitherCosts) && empty(args.splits) && empty(args.chain) && empty(args.raisers);
}

/** One PC's before-roll defences that fit this attack (Q2): ready, affordable, the trigger's subjects within range. */
function preRollDefences(member: PartyMember, picks: readonly PcPick[], scene: ActionScene, self: Combatant, hopeAndFear: boolean): string[] {
  const id = member.character._id;
  const token = scene.map?.scene.tokens.find((t) => t.ref.kind === "pc" && t.ref.characterId === id);
  const toAttacker = scene.map && token ? rangeCheck(token, scene.map.selfToken, "melee").band : undefined;
  const targets = picks.map((p) => ({ id: p.member.character._id, ...(p.member.character._id !== id ? optionalBand(scene.bands(id, p.member.character._id)) : {}) }));
  const actor = featureActor(id, member.sheet);
  const out: string[] = [];
  for (const effect of answeringFeatures(member.sheet, hopeAndFear)) {
    const fits = effect.uses.find((u) => {
      if (u.activation.kind !== "reaction") return false;
      const subjects = preRollFits(u.activation.trigger, id, targets, toAttacker);
      const subject = picks.find((p) => subjects.includes(p.member.character._id));
      return subject !== undefined && featureReady(effect, u, actor, { amount: 0, subject: subject.combatant, source: self });
    });
    if (fits) out.push(effect.featureId);
  }
  return out;
}

const optionalBand = (band: Range | undefined) => (band !== undefined ? { band } : {});

/**
 * SD4 (Q2 a, HF p.14): before the roll, the PCs holding a ready, affordable before-roll defence get "Bandit attacks
 * Mira" with Use / Pass; nothing waits for PCs without one. The attack is stored unrolled in a `preRoll` request (one GM
 * row in the action's group, so undo calls it off) and replays when everyone answered or the GM resolves it. Returns
 * null when nobody holds one (the attack goes ahead at once).
 */
async function holdForPreRoll(
  ctx: MutationCtx,
  h: { campaign: Doc<"campaigns">; user: Doc<"users">; instance: Doc<"encounterAdversaries">; encounter: Doc<"encounters">; block: Block; scene: ActionScene; args: ActionArgs; picks: PcPick[]; groupId: string; label: string; featureName: string },
): Promise<ActionResult | null> {
  if (h.picks.length === 0) return null;
  const hopeAndFear = resolveOptions(h.campaign.frameId, h.campaign.options).hopeAndFear;
  const self = selfCombatant(h.instance, h.block);
  const responders = h.scene.party.flatMap((m) => {
    const featureIds = preRollDefences(m, h.picks, h.scene, self, hopeAndFear);
    return featureIds.length > 0 ? [{ characterId: m.character._id, featureIds: featureIds.slice(0, 10) }] : [];
  });
  if (responders.length === 0) return null;
  const live = await liveCombatMap(ctx, h.campaign._id);
  const targetCharacterIds = h.picks.map((p) => p.member.character._id);
  const requestId = await ctx.db.insert("combatRequests", {
    campaignId: h.campaign._id,
    encounterId: h.encounter._id,
    ...(live ? { mapId: live._id } : {}),
    kind: "preRoll",
    status: "open",
    createdBy: h.user._id,
    createdAt: Date.now(),
    responses: [],
    payload: {
      schemaVersion: 1,
      kind: "preRoll",
      attacker: { instanceId: h.instance._id, label: h.label, ...(h.args.feature !== undefined ? { feature: h.args.feature } : {}) },
      attack: {
        instanceId: h.instance._id,
        ...(h.args.feature !== undefined ? { feature: h.args.feature } : {}),
        ...(h.args.useId !== undefined ? { useId: h.args.useId } : {}),
        targetCharacterIds,
        ...(h.args.advantage !== undefined ? { advantage: h.args.advantage } : {}),
        ...(h.args.disadvantage !== undefined ? { disadvantage: h.args.disadvantage } : {}),
        ...(h.args.experience !== undefined ? { experience: h.args.experience } : {}),
        ...(h.args.spendFear !== undefined ? { spendFear: h.args.spendFear } : {}),
        ...(h.args.reactions !== undefined ? { reactions: h.args.reactions.slice(0, 20) } : {}),
        ...(h.args.darkHearted ? { darkHearted: true } : {}),
        ...(h.args.destination ? { destination: h.args.destination } : {}),
      },
      groupId: h.groupId,
      responders,
    },
  });
  const names = (ids: readonly string[]) => ids.map((id) => h.scene.party.find((m) => m.character._id === id)?.sheet.name ?? "someone").join(", ");
  const text = `${h.label} attacks ${names(targetCharacterIds)} (${h.featureName}): waiting for ${names(responders.map((r) => r.characterId))} before the roll`;
  const entryId = await logAction(ctx, { campaignId: h.campaign._id, actorId: h.user._id, kind: "adversary", visibility: "gm", summary: text, groupId: h.groupId, undoable: true });
  // DA1 (SD4 follow-up): no manual prompt; the tracker's waiting line ("attacks Mira, before the roll") is the held row.
  return { status: "resolved", groupId: h.groupId, entryId, roll: null, success: false, targets: [], fearDelta: 0, prompts: [], offers: [], held: requestId };
}



const words = (roll: RollRecord) => `${roll.total} (${roll.dice.filter((d) => !d.dropped).map((d) => d.value).join(", ")}${roll.modifier ? ` ${roll.modifier >= 0 ? "+" : ""}${roll.modifier}` : ""})`;

/**
 * Runs an adversary's standard attack (`feature` unset) or one use of a feature against PCs. The GM picks the targets:
 * party characters, or PC tokens on the live map when the adversary has a token there (line of sight required, cover
 * gives disadvantage; Q2, Q18). An action needs the spotlight (CB p.194): the instance is spotlighted, the second
 * spotlight of a GM turn costs 1 Fear (CB p.153). Fear costs, an Experience and that spotlight return `confirmFear`
 * until `spendFear` covers them (Q19); NOT_ENOUGH_FEAR past the GM's Fear. Refusals: ADVERSARY_DEFEATED (it can't act,
 * so it is never spotlit; dcm-j5ft), ADVERSARY_FEATURE_UNAVAILABLE, ADVERSARY_NOT_SPOTLIT, COMBAT_TARGET_INVALID, COMBAT_NO_LINE_OF_SIGHT, ENCOUNTER_NOT_RUNNING, INVALID.
 */
export async function adversaryAction(
  ctx: MutationCtx,
  campaign: Doc<"campaigns">,
  user: Doc<"users">,
  args: ActionArgs,
  replay?: Replay,
  /** FH-AP: `picks`, the run of a held use with its PCs' picks, in the held use's group, its first dice replayed. */
  opts?: { forced?: boolean; picks?: { chooserOptions: Record<string, Record<string, string[]>>; dice: readonly number[]; groupId: string } },
): Promise<ActionResult | ConfirmFear> {
  const { instance, encounter, block, others } = await loadActor(ctx, campaign, args.instanceId);
  const self = selfCombatant(instance, block);

  // The use: the standard attack, a feature's effect entry, or (no entry: custom blocks, tables not written yet) manual.
  let effect: AdversaryFeatureEffect | undefined;
  let manualFeature: BlockFeature | undefined;
  if (args.feature === undefined) effect = standardAttackEffect(block.adversaryId, block.attack);
  else {
    effect = block.effects.find((e) => e.feature === args.feature);
    if (!effect) manualFeature = block.features.find((f) => f.name === args.feature);
    if (!effect && (!manualFeature || manualFeature.kind === "passive")) throw appError("ADVERSARY_FEATURE_UNAVAILABLE");
  }
  const use = effect ? pickAdversaryUse(effect, args.feature === undefined ? STANDARD_ATTACK_USE : args.useId) : undefined;
  if (effect && (!use || use.activation.kind === "passive")) throw appError("ADVERSARY_FEATURE_UNAVAILABLE");
  // dcm-y3mf: "all targets in front of the Ogre" (an area the map can't measure) is named by the GM; a roll at nobody is
  // refused before anything is asked or paid (Hail of Boulders rolled at no one and marked its Stress).
  const areaSpec = use?.targets && use.targets.side !== "trigger" ? use.targets : undefined;
  if (areaSpec && namedByGm(areaSpec) && use?.roll !== undefined && args.targets.length === 0) {
    throw appError("COMBAT_TARGET_INVALID", `Pick the targets ${areaWords(areaSpec.area, areaSpec.range, instance.label)}.`);
  }
  // Lane E7 round 3 (dcm-f70y): a forced attack (Words of Discord, Beguiled) is made outside its spotlight.
  const needsSpotlight = opts?.forced ? false : use ? use.needsSpotlight : manualFeature!.kind === "action";

  // Spotlight (CB p.153, p.194): spotlit this GM turn, or spotlight it now (the turn's second spotlight costs a Fear).
  const fearState = await campaignFearState(ctx, campaign._id);
  const fearNow = fearState.fear;
  // AA2b (bead dcm-vv2 3 / 6): passives read the GM's Fear and the situations the GM confirmed.
  const passives = passiveSummary(block.effects, { ...adversaryState(instance), situations: args.situations ?? [] }, block.tier, rollDie, fearNow);
  const { spotlit, fear: spotlightFear } = spotlightFearFor(instance, encounter, others, block, passives, needsSpotlight);

  const experience = args.experience === undefined ? undefined : block.experiences.find((e) => e.name === args.experience);
  if (args.experience !== undefined && !experience) throw appError("INVALID", "The adversary has no such Experience.");
  const bookFeatureFear = use ? upfrontFear(use.costs, { self, tokens: instance.tokens ?? 0, tier: block.tier, gmFear: 0, rng: rollDie, ...(args.eitherCosts ? { eitherCosts: args.eitherCosts } : {}), ...(args.trigger?.amount !== undefined ? { trigger: { amount: args.trigger.amount } } : {}) }) : (manualFeature!.fearCost ?? featureFearCost(manualFeature!.text) ?? 0);
  // Plan rule-switches WF (CB p.154): F5 `fearFeatures` / F4 `adversaryExperienceFear` Manual: no Fear asked, refused or
  // spent for the feature's cost or the Experience; the action's GM note says "Spend N Fear by hand".
  const fearFeaturesManual = ruleMode(campaign, "fearFeatures") === "manual";
  const experienceManual = ruleMode(campaign, "adversaryExperienceFear") === "manual";
  const featureFear = fearFeaturesManual ? 0 : bookFeatureFear;
  const experienceFear = experience && !experienceManual ? 1 : 0;
  const byHand: { ruleId: "fearFeatures" | "adversaryExperienceFear"; summary: string }[] = [];
  if (fearFeaturesManual && bookFeatureFear > 0) byHand.push({ ruleId: "fearFeatures", summary: `${instance.label} used ${args.feature ?? block.attack.name}: ${fearByHandText(bookFeatureFear)}` });
  if (experience && experienceManual) byHand.push({ ruleId: "adversaryExperienceFear", summary: `${instance.label} used ${experience.name} (+${experience.value}): ${fearByHandText(1)}` });
  // WF, W3 Tier 3 Dark-Hearted (HF p.177): advantage on this roll for 1 Fear, once the Doom Track's Tier 3 rule is active.
  if (args.darkHearted && !(await darkHeartedActive(ctx, campaign))) throw appError("INVALID", "Dark-Hearted needs the Doom Track's Tier 3 rule (5 boxes marked in Tier 3).");
  const darkFear = args.darkHearted ? 1 : 0;
  const asked = spotlightFear + featureFear + experienceFear + darkFear;
  if (asked > 0 && (args.spendFear ?? 0) < asked) return { status: "confirmFear", fear: asked, spotlight: spotlightFear, feature: featureFear, experience: experienceFear, ...(darkFear > 0 ? { darkHearted: darkFear } : {}) };
  if (asked > fearNow) throw appError("NOT_ENOUGH_FEAR", undefined, { resource: "fear", need: asked, have: fearNow });

  const scene = await actionScene(ctx, campaign, instance);
  const base = { encounter, self: instance, block, scene };
  const groupId = replay?.groupId ?? opts?.picks?.groupId ?? newGroupId();
  const w = new Work(instance, block, scene.party, others, encounter, fearState.sessionStartedAt);
  const label = instance.label;
  const featureName = args.feature ?? block.attack.name;

  if (!effect || !use) {
    // A feature without an effect entry: the GM resolves its text; Fear and the spotlight are paid here.
    const targets = (await resolveCreatures(ctx, base, args.targets, false)).picks;
    w.prompts.push({ kind: "manual", text: `${manualFeature!.name}: ${manualFeature!.text}` });
    w.fearDelta -= featureFear;
    for (const n of byHand) await postRuleNote(ctx, campaign, { ...n, groupId, actorId: user._id });
    return finish(ctx, { campaign, user, encounter, w, groupId, spotlight: needsSpotlight && !spotlit, needsSpotlight, spotlightFear, roll: null, success: true, outcomes: targets.map((t) => outcomeOf(t, true)), offers: [], publicText: `${label} used ${manualFeature!.name}`, gmText: [`${label} used ${manualFeature!.name} (no automation: the GM applies it)`], attackerFeature: manualFeature!.name });
  }

  const attack = isAttackUse(use);
  // Plan rule-switches WF, C4 `unconscious` Book (Q8 a; CB p.106 "they can't be targeted by an attack"): an unconscious
  // PC is left out of an auto-filled list, and naming one as a target of an attack or of a feature aimed at PCs is
  // COMBAT_TARGET_INVALID before anything is rolled or paid. Manual lets it through (the GM decides).
  const unconsciousMode = ruleMode(campaign, "unconscious");
  const untargetable = new Set<string>(scene.party.filter((m) => isUntargetableUnconscious(m.sheet, unconsciousMode)).map((m) => m.character._id as string));
  // dcm-y3mf: "all targets within Close range" with none named: every creature in range the adversary sees on the live
  // map (as a card's, cardRunner R9). Rule switches ODR2: with Defined Ranges off nobody is counted; the GM is asked.
  let named = args.targets;
  if (areaSpec && named.length === 0 && fillsFromMap(areaSpec) && scene.map) {
    if (ruleMode(campaign, "definedRanges")) named = inRangeOnMap(scene.map, areaSpec, others, instance._id, untargetable);
    else if (areaSpec.range !== "unlimited" && areaSpec.range !== "weapon" && !replay) await postRuleNote(ctx, campaign, { ruleId: "definedRanges", summary: rangeAsk(`${featureName} (${label})`, areaSpec.range), groupId, actorId: user._id });
  }
  // Plan rule-switches WF (user 2026-11-10): a "path" feature's destination (Rampaging Fury, Trample): within the move's
  // range of its token; with no targets named, everyone the straight line crosses (the GM's picker pre-picks the same).
  const pathRange = pathMoveRange(use);
  let moveTo: { x: number; y: number; face: number } | null = null;
  if (args.destination !== undefined) {
    if (pathRange === null) throw appError("INVALID", `${featureName} has no move to pick a destination for.`);
    const map = scene.map;
    if (map === null) throw appError("COMBAT_TARGET_INVALID", "The destination needs the adversary's token on the live map.");
    const { x, y } = args.destination;
    const self = map.selfToken;
    const board = map.scene.map;
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x + self.size > board.w || y + self.size > board.h) throw appError("COMBAT_TARGET_INVALID", "That square is off the map.");
    if (!rangeCheck(self, { x, y, size: self.size }, pathRange, ruleMode(campaign, "definedRanges")).inRange) throw appError("COMBAT_TARGET_INVALID", `Pick a square within ${pathRange === "veryClose" ? "Very Close" : pathRange === "veryFar" ? "Very Far" : pathRange[0]!.toUpperCase() + pathRange.slice(1)} range.`);
    moveTo = moveToken(self, x, y, board);
    if (named.length === 0) {
      const standing = new Set(others.filter((o) => o._id !== instance._id && !o.defeated).map((o) => o._id as string));
      const footprints = map.scene.tokens.flatMap((t) => {
        if (t.ref.kind === "pc") return [{ id: t.ref.characterId as string, x: t.x, y: t.y, size: t.size }];
        if (t.ref.kind === "adversary" && areaSpec?.side === "any" && standing.has(t.ref.adversaryId)) return [{ id: t.ref.adversaryId as string, x: t.x, y: t.y, size: t.size }];
        return [];
      });
      named = crossedBy(self, args.destination, footprints).filter((id) => !untargetable.has(id)).slice(0, MAX_ACTION_TARGETS);
    }
  }
  if (areaSpec && named.length === 0 && namedByGm(areaSpec)) {
    w.prompts.push({ kind: "manual", text: `${featureName}: nobody was named ${areaWords(areaSpec.area, areaSpec.range, label)}. If someone was, apply it to them by hand.` });
  }
  const targets = await resolveCreatures(ctx, base, named, attack);
  if (attack || areaSpec?.side === "enemy") {
    const down = targets.picks.flatMap((p) => (p.kind === "pc" && untargetable.has(p.member.character._id) ? [p.member.sheet.name] : []));
    if (down.length > 0) throw appError("COMBAT_TARGET_INVALID", unconsciousTargetText(down));
  }
  // SD4 (Q2): PCs holding a ready before-roll defence (Harrowing Invocation, Draining Bane, Keen Defenses) answer first;
  // the attack waits, unrolled, in a `preRoll` request and replays when they answered or the GM resolves it.
  if (attack && !replay && holdable(args) && targets.picks.every((p) => p.kind === "pc")) {
    const held = await holdForPreRoll(ctx, { campaign, user, instance, encounter, block, scene, args, picks: targets.picks as PcPick[], groupId, label: instance.label, featureName: args.feature ?? block.attack.name });
    if (held) return held;
  }
  // SD4: a held attack replays with its before-roll answers: +Evasion against it for the PC who answered (Keen Defenses).
  if (replay) {
    for (const p of targets.picks) {
      const bonus = p.kind === "pc" ? (replay.evasion[p.member.character._id] ?? 0) : 0;
      if (bonus > 0) p.combatant = { ...p.combatant, evasion: (p.combatant.evasion ?? 0) + bonus };
    }
  }
  // SD4: Drained (Draining Bane, HF p.14): "uses a d12 instead of a d20 for attack rolls (including for advantage or
  // disadvantage) until they fail a roll".
  const drained = attack && (instance.tags ?? []).includes(DRAINED);
  const ownAdvantage = (args.advantage ?? 0) + darkFear + (attack && (passives.advantage ?? []).some((on) => on === "attack" || on === "any") ? 1 : 0);
  // DA1 (user 2026-10-30): one roll for every target (CB p.161), but a target's own disadvantage (CB p.68 Sturdy; HF p.14
  // Harrowing Invocation for the PCs it protected) counts only against that target. What every target carries counts for
  // the whole roll; the rest (`residual`) is read from the same pair of dice per target. DA17 (user 2026-10-30): several
  // of a target's own sources (Sturdy and Harrowing) count once; one advantage source cancels them.
  const buyOffers: BuyOffer[] = [];
  const gated = { ...(scene.map ? { selfToken: scene.map.selfToken } : {}), paidOff: args.buyOffs ?? [], offers: buyOffers };
  const conditionDice = ruleMode(campaign, "conditionDice");
  // RFA (C1 Book, CB p.102): a Vulnerable PC target gives advantage against that target; a signed residual per target.
  const own = attack
    ? targets.picks.map((p) => ({ id: p.combatant.id, disadvantage: targetDisadvantage(p, instance, gated, conditionDice) + (p.kind === "pc" ? (replay?.disadvantageAgainst[p.member.character._id] ?? 0) : 0), advantage: targetAdvantage(p, conditionDice) }))
    : [];
  const { advantage: commonAdvantage, disadvantage: common, residual } = splitTargetEdge(own);
  const advantage = ownAdvantage + commonAdvantage;
  // Plan rule-switches OE, Underwater (optional rule, CB p.168: "Attack rolls underwater have disadvantage unless it makes
  // sense for a character to easily fight underwater, like a Siren or Shark"): the adversary's token on the live map
  // marked Underwater, unless the GM marked the token "fights underwater".
  const underwater = attack ? underwaterAttackDisadvantage(campaign, scene) : 0;
  if (underwater > 0) w.gm.push(`${label} attacks underwater: disadvantage`);
  const disadvantage = (args.disadvantage ?? 0) + (attack && targets.cover ? 1 : 0) + common + underwater;
  // The whole roll's net advantage as rollD20 counts it (the use's own flags; Goad Them On adds a disadvantage).
  const net = advantage + (use.roll?.advantage ? 1 : 0) - disadvantage - (instanceModifiers(instance).disadvantage ? 1 : 0) - (use.roll?.disadvantage ? 1 : 0);
  // The attack roll's dice, rolled here (a Drained attacker's are d12s, HF p.14); a second die when any reader needs it.
  const attackDie = () => rollDie(drained ? 12 : 20);
  const first = attack ? attackDie() : 0;
  const second = attack && (net !== 0 || residual.size > 0) ? attackDie() : null;
  const keptBy = (id: string) => keptDie(first, second, net - (residual.get(id) ?? 0));
  const natural = keptDie(first, second, net);
  const picked = (await resolveCreatures(ctx, base, args.picked ?? [], false)).picks;
  const allies = (await resolveCreatures(ctx, base, args.allies ?? [], false)).picks;
  const followUp = (await resolveCreatures(ctx, base, args.followUp ?? [], false)).picks;
  const byId = async (id: string | undefined) => (id === undefined ? undefined : (await resolveCreatures(ctx, base, [id], false)).picks[0]?.combatant);
  const source = await byId(args.trigger?.sourceId);
  const subject = await byId(args.trigger?.subjectId);
  const group = use.groupAttack ? await groupOf(ctx, instance, others, self) : [];
  // Lane E7, round 2 (dcm-e16o): the per-creature facts the card runner reads.
  const raisers = (await resolveCreatures(ctx, base, args.raisers ?? [], false)).picks.filter((p) => p.kind === "adversary");
  const chain: Combatant[][] = [];
  for (const link of (args.chain ?? []).slice(0, MAX_CHAIN)) chain.push((await resolveCreatures(ctx, base, link, false)).picks.map((p) => p.combatant));
  const firstPcTarget = targets.picks.find((p): p is PcPick => p.kind === "pc");
  const creatures = mapCreatures(
    instance._id,
    [instance, ...others.filter((a) => a._id !== instance._id)],
    scene.party,
    scene.map ? { tokens: scene.map.scene.tokens, self: scene.map.selfToken, ...(firstPcTarget?.token ? { target: firstPcTarget.token } : {}) } : null,
  );
  // dcm-xyw / dcm-yd5h: riders on attacks against what each PC target carries (Mark Target, Chokehold's Vulnerable).
  const attackedRiders: Record<string, ReturnType<typeof attackedRidersOn>> = {};
  for (const p of targets.picks) {
    if (p.kind !== "pc") continue;
    const riders = attackedRidersOn(p.member.sheet, block.adversaryId);
    if (riders.length > 0) attackedRiders[p.member.character._id] = riders;
  }

  const context: AdversaryRunContext = {
    adversaryId: block.adversaryId,
    self,
    attack: block.attack,
    tier: block.tier,
    tokens: instance.tokens ?? 0,
    featureUses: w.baseUses,
    gmFear: fearNow - spotlightFear,
    spotlit: true,
    fearConfirmed: true,
    useId: use.id,
    targets: targets.picks.map((p) => p.combatant),
    ...(picked.length ? { picked: picked.map((p) => p.combatant) } : {}),
    ...(allies.length ? { allies: allies.map((p) => p.combatant) } : {}),
    ...(followUp.length ? { followUp: followUp.map((p) => p.combatant) } : {}),
    ...(args.trigger ? { trigger: { ...(args.trigger.amount !== undefined ? { amount: args.trigger.amount } : {}), ...(source ? { source } : {}), ...(subject ? { subject } : {}) } } : {}),
    ...(args.options ? { options: Object.fromEntries(args.options.map((o) => [o.id, o.values])) } : {}),
    ...(args.optionals ? { optionals: args.optionals } : {}),
    ...(args.eitherCosts ? { eitherCosts: args.eitherCosts } : {}),
    ...(args.splits ? { splits: Object.fromEntries(args.splits.map((s) => [s.id, s.amount])) } : {}),
    situations: args.situations ?? [],
    advantage,
    disadvantage,
    ...(experience ? { experience } : {}),
    ...(group.length ? { group } : {}),
    hordeX: block.hordeX,
    attackDiceOnAttacks: true,
    passives,
    instance: instanceModifiers(instance),
    hopeOf: Object.fromEntries(scene.party.map((m) => [m.character._id, m.sheet.hope])),
    creatures,
    ...(raisers.length ? { saveRaisers: raisers.map((p) => p.combatant) } : {}),
    ...(chain.length ? { chain } : {}),
    ...(Object.keys(attackedRiders).length > 0 ? { attackedRiders } : {}),
    // Lane E7 round 3 (dcm-n3mp, dcm-0n1u): named tokens on the encounter's instances, and each PC's gold in handfuls (a bag is 10, dcm-sgn7).
    // Plan lanes-2 E7.4 (dcm-wiwi): and on each PC sheet (`creatureTokens`).
    creatureTokens: { ...creatureTokensOf([instance, ...others]), ...sheetCreatureTokensOf(scene.party) },
    goldOf: partyGoldOf(scene.party),
    // dcm-qw4f: the options its features lost for good (Seven-Headed).
    removedOptions: (instance.effects ?? []).flatMap((e) => e.optionsRemoved ?? []),
    // FH-AP: each PC's own pick, once they all answered (convex/lib/allyPicks.ts).
    ...(opts?.picks ? { chooserOptions: opts.picks.chooserOptions } : {}),
    // ODR3: Defined Ranges off, nothing the use picks or counts by range applies on its own (ODR2's runner flag).
    ...rangesFlag(campaign),
    rng: rollDie,
  };
  // FH-AP: a use that is not an attack records its dice, so the run with the PCs' picks replays them.
  const pickRolls = pickDice(opts?.picks?.dice);
  if (args.options) w.options = context.options;
  // DA1: the runner reads the whole roll's die; a target that keeps a lower one meets its Evasion raised by the difference,
  // which is the same hit or miss as its own total against its own Evasion.
  const shifted = (p: Pick, from: number): Combatant =>
    residual.has(p.combatant.id) && p.combatant.evasion !== undefined ? { ...p.combatant, evasion: p.combatant.evasion + from - keptBy(p.combatant.id) } : p.combatant;
  // A natural 20 hits and is critical only for the targets that keep it (CB p.148): the others run again on their own
  // die (same damage dice); the first run alone pays the costs and changes the attacker. RFA: a target with its own
  // advantage (Vulnerable) may keep a 20 the whole roll doesn't; it runs again the same way, critical.
  // Lane E7 round 3 (dcm-mhn): a widened critical range (Eye of the Sage, HF p.70: "critically succeeds on a roll of 19-20").
  const critAt = Math.min(20, use.roll?.critRange ?? 20);
  const lower = attack ? targets.picks.filter((p) => keptBy(p.combatant.id) >= critAt !== natural >= critAt) : [];
  const lowerIds = new Set(lower.map((p) => p.combatant.id));
  const later: Rolled[] = [];
  let plan = attack
    ? runOrThrow(effect, { ...context, targets: targets.picks.filter((p) => !lowerIds.has(p.combatant.id)).map((p) => shifted(p, natural)), rng: presetDice(net !== 0 && second !== null ? [first, second] : [first], later) })
    : runOrThrow(effect, { ...context, rng: pickRolls.rng });
  // FH-AP (user 2026-11-05): PCs who each pick their own option (Locust Swarm, Awesome Size, the Fire head) answer on their
  // own screens first; the whole use waits (nothing paid or applied) and runs again with their picks and these dice.
  if (!attack && !replay && opts?.picks === undefined) {
    const held = await holdForAllyPicks(ctx, { campaign, user, instance, encounter, party: scene.party, args, plan, dice: pickRolls.values, groupId, featureName });
    if (held) return held;
  }
  if (lower.length > 0) {
    const top = Math.max(...lower.map((p) => keptBy(p.combatant.id)));
    // One die, no advantage or disadvantage left over: the runner keeps `top`.
    const even = { advantage: (instanceModifiers(instance).disadvantage ? 1 : 0) + (use.roll?.disadvantage ? 1 : 0), disadvantage: use.roll?.advantage ? 1 : 0 };
    const rest = runOrThrow(effect, { ...context, ...even, targets: lower.map((p) => shifted(p, top)), rng: presetDice([top], undefined, later) });
    plan = joinTargets(plan, rest, lowerIds);
  }
  // The stored roll (SD4 follow-up): a Drained attacker's dice are d12s; a second die only some targets read is listed.
  const roll = plan.roll && attack ? attackRecord(plan.roll.record, drained, residual.size > 0 ? second : null) : (plan.roll?.record ?? null);
  w.absorb(plan, featureName);
  // Lane E7, round 2 (dcm-mm0f, adversary bearer; dcm-f0m, dcm-bxp.99.19.3): riders on what it carries fire when it acts
  // (On Fire, Poisoned: "each time they act") or attacks; the GM applies their steps.
  const firing = instanceBearerRiders(instance, [...(needsSpotlight ? (["acts"] as const) : []), ...(attack ? (["attack"] as const) : [])]);
  for (const r of firing) {
    // Plan lanes-2 E7.4 (dcm-mm0f, dcm-0wj1, dcm-f0m, dcm-bxp.99.19.3): steps on itself with fixed numbers run here (On
    // Fire's 2d6 magic "if they are still On Fire at the end of their action", Poisoned's 1d10 direct physical); the rest
    // stays a prompt.
    const auto = selfRiderSteps(r.rider);
    const held = [...w.selfAfter.conditions, ...(w.selfAfter.tags ?? [])].some((c) => c.toLowerCase() === r.label.toLowerCase());
    if (auto === null || (r.rider.timing === "after" && !held)) {
      if (auto === null) w.prompts.push({ kind: "manual", text: `${r.label} (${r.source}): ${label} ${r.rider.on === "acts" ? "acts" : "attacks"}: ${riderStepsText(r.rider.steps)}` });
      continue;
    }
    const parts: string[] = [];
    for (const d of auto.damage) {
      const rolled = Array.from({ length: d.count }, () => rollDie(d.sides)).reduce((a, b) => a + b, 0) + d.plus;
      const res = applyDamageTo(w.selfAfter, rolled, d.type);
      w.selfAfter = res.after;
      parts.push(`${rolled} ${d.direct ? "direct " : ""}${d.type} damage (${res.hpMarked} HP)`);
    }
    if (auto.stress > 0) {
      w.selfAfter = applyStressTo(w.selfAfter, auto.stress).after;
      parts.push(`${auto.stress} Stress`);
    }
    if (auto.hp > 0) {
      w.selfAfter = applyHpTo(w.selfAfter, auto.hp).after;
      parts.push(`${auto.hp} HP`);
    }
    w.gm.push(`${r.label} (${r.source}): ${label} ${r.rider.on === "acts" ? "acts" : "attacks"} and takes ${parts.join(", ")}`);
  }
  // DA1: each hit carries its target's own attack total (the window compares Evasion answers with it).
  if (plan.roll && residual.size > 0) {
    const modifier = plan.roll.record.total - natural;
    for (const h of w.hits) if (residual.has(h.targetId)) h.hit.attackTotal = keptBy(h.targetId) + modifier;
  }
  const attackKind = args.feature === undefined ? ("standard" as const) : ("feature" as const);

  // Reactions the GM opted into before the damage (Heavy Hitter, Overload; Q19 default No): their damage folds join the hits.
  const offers: Offer[] = [];
  // ODR3: Defined Ranges off, range-gated triggers are the GM's call (`rangeGatedUses`); the questions go in the group.
  const definedRanges = ruleMode(campaign, "definedRanges");
  const rangeAsks: string[] = [];
  const gatedUses = (uses: readonly TriggeredUse[]) => {
    const gated = rangeGatedUses(uses, definedRanges, label);
    rangeAsks.push(...gated.asks);
    return gated.uses;
  };
  if (w.hits.length > 0) {
    for (const t of gatedUses(triggered(w.block, w.instance, [{ kind: "onAttack", stage: "beforeDamage", attack: attackKind }]))) {
      if (t.mode === "reaction" && !(args.reactions ?? []).includes(t.effect.feature)) {
        offers.push({ feature: t.effect.feature, useId: t.use.id, trigger: "beforeDamage" });
        continue;
      }
      const r = runOrThrow(t.effect, { ...context, self: w.selfAfter, useId: t.use.id, gmFear: Math.max(0, fearNow - spotlightFear + w.fearDelta), optionals: optionalIds(t.use), trigger: { source: self, ...(targets.picks[0] ? { subject: targets.picks[0].combatant } : {}) } });
      w.absorb(r, t.effect.feature);
      for (const s of r.steps) {
        if (s.kind !== "fold" || s.step.kind !== "modifyDamage") continue;
        const change = s.step.change;
        for (const h of w.hits) {
          if (s.targetIds.length > 0 && !s.targetIds.includes(h.targetId)) continue;
          if (change.kind === "add") {
            h.hit.amount += typeof s.amount === "number" ? s.amount : 0;
            // Plan lanes-2 E7.4 (dcm-i55; CB p.99): added damage of the other type makes the hit physical and magic.
            if (change.type !== undefined && change.type !== h.hit.type && h.hit.type !== "both") h.hit.type = "both";
          }
          else if (change.kind === "multiply") h.hit.amount *= change.factor;
          else if (change.kind === "halve") h.hit.amount = Math.floor(h.hit.amount / 2);
        }
      }
      w.gm.push(`${t.effect.feature} (reaction) applied`);
    }
  }

  // Triggers of the attack itself (AR8): Momentum's Fear runs at once; reactions are offered to the GM.
  const hitIds = new Set(plan.hits.filter((h) => h.hit).map((h) => h.id));
  const events: AdversaryEvent[] = [];
  for (const p of targets.picks) {
    if (p.kind === "pc" && hitIds.has(p.member.character._id)) events.push({ kind: "onHit", attack: attackKind, ...(p.band ? { band: p.band } : {}), target: { conditions: p.combatant.conditions, tags: p.combatant.tags ?? [] } });
  }
  if (plan.roll && hitIds.size === 0) events.push({ kind: "onMiss", attack: attackKind });
  for (const t of gatedUses(triggered(w.block, w.instance, events))) {
    if (t.mode === "reaction") {
      offers.push({ feature: t.effect.feature, useId: t.use.id, trigger: events[0]!.kind });
      continue;
    }
    const firstHit = targets.picks.find((p) => hitIds.has(p.kind === "pc" ? p.member.character._id : p.instance._id));
    const { experience: _experience, ...plain } = context;
    void _experience;
    const r = runOrThrow(t.effect, { ...plain, self: w.selfAfter, useId: t.use.id, gmFear: Math.max(0, fearNow - spotlightFear + w.fearDelta), trigger: { source: self, ...(firstHit ? { subject: firstHit.combatant } : {}) } });
    w.absorb(r, t.effect.feature);
    w.gm.push(`${t.effect.feature} (automatic)`);
  }

  // SD4: the before-roll answers' after-effects. Harrowing Invocation (HF p.14): "If the adversary fails the roll, they
  // must also mark a Stress": the roll failed against any PC it protected (user 2026-10-30; SD4 had "every"). Drained
  // ends when the attack roll fails (misses every target; HF p.14 "until they fail a roll", user: attack rolls only).
  if (replay?.harrowed && plan.roll && replay.harrowed.subjects.some((id) => !hitIds.has(id))) {
    w.selfAfter = applyStressTo(w.selfAfter, 1).after;
    w.gm.push(`Harrowing Invocation: ${label} failed the roll and marks a Stress`);
  }
  // Lane E7 round 3 (dcm-eut): the attacker pays the buy-offs the GM chose; the others are offered for the next attack.
  for (const b of buyOffers) {
    const stress = buyOffStress(b.costs);
    if (b.paid) {
      if (stress > 0) w.selfAfter = applyStressTo(w.selfAfter, stress).after;
      w.gm.push(`${label} pays off ${w.nameOf(b.characterId)}'s disadvantage (${b.featureId})${stress > 0 ? `: marks ${stress} Stress` : ""}`);
    } else w.gm.push(`${label} could pay ${stress > 0 ? `${stress} Stress` : "the cost"} to negate ${w.nameOf(b.characterId)}'s disadvantage (${b.featureId}; buyOffs)`);
  }
  if (drained) w.gm.push(`Drained: rolled a d12 instead of a d20`);
  if (drained && plan.roll && hitIds.size === 0) {
    w.selfAfter = { ...w.selfAfter, tags: (w.selfAfter.tags ?? []).filter((t) => t !== DRAINED) };
    w.gm.push(`${label} failed a roll: no longer Drained`);
  }

  const outcomes: TargetOutcome[] = targets.picks.map((p) => outcomeOf(p, plan.roll ? hitIds.has(p.combatant.id) : true));
  const hitNames = outcomes.filter((o) => o.hit).map((o) => w.nameOf(o.characterId ?? o.instanceId ?? ""));
  const missNames = outcomes.filter((o) => !o.hit).map((o) => w.nameOf(o.characterId ?? o.instanceId ?? ""));
  const what = args.feature === undefined ? "" : ` used ${args.feature}`;
  const publicText = plan.roll
    ? `${label}${what ? `${what}:` : ""} ${[hitNames.length ? `hit ${hitNames.join(", ")}` : "", missNames.length ? `missed ${missNames.join(", ")}` : ""].filter(Boolean).join("; ")}`
    : `${label}${what || ` used ${featureName}`}${outcomes.length ? ` on ${outcomes.map((o) => w.nameOf(o.characterId ?? o.instanceId ?? "")).join(", ")}` : ""}`;
  const gmText: string[] = [];
  if (plan.roll && roll) {
    const modifier = plan.roll.record.total - natural;
    // DA1: a target with its own disadvantage shows the die it kept and its own total.
    const ownRoll = (id: string) => (residual.has(id) ? ` (${residual.get(id)! > 0 ? "disadvantage" : "advantage"} against them: ${keptBy(id)}, total ${keptBy(id) + modifier}${keptBy(id) >= critAt ? " critical" : ""})` : "");
    const vs = targets.picks.map((p) => `${w.nameOf(p.combatant.id)} ${p.combatant.evasion ?? p.combatant.difficulty ?? "?"}${ownRoll(p.combatant.id)}: ${hitIds.has(p.combatant.id) ? "hit" : "miss"}`);
    gmText.push(`${label} ${featureName}: ${words(roll)}${plan.roll.critical ? " critical" : ""} vs ${vs.join(", ")}`);
  } else gmText.push(`${label} used ${featureName}`);
  if (spotlightFear > 0) gmText.push("1 Fear for the spotlight");
  if (darkFear > 0) gmText.push("Dark-Hearted: advantage (1 Fear)");
  if (experience) gmText.push(`Experience ${experience.name} +${experience.value} (${experienceManual ? "spend 1 Fear by hand" : "1 Fear"})`);
  for (const n of byHand) await postRuleNote(ctx, campaign, { ...n, groupId, actorId: user._id });
  // WF, D7 Manual: the standard attack was rolled with its printed damage.
  if (args.feature === undefined && ruleMode(campaign, "hordes") === "manual") {
    const note = hordeNote(label, block.hordeX ?? passives.horde ?? null, self);
    if (note !== null) await postRuleNote(ctx, campaign, { ruleId: "hordes", summary: note, groupId, actorId: user._id });
  }
  for (const h of w.hits) gmText.push(`${w.nameOf(h.targetId)}: ${h.hit.amount} ${h.hit.type}${h.hit.direct ? " direct" : ""}${h.hit.forcedArmor ? `, ${h.hit.forcedArmor} forced Armor Slot` : ""}${h.riders.length ? `, ${h.riders.length} rider${h.riders.length === 1 ? "" : "s"} with the hit` : ""} (waiting for armor)`);
  w.fearDelta -= spotlightFear + darkFear;
  // Lane E7 round 3 (dcm-f70y): a forced attack by a PC is the player's roll. Plan lanes-2 E7.4 (dcm-uxsd): the player
  // gets a `forcedAttack` request (opened after the commit, in this group); the GM row names it.
  const forcedPcs: { characterIds: Id<"characters">[]; againstIds: string[] }[] = [];
  for (const f of w.forcedAttacks) {
    const pcs = scene.party.filter((m) => f.attackerIds.includes(m.character._id)).map((m) => m.character._id);
    if (pcs.length === 0) continue;
    forcedPcs.push({ characterIds: pcs, againstIds: f.againstIds });
    const against = f.againstIds.length > 0 ? f.againstIds.map((id) => w.nameOf(id)).join(", ") : "a target the GM picks";
    w.gm.push(`${pcs.map((id) => w.nameOf(id)).join(", ")} must make an attack against ${against} (roll request sent)`);
  }
  // Plan lanes-2 E7.4 (dcm-thwj): stored condition ends on its roll and on the HP the plans marked on instances.
  w.settleEnds(plan.roll ? adversaryEndRoll({ attack, success: attack ? hitIds.size > 0 : plan.success }) : null);
  // Rule switches RC2 / RFA, C1 Manual (CB p.102): the attack on a Hidden / Cloaked PC was rolled without its
  // disadvantage, on a Vulnerable PC without its advantage; one note per target and condition.
  if (attack && conditionDice === "manual") {
    for (const p of targets.picks) {
      if (p.kind !== "pc") continue;
      const condition = hiddenCondition(p.member.sheet.conditions);
      if (condition !== null) await postRuleNote(ctx, campaign, { ruleId: "conditionDice", summary: hiddenTargetNote(label, p.member.sheet.name, condition), characterId: p.member.character._id, groupId, actorId: user._id });
      if (p.member.sheet.conditions.includes("vulnerable")) await postRuleNote(ctx, campaign, { ruleId: "conditionDice", summary: vulnerableTargetNote(label, p.member.sheet.name), characterId: p.member.character._id, groupId, actorId: user._id });
    }
  }
  for (const summary of new Set(rangeAsks)) await postRuleNote(ctx, campaign, { ruleId: "definedRanges", summary, groupId, actorId: user._id });
  // Plan rule-switches WR (R10 Manual): the critical's maximum the damage left out.
  if ((plan.criticalDamageWithheld ?? 0) > 0) await postRuleNote(ctx, campaign, { ruleId: "criticalDamage", summary: criticalDamageNote(label, plan.criticalDamageWithheld!), groupId, actorId: user._id });
  // WF: the "path" feature's move, as the GM's drag would place it (the token faces the way it went).
  if (moveTo !== null && scene.map) {
    await ctx.db.patch("combatTokens", scene.map.selfToken._id, moveTo);
    gmText.push(`${label} moved to (${moveTo.x}, ${moveTo.y})`);
  }
  const result = await finish(ctx, { campaign, user, encounter, w, groupId, spotlight: needsSpotlight && !spotlit, needsSpotlight, spotlightFear: 0, roll, success: plan.success, outcomes, offers, publicText, gmText, ...(args.feature !== undefined ? { attackerFeature: args.feature } : {}) });
  if (forcedPcs.length > 0) {
    const live = await liveCombatMap(ctx, campaign._id);
    const tokens = live ? await tokensOnMap(ctx, live._id) : [];
    for (const f of forcedPcs) {
      await openForcedAttacks(ctx, {
        campaignId: campaign._id,
        encounterId: encounter._id,
        ...(live ? { mapId: live._id } : {}),
        createdBy: user._id,
        groupId,
        instance,
        feature: featureName,
        characterIds: f.characterIds,
        againstIds: f.againstIds,
        tokens,
      });
    }
  }
  // An adversary attacker makes its standard attack now (its own log group), unless this already is a forced attack.
  if (!opts?.forced) {
    for (const f of w.forcedAttacks) {
      for (const attackerId of f.attackerIds) {
        if (!others.some((a) => a._id === attackerId && !a.defeated)) continue;
        const targetIds = f.againstIds.filter((id) => id !== attackerId);
        if (targetIds.length === 0) {
          result.prompts.push({ kind: "manual", text: `${w.nameOf(attackerId)} must make its standard attack against a target the GM picks` });
          continue;
        }
        await forcedStandardAttack(ctx, campaign, user, { instanceId: attackerId, targets: targetIds });
      }
    }
  }
  return result;
}

/**
 * Lane E7 round 3 (dcm-f70y; Words of Discord, CB p.335: "make an attack against another adversary instead of against you
 * or your allies"; Beguiled, HF p.75): the instance makes its standard attack against `targets` (PCs or other instances of
 * its encounter) outside its spotlight: no spotlight is spent and no Fear is asked. The card runner's `forcedAttack` hand-off
 * (E4) and the GM's button call it. Refusals as `adversaryAction`.
 */
export async function forcedStandardAttack(ctx: MutationCtx, campaign: Doc<"campaigns">, user: Doc<"users">, args: { instanceId: string; targets: string[] }): Promise<ActionResult> {
  const result = await adversaryAction(ctx, campaign, user, { instanceId: args.instanceId, targets: args.targets }, undefined, { forced: true });
  if (result.status !== "resolved") throw appError("INVALID", "A forced attack asks for no Fear.");
  return result;
}

function outcomeOf(p: Pick, hit: boolean): TargetOutcome {
  return p.kind === "pc" ? { characterId: p.member.character._id, hit, resolved: true } : { instanceId: p.instance._id, hit, resolved: true };
}

type FinishInput = {
  campaign: Doc<"campaigns">;
  user: Doc<"users">;
  encounter: Doc<"encounters">;
  w: Work;
  groupId: string;
  spotlight: boolean;
  /** The action needs the spotlight (CB p.194): the spotlight goes to the GM on this adversary (S1, bead dcm-bxp.99.32.4). */
  needsSpotlight: boolean;
  /** Fear for the spotlight not yet in `w.fearDelta` (the manual path). */
  spotlightFear: number;
  roll: RollRecord | null;
  success: boolean;
  outcomes: TargetOutcome[];
  offers: Offer[];
  publicText: string;
  gmText: string[];
  /** The feature's printed name on the hit rows; unset for the standard attack. */
  attackerFeature?: string;
};

/**
 * S1, the adversary side (bead dcm-bxp.99.32.4; CB p.100: "When play passes to the GM, the GM can make a move to
 * spotlight an adversary"; CB p.194: "For an adversary to use an action, they must have the spotlight"). Book: the
 * spotlight goes to the GM on this adversary; its token on the live map is lit (`spotlightAdversary`), else the GM just
 * holds it (`moveToGm`, reason `adversary`). An adversary already lit writes nothing, so a Fear paid for it
 * (`combatSpotlight.gmTake` pay "fear") is never paid again and its spotlight this GM turn is not counted twice (the
 * encounter's count is `commit`'s, unchanged). Every mode (user 2026-11-06, tracer RFA): S1 Manual stops only the
 * PC-roll half (convex/lib/rollAftermath.ts); an adversary's action always takes the spotlight.
 */
async function spotlightActor(
  ctx: MutationCtx,
  campaign: Doc<"campaigns">,
  instance: Doc<"encounterAdversaries">,
  tokens: readonly Doc<"combatTokens">[],
): Promise<void> {
  const token = tokens.find((t) => t.ref.kind === "adversary" && t.ref.adversaryId === instance._id);
  if (token) await spotlightAdversary(ctx, campaign, token._id);
  else await moveToGm(ctx, campaign, "adversary");
}

/** Writes the action and logs its group: the GM row (roll, damage, `adversaryBefore`, Fear), the public row, then one incoming hit per hit PC. */
async function finish(ctx: MutationCtx, f: FinishInput): Promise<ActionResult> {
  const { w, campaign } = f;
  const log = { campaignId: campaign._id, actorId: f.user._id, groupId: f.groupId };
  const map = await liveCombatMap(ctx, campaign._id);
  const bands = await bandsOnMap(ctx, map?._id);
  const tokens = map ? await tokensOnMap(ctx, map._id) : [];
  // S1 (bead dcm-bxp.99.32.4): before the action's own marks are written (an adversary that marks its last HP acting
  // still had the spotlight for that action).
  if (f.needsSpotlight) await spotlightActor(ctx, campaign, w.instance, tokens);
  const fearDelta = await applyFear(ctx, campaign._id, w.fearDelta - f.spotlightFear);
  const adversaryBefore = await commit(ctx, w, log, f.spotlight ? { gmTurn: f.encounter.gmTurn } : null);
  const gmLines = [...f.gmText, ...w.gm, ...w.prompts.map((p) => `${p.kind}: ${p.text}`)];
  const entryId = await logAction(ctx, {
    ...log,
    kind: "adversary",
    visibility: "gm",
    summary: gmLines.join("; "),
    ...(f.roll ? { roll: f.roll } : {}),
    adversaryBefore,
    ...(fearDelta !== 0 ? { fearDelta } : {}),
    undoable: true,
  });
  const publicId = await logAction(ctx, { ...log, kind: "adversary", visibility: "public", summary: f.publicText, undoable: true });
  // H3: the tokens it named, by id, so the map flashes them without reading names out of the text.
  const targets = publicTargets(tokens, f.outcomes, w, f.roll !== null);
  if (targets.length > 0) await ctx.db.patch("actionLog", publicId, { targets });

  const outcomes = [...f.outcomes];
  for (const h of w.hits) {
    // Read again for each hit: an earlier hit that resolved at once changed a sheet.
    const party = await partyMembers(ctx, campaign._id);
    const token = tokens.find((t) => t.ref.kind === "pc" && t.ref.characterId === h.targetId);
    const { requestId, resolution } = await openIncomingHit(ctx, {
      campaignId: campaign._id,
      encounterId: f.encounter._id,
      ...(map ? { mapId: map._id } : {}),
      createdBy: f.user._id,
      groupId: f.groupId,
      attacker: { instanceId: w.instance._id, label: w.instance.label, ...(f.attackerFeature !== undefined ? { feature: f.attackerFeature } : {}) },
      targetCharacterId: h.targetId,
      ...(token ? { targetTokenId: token._id } : {}),
      hit: h.hit,
      riders: h.riders,
      party,
      bands,
    });
    const o = outcomes.find((x) => x.characterId === h.targetId);
    const entry = { characterId: h.targetId, hit: true, requestId, damage: h.hit.amount, resolved: resolution !== null, ...(resolution?.deathMove ? { deathMove: true } : {}) };
    if (o) Object.assign(o, entry);
    else outcomes.push(entry);
    if (resolution) await afterHitTriggers(ctx, resolution, f.user._id);
  }
  // dcm-bxp.99.32.27: a feature use's GM prompts are stored open for the HUD queue (a reload or a second GM tab keeps them).
  if (f.attackerFeature !== undefined) {
    for (const p of w.prompts.slice(0, MAX_GM_PROMPTS_PER_USE)) {
      await ctx.db.insert("combatRequests", {
        campaignId: campaign._id,
        encounterId: f.encounter._id,
        ...(map ? { mapId: map._id } : {}),
        kind: "gmPrompt",
        status: "open",
        createdBy: f.user._id,
        createdAt: Date.now(),
        responses: [],
        payload: { schemaVersion: 1, kind: "gmPrompt", instanceId: w.instance._id, instanceLabel: w.instance.label.slice(0, 80), feature: f.attackerFeature.slice(0, 80), prompt: p.kind, text: p.text.slice(0, 1000), groupId: f.groupId },
      });
    }
  }
  return { status: "resolved", groupId: f.groupId, entryId, roll: f.roll, success: f.success, targets: outcomes, fearDelta, prompts: w.prompts, offers: f.offers };
}

/**
 * The public row's `targets` (followups-7 H3): the live map's token of each creature the action named (hit, missed, or
 * touched by a feature without a roll), then each other adversary its feature changed (allies; tone "effect"), then each
 * other PC whose sheet it changed (tone "effect", followups-8 I2). PCs and
 * adversaries without a token on the live map are left out. Ids and tones only (Q14).
 */
function publicTargets(tokens: readonly Doc<"combatTokens">[], outcomes: readonly TargetOutcome[], w: Work, rolled: boolean): ActionTarget[] {
  const out: ActionTarget[] = [];
  const add = (token: Doc<"combatTokens"> | undefined, side: ActionTarget["side"], tone: ActionTarget["tone"]) => {
    if (token && !out.some((t) => t.tokenId === token._id)) out.push({ tokenId: token._id, side, tone });
  };
  const pcToken = (id: string) => tokens.find((t) => t.ref.kind === "pc" && t.ref.characterId === id);
  const adversaryToken = (id: string) => tokens.find((t) => t.ref.kind === "adversary" && t.ref.adversaryId === id);
  for (const o of outcomes) {
    const tone = rolled ? (o.hit ? "hit" : "miss") : "effect";
    if (o.characterId !== undefined) add(pcToken(o.characterId), "pc", tone);
    else if (o.instanceId !== undefined) add(adversaryToken(o.instanceId), "adversary", tone);
  }
  for (const { instance } of w.allies.values()) if (instance._id !== w.instance._id) add(adversaryToken(instance._id), "adversary", "effect");
  // followups-8 I2 (dcm-bxp.99.26): a PC whose sheet the feature changed without naming them (a picked or follow-up PC, a
  // trigger's subject) flashes too; a named PC keeps its hit / miss tone.
  for (const id of w.sheets.keys()) add(pcToken(id), "pc", "effect");
  return out;
}

// ---------------------------------------------------------------- after a hit resolves

/**
 * The attacker's triggers once a hit is marked (AR8): `onTargetMarksHp` (Overwhelming Force's knock-back), `onDealDamage`,
 * `onDefeatPc`. Automatic uses run and log a GM row in the hit's group; reactions are named on that row for the GM
 * (they fire them through `useFeature` with the trigger). Nothing happens when the encounter no longer runs.
 */
export async function afterHitTriggers(ctx: MutationCtx, res: HitResolution, actorId: Id<"users">): Promise<void> {
  const instanceId = attackerInstanceId(res.attacker);
  if (res.negated || instanceId === null) return;
  const instance = await ctx.db.get("encounterAdversaries", instanceId);
  if (instance === null || instance.defeated) return;
  const encounter = await ctx.db.get("encounters", instance.encounterId);
  if (encounter === null || encounter.status !== "running") return;
  const block = await blockOf(ctx, instance);
  if (block === null || block.effects.length === 0) return;
  const campaign = await ctx.db.get("campaigns", instance.campaignId);
  if (campaign === null) return;
  const attack = res.attacker.feature === undefined ? ("standard" as const) : ("feature" as const);
  const events: AdversaryEvent[] = [];
  if (res.hpMarked > 0) events.push({ kind: "onTargetMarksHp", attack });
  if (res.taken > 0) events.push({ kind: "onDealDamage", ...(res.severity !== "none" ? { severity: res.severity } : {}), toPc: true });
  if (res.deathMove) events.push({ kind: "onDefeatPc" });
  if (events.length === 0) return;
  const others = await ctx.db
    .query("encounterAdversaries")
    .withIndex("by_encounter_order", (q) => q.eq("encounterId", encounter._id))
    .take(MAX_INSTANCES + 1);
  const party = await partyMembers(ctx, instance.campaignId);
  const fearState = await campaignFearState(ctx, instance.campaignId);
  const w = new Work(instance, block, party, others, encounter, fearState.sessionStartedAt);
  const target = party.find((m) => m.character._id === res.targetId);
  const fear = fearState.fear;
  const lines: string[] = [];
  const groupId = res.groupId;
  // ODR3: Defined Ranges off, range-gated triggers are the GM's call; the questions join the hit's group.
  const gated = rangeGatedUses(triggered(w.block, w.instance, events), ruleMode(campaign, "definedRanges"), instance.label);
  for (const summary of new Set(gated.asks)) await postRuleNote(ctx, campaign, { ruleId: "definedRanges", summary, groupId, actorId });
  for (const t of gated.uses) {
    if (t.mode === "reaction") {
      lines.push(`Reaction available: ${t.effect.feature}`);
      continue;
    }
    const self = w.selfAfter;
    const plan = runOrThrow(t.effect, {
      adversaryId: block.adversaryId,
      self,
      attack: block.attack,
      tier: block.tier,
      tokens: w.tokensAfter,
      featureUses: w.baseUses,
      gmFear: Math.max(0, fear + w.fearDelta),
      spotlit: true,
      fearConfirmed: true,
      useId: t.use.id,
      ...(target ? { targets: [pcCombatant(target.character._id, target.sheet)] } : {}),
      trigger: { amount: res.taken, source: selfCombatant(instance, block), ...(target ? { subject: pcCombatant(target.character._id, target.sheet) } : {}) },
      situations: [],
      attackDiceOnAttacks: true,
      ...rangesFlag(campaign),
      rng: rollDie,
    });
    w.absorb(plan, t.effect.feature);
    lines.push(`${t.effect.feature} (automatic)`);
  }
  if (lines.length === 0) return;
  w.settleEnds(null);
  const log = { campaignId: instance.campaignId, actorId, groupId };
  const fearDelta = await applyFear(ctx, instance.campaignId, w.fearDelta);
  const adversaryBefore = await commit(ctx, w, log, null);
  await logAction(ctx, {
    ...log,
    kind: "adversary",
    visibility: "gm",
    summary: `${instance.label} → ${[...lines, ...w.gm, ...w.prompts.map((p) => `${p.kind}: ${p.text}`)].join("; ")}`,
    adversaryBefore,
    ...(fearDelta !== 0 ? { fearDelta } : {}),
    undoable: true,
  });
  const map = await liveCombatMap(ctx, instance.campaignId);
  const bands = await bandsOnMap(ctx, map?._id);
  for (const h of w.hits) {
    // A hit from an automatic use (rare): its own window, in the same group; its triggers don't chain further.
    await openIncomingHit(ctx, { campaignId: instance.campaignId, encounterId: encounter._id, ...(map ? { mapId: map._id } : {}), createdBy: actorId, groupId, attacker: { instanceId: instance._id, label: instance.label }, targetCharacterId: h.targetId, hit: h.hit, riders: h.riders, party: await partyMembers(ctx, instance.campaignId), bands });
  }
}
// ---------------------------------------------------------------- before the roll (SD4, Q2)

export type PreRollRow = Doc<"combatRequests"> & { payload: PreRollPayload };

export function isPreRollRow(row: Doc<"combatRequests">): row is PreRollRow {
  return row.kind === "preRoll" && row.payload.kind === "preRoll";
}

/** The attacking instance of a held attack as a creature (the before-roll feature's trigger source); null when gone. */
async function heldAttacker(ctx: QueryCtx, row: PreRollRow): Promise<{ instance: Doc<"encounterAdversaries">; combatant: Combatant } | null> {
  const instance = await ctx.db.get("encounterAdversaries", row.payload.attacker.instanceId);
  if (instance === null || instance.campaignId !== row.campaignId) return null;
  const block = await blockOf(ctx, instance);
  return block ? { instance, combatant: selfCombatant(instance, block) } : null;
}

/** The PCs a before-roll answer protects (its trigger's subjects among the held attack's targets), by character id. */
async function preRollSubjects(ctx: QueryCtx, row: PreRollRow, characterId: Id<"characters">, effect: FeatureEffect, useId: string): Promise<string[]> {
  const use = effect.uses.find((u) => u.id === useId);
  if (!use || use.activation.kind !== "reaction") return [];
  const map = row.mapId ? await ctx.db.get("combatMaps", row.mapId) : null;
  const bands = await bandsOnMap(ctx, row.mapId);
  let toAttacker: Range | undefined;
  if (map?.live) {
    const tokens = await tokensOnMap(ctx, map._id);
    const mine = tokens.find((t) => t.ref.kind === "pc" && t.ref.characterId === characterId);
    const theirs = tokens.find((t) => t.ref.kind === "adversary" && t.ref.adversaryId === row.payload.attacker.instanceId);
    if (mine && theirs) toAttacker = rangeCheck(mine, theirs, "melee").band;
  }
  const targets = row.payload.attack.targetCharacterIds.map((id) => ({ id, ...(id !== characterId ? optionalBand(bands(characterId, id)) : {}) }));
  return preRollFits(use.activation.trigger, characterId, targets, toAttacker);
}

/**
 * An answer to a before-roll prompt (Q2): `pass`, or a before-roll feature the responder was offered, run now through
 * SD1's feature runner with the attack as its trigger and paid at once (a Favor, a Focus). What it does to the attacker
 * now is written now (Draining Bane: a Stress, and "Drained" on the instance); the rest waits for the replay
 * (disadvantage, +Evasion). NOT_A_RESPONDER for anyone not listed, an answer given twice or a feature not offered.
 * Returns whether every responder answered.
 */
export async function respondPreRoll(ctx: MutationCtx, input: { row: PreRollRow; characterId: Id<"characters">; choice: AnswerChoice; by: Id<"users"> }): Promise<{ complete: boolean }> {
  const { row, characterId, choice } = input;
  const p = row.payload;
  const responder = p.responders.find((r) => r.characterId === characterId);
  if (!responder || row.responses.some((r) => r.characterId === characterId)) throw appError("NOT_A_RESPONDER");
  let stored: CombatResponse["choice"] = { kind: "pass" };
  if (choice.kind === "feature") {
    if (!responder.featureIds.includes(choice.featureId)) throw appError("NOT_A_RESPONDER", choice.featureId);
    const member = (await partyMembers(ctx, row.campaignId)).find((m) => m.character._id === characterId);
    const campaign = await ctx.db.get("campaigns", row.campaignId);
    const attacker = await heldAttacker(ctx, row);
    if (!member || !campaign || !attacker) throw appError("NOT_A_RESPONDER", choice.featureId);
    const effect = answeringFeatures(member.sheet, resolveOptions(campaign.frameId, campaign.options).hopeAndFear).find((f) => f.featureId === choice.featureId);
    const use = effect?.uses.find((u) => u.activation.kind === "reaction" && (choice.useId === undefined || u.id === choice.useId));
    if (!effect || !use) throw appError("NOT_A_RESPONDER", choice.featureId);
    const subjects = await preRollSubjects(ctx, row, characterId, effect, use.id);
    const party = await partyMembers(ctx, row.campaignId);
    const subject = party.find((m) => subjects.includes(m.character._id));
    if (!subject) throw appError("NOT_A_RESPONDER", choice.featureId);
    const subjectCombatant = pcCombatant(subject.character._id, subject.sheet);
    const result = runFeature(effect, use.id, {
      actor: actorWithSubject(featureActor(characterId, member.sheet), subjectCombatant),
      gmFear: 0,
      ...featureChoices(choice.choices),
      trigger: { amount: 0, subject: subjectCombatant, source: attacker.combatant },
      rng: seededRng(`${row._id}:${row.responses.length}`),
    });
    if (!result.ok) throw featureRefusal(result);
    assertPicked(result.plan);
    const plan = result.plan;
    await saveSheet(ctx, characterId, actorSheetAfter(member.sheet, plan, characterId, plan.name));
    await logAction(ctx, { campaignId: row.campaignId, characterId, actorId: row.createdBy, kind: "adversary", visibility: "public", summary: `${member.sheet.name} uses ${plan.name} against ${p.attacker.label}`, groupId: p.groupId, before: member.sheet, undoable: true });
    // Draining Bane: the Stress now, and Drained on the instance (its d12 starts with this attack).
    const written = await writeAttackerChanges(ctx, plan, attacker, p.attacker.label);
    const drains = plan.steps.some((s) => s.kind === "effect" && s.targetId === attacker.combatant.id && s.mods.some((m) => m.kind === "set" && m.stat === "attackDie"));
    let before = written.before;
    const lines = written.line ? [written.line] : [];
    if (drains) {
      const fresh = await ctx.db.get("encounterAdversaries", attacker.instance._id);
      if (fresh && !(fresh.tags ?? []).includes(DRAINED)) {
        before ??= beforeOf(fresh);
        await ctx.db.patch("encounterAdversaries", fresh._id, { tags: [...(fresh.tags ?? []), DRAINED].slice(0, 20), updatedAt: Date.now() });
        lines.push(`${p.attacker.label} is Drained (d12 attack rolls until it fails a roll)`);
      }
    }
    if (lines.length > 0) {
      await logAction(ctx, { campaignId: row.campaignId, actorId: row.createdBy, kind: "adversary", visibility: "gm", summary: `${member.sheet.name} · ${plan.name} → ${lines.join("; ")}`, groupId: p.groupId, ...(before ? { adversaryBefore: [before] } : {}), undoable: true });
    }
    stored = { kind: "feature", featureId: effect.featureId, useId: use.id, choices: choice.choices.filter((c) => c.id !== SPENT_DICE) };
  }
  const responses = [...row.responses, { characterId, choice: stored, by: input.by, at: Date.now() }];
  await ctx.db.patch("combatRequests", row._id, { responses });
  return { complete: p.responders.every((r) => responses.some((x) => x.characterId === r.characterId)) };
}

/**
 * Replays a held attack (Q2): when every responder answered, or on the GM's "Resolve now" (combat-actions Q17; whoever
 * hasn't answered passes). The answers' effects ride on the roll: Harrowing Invocation's disadvantage against the PCs it
 * protects (and its Stress if the roll fails against any of them, DA1), Keen Defenses' +Evasion; Drained is on the instance already. The attack then runs as the GM sent it,
 * in the same action group (one undo, U4). A held attack that can't run any more (the instance left, the Fear is gone)
 * is called off with a GM row. Closes the request.
 */
export async function replayHeld(ctx: MutationCtx, row: PreRollRow, by: Id<"users">): Promise<ActionResult | null> {
  const p = row.payload;
  const campaign = await ctx.db.get("campaigns", row.campaignId);
  const user = await ctx.db.get("users", row.createdBy);
  const attacker = await heldAttacker(ctx, row);
  if (campaign === null || user === null || attacker === null) {
    await closeRequest(ctx, row._id, "declined", by);
    return null;
  }
  const party = await partyMembers(ctx, row.campaignId);
  const hopeAndFear = resolveOptions(campaign.frameId, campaign.options).hopeAndFear;
  const replay: Replay = { groupId: p.groupId, disadvantageAgainst: {}, evasion: {}, harrowed: null };
  for (const [i, answer] of row.responses.entries()) {
    if (answer.choice.kind !== "feature") continue;
    const choice = answer.choice;
    const member = party.find((m) => m.character._id === answer.characterId);
    const effect = member ? answeringFeatures(member.sheet, hopeAndFear).find((f) => f.featureId === choice.featureId) : undefined;
    const use = effect?.uses.find((u) => u.id === choice.useId) ?? effect?.uses.find((u) => u.activation.kind === "reaction");
    if (!member || !effect || !use) continue;
    const subjects = await preRollSubjects(ctx, row, answer.characterId, effect, use.id);
    const subject = party.find((m) => subjects.includes(m.character._id));
    const subjectCombatant = subject ? pcCombatant(subject.character._id, subject.sheet) : undefined;
    const result = runFeature(effect, use.id, {
      actor: actorWithSubject(featureReplayActor(member, effect.featureId, choice.choices), subjectCombatant),
      gmFear: 0,
      ...featureChoices(choice.choices),
      trigger: { amount: 0, ...(subjectCombatant ? { subject: subjectCombatant } : {}), source: attacker.combatant },
      rng: seededRng(`${row._id}:${i}`),
    });
    if (!result.ok) continue;
    for (const s of result.plan.steps) {
      // DA1 (user 2026-10-30): the disadvantage counts only against the PCs this answer protects.
      if (s.kind === "effect" && s.mods.some((m) => m.kind === "flag" && m.flag === "attackDisadvantage")) {
        for (const id of subjects) replay.disadvantageAgainst[id] = (replay.disadvantageAgainst[id] ?? 0) + 1;
      }
      if (s.kind === "fold" && s.step.kind === "modifyRoll" && s.step.change.kind === "evasion" && typeof s.amount === "number") {
        for (const id of s.targetIds.length > 0 ? s.targetIds : [answer.characterId]) replay.evasion[id] = (replay.evasion[id] ?? 0) + s.amount;
      }
    }
    // Harrowing Invocation's second half: "If the adversary fails the roll, they must also mark a Stress."
    if (effect.uses.some((u) => u.activation.kind === "auto" && u.activation.trigger.kind === "whenCreatureAttacked" && u.activation.trigger.stage === "failed")) {
      replay.harrowed = { subjects: [...new Set([...(replay.harrowed?.subjects ?? []), ...subjects])] };
    }
  }
  const a = p.attack;
  const args: ActionArgs = {
    instanceId: a.instanceId,
    ...(a.feature !== undefined ? { feature: a.feature } : {}),
    ...(a.useId !== undefined ? { useId: a.useId } : {}),
    targets: [...a.targetCharacterIds],
    ...(a.advantage !== undefined ? { advantage: a.advantage } : {}),
    ...(a.disadvantage !== undefined ? { disadvantage: a.disadvantage } : {}),
    ...(a.experience !== undefined ? { experience: a.experience } : {}),
    ...(a.spendFear !== undefined ? { spendFear: a.spendFear } : {}),
    ...(a.reactions !== undefined ? { reactions: [...a.reactions] } : {}),
    ...(a.darkHearted ? { darkHearted: true } : {}),
    ...(a.destination ? { destination: a.destination } : {}),
  };
  let result: ActionResult | ConfirmFear;
  try {
    result = await adversaryAction(ctx, campaign, user, args, replay);
  } catch (e) {
    if (!(e instanceof ConvexError)) throw e;
    await calledOff(ctx, row, by, (e.data as { code?: string }).code ?? "INVALID");
    return null;
  }
  if (result.status === "confirmFear") {
    await calledOff(ctx, row, by, "NOT_ENOUGH_FEAR");
    return null;
  }
  await closeRequest(ctx, row._id, "resolved", by);
  return result;
}

async function calledOff(ctx: MutationCtx, row: PreRollRow, by: Id<"users">, code: string) {
  await logAction(ctx, { campaignId: row.campaignId, actorId: row.createdBy, kind: "adversary", visibility: "gm", summary: `${row.payload.attacker.label}'s held attack was called off (${code})`, groupId: row.payload.groupId, undoable: false });
  await closeRequest(ctx, row._id, "declined", by);
}

// ---------------------------------------------------------------- a GM-controlled PC (lanes-2, E7; dcm-idz)

export type GmControlArgs = { characterId: Id<"characters">; targets: string[]; weapon?: "primary" | "secondary"; trait?: TraitId };

/**
 * Lane E7, round 2 (dcm-idz; user answer 2026-10-31: "the GM moves the token and attacks with it using a d20 + the PC's
 * weapon like an adversary; Weredrake swaps to the Weredrake stat block until it ends"). The PC must carry the
 * `GM-controlled` tag or a `gmControl` mod (`gmControlOf`). One d20 + the weapon's trait (or, under a stat block, its ATK)
 * against each target: other party PCs (their Evasion; a hit opens the usual reaction window with this PC as attacker)
 * or adversary instances of the running encounter (their Difficulty; the damage is a GM prompt, applied in the tracker).
 * Spotlight and token moves stay the GM's (the control UI waits for the combat UI design, dcm-bxp.99.32). Refusals:
 * NOT_FOUND (not a party PC), INVALID (not GM-controlled, no weapon), COMBAT_TARGET_INVALID.
 */
export async function gmControlledAttack(ctx: MutationCtx, campaign: Doc<"campaigns">, user: Doc<"users">, args: GmControlArgs): Promise<ActionResult> {
  const party = await partyMembers(ctx, campaign._id);
  const member = party.find((m) => m.character._id === args.characterId);
  if (!member) throw appError("NOT_FOUND");
  const control = gmControlOf(member.sheet);
  if (control === null) throw appError("INVALID", "That character is not under the GM's control.");
  if (args.targets.length === 0 || args.targets.length > MAX_ACTION_TARGETS) throw appError("COMBAT_TARGET_INVALID");

  type Target = { id: string; evasion: number; pc?: PartyMember; instance?: Doc<"encounterAdversaries"> };
  const targets: Target[] = [];
  let encounter: Doc<"encounters"> | null = null;
  for (const raw of args.targets) {
    const characterId = ctx.db.normalizeId("characters", raw);
    const instanceId = ctx.db.normalizeId("encounterAdversaries", raw);
    if (characterId) {
      const pc = party.find((m) => m.character._id === characterId);
      if (!pc || pc.character._id === member.character._id) throw appError("COMBAT_TARGET_INVALID");
      if (!targets.some((t) => t.id === pc.character._id)) targets.push({ id: pc.character._id, evasion: pcCombatant(pc.character._id, pc.sheet).evasion ?? 0, pc });
    } else if (instanceId) {
      const instance = await ctx.db.get("encounterAdversaries", instanceId);
      if (instance === null || instance.campaignId !== campaign._id || instance.defeated) throw appError("COMBAT_TARGET_INVALID");
      encounter ??= await ctx.db.get("encounters", instance.encounterId);
      if (encounter === null || encounter._id !== instance.encounterId || encounter.status !== "running") throw appError("COMBAT_TARGET_INVALID");
      const difficulty = instance.stats.difficulty + (instance.effects ?? []).reduce((s, e) => s + (e.difficulty ?? 0), 0);
      if (!targets.some((t) => t.id === instance._id)) targets.push({ id: instance._id, evasion: difficulty, instance });
    } else throw appError("COMBAT_TARGET_INVALID");
  }

  // The roll: the stat block's ATK and standard attack (Weredrake), else d20 + the weapon's trait and its damage.
  const sheet = member.sheet;
  let rolled: { attack: ReturnType<typeof gmControlledWeaponAttack>["attack"]; damage: string };
  let weaponName: string;
  if (control.asAdversary) {
    const def = control.asAdversary;
    rolled = { attack: adversaryAttack(def.attack.modifier, {}, 0, targets, rollDie), damage: def.attack.damage };
    weaponName = `${def.name}: ${def.attack.name}`;
  } else {
    const weapon = getWeapon((args.weapon === "secondary" ? sheet.secondaryWeaponId : sheet.primaryWeaponId) ?? "");
    if (!weapon) throw appError("INVALID", "That character has no such weapon.");
    // Lanes-3 (dcm-grqt; user answer 2026-10-31): a "choice" weapon takes the trait the GM picks for this attack.
    const traitId = weapon.trait === "choice" ? args.trait : weapon.trait;
    if (traitId === undefined) throw appError("INVALID", "Pick the trait for this weapon's attack.");
    const trait = sheet.traits[traitId];
    rolled = gmControlledWeaponAttack(trait, weapon.damage, sheet.proficiency, targets, rollDie);
    weaponName = weapon.name;
  }
  const { attack } = rolled;

  const groupId = newGroupId();
  const log = { campaignId: campaign._id, actorId: user._id, groupId };
  const name = sheet.name;
  const hitIds = new Set(attack.hits.filter((h) => h.hit).map((h) => h.id));
  const prompts: Prompt[] = [];
  const gmLines = [`${name} (${GM_CONTROLLED}) ${weaponName}: ${words(attack.record)}${attack.critical ? " critical" : ""} vs ${targets.map((t) => `${t.pc?.sheet.name ?? t.instance?.label ?? "?"} ${t.evasion}: ${hitIds.has(t.id) ? "hit" : "miss"}`).join(", ")}`];
  const damages = new Map<string, NonNullable<ReturnType<typeof adversaryDamage>>>();
  // Plan rule-switches WR (R10 Manual): a natural 20's damage rolled like a normal hit; the GM's note below.
  const criticalDamage = ruleMode(campaign, "criticalDamage");
  let criticalWithheld = false;
  for (const t of targets) {
    if (!hitIds.has(t.id)) continue;
    const crit = attack.targets.find((x) => x.id === t.id)?.critical ?? false;
    if (crit && criticalDamage === "manual") criticalWithheld = true;
    const dmg = adversaryDamage(rolled.damage, crit, rollDie, criticalDamage);
    if (!dmg) continue;
    damages.set(t.id, dmg);
    if (t.instance) prompts.push({ kind: "manual", text: `${t.instance.label} takes ${dmg.record.total} ${dmg.type} damage from ${name}` });
  }
  const entryId = await logAction(ctx, { ...log, kind: "adversary", visibility: "gm", summary: [...gmLines, ...prompts.map((p) => `${p.kind}: ${p.text}`)].join("; "), roll: attack.record, undoable: true });
  if (criticalWithheld) await postRuleNote(ctx, campaign, { ruleId: "criticalDamage", summary: criticalDamageNote(name, criticalBonus(rolled.damage)), groupId, actorId: user._id });
  const hitNames = targets.filter((t) => hitIds.has(t.id)).map((t) => t.pc?.sheet.name ?? t.instance?.label ?? "?");
  const missNames = targets.filter((t) => !hitIds.has(t.id)).map((t) => t.pc?.sheet.name ?? t.instance?.label ?? "?");
  await logAction(ctx, { ...log, kind: "adversary", visibility: "public", summary: `${name} (${GM_CONTROLLED}) attacked: ${[hitNames.length ? `hit ${hitNames.join(", ")}` : "", missNames.length ? `missed ${missNames.join(", ")}` : ""].filter(Boolean).join("; ")}`, undoable: true });

  const map = await liveCombatMap(ctx, campaign._id);
  const bands = await bandsOnMap(ctx, map?._id);
  const tokens = map ? await tokensOnMap(ctx, map._id) : [];
  const outcomes: TargetOutcome[] = [];
  for (const t of targets) {
    const dmg = damages.get(t.id);
    if (t.instance) {
      outcomes.push({ instanceId: t.instance._id, hit: hitIds.has(t.id), resolved: true, ...(dmg ? { damage: dmg.record.total } : {}) });
      continue;
    }
    if (!t.pc || !dmg) {
      if (t.pc) outcomes.push({ characterId: t.pc.character._id, hit: false, resolved: true });
      continue;
    }
    const targetId = t.pc.character._id;
    const token = tokens.find((x) => x.ref.kind === "pc" && x.ref.characterId === targetId);
    const { requestId, resolution } = await openIncomingHit(ctx, {
      campaignId: campaign._id,
      ...(encounter ? { encounterId: encounter._id } : {}),
      ...(map ? { mapId: map._id } : {}),
      createdBy: user._id,
      groupId,
      attacker: { kind: "pc", characterId: member.character._id, label: name, cardId: "gm-control", feature: weaponName },
      targetCharacterId: targetId,
      ...(token ? { targetTokenId: token._id } : {}),
      hit: { amount: dmg.record.total, type: dmg.type, direct: dmg.direct, forcedArmor: 0, critical: attack.targets.find((x) => x.id === t.id)?.critical ?? false },
      party: await partyMembers(ctx, campaign._id),
      bands,
    });
    outcomes.push({ characterId: targetId, hit: true, requestId, damage: dmg.record.total, resolved: resolution !== null, ...(resolution?.deathMove ? { deathMove: true } : {}) });
  }
  return { status: "resolved", groupId, entryId, roll: attack.record, success: hitIds.size > 0, targets: outcomes, fearDelta: 0, prompts, offers: [] };
}

// ---------------------------------------------------------------- adversary uses on a PC's roll (lanes-2, E7 round 3; dcm-of7v)

/** A bonus an adversary use puts on one duality die of a PC's roll (Ill Omen, Backhanded Guidance). */
export type PcRollDieBonus = { die: "hope" | "fear"; amount: number; instanceId: Id<"encounterAdversaries">; feature: string };

export type PcRollUses = {
  /** The duality-die bonuses to fold into the roll with `withDieBonuses` (E1's helper) before hits are read. */
  bonuses: PcRollDieBonus[];
  /** GM feed lines for what ran (the caller logs them with its roll). */
  lines: string[];
  /** Reactions that matched and were not opted into (the GM's choice, Q19 default No), by instance. */
  offers: { instanceId: Id<"encounterAdversaries">; feature: string; useId: string }[];
  /** ODR3: the GM's questions for the range-gated uses Defined Ranges off left out (already posted as notes); absent: none. */
  rangeAsks?: string[];
};

/**
 * Lane E7 round 3 (dcm-of7v; dcm-3ou, dcm-jog): the running encounter's adversary uses that fire when a PC rolls
 * (`pcRolls` triggers): every matching `auto` use runs (Ill Omen, HF p.95: "When a PC within Close range makes an action
 * roll, their Fear Die gains a bonus equal to the amount of Fear you have"), and a matching `reaction` runs when the GM
 * opted into it (`reactions`, by feature name; Backhanded Guidance, HF p.87: "mark a Stress to add 1d6 to the result of
 * their Fear Die"); the others come back as `offers`. Their `modifyRoll dieBonus` folds come back as `bonuses` for the
 * caller's roll (user answer 2026-10-31: the bonus only decides Hope vs Fear, never a critical; a tie is WITH FEAR, which
 * `withDieBonuses` does). Costs an opted-in reaction pays (its Stress, Fear) are written on the instance and the GM's Fear.
 * The band is read from the live map (no map: no range, Q18). No running encounter: nothing.
 *
 * Callers: the PC roll paths (E1's resolveAttack / card uses / rolls.duality; follow-up bead) pass the roll's facts.
 *
 * Plan rule-switches ODR3 (user 2026-11-06): with Defined Ranges off a range-gated use (Ill Omen's "a PC within Close
 * range") neither runs nor is offered; one GM-only `definedRanges` note per use asks who is in range (`rangeAsks`), in
 * the roll's group when the caller passes `groupId` (by `actorId`, else the wrapper context's caller). The other uses
 * run with the runner's `definedRanges: false`.
 */
export async function pcRollAdversaryUses(
  ctx: MutationCtx,
  campaign: Doc<"campaigns">,
  input: { characterId: Id<"characters">; roll: RollFacts; reactions?: readonly string[]; groupId?: string; actorId?: Id<"users"> },
): Promise<PcRollUses> {
  const out: PcRollUses = { bonuses: [], lines: [], offers: [] };
  const rangeAsks: string[] = [];
  const encounter = await ctx.db
    .query("encounters")
    .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", campaign._id).eq("status", "running"))
    .first();
  if (encounter === null) return out;
  const party = await partyMembers(ctx, campaign._id);
  const member = party.find((m) => m.character._id === input.characterId);
  if (!member) return out;
  const subject = pcCombatant(member.character._id, member.sheet);
  const instances = await ctx.db
    .query("encounterAdversaries")
    .withIndex("by_encounter_order", (q) => q.eq("encounterId", encounter._id))
    .take(MAX_INSTANCES + 1);
  const map = await liveCombatMap(ctx, campaign._id);
  const tokens = map ? await tokensOnMap(ctx, map._id) : [];
  const pcToken = tokens.find((t) => t.ref.kind === "pc" && t.ref.characterId === input.characterId);
  const fearState = await campaignFearState(ctx, campaign._id);
  let fear = fearState.fear;
  const definedRanges = ruleMode(campaign, "definedRanges");
  for (const instance of instances) {
    if (instance.defeated) continue;
    const block = await blockOf(ctx, instance);
    if (block === null) continue;
    const selfToken = tokens.find((t) => t.ref.kind === "adversary" && t.ref.adversaryId === instance._id);
    const band = selfToken && pcToken ? rangeCheck(selfToken, pcToken, "melee").band : undefined;
    const event: AdversaryEvent = { kind: "pcRolls", roll: input.roll, ...(band ? { band } : {}) };
    const gated = rangeGatedUses(triggered(block, instance, [event]), definedRanges, instance.label);
    for (const ask of gated.asks) if (!rangeAsks.includes(ask)) rangeAsks.push(ask);
    for (const t of gated.uses) {
      if (t.mode === "reaction" && !(input.reactions ?? []).includes(t.effect.feature)) {
        out.offers.push({ instanceId: instance._id, feature: t.effect.feature, useId: t.use.id });
        continue;
      }
      const self = selfCombatant(instance, block);
      const plan = runOrThrow(t.effect, {
        adversaryId: block.adversaryId,
        self,
        attack: block.attack,
        tier: block.tier,
        tokens: instance.tokens ?? 0,
        featureUses: instanceUses(instance, encounter, fearState.sessionStartedAt),
        gmFear: fear,
        spotlit: true,
        fearConfirmed: true,
        useId: t.use.id,
        targets: [subject],
        trigger: { subject, source: self },
        optionals: optionalIds(t.use),
        ...rangesFlag(campaign),
        rng: rollDie,
      });
      for (const s of plan.steps) {
        if (s.kind !== "fold" || s.step.kind !== "modifyRoll" || s.step.change.kind !== "dieBonus") continue;
        const die = s.step.change.die === "hopeOrFear" ? "fear" : s.step.change.die;
        const amount = typeof s.amount === "number" ? s.amount : 0;
        if (amount !== 0) out.bonuses.push({ die, amount, instanceId: instance._id, feature: t.effect.feature });
      }
      // What the use paid or changed on itself (Backhanded Guidance's Stress), and the Fear it spent or gained.
      const after = plan.self.after;
      if (after.stress !== instance.stress || after.hp !== instance.hp) {
        await ctx.db.patch("encounterAdversaries", instance._id, { stress: Math.max(0, Math.min(self.stressMax, after.stress)), hp: Math.max(0, Math.min(self.hpMax, after.hp)), updatedAt: Date.now() });
      }
      if (plan.gmFearDelta < 0) await spendFear(ctx, campaign._id, -plan.gmFearDelta, "feature");
      else if (plan.gmFearDelta > 0) await gainFear(ctx, campaign._id, plan.gmFearDelta);
      fear = Math.max(0, fear + plan.gmFearDelta);
      const manual = plan.steps.flatMap((s) => (s.kind === "prompt" ? [s.text] : []));
      out.lines.push(`${instance.label} ${t.effect.feature} (${t.mode === "auto" ? "automatic" : "reaction"}) on ${member.sheet.name}'s roll${manual.length > 0 ? `: ${manual.join("; ")}` : ""}`);
    }
  }
  // ODR3: the GM's questions, in the roll's group when the caller has one (else a note that is never undoable).
  if (rangeAsks.length === 0) return out;
  out.rangeAsks = rangeAsks;
  const actorId = input.actorId ?? (ctx as MutationCtx & { user?: Doc<"users"> }).user?._id;
  if (actorId !== undefined) {
    for (const summary of rangeAsks) await postRuleNote(ctx, campaign, { ruleId: "definedRanges", summary, ...(input.groupId !== undefined ? { groupId: input.groupId } : {}), actorId });
  }
  return out;
}

// ---------------------------------------------------------------- plan lanes-2 E7.4: a PC escapes (dcm-0hlq, dcm-thwj)

export type EscapeResult = { groupId: string; tokens: number; lines: string[]; prompts: Prompt[]; offers: { instanceId: Id<"encounterAdversaries">; feature: string; useId: string }[] };

/**
 * A PC escaped the named tokens an adversary put on them (Encumber, CB p.218: "All bramble tokens can be removed by
 * succeeding on a Finesse Roll (12 + the number of bramble tokens)"). The table makes the roll; the GM records the
 * success here. Every token of `name` comes off the sheet (`creatureTokens`) and the running encounter's instances hear
 * `pcEscapes` with `trigger.amount` = the tokens removed (Drain and Multiply: a Minion per token): automatic uses run,
 * reactions are named for the GM. One undoable group. INVALID when the PC holds no such tokens; NOT_FOUND for a PC
 * outside the party.
 */
export async function pcEscape(ctx: MutationCtx, campaign: Doc<"campaigns">, user: Doc<"users">, args: { characterId: Id<"characters">; name: string }): Promise<EscapeResult> {
  const party = await partyMembers(ctx, campaign._id);
  const member = party.find((m) => m.character._id === args.characterId);
  if (!member) throw appError("NOT_FOUND");
  const tokens = (member.sheet.creatureTokens ?? []).find((t) => t.name === args.name)?.count ?? 0;
  if (tokens <= 0) throw appError("INVALID", "The PC holds no such tokens.");
  const groupId = newGroupId();
  const log = { campaignId: campaign._id, actorId: user._id, groupId };
  const cleared = withSheetCreatureTokens(member.sheet, args.name, 0);
  await saveSheet(ctx, member.character._id, cleared);
  await logAction(ctx, { ...log, characterId: member.character._id, kind: "adversary", visibility: "public", summary: `${member.sheet.name} escaped the ${args.name} tokens (${tokens})`, before: member.sheet, undoable: true });
  const out: EscapeResult = { groupId, tokens, lines: [], prompts: [], offers: [] };
  const encounter = await ctx.db
    .query("encounters")
    .withIndex("by_campaign_status_updated", (q) => q.eq("campaignId", campaign._id).eq("status", "running"))
    .first();
  if (encounter === null) return out;
  const instances = await ctx.db
    .query("encounterAdversaries")
    .withIndex("by_encounter_order", (q) => q.eq("encounterId", encounter._id))
    .take(MAX_INSTANCES + 1);
  const map = await liveCombatMap(ctx, campaign._id);
  const mapTokens = map ? await tokensOnMap(ctx, map._id) : [];
  const pcToken = mapTokens.find((t) => t.ref.kind === "pc" && t.ref.characterId === args.characterId);
  const sessionStartedAt = (await campaignFearState(ctx, campaign._id)).sessionStartedAt;
  for (const instance of instances) {
    if (instance.defeated) continue;
    const block = await blockOf(ctx, instance);
    if (block === null || block.effects.length === 0) continue;
    const selfToken = mapTokens.find((t) => t.ref.kind === "adversary" && t.ref.adversaryId === instance._id);
    const band = selfToken && pcToken ? rangeCheck(selfToken, pcToken, "melee").band : undefined;
    const event: AdversaryEvent = { kind: "pcEscapes", tokens, name: args.name, ...(band ? { band } : {}) };
    // ODR3: Defined Ranges off, a range-gated use is the GM's call (a note in the escape's group).
    const gated = rangeGatedUses(triggered(block, instance, [event]), ruleMode(campaign, "definedRanges"), instance.label);
    for (const summary of gated.asks) await postRuleNote(ctx, campaign, { ruleId: "definedRanges", summary, groupId, actorId: user._id });
    const fired = gated.uses;
    if (fired.length === 0) continue;
    const w = new Work(instance, block, await partyMembers(ctx, campaign._id), instances, encounter, sessionStartedAt);
    const subject = pcCombatant(member.character._id, cleared);
    const fear = (await campaignFearState(ctx, campaign._id)).fear;
    const lines: string[] = [];
    for (const t of fired) {
      if (t.mode === "reaction") {
        out.offers.push({ instanceId: instance._id, feature: t.effect.feature, useId: t.use.id });
        lines.push(`Reaction available: ${t.effect.feature} (trigger amount ${tokens})`);
        continue;
      }
      const plan = runOrThrow(t.effect, {
        adversaryId: block.adversaryId,
        self: w.selfAfter,
        attack: block.attack,
        tier: block.tier,
        tokens: w.tokensAfter,
        featureUses: w.baseUses,
        gmFear: Math.max(0, fear + w.fearDelta),
        spotlit: true,
        fearConfirmed: true,
        useId: t.use.id,
        targets: [subject],
        trigger: { amount: tokens, subject, source: selfCombatant(instance, block) },
        optionals: optionalIds(t.use),
        situations: [],
        attackDiceOnAttacks: true,
        ...rangesFlag(campaign),
        rng: rollDie,
      });
      w.absorb(plan, t.effect.feature);
      lines.push(`${t.effect.feature} (automatic)`);
    }
    w.settleEnds(null);
    const fearDelta = await applyFear(ctx, campaign._id, w.fearDelta);
    const adversaryBefore = await commit(ctx, w, log, null);
    await logAction(ctx, {
      ...log,
      kind: "adversary",
      visibility: "gm",
      summary: `${instance.label} → ${member.sheet.name} escaped (${tokens} ${args.name}): ${[...lines, ...w.gm, ...w.prompts.map((p) => `${p.kind}: ${p.text}`)].join("; ")}`,
      adversaryBefore,
      ...(fearDelta !== 0 ? { fearDelta } : {}),
      undoable: true,
    });
    out.lines.push(...lines.map((l) => `${instance.label}: ${l}`), ...w.gm);
    out.prompts.push(...w.prompts);
  }
  return out;
}
