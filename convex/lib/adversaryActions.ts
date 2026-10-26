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
import { pickAdversaryUse, standardAttackEffect, STANDARD_ATTACK_USE, upfrontFear, type AdversaryPlan, type AdversaryPlanStep, type AdversaryRunContext } from "../../src/lib/domain/adversary-effects/run";
import type { AdversaryFeatureEffect } from "../../src/lib/domain/adversary-effects/types";
import { passiveSummary, type AdversaryEvent } from "../../src/lib/domain/adversary-actions/index";
import { featureFearCost } from "../../src/lib/domain/adversaries/index";
import type { PlanStep } from "../../src/lib/domain/card-effects/run";
import type { Range } from "../../src/lib/domain/card-effects/types";
import { lineOfSight, rangeCheck, type Combatant } from "../../src/lib/domain/combat-actions/index";
import { applySpotlight } from "../../src/lib/domain/encounters/spotlight";
import type { RollRecord } from "../../src/lib/domain/duality";
import { appError } from "../../src/lib/errors/app-error";
import type { CharacterSheet, FeatureUse } from "../../src/lib/validation/characters";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAction, newGroupId } from "./actionLog";
import {
  adversaryOnlyPrompts,
  adversaryState,
  beforeOf,
  blockOf,
  instanceModifiers,
  instanceUses,
  isAttackUse,
  loadActor,
  optionalIds,
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
import { pcCombatant, writeSheetChanges } from "./cardRunner";
import { saveSheet } from "./characterSheet";
import { liveCombatMap, tokensOnMap } from "./combatMaps";
import { loadScene, type Scene } from "./combatVision";
import { MAX_INSTANCES } from "./encounters";
import { campaignFearState, gainFear, spendFear } from "./fear";
import { attackerInstanceId, bandsOnMap, openIncomingHit, partyMembers, type BandBetween, type HitDraft, type HitResolution, type PartyMember } from "./incomingHits";
import { rollDie } from "./dice";
import type { ActionTarget, AdversaryBefore, StoredRoll } from "./validators/actionLog";
import type { HitRider } from "./validators/combatRequests";
import { ENCOUNTER_CONDITIONS, type EncounterCondition } from "./validators/encounters";

// The stat block, limits, riders and the runner's helpers moved to ./adversaryFeatures.ts (AA2c, CH9); same names here.
export { adversaryOnlyPrompts, adversaryState, beforeOf, blockOf, instanceUses, ridersOf, selfCombatant, type Block, type Prompt } from "./adversaryFeatures";

/** The most creatures one action names in each list (targets, picked, allies, follow-up); bounds the hit rows (CD8). */
export const MAX_ACTION_TARGETS = 20;
/** The most Minions a Group Attack counts. */
const MAX_GROUP = 30;

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

type PcPick = { kind: "pc"; member: PartyMember; token: Doc<"combatTokens"> | null; combatant: Combatant; band?: Range };
type AdversaryPick = { kind: "adversary"; instance: Doc<"encounterAdversaries">; combatant: Combatant };
type Pick = PcPick | AdversaryPick;

/**
 * The creatures one list names: character ids, PC token ids (with a live map) or instance ids of the same encounter
 * (allies). With `sight`, a PC needs the adversary's line of sight on the map (Q2); `cover` reports whether any is in
 * cover. COMBAT_TARGET_INVALID for anything else (another campaign's, a PC not on the map, a defeated adversary).
 */
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
        prior.hit.amount += hit.amount;
        prior.hit.direct ||= hit.direct;
        prior.hit.forcedArmor += hit.forcedArmor;
        if (prior.hit.type !== hit.type) prior.hit.type = "both";
      } else {
        this.hits.push({ targetId: member.character._id, hit: { amount: hit.amount, type: hit.type, direct: hit.direct, forcedArmor: hit.forcedArmor, critical: hit.critical, ...(hit.attackTotal !== undefined ? { attackTotal: hit.attackTotal } : {}) }, riders: [] });
      }
    }
    const pending = (id: string) => this.hits.find((h) => h.targetId === id);
    const inPlan = new Set(plan.incoming.map((h) => h.targetId));
    const marks = (id: string, track: "stress" | "hp" | "armor", noBenefit?: boolean) =>
      plan.steps.reduce((n, s) => n + (s.kind === "mark" && s.targetId === id && s.track === track && (noBenefit === undefined || (s.noBenefit === true) === noBenefit) ? s.amount : 0), 0);
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
          const hp = marks(c.id, "hp");
          if (stress > 0) hit.riders.push({ kind: "stress", amount: stress });
          if (hp > 0) hit.riders.push({ kind: "hp", amount: hp });
          if (armor !== sheet.armorMarked) this.sheets.set(c.id, { member, after: { ...sheet, armorMarked: armor } });
          continue;
        }
        this.sheets.set(c.id, { member, after: { ...sheet, hp: Math.min(sheet.hpMax, c.after.hp), stress: Math.min(sheet.stressMax, c.after.stress), armorMarked: c.after.armor ?? sheet.armorMarked } });
        continue;
      }
      const ally = this.encounterInstances.find((a) => a._id === c.id);
      if (ally) this.allies.set(c.id, { instance: ally, after: c.after });
    }
    // Conditions, effects and Hope on PCs (Restrained on a hit, a sheet effect), with the feature as the effect's source.
    const cardSteps = plan.steps.filter((s): s is PlanStep => s.kind !== "summon" && s.kind !== "countdown" && s.kind !== "spotlight");
    const touched = new Set(plan.steps.flatMap((s) => ("targetId" in s && ["condition", "clearCondition", "effect", "hope"].includes(s.kind) ? [s.targetId] : [])));
    for (const id of touched) {
      const member = this.party.find((m) => m.character._id === id);
      if (!member) continue;
      const sheet = this.sheets.get(id)?.after ?? member.sheet;
      const after = writeSheetChanges(sheet, cardSteps, id, `${plan.adversaryId}/${plan.feature}`, feature, false, false);
      const hit = pending(id);
      if (hit) {
        hit.riders.push(...ridersOf(sheet, after, cardSteps, id));
        continue;
      }
      this.sheets.set(id, { member, after });
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
    for (const id of plan.deathMoves) this.gm.push(`${this.nameOf(id)} marked their last HP: death move`);
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
        return { kind: "summon", text: `Summon ${step.count} ${step.label}${step.range ? ` within ${step.range}` : ""}${step.note ? `: ${step.note}` : ""}` };
      case "countdown":
        return { kind: "countdown", text: `Countdown ${step.label}: ${step.op}${step.start ? ` at ${step.start}` : ""}${step.amount ? ` by ${step.amount}` : ""}${step.note ? ` (${step.note})` : ""}` };
      case "spotlight":
        return step.who === "self" ? null : { kind: "spotlight", text: `Spotlight ${step.who}${step.count ? ` x${step.count}` : ""}${step.within ? ` within ${step.within}` : ""}${step.name ? ` (${step.name})` : ""}` };
      default:
        return null;
    }
  }
}

/** Writes the work: the instance (and spotlight), allies, PC sheets with their public rows. Returns the instances' before-states. */
async function commit(ctx: MutationCtx, w: Work, log: { campaignId: Id<"campaigns">; actorId: Id<"users">; groupId: string }, spotlight: { gmTurn: number } | null): Promise<AdversaryBefore[]> {
  const now = Date.now();
  // AA2c: a recorded limited use goes into the before-state, so undo gives it back.
  const before: AdversaryBefore[] = [{ ...beforeOf(w.instance), ...(w.addedUses.length > 0 ? { featureUses: w.instance.featureUses ?? [] } : {}) }];
  const s = w.selfAfter;
  const hp = Math.max(0, Math.min(w.instance.stats.hpMax, s.hp));
  await ctx.db.patch("encounterAdversaries", w.instance._id, {
    hp,
    stress: Math.max(0, Math.min(w.instance.stats.stressMax, s.stress)),
    defeated: hp >= w.instance.stats.hpMax || (w.instance.defeated && s.defeated),
    conditions: [...new Set(s.conditions.filter((c): c is EncounterCondition => ENCOUNTER_SET.has(c)))],
    tags: [...new Set(s.tags ?? [])].slice(0, 20),
    tokens: Math.max(0, w.tokensAfter),
    ...(w.addedUses.length > 0 ? { featureUses: storedUses(w.instance, w.encounter, w.block, w.addedUses, w.session) } : {}),
    ...(spotlight ? applySpotlight({ spotlights: w.instance.spotlights, spotlightTurn: w.instance.spotlightTurn }, spotlight.gmTurn) : {}),
    updatedAt: now,
  });
  for (const { instance, after } of w.allies.values()) {
    before.push(beforeOf(instance));
    const ahp = Math.max(0, Math.min(instance.stats.hpMax, after.hp));
    await ctx.db.patch("encounterAdversaries", instance._id, {
      hp: ahp,
      stress: Math.max(0, Math.min(instance.stats.stressMax, after.stress)),
      defeated: ahp >= instance.stats.hpMax || (instance.defeated && after.defeated),
      conditions: [...new Set(after.conditions.filter((c): c is EncounterCondition => ENCOUNTER_SET.has(c)))],
      tags: [...new Set(after.tags ?? [])].slice(0, 20),
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
  for (const { member, after } of w.sheets.values()) {
    await saveSheet(ctx, member.character._id, after);
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
  /** Reactions the GM opted into for this attack (Heavy Hitter, …), by feature name (Q19: default No). */
  reactions?: string[];
};

export type TargetOutcome = { characterId?: Id<"characters">; instanceId?: Id<"encounterAdversaries">; hit: boolean; requestId?: Id<"combatRequests">; damage?: number; resolved: boolean; deathMove?: boolean };

export type ConfirmFear = { status: "confirmFear"; fear: number; spotlight: number; feature: number; experience: number };
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
};


const words = (roll: RollRecord) => `${roll.total} (${roll.dice.filter((d) => !d.dropped).map((d) => d.value).join(", ")}${roll.modifier ? ` ${roll.modifier >= 0 ? "+" : ""}${roll.modifier}` : ""})`;

/**
 * Runs an adversary's standard attack (`feature` unset) or one use of a feature against PCs. The GM picks the targets:
 * party characters, or PC tokens on the live map when the adversary has a token there (line of sight required, cover
 * gives disadvantage; Q2, Q18). An action needs the spotlight (CB p.194): the instance is spotlighted, the second
 * spotlight of a GM turn costs 1 Fear (CB p.153). Fear costs, an Experience and that spotlight return `confirmFear`
 * until `spendFear` covers them (Q19); NOT_ENOUGH_FEAR past the GM's Fear. Refusals: ADVERSARY_FEATURE_UNAVAILABLE,
 * ADVERSARY_NOT_SPOTLIT, COMBAT_TARGET_INVALID, COMBAT_NO_LINE_OF_SIGHT, ENCOUNTER_NOT_RUNNING, INVALID.
 */
export async function adversaryAction(ctx: MutationCtx, campaign: Doc<"campaigns">, user: Doc<"users">, args: ActionArgs): Promise<ActionResult | ConfirmFear> {
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
  const needsSpotlight = use ? use.needsSpotlight : manualFeature!.kind === "action";

  // Spotlight (CB p.153, p.194): spotlit this GM turn, or spotlight it now (the turn's second spotlight costs a Fear).
  const fearState = await campaignFearState(ctx, campaign._id);
  const fearNow = fearState.fear;
  // AA2b (bead dcm-vv2 3 / 6): passives read the GM's Fear and the situations the GM confirmed.
  const passives = passiveSummary(block.effects, { ...adversaryState(instance), situations: args.situations ?? [] }, block.tier, rollDie, fearNow);
  const { spotlit, fear: spotlightFear } = spotlightFearFor(instance, encounter, others, block, passives, needsSpotlight);

  const experience = args.experience === undefined ? undefined : block.experiences.find((e) => e.name === args.experience);
  if (args.experience !== undefined && !experience) throw appError("INVALID", "The adversary has no such Experience.");
  const featureFear = use ? upfrontFear(use.costs, { self, tokens: instance.tokens ?? 0, tier: block.tier, gmFear: 0, rng: rollDie, ...(args.eitherCosts ? { eitherCosts: args.eitherCosts } : {}), ...(args.trigger?.amount !== undefined ? { trigger: { amount: args.trigger.amount } } : {}) }) : (manualFeature!.fearCost ?? featureFearCost(manualFeature!.text) ?? 0);
  const experienceFear = experience ? 1 : 0;
  const asked = spotlightFear + featureFear + experienceFear;
  if (asked > 0 && (args.spendFear ?? 0) < asked) return { status: "confirmFear", fear: asked, spotlight: spotlightFear, feature: featureFear, experience: experienceFear };
  if (asked > fearNow) throw appError("NOT_ENOUGH_FEAR");

  const scene = await actionScene(ctx, campaign, instance);
  const base = { encounter, self: instance, block, scene };
  const groupId = newGroupId();
  const w = new Work(instance, block, scene.party, others, encounter, fearState.sessionStartedAt);
  const label = instance.label;
  const featureName = args.feature ?? block.attack.name;

  if (!effect || !use) {
    // A feature without an effect entry: the GM resolves its text; Fear and the spotlight are paid here.
    const targets = (await resolveCreatures(ctx, base, args.targets, false)).picks;
    w.prompts.push({ kind: "manual", text: `${manualFeature!.name}: ${manualFeature!.text}` });
    w.fearDelta -= featureFear;
    return finish(ctx, { campaign, user, encounter, w, groupId, spotlight: needsSpotlight && !spotlit, spotlightFear, roll: null, success: true, outcomes: targets.map((t) => outcomeOf(t, true)), offers: [], publicText: `${label} used ${manualFeature!.name}`, gmText: [`${label} used ${manualFeature!.name} (no automation: the GM applies it)`], attackerFeature: manualFeature!.name });
  }

  const attack = isAttackUse(use);
  const targets = await resolveCreatures(ctx, base, args.targets, attack);
  const picked = (await resolveCreatures(ctx, base, args.picked ?? [], false)).picks;
  const allies = (await resolveCreatures(ctx, base, args.allies ?? [], false)).picks;
  const followUp = (await resolveCreatures(ctx, base, args.followUp ?? [], false)).picks;
  const byId = async (id: string | undefined) => (id === undefined ? undefined : (await resolveCreatures(ctx, base, [id], false)).picks[0]?.combatant);
  const source = await byId(args.trigger?.sourceId);
  const subject = await byId(args.trigger?.subjectId);
  const group = use.groupAttack ? await groupOf(ctx, instance, others, self) : [];

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
    advantage: (args.advantage ?? 0) + (attack && (passives.advantage ?? []).some((on) => on === "attack" || on === "any") ? 1 : 0),
    disadvantage: (args.disadvantage ?? 0) + (attack && targets.cover ? 1 : 0),
    ...(experience ? { experience } : {}),
    ...(group.length ? { group } : {}),
    hordeX: block.hordeX,
    attackDiceOnAttacks: true,
    passives,
    instance: instanceModifiers(instance),
    rng: rollDie,
  };
  const plan = runOrThrow(effect, context);
  w.absorb(plan, featureName);
  const attackKind = args.feature === undefined ? ("standard" as const) : ("feature" as const);

  // Reactions the GM opted into before the damage (Heavy Hitter, Overload; Q19 default No): their damage folds join the hits.
  const offers: Offer[] = [];
  if (w.hits.length > 0) {
    for (const t of triggered(w.block, w.instance, [{ kind: "onAttack", stage: "beforeDamage", attack: attackKind }])) {
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
          if (change.kind === "add") h.hit.amount += typeof s.amount === "number" ? s.amount : 0;
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
  for (const t of triggered(w.block, w.instance, events)) {
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

  const outcomes: TargetOutcome[] = targets.picks.map((p) => outcomeOf(p, plan.roll ? hitIds.has(p.combatant.id) : true));
  const hitNames = outcomes.filter((o) => o.hit).map((o) => w.nameOf(o.characterId ?? o.instanceId ?? ""));
  const missNames = outcomes.filter((o) => !o.hit).map((o) => w.nameOf(o.characterId ?? o.instanceId ?? ""));
  const what = args.feature === undefined ? "" : ` used ${args.feature}`;
  const publicText = plan.roll
    ? `${label}${what ? `${what}:` : ""} ${[hitNames.length ? `hit ${hitNames.join(", ")}` : "", missNames.length ? `missed ${missNames.join(", ")}` : ""].filter(Boolean).join("; ")}`
    : `${label}${what || ` used ${featureName}`}${outcomes.length ? ` on ${outcomes.map((o) => w.nameOf(o.characterId ?? o.instanceId ?? "")).join(", ")}` : ""}`;
  const gmText: string[] = [];
  if (plan.roll) {
    const vs = targets.picks.map((p) => `${w.nameOf(p.combatant.id)} ${p.combatant.evasion ?? p.combatant.difficulty ?? "?"}: ${hitIds.has(p.combatant.id) ? "hit" : "miss"}`);
    gmText.push(`${label} ${featureName}: ${words(plan.roll.record)}${plan.roll.critical ? " critical" : ""} vs ${vs.join(", ")}`);
  } else gmText.push(`${label} used ${featureName}`);
  if (spotlightFear > 0) gmText.push("1 Fear for the spotlight");
  if (experience) gmText.push(`Experience ${experience.name} +${experience.value} (1 Fear)`);
  for (const h of w.hits) gmText.push(`${w.nameOf(h.targetId)}: ${h.hit.amount} ${h.hit.type}${h.hit.direct ? " direct" : ""}${h.hit.forcedArmor ? `, ${h.hit.forcedArmor} forced Armor Slot` : ""}${h.riders.length ? `, ${h.riders.length} rider${h.riders.length === 1 ? "" : "s"} with the hit` : ""} (waiting for armor)`);
  w.fearDelta -= spotlightFear;
  return finish(ctx, { campaign, user, encounter, w, groupId, spotlight: needsSpotlight && !spotlit, spotlightFear: 0, roll: plan.roll?.record ?? null, success: plan.success, outcomes, offers, publicText, gmText, ...(args.feature !== undefined ? { attackerFeature: args.feature } : {}) });
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

/** Writes the action and logs its group: the GM row (roll, damage, `adversaryBefore`, Fear), the public row, then one incoming hit per hit PC. */
async function finish(ctx: MutationCtx, f: FinishInput): Promise<ActionResult> {
  const { w, campaign } = f;
  const log = { campaignId: campaign._id, actorId: f.user._id, groupId: f.groupId };
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
  const map = await liveCombatMap(ctx, campaign._id);
  const bands = await bandsOnMap(ctx, map?._id);
  const tokens = map ? await tokensOnMap(ctx, map._id) : [];
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
  for (const t of triggered(w.block, w.instance, events)) {
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
      rng: rollDie,
    });
    w.absorb(plan, t.effect.feature);
    lines.push(`${t.effect.feature} (automatic)`);
  }
  if (lines.length === 0) return;
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