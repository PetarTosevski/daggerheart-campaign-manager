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

import { pickAdversaryUse, standardAttackEffect, STANDARD_ATTACK_USE, upfrontFear, type AdversaryPlan, type AdversaryPlanStep, type AdversaryRunContext } from "../../src/lib/domain/adversary-effects/run";
import type { AdversaryFeatureEffect } from "../../src/lib/domain/adversary-effects/types";
import { actorWithSubject, featureReady, keptDie, passiveSummary, pcTarget, preRollFits, splitTargetDisadvantage, type AdversaryEvent } from "../../src/lib/domain/adversary-actions/index";
import { runFeature } from "../../src/lib/domain/feature-effects/run";
import type { FeatureEffect } from "../../src/lib/domain/feature-effects/types";
import { resolveOptions } from "../../src/lib/frames/options";
import { featureFearCost } from "../../src/lib/domain/adversaries/index";
import type { PlanStep } from "../../src/lib/domain/card-effects/run";
import type { Range } from "../../src/lib/domain/card-effects/types";
import { applyStressTo, lineOfSight, rangeCheck, type Combatant } from "../../src/lib/domain/combat-actions/index";
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
import { answeringFeatures, featureActor, featureChoices, featureReplayActor, seededRng, SPENT_DICE } from "./adversaryHits";
import { actorSheetAfter, pcCombatant, writeSheetChanges } from "./cardRunner";
import { saveSheet } from "./characterSheet";
import { closeRequest } from "./combatRequests";
import { liveCombatMap, tokensOnMap } from "./combatMaps";
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
import type { ActionTarget, AdversaryBefore, StoredRoll } from "./validators/actionLog";
import type { CombatResponse, HitRider, PreRollPayload } from "./validators/combatRequests";
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
  /** SD4 (Q2): the attack waits, unrolled, for before-roll answers in this `preRoll` request. */
  held?: Id<"combatRequests">;
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

/** Disadvantage sources a PC's passives put on an attack against them (CB p.68 Sturdy, at 1 HP left), by this attacker. */
function targetDisadvantage(p: Pick, instance: Doc<"encounterAdversaries">): number {
  if (p.kind !== "pc") return 0;
  return pcTarget(p.member.character._id, p.member.sheet, 0, { tags: instance.tags ?? [] }).disadvantage ?? 0;
}

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
  return args.trigger === undefined && empty(args.picked) && empty(args.allies) && empty(args.followUp) && empty(args.options) && empty(args.optionals) && empty(args.situations) && empty(args.eitherCosts) && empty(args.splits);
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
 * until `spendFear` covers them (Q19); NOT_ENOUGH_FEAR past the GM's Fear. Refusals: ADVERSARY_FEATURE_UNAVAILABLE,
 * ADVERSARY_NOT_SPOTLIT, COMBAT_TARGET_INVALID, COMBAT_NO_LINE_OF_SIGHT, ENCOUNTER_NOT_RUNNING, INVALID.
 */
export async function adversaryAction(ctx: MutationCtx, campaign: Doc<"campaigns">, user: Doc<"users">, args: ActionArgs, replay?: Replay): Promise<ActionResult | ConfirmFear> {
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
  const groupId = replay?.groupId ?? newGroupId();
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
  const advantage = (args.advantage ?? 0) + (attack && (passives.advantage ?? []).some((on) => on === "attack" || on === "any") ? 1 : 0);
  // DA1 (user 2026-10-30): one roll for every target (CB p.161), but a target's own disadvantage (CB p.68 Sturdy; HF p.14
  // Harrowing Invocation for the PCs it protected) counts only against that target. What every target carries counts for
  // the whole roll; the rest (`residual`) is read from the same pair of dice per target.
  const own = attack ? targets.picks.map((p) => ({ id: p.combatant.id, disadvantage: targetDisadvantage(p, instance) + (p.kind === "pc" ? (replay?.disadvantageAgainst[p.member.character._id] ?? 0) : 0) })) : [];
  const { common, residual } = splitTargetDisadvantage(own);
  const disadvantage = (args.disadvantage ?? 0) + (attack && targets.cover ? 1 : 0) + common;
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
    rng: rollDie,
  };
  // DA1: the runner reads the whole roll's die; a target that keeps a lower one meets its Evasion raised by the difference,
  // which is the same hit or miss as its own total against its own Evasion.
  const shifted = (p: Pick, from: number): Combatant =>
    residual.has(p.combatant.id) && p.combatant.evasion !== undefined ? { ...p.combatant, evasion: p.combatant.evasion + from - keptBy(p.combatant.id) } : p.combatant;
  // A natural 20 hits and is critical only for the targets that keep it (CB p.148): the others run again on their own
  // die (same damage dice); the first run alone pays the costs and changes the attacker.
  const lower = attack && natural === 20 ? targets.picks.filter((p) => keptBy(p.combatant.id) !== 20) : [];
  const lowerIds = new Set(lower.map((p) => p.combatant.id));
  const later: Rolled[] = [];
  let plan = attack
    ? runOrThrow(effect, { ...context, targets: targets.picks.filter((p) => !lowerIds.has(p.combatant.id)).map((p) => shifted(p, natural)), rng: presetDice(net !== 0 && second !== null ? [first, second] : [first], later) })
    : runOrThrow(effect, context);
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
  // DA1: each hit carries its target's own attack total (the window compares Evasion answers with it).
  if (plan.roll && residual.size > 0) {
    const modifier = plan.roll.record.total - natural;
    for (const h of w.hits) if (residual.has(h.targetId)) h.hit.attackTotal = keptBy(h.targetId) + modifier;
  }
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

  // SD4: the before-roll answers' after-effects. Harrowing Invocation (HF p.14): "If the adversary fails the roll, they
  // must also mark a Stress": the roll failed against any PC it protected (user 2026-10-30; SD4 had "every"). Drained
  // ends when the attack roll fails (misses every target; HF p.14 "until they fail a roll", user: attack rolls only).
  if (replay?.harrowed && plan.roll && replay.harrowed.subjects.some((id) => !hitIds.has(id))) {
    w.selfAfter = applyStressTo(w.selfAfter, 1).after;
    w.gm.push(`Harrowing Invocation: ${label} failed the roll and marks a Stress`);
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
    const ownRoll = (id: string) => (residual.has(id) ? ` (disadvantage against them: ${keptBy(id)}, total ${keptBy(id) + modifier}${keptBy(id) === 20 ? " critical" : ""})` : "");
    const vs = targets.picks.map((p) => `${w.nameOf(p.combatant.id)} ${p.combatant.evasion ?? p.combatant.difficulty ?? "?"}${ownRoll(p.combatant.id)}: ${hitIds.has(p.combatant.id) ? "hit" : "miss"}`);
    gmText.push(`${label} ${featureName}: ${words(roll)}${plan.roll.critical ? " critical" : ""} vs ${vs.join(", ")}`);
  } else gmText.push(`${label} used ${featureName}`);
  if (spotlightFear > 0) gmText.push("1 Fear for the spotlight");
  if (experience) gmText.push(`Experience ${experience.name} +${experience.value} (1 Fear)`);
  for (const h of w.hits) gmText.push(`${w.nameOf(h.targetId)}: ${h.hit.amount} ${h.hit.type}${h.hit.direct ? " direct" : ""}${h.hit.forcedArmor ? `, ${h.hit.forcedArmor} forced Armor Slot` : ""}${h.riders.length ? `, ${h.riders.length} rider${h.riders.length === 1 ? "" : "s"} with the hit` : ""} (waiting for armor)`);
  w.fearDelta -= spotlightFear;
  return finish(ctx, { campaign, user, encounter, w, groupId, spotlight: needsSpotlight && !spotlit, spotlightFear: 0, roll, success: plan.success, outcomes, offers, publicText, gmText, ...(args.feature !== undefined ? { attackerFeature: args.feature } : {}) });
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
