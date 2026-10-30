// The reaction window of an adversary hit (plan combat-actions, tracer AA1; user answers Q13, Q17, Q18). Pure state
// machine: the server (AA2) opens one per hit PC, records each answer through `respond`, and resolves it into the final
// HP / Stress / Armor / Hope marks with `resolveWindow` once `isComplete` (or on the GM's "Resolve now").
//
// Q13: "The hit PC's player chooses whether to mark an Armor Slot; the damage waits for that choice. Allies may respond
//   with their abilities (e.g. 'I Am Your Shield', CB p.341)". Q17 (a): "the reaction window closes when the target chose
//   armor and every eligible ally answered Use/Pass; the GM can 'Resolve now' anytime; no timer." The target needs no
//   answer when they have no usable Armor Slot and no eligible card (analysis B4).
// Q18 (a): with no live map, no range restriction: a card's range holds when the distance is unknown.
// CB p.341, I Am Your Shield: "When an ally within Very Close range would take damage, you can mark a Stress to stand in
//   the way and make yourself the target of the attack instead. When you take damage from this attack, you can mark any
//   number of Armor Slots." -> `redirect` to the ally (who then chooses armor) and `extraArmorSlots: any`.
// CB p.114: one Armor Slot per hit unless a card says otherwise; CB p.99: none on direct damage.
//
// The state is a plain object (no functions), so the server can rebuild it from the stored row: `openWindow` with the
// party as it was, then `respond` for every stored answer in order (with the folds the card produced).
//
// ```ts
// let w = openWindow({ hit, targetId: "mira", party });     // responders: Mira (armor), Bram (I Am Your Shield)
// w = expectOk(respond(w, { characterId: "bram", choice: { kind: "card", cardId: "i-am-your-shield" }, folds }));
// w = expectOk(respond(w, { characterId: "bram", choice: { kind: "armor", slots: 2 } }));
// isComplete(w);                                             // true
// resolveWindow(w, party);                                   // Bram takes the hit with 2 slots
// ```

import { cardAvailability, resolveCosts, unaffordable } from "../card-effects/availability";
import { pickUse, run as runCard, type ActorState, type PlanStep, type RunPlan, type RunResult } from "../card-effects/run";
import type { CardEffect, CardUse, NumberChoice, Range, Step, Trigger } from "../card-effects/types";
import { asCardEffect, runFeature, type FeatureRunResult } from "../feature-effects/run";
import type { FeatureEffect } from "../feature-effects/types";
import type { Combatant } from "../combat-actions/damage";
import { withinRange } from "../combat-actions/distance";
import type { Rng } from "../dice/index";
import type { FeatureUse } from "../../validation/characters";
import { applyHitToPc, armorOptions, damageBeforeArmor, stepDown, type HitAdjustments, type PcDefense, type PcHit, type PcHitResult, type PcSeverity } from "./severity";

// ---------------------------------------------------------------- inputs

/** One hit waiting in the window (the incoming-hit payload's numbers, plus what the engine may know about the roll). */
export interface WindowHit extends PcHit {
  /** The attacking instance (for "Bandit hit Mira" and reflected damage). */
  attackerId: string;
  critical: boolean;
  /** The attack roll's total, when kept (a reaction that raises Evasion compares against it). Never shown to players (Q14). */
  attackTotal?: number;
  /** The attacker's band from the target (`from: "melee"` cards); unknown = any (Q18). */
  attackerBand?: Range;
  /**
   * The hit carries a condition rider for whoever takes it (AA2b: Bite's Restrained moves with the damage), so the target
   * may answer a `wouldGainCondition` reaction (Bold Presence, CB p.341: "When you would gain a condition").
   */
  conditionRiders?: boolean;
}

/** A PC at the table, as the window needs them: defenses, Evasion, loadout cards with effects, and distance to the target. */
export interface WindowPc extends PcDefense {
  readonly evasion?: number;
  /** The sheet's feature uses (once-per cards, CB p.101). */
  readonly featureUses?: readonly FeatureUse[];
  /** Loadout cards that have an effect entry (`CARD_EFFECTS`); cards without one can't answer. */
  readonly cards: readonly CardEffect[];
  /** The band from this PC to the hit's target; unknown (no map) = any range (Q18). */
  readonly bandToTarget?: Range;
  /**
   * SD4 (plan sheet-drawer): the PC as the card runner's actor (resources, Favor, Focus, held dice, facts such as
   * Flying). Features answer only with it; absent = no feature answers.
   */
  readonly actor?: ActorState;
  /** SD4: the features the PC holds that have an effect entry (upgrades applied, `owned()` + FE-* tables). */
  readonly features?: readonly FeatureEffect[];
  /** SD4: the band from this PC to the attacker (Not This Time "within Far", Q3); unknown = any range (Q18). */
  readonly bandToAttacker?: Range;
}

/** Who must or may answer (the stored `HitResponder`): the target (armor) or an ally with an eligible reaction card. */
export interface Responder {
  characterId: string;
  role: "target" | "ally";
  cardIds: string[];
  /** SD4: the features with a reaction use that may answer this hit (feature ids, `<source>:<owner>:<slug>`). */
  featureIds?: string[];
}

/** An answer (the stored `HitChoice`). */
export type HitChoice =
  | { kind: "armor"; slots?: number }
  | { kind: "noArmor" }
  | { kind: "card"; cardId: string; useId?: string }
  /** SD4: a feature's reaction use (the stored `preRollFeatureChoiceValidator` shape; `choices` as `useFeature`'s). */
  | { kind: "feature"; featureId: string; useId?: string; choices?: readonly unknown[] }
  | { kind: "pass" };

/**
 * What a reaction card does to the hit, from its run plan's `fold` steps (`foldsFromPlan`). `redirect`: the card's user
 * becomes the target; `reflect`: the damage goes to the attacker or a picked creature instead (the target takes none).
 */
export type Fold =
  | { kind: "redirect"; to: string }
  | { kind: "reflect"; to: "attacker" | "picked"; targetIds: string[] }
  | { kind: "extraArmorSlots"; max: number | "any"; targetIds: string[] }
  | { kind: "reduceSeverity"; steps: number; targetIds: string[] }
  | { kind: "reduceDamage"; amount: number; targetIds: string[] }
  | { kind: "negateDamage" }
  | { kind: "negateAttack" }
  /** AA2b: the hit's condition riders don't land (Bold Presence). */
  | { kind: "negateCondition" }
  | { kind: "evasion"; amount: number; targetIds: string[] }
  | { kind: "convert"; into: "stress" | "hope"; targetIds: string[] }
  /** SD4 (NV4): "mark N fewer / more Hit Points" after the thresholds (Scales, Thick Skin, Dark Aegis). */
  | { kind: "hpMarked"; delta: number; targetIds: string[] }
  /** SD4: the attacker rerolls its attack (Not This Time, Danger Sense); the server rolls it (`attackRoll`). */
  | { kind: "rerollAttack" }
  /** SD4: the attacker rerolls its damage (Not This Time); the server rolls it (`damageRoll`). */
  | { kind: "rerollDamage" }
  /** SD4: the attack roll as rerolled by the server: the new result stands (CB p.107). */
  | { kind: "attackRoll"; total: number; critical: boolean }
  /** SD4: the damage as rerolled by the server: the new result stands (CB p.107). */
  | { kind: "damageRoll"; amount: number }
  | { kind: "manual"; text: string };

export interface WindowResponse {
  characterId: string;
  choice: HitChoice;
  /** For a `card` answer: what it does to the hit (`foldsFromPlan` of the card's run). */
  folds?: readonly Fold[];
}

export interface WindowState {
  hit: WindowHit;
  /** The PC first hit. */
  originalTargetId: string;
  /** Whoever takes the hit now (changes on a `redirect`). */
  targetId: string;
  responders: Responder[];
  responses: WindowResponse[];
  /** Per PC: could mark at least one Armor Slot for its benefit on this hit (free slot, not direct, no Frenzy). */
  armorCapable: Record<string, boolean>;
  /** Responders no longer owed an answer (the first target after a redirect). */
  released: string[];
  /** `resolveNow`: the GM closed it early (Q17). */
  closedEarly: boolean;
  /** SD4: the party as opened (features answer from it: what fits now depends on the answers so far). */
  party?: readonly WindowPc[];
  /** SD4: the attacker as a creature (a feature answer's trigger source). */
  attacker?: Combatant;
}

// ---------------------------------------------------------------- eligibility

const reaches = (band: Range | undefined, range: Range) => band === undefined || withinRange(band, range);

/** Whether a reaction card's trigger fits this hit for this PC (Q13). Unknown bands pass (Q18). */
export function triggerFits(trigger: Trigger, role: "target" | "ally", pc: WindowPc, hit: WindowHit, severityBefore: PcSeverity, armorCapable: boolean): boolean {
  const typeOk = (t: "physical" | "magic" | undefined) => t === undefined || hit.type === t || hit.type === "both";
  const fromOk = (from: "melee" | "beyondMelee" | undefined) =>
    from === undefined || hit.attackerBand === undefined || (from === "melee" ? hit.attackerBand === "melee" : hit.attackerBand !== "melee");
  switch (trigger.kind) {
    case "whenAllyWouldTakeDamage":
      return role === "ally" ? reaches(pc.bandToTarget, trigger.range) : trigger.includeSelf === true;
    case "whenYouWouldTakeDamage":
      return role === "target" && typeOk(trigger.damageType) && (trigger.severity === undefined || trigger.severity === severityBefore) && fromOk(trigger.from);
    case "whenAttacked":
      return role === "target" && (trigger.stage === "rolled" || trigger.stage === "succeeded") && typeOk(trigger.damageType) && fromOk(trigger.from);
    case "whenArmorSlotMarked":
      return role === "target" && trigger.who === "self" && armorCapable;
    case "wouldGainCondition":
      return role === "target" && hit.conditionRiders === true;
    // SD4 (NV6): an attack aimed at you or an ally, after its roll (Danger Sense, Not This Time; Q2, Q3). The
    // `targeted` stage is before the roll: the `preRoll` prompt's (`preRollFits`), never the window's.
    case "whenCreatureAttacked": {
      if (trigger.stage !== "rolled" && trigger.stage !== "succeeded") return false;
      const subjectOk =
        role === "target"
          ? trigger.subject === "self" || trigger.subject === "selfOrAlly"
          : (trigger.subject === "ally" || trigger.subject === "selfOrAlly") && (trigger.subjectWithin === undefined || reaches(pc.bandToTarget, trigger.subjectWithin));
      return subjectOk && (trigger.attackerWithin === undefined || reaches(pc.bandToAttacker, trigger.attackerWithin));
    }
    default:
      return false;
  }
}

/**
 * SD4 (Q2): whether a before-roll trigger (`targeted` stage) fits an adversary attack for this PC: `whenAttacked` when the
 * PC is one of the targets; `whenCreatureAttacked` when a target is the PC (`self`) or an ally within `subjectWithin` of
 * them (`ally`), and the attacker is within `attackerWithin`. Unknown bands pass (Q18). Returns the fitting target ids.
 */
export function preRollFits(trigger: Trigger, pcId: string, targets: readonly { id: string; band?: Range }[], bandToAttacker?: Range): string[] {
  if (trigger.kind === "whenAttacked") return trigger.stage === "targeted" && targets.some((t) => t.id === pcId) ? [pcId] : [];
  if (trigger.kind !== "whenCreatureAttacked" || trigger.stage !== "targeted") return [];
  if (trigger.attackerWithin !== undefined && !reaches(bandToAttacker, trigger.attackerWithin)) return [];
  return targets
    .filter((t) =>
      t.id === pcId
        ? trigger.subject === "self" || trigger.subject === "selfOrAlly"
        : (trigger.subject === "ally" || trigger.subject === "selfOrAlly") && (trigger.subjectWithin === undefined || reaches(t.band, trigger.subjectWithin)),
    )
    .map((t) => t.id);
}

/** Whether a card use can be paid with fixed amounts now (Hope, free Stress / HP / Armor slots; CB p.90). */
function affordable(use: CardUse, pc: WindowPc): boolean {
  const paid = resolveCosts(use.costs ?? [], (c) => (c.amount.kind === "fixed" ? c.amount.value : 0));
  return (
    unaffordable(paid, {
      hope: pc.hope ?? 0,
      stress: pc.stress,
      stressMax: pc.stressMax,
      hp: pc.hp,
      hpMax: pc.hpMax,
      armor: pc.armor,
      armorMax: pc.armorMax,
      cardTokens: Infinity,
    }).length === 0
  );
}

/** The loadout cards with a ready, affordable reaction use whose trigger fits (the responder's `cardIds`). */
export function eligibleCards(pc: WindowPc, role: "target" | "ally", hit: WindowHit, severityBefore: PcSeverity, armorCapable: boolean): string[] {
  const out: string[] = [];
  for (const card of pc.cards) {
    const fits = card.uses.some(
      (use) =>
        use.activation.kind === "reaction" &&
        triggerFits(use.activation.trigger, role, pc, hit, severityBefore, armorCapable) &&
        (!use.limit || cardAvailability(pc, card.cardId, { useId: use.id, limit: use.limit }).state === "ready") &&
        affordable(use, pc),
    );
    if (fits && !out.includes(card.cardId)) out.push(card.cardId);
  }
  return out;
}

// ---------------------------------------------------------------- feature answers (SD4)

/** One feature use a PC may answer with now. */
export interface FeatureAnswer {
  featureId: string;
  useId: string;
}

/** The trigger's creatures for a feature run: the PC who would take the damage and the attacker. */
export interface TriggerCreatures {
  subject?: Combatant;
  source?: Combatant;
}

/** Every `situation` text of a use (the dry run confirms them: a check the engine can read still decides, Q13). */
function situationTexts(use: CardUse): string[] {
  return (use.requires ?? []).flatMap((r) => (r.kind === "situation" ? [r.text] : []));
}

/** The smallest numbers a use's choices take (the dry run's choices; Prayer Dice: one die). */
function minimalChoices(use: CardUse): Record<string, number> {
  return Object.fromEntries((use.choices ?? []).map((c: NumberChoice) => [c.id, Math.max(0, c.min)]));
}

/** The actor with the trigger's subject as a fact (Loyal Protector, CB p.36: "an ally … has 2 or fewer Hit Points"). */
export function actorWithSubject(actor: ActorState, subject: Combatant | undefined): ActorState {
  if (!subject) return actor;
  return { ...actor, facts: { ...(actor.facts ?? {}), subject: { conditions: subject.conditions, ...(subject.tags ? { tags: subject.tags } : {}), hp: subject.hp, hpMax: subject.hpMax } } };
}

/**
 * Whether a feature use can go ahead for this trigger (a dry run through SD1's `runFeature` with the lowest dice and the
 * smallest choices): its limit is ready (CB p.101), its costs are affordable (Favor, Focus, held dice included), its
 * requirements hold (Wings' Flying, Q16). A refusal only for a missing choice still counts: the player picks it.
 */
export function featureReady(effect: FeatureEffect, use: CardUse, actor: ActorState, trigger: TriggerCreatures & { amount: number }): boolean {
  const result = runFeature(effect, use.id, {
    actor: actorWithSubject(actor, trigger.subject),
    gmFear: 0,
    choices: minimalChoices(use),
    situations: situationTexts(use),
    trigger: { amount: trigger.amount, ...(trigger.subject ? { subject: trigger.subject } : {}), ...(trigger.source ? { source: trigger.source } : {}) },
    rng: () => 1,
  });
  return result.ok || result.reason === "choice";
}

/** Whether a use's trigger has a severity filter (Thick Skin, Scales): the only answers left after the armor answer. */
const severityGated = (trigger: Trigger) => (trigger.kind === "whenYouWouldTakeDamage" || trigger.kind === "whenYouTakeDamage") && trigger.severity !== undefined;

/**
 * The feature uses this PC may answer the hit with now (SD4): `reaction` uses whose trigger fits the hit's current state
 * (`severityNow`: the severity after the answers so far, CB p.107 "the player … can apply the effects in any order"),
 * ready and affordable. `afterArmor`: the target already answered armor, so only severity-gated answers are left.
 */
export function eligibleFeatures(
  pc: WindowPc,
  role: "target" | "ally",
  hit: WindowHit,
  severityNow: PcSeverity,
  armorCapable: boolean,
  trigger: TriggerCreatures & { amount: number },
  afterArmor = false,
): FeatureAnswer[] {
  if (!pc.actor) return [];
  const out: FeatureAnswer[] = [];
  for (const effect of pc.features ?? []) {
    for (const use of effect.uses) {
      if (use.activation.kind !== "reaction") continue;
      if (afterArmor && !severityGated(use.activation.trigger)) continue;
      if (!triggerFits(use.activation.trigger, role, pc, hit, severityNow, armorCapable)) continue;
      if (!featureReady(effect, use, pc.actor, trigger)) continue;
      out.push({ featureId: effect.featureId, useId: use.id });
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- the hit so far (SD4)

/** The hit as the answers so far left it: damage after reductions and rerolls, its severity now, the armor answered. */
export interface HitProgress {
  amount: number;
  /** Severity against the target's thresholds after the damage changes, Armor Slots and severity steps so far. */
  severity: PcSeverity;
  armorAnswered: boolean;
}

const applies = (targetIds: readonly string[], state: WindowState) =>
  targetIds.length === 0 || targetIds.includes(state.targetId) || targetIds.includes(state.originalTargetId);

/** The damage after the answers so far: a rerolled damage replaces it (CB p.107), reductions come off it. */
function amountNow(state: WindowState, folds: readonly Fold[]): number {
  let amount = state.hit.amount;
  for (const f of folds) if (f.kind === "damageRoll") amount = f.amount;
  const reduce = folds.reduce((n, f) => n + (f.kind === "reduceDamage" && applies(f.targetIds, state) ? f.amount : 0), 0);
  return Math.max(0, amount - reduce);
}

/** The hit now for the current target (SD4): what the next answer's trigger reads. */
export function progress(state: WindowState, target: PcDefense): HitProgress {
  const folds = state.responses.flatMap((r) => r.folds ?? []);
  const amount = amountNow(state, folds);
  const armorAnswer = state.responses.find((r) => r.characterId === state.targetId && isArmorAnswer(r.choice));
  const slots = armorAnswer?.choice.kind === "armor" ? Math.max(1, armorAnswer.choice.slots ?? 1) : 0;
  const steps = folds.reduce((n, f) => n + (f.kind === "reduceSeverity" && applies(f.targetIds, state) ? f.steps : 0), 0);
  const before = damageBeforeArmor(target, { ...state.hit, amount }).severity;
  return { amount, severity: stepDown(stepDown(before, slots), steps), armorAnswered: armorAnswer !== undefined };
}

/**
 * The feature uses `characterId` may still answer with (SD4): eligible now and not played yet in this window. Only a
 * responder listed with that feature, still owed an answer (or the target after armor, for severity-gated answers).
 */
export function featureAnswers(state: WindowState, characterId: string): FeatureAnswer[] {
  const responder = state.responders.find((r) => r.characterId === characterId);
  const pc = state.party?.find((p) => p.id === characterId);
  const target = state.party?.find((p) => p.id === state.targetId);
  if (!responder || !pc || !target || (responder.featureIds ?? []).length === 0 || state.closedEarly || state.released.includes(characterId)) return [];
  const mine = state.responses.filter((x) => x.characterId === characterId);
  const role = characterId === state.targetId ? "target" : "ally";
  if (role === "ally" && mine.length > 0) return [];
  if (role === "target" && mine.some((x) => x.choice.kind === "pass" || x.choice.kind === "noArmor")) return [];
  const now = progress(state, target);
  const played = new Set(mine.flatMap((x) => (x.choice.kind === "feature" ? [x.choice.featureId] : [])));
  const hit = { ...state.hit, amount: now.amount };
  const creatures: TriggerCreatures = { ...(target.actor ? { subject: target.actor } : {}), ...(state.attacker ? { source: state.attacker } : {}) };
  return eligibleFeatures(pc, role, hit, now.severity, state.armorCapable[characterId] ?? false, { amount: now.amount, ...creatures }, role === "target" && now.armorAnswered).filter(
    (f) => (responder.featureIds ?? []).includes(f.featureId) && !played.has(f.featureId),
  );
}

// ---------------------------------------------------------------- the machine

export interface OpenInput {
  hit: WindowHit;
  targetId: string;
  /** Every PC in the scene, the target included. */
  party: readonly WindowPc[];
  /** SD4: the attacker as a creature (a feature's trigger source: Revenge, Not This Time); absent = unknown. */
  attacker?: Combatant;
}

const SEVERITIES: readonly PcSeverity[] = ["severe", "major", "minor"];

/** The feature ids a PC may answer this hit with at some point (SD4): now, or (the target) after the armor answer. */
function featureIdsAtOpen(pc: WindowPc, role: "target" | "ally", hit: WindowHit, severity: PcSeverity, armorCapable: boolean, creatures: TriggerCreatures): string[] {
  const ids = new Set(eligibleFeatures(pc, role, hit, severity, armorCapable, { amount: hit.amount, ...creatures }).map((f) => f.featureId));
  if (role === "target" && armorCapable) {
    // Armor (or a severity step) lowers the severity: Thick Skin on a Major hit marked down to Minor (CB p.107 order).
    for (const lower of SEVERITIES.slice(SEVERITIES.indexOf(severity) + 1)) {
      for (const f of eligibleFeatures(pc, role, hit, lower, armorCapable, { amount: hit.amount, ...creatures }, true)) ids.add(f.featureId);
    }
  }
  return [...ids];
}

/**
 * Opens the window (Q13): the target is a responder when they can mark an Armor Slot or hold an eligible card or
 * feature; every other PC with an eligible card or feature is an ally responder. A window with no responder is
 * complete at once.
 */
export function openWindow(input: OpenInput): WindowState {
  const { hit, targetId, party } = input;
  const armorCapable: Record<string, boolean> = {};
  for (const pc of party) armorCapable[pc.id] = armorOptions(pc, hit).canUseArmor;
  const target = party.find((p) => p.id === targetId);
  const responders: Responder[] = [];
  if (target) {
    const severity = damageBeforeArmor(target, hit).severity;
    const creatures: TriggerCreatures = { ...(target.actor ? { subject: target.actor } : {}), ...(input.attacker ? { source: input.attacker } : {}) };
    const cards = eligibleCards(target, "target", hit, severity, armorCapable[target.id] ?? false);
    const features = featureIdsAtOpen(target, "target", hit, severity, armorCapable[target.id] ?? false, creatures);
    if (armorCapable[target.id] || cards.length > 0 || features.length > 0) responders.push({ characterId: target.id, role: "target", cardIds: cards, ...(features.length > 0 ? { featureIds: features } : {}) });
    for (const pc of party) {
      if (pc.id === targetId) continue;
      const allyCards = eligibleCards(pc, "ally", hit, severity, armorCapable[pc.id] ?? false);
      const allyFeatures = featureIdsAtOpen(pc, "ally", hit, severity, armorCapable[pc.id] ?? false, creatures);
      if (allyCards.length > 0 || allyFeatures.length > 0) responders.push({ characterId: pc.id, role: "ally", cardIds: allyCards, ...(allyFeatures.length > 0 ? { featureIds: allyFeatures } : {}) });
    }
  }
  return { hit, originalTargetId: targetId, targetId, responders, responses: [], armorCapable, released: [], closedEarly: false, party, ...(input.attacker ? { attacker: input.attacker } : {}) };
}

const isArmorAnswer = (c: HitChoice) => c.kind === "armor" || c.kind === "noArmor" || c.kind === "pass";

/**
 * The responders still owed an answer: the target until they answer armor (and, SD4, after armor while a severity-gated
 * feature they hold fits the hit now, until they use it or pass: Thick Skin after the slot made it Minor, CB p.107); an
 * ally until any answer (Q17).
 */
export function awaiting(state: WindowState): string[] {
  if (state.closedEarly) return [];
  return state.responders
    .filter((r) => {
      if (state.released.includes(r.characterId)) return false;
      const mine = state.responses.filter((x) => x.characterId === r.characterId);
      if (r.role === "target") {
        if (!mine.some((x) => isArmorAnswer(x.choice))) return true;
        if (mine.some((x) => x.choice.kind === "pass" || x.choice.kind === "noArmor")) return false;
        return (r.featureIds ?? []).length > 0 && featureAnswers(state, r.characterId).length > 0;
      }
      return mine.length === 0;
    })
    .map((r) => r.characterId);
}

/** Complete when nobody is owed an answer, or the GM resolved it early (Q17 a, no timer). */
export function isComplete(state: WindowState): boolean {
  return state.closedEarly || awaiting(state).length === 0;
}

/** The GM's "Resolve now" (Q17): closes the window; whoever hasn't answered takes no armor and plays no card. */
export function resolveNow(state: WindowState): WindowState {
  return { ...state, closedEarly: true };
}

export type RespondResult = { ok: true; state: WindowState } | { ok: false; code: "REQUEST_NOT_OPEN" | "NOT_A_RESPONDER"; detail: string };

/**
 * Records one answer. The target answers armor / noArmor (`pass` counts as noArmor) once, and may play eligible cards
 * and (SD4) features before that, and severity-gated features after it (then `pass` ends their turn); an ally answers once, with a card or `pass`. A card's `redirect` fold makes its user the target, who then
 * owes an armor answer if they can mark a slot (the first target is released). Errors: REQUEST_NOT_OPEN (complete),
 * NOT_A_RESPONDER (not listed, already answered, or a card they weren't offered).
 */
export function respond(state: WindowState, response: WindowResponse, options: { replay?: boolean } = {}): RespondResult {
  const who = response.characterId;
  const responder = state.responders.find((r) => r.characterId === who);
  // SD4: a stored answer replays without the "owed now" checks (they read today's sheets: Thick Skin's Stress is paid).
  if (!options.replay) {
    if (isComplete(state)) return { ok: false, code: "REQUEST_NOT_OPEN", detail: "The window is closed." };
    if (!responder || !awaiting(state).includes(who)) return { ok: false, code: "NOT_A_RESPONDER", detail: who };
  } else if (!responder) return { ok: false, code: "NOT_A_RESPONDER", detail: who };
  if (!responder) return { ok: false, code: "NOT_A_RESPONDER", detail: who };
  const choice = response.choice;
  if (responder.role === "ally" && (choice.kind === "armor" || choice.kind === "noArmor")) return { ok: false, code: "NOT_A_RESPONDER", detail: "Only the target marks armor." };
  // SD4: after the armor answer the target may still answer a severity-gated feature, or pass; nothing else.
  const armorDone = responder.role === "target" && state.responses.some((x) => x.characterId === who && isArmorAnswer(x.choice));
  if (armorDone && choice.kind !== "feature" && choice.kind !== "pass") return { ok: false, code: "NOT_A_RESPONDER", detail: "The armor answer is in." };
  if (choice.kind === "card") {
    const played = state.responses.some((x) => x.characterId === who && x.choice.kind === "card" && x.choice.cardId === choice.cardId);
    if (!responder.cardIds.includes(choice.cardId) || played) return { ok: false, code: "NOT_A_RESPONDER", detail: choice.cardId };
  }
  if (choice.kind === "feature") {
    const played = state.responses.some((x) => x.characterId === who && x.choice.kind === "feature" && x.choice.featureId === choice.featureId);
    if (!(responder.featureIds ?? []).includes(choice.featureId) || played) return { ok: false, code: "NOT_A_RESPONDER", detail: choice.featureId };
  }
  let next: WindowState = { ...state, responses: [...state.responses, { ...response, ...(response.folds ? { folds: [...response.folds] } : {}) }] };
  const redirect = (response.folds ?? []).find((f): f is Extract<Fold, { kind: "redirect" }> => f.kind === "redirect");
  if ((choice.kind === "card" || choice.kind === "feature") && redirect && redirect.to !== next.targetId) {
    const newTarget = redirect.to;
    const canArmor = next.armorCapable[newTarget] ?? false;
    const old = next.targetId;
    next = {
      ...next,
      targetId: newTarget,
      released: [...new Set([...next.released, old])],
      responders: next.responders
        .map((r) => (r.characterId === old ? { ...r, role: "ally" as const } : r.characterId === newTarget ? { ...r, role: "target" as const } : r))
        .concat(next.responders.some((r) => r.characterId === newTarget) ? [] : [{ characterId: newTarget, role: "target" as const, cardIds: [] as string[] }]),
    };
    // The new target owes an armor answer only if they can mark a slot; otherwise their card was their answer.
    if (!canArmor) next = { ...next, responses: [...next.responses, { characterId: newTarget, choice: { kind: "noArmor" } }] };
  }
  return { ok: true, state: next };
}

// ---------------------------------------------------------------- folds from a card's run

/**
 * Turns a reaction card's (or, SD4, feature's) run plan into folds on the hit (I Am Your Shield: redirect +
 * extraArmorSlots any). `amountNow`: the damage the trigger carried, so a halving (Increased Fortitude, CB p.55; rounded
 * up, Q6, CB p.107) folds as the damage it removes.
 */
export function foldsFromPlan(plan: Pick<RunPlan, "steps">, responderId: string, amountNow?: number): Fold[] {
  const out: Fold[] = [];
  for (const s of plan.steps as readonly PlanStep[]) {
    if (s.kind !== "fold") continue;
    const step = s.step;
    switch (step.kind) {
      case "redirectDamage":
        if (step.target === "self") out.push({ kind: "redirect", to: responderId });
        else out.push({ kind: "negateDamage" }, { kind: "reflect", to: step.target === "triggerSource" ? "attacker" : "picked", targetIds: s.targetIds });
        break;
      case "extraArmorSlots":
        out.push({ kind: "extraArmorSlots", max: s.amount === "any" ? "any" : (s.amount ?? 1), targetIds: s.targetIds });
        break;
      case "reduceSeverity":
        out.push({ kind: "reduceSeverity", steps: typeof s.amount === "number" ? s.amount : step.steps, targetIds: s.targetIds });
        break;
      case "reduceDamage":
        out.push({ kind: "reduceDamage", amount: typeof s.amount === "number" ? s.amount : 0, targetIds: s.targetIds });
        break;
      case "negate":
        if (step.what === "damage") out.push({ kind: "negateDamage" });
        else if (step.what === "attack") out.push({ kind: "negateAttack" });
        else if (step.what === "condition") out.push({ kind: "negateCondition" });
        else out.push({ kind: "manual", text: step.note ?? `Negate ${step.what}` });
        break;
      case "modifyRoll":
        if (step.change.kind === "fail") out.push({ kind: "negateAttack" });
        else if (step.change.kind === "evasion") out.push({ kind: "evasion", amount: typeof s.amount === "number" ? s.amount : 0, targetIds: s.targetIds });
        // SD4: "force an adversary to reroll an attack" (Danger Sense, CB p.63; Not This Time, CB p.50).
        else if (step.change.kind === "reroll" && step.to === "triggerSource") out.push({ kind: "rerollAttack" });
        else out.push({ kind: "manual", text: step.note ?? `Change the roll (${step.change.kind})` });
        break;
      case "modifyDamage":
        // SD4: halve the incoming damage (Increased Fortitude, Damage Sink; Q6 round up); the attacker's damage reroll.
        if (step.change.kind === "halve" && typeof s.amount === "number" && amountNow !== undefined) out.push({ kind: "reduceDamage", amount: Math.max(0, amountNow - s.amount), targetIds: s.targetIds });
        else if (step.change.kind === "reroll" && step.to === "triggerSource") out.push({ kind: "rerollDamage" });
        else out.push({ kind: "manual", text: step.note ?? `Change the damage (${step.change.kind})` });
        break;
      case "adjustHpMarked":
        out.push({ kind: "hpMarked", delta: (step.change === "fewer" ? -1 : 1) * (typeof s.amount === "number" ? s.amount : 0), targetIds: s.targetIds });
        break;
      case "convertMarks":
        if (step.from === "hp" && (step.into === "stress" || step.into === "hope")) out.push({ kind: "convert", into: step.into, targetIds: s.targetIds });
        else out.push({ kind: "manual", text: step.note ?? `Mark ${step.into} instead of ${step.from}` });
        break;
      default:
        out.push({ kind: "manual", text: step.note ?? step.kind });
    }
  }
  return out;
}

/**
 * Runs a reaction card for this window (CA1's `run`) with the hit as its trigger: `subject` the PC who would take the
 * damage, `source` the attacker, `amount` the damage. Returns the run and, when it went ahead, the folds to pass to
 * `respond`. The server pays the plan's costs (`plan.actor.after`) when it records the answer.
 */
export function runReactionCard(
  card: CardEffect,
  actor: ActorState,
  state: WindowState,
  creatures: { target: Combatant; attacker?: Combatant },
  rng: Rng,
  useId?: string,
): { result: RunResult; folds: Fold[] } {
  const reactionUse = useId ?? card.uses.find((u) => u.activation.kind === "reaction")?.id;
  const result = runCard(card, {
    actor,
    gmFear: 0,
    ...(reactionUse ? { useId: reactionUse } : {}),
    trigger: { amount: state.hit.amount, subject: creatures.target, ...(creatures.attacker ? { source: creatures.attacker } : {}) },
    rng,
  });
  return { result, folds: result.ok ? foldsFromPlan(result.plan, actor.id) : [] };
}

/**
 * SD4: runs a feature's reaction use for this window (SD1's `runFeature`) with the hit as its trigger: `subject` the PC
 * who would take the damage, `source` the attacker, `amount` the damage as the answers so far left it. Choices as
 * `useFeature` reads them. Returns the run and, when it went ahead, the folds to pass to `respond`.
 */
export function runReactionFeature(
  effect: FeatureEffect,
  actor: ActorState,
  state: WindowState,
  creatures: { target: Combatant; attacker?: Combatant },
  rng: Rng,
  options: { useId?: string; amount?: number; choices?: Readonly<Record<string, number>>; options?: Readonly<Record<string, readonly string[]>>; optionals?: readonly string[]; situations?: readonly string[] } = {},
): { result: FeatureRunResult; folds: Fold[] } {
  const useId = options.useId ?? effect.uses.find((u) => u.activation.kind === "reaction")?.id;
  const amount = options.amount ?? state.hit.amount;
  const result = runFeature(effect, useId, {
    actor: actorWithSubject(actor, creatures.target),
    gmFear: 0,
    ...(options.choices ? { choices: options.choices } : {}),
    ...(options.options ? { options: options.options } : {}),
    ...(options.optionals ? { optionals: options.optionals } : {}),
    situations: options.situations ?? [],
    trigger: { amount, subject: creatures.target, ...(creatures.attacker ? { source: creatures.attacker } : {}) },
    rng,
  });
  return { result, folds: result.ok ? foldsFromPlan(result.plan, actor.id, amount) : [] };
}

/** The `choose` steps of a use the player must pick (Not This Time's attack or damage, Not Done Yet's Hope or Stress). */
export function chooseSteps(use: CardUse): Extract<Step, { kind: "choose" }>[] {
  return use.steps.filter((s): s is Extract<Step, { kind: "choose" }> => s.kind === "choose");
}

/** The `optional` steps of a use the player may take (Draining Bane's "you can clear a Stress"). */
export function optionalSteps(use: CardUse): Extract<Step, { kind: "optional" }>[] {
  return use.steps.filter((s): s is Extract<Step, { kind: "optional" }> => s.kind === "optional");
}

/** A feature's use by id (default its first reaction use). */
export function featureUse(effect: FeatureEffect, useId?: string): CardUse | undefined {
  return useId === undefined ? effect.uses.find((u) => u.activation.kind === "reaction") : pickUse(asCardEffect(effect), useId);
}

// ---------------------------------------------------------------- resolution

export interface WindowResolution {
  originalTargetId: string;
  /** Who took the hit (after any redirect). */
  targetId: string;
  /** A fold turned the hit into a miss (Bone-Touched; an Evasion bonus that beats the roll). */
  missed: boolean;
  /** The PC took nothing: missed, negated or reflected. */
  negated: boolean;
  /** The marks; null when missed. */
  result: PcHitResult | null;
  /** Damage sent elsewhere by a reflecting card (Arcane Reflection, Redirect): the server deals it. */
  reflected: { to: "attacker" | "picked"; targetIds: string[]; amount: number }[];
  /** Fold texts the engine can't apply (shown to the table). */
  manual: string[];
  /** The armor answer used. */
  armorSlotsChosen: number;
  /** AA2b: a card answer (Bold Presence) keeps the hit's condition riders off the target. */
  conditionNegated: boolean;
}

/**
 * The hit's final marks (AR3-AR5): the target's armor answer (none if they didn't answer before "Resolve now"), every
 * answer's folds in order, then `applyHitToPc`. Misses on a `negateAttack` fold, or when the attack total (rerolled by
 * an `attackRoll` fold, SD4: the new result stands, CB p.107) is below the Evasion plus any Evasion bonus (a critical
 * still hits, CB p.148). SD4: a rerolled damage replaces the amount; halvings and reductions come off it before the
 * thresholds; "N fewer Hit Points" folds (NV4) change the marks after them.
 */
export function resolveWindow(state: WindowState, party: readonly PcDefense[]): WindowResolution {
  const folds = state.responses.flatMap((r) => r.folds ?? []);
  const target = party.find((p) => p.id === state.targetId);
  const manual: string[] = [];
  let missed = folds.some((f) => f.kind === "negateAttack");
  const evasionBonus = folds.filter((f): f is Extract<Fold, { kind: "evasion" }> => f.kind === "evasion" && applies(f.targetIds, state)).reduce((n, f) => n + f.amount, 0);
  const reroll = [...folds].reverse().find((f): f is Extract<Fold, { kind: "attackRoll" }> => f.kind === "attackRoll");
  const attackTotal = reroll ? reroll.total : state.hit.attackTotal;
  const critical = reroll ? reroll.critical : state.hit.critical;
  const evasion = (party.find((p) => p.id === state.targetId) as WindowPc | undefined)?.evasion;
  if (evasionBonus > 0 || reroll) {
    if (attackTotal !== undefined && evasion !== undefined) {
      if (!critical && attackTotal < evasion + evasionBonus) missed = true;
    } else if (evasionBonus > 0) manual.push(`+${evasionBonus} Evasion against this attack`);
  }
  for (const f of folds) {
    if (f.kind === "rerollAttack") manual.push("The attacker rerolls its attack roll: the new result stands");
    if (f.kind === "rerollDamage") manual.push("The attacker rerolls its damage roll: the new result stands");
  }
  const reflects = folds.filter((f): f is Extract<Fold, { kind: "reflect" }> => f.kind === "reflect");
  const negated = missed || folds.some((f) => f.kind === "negateDamage");
  for (const f of folds) if (f.kind === "manual") manual.push(f.text);

  const armorAnswer = state.responses.find((r) => r.characterId === state.targetId && isArmorAnswer(r.choice));
  const armorSlotsChosen = armorAnswer?.choice.kind === "armor" ? Math.max(1, armorAnswer.choice.slots ?? 1) : 0;
  const amount = amountNow(state, folds);
  const reflected = reflects.map((f) => ({ to: f.to, targetIds: f.targetIds, amount }));
  const conditionNegated = folds.some((f) => f.kind === "negateCondition");
  if (!target || missed) {
    return { originalTargetId: state.originalTargetId, targetId: state.targetId, missed, negated, result: null, reflected, manual, armorSlotsChosen, conditionNegated };
  }

  let extra: number | "any" = 0;
  let reduceSeverity = 0;
  let hpDelta = 0;
  let convert: HitAdjustments["convert"];
  for (const f of folds) {
    if (f.kind === "extraArmorSlots" && applies(f.targetIds, state)) extra = extra === "any" || f.max === "any" ? "any" : extra + f.max;
    if (f.kind === "reduceSeverity" && applies(f.targetIds, state)) reduceSeverity += f.steps;
    if (f.kind === "hpMarked" && applies(f.targetIds, state)) hpDelta += f.delta;
    if (f.kind === "convert" && applies(f.targetIds, state)) convert = f.into;
  }
  const hit: PcHit = { ...state.hit, amount, ...(hpDelta !== 0 ? { hpMarkedDelta: (state.hit.hpMarkedDelta ?? 0) + hpDelta } : {}) };
  const result = applyHitToPc(target, hit, {
    armorSlots: armorSlotsChosen,
    extraSlots: extra,
    reduceSeverity,
    negate: negated,
    ...(convert ? { convert } : {}),
  });
  return { originalTargetId: state.originalTargetId, targetId: state.targetId, missed, negated, result, reflected, manual, armorSlotsChosen, conditionNegated };
}

// ---------------------------------------------------------------- after the hit (AA2b)

/** What the resolved hit did to the PC who took it, for the card uses it sets off (CE-valor "For AA2"). */
export interface MarkFacts {
  hpMarked: number;
  /** The hit marked their last Hit Point (CB p.91: a death move is due). */
  deathMove: boolean;
  /** Armor Slots they marked for its benefit. */
  armorSlots: number;
  /** The damage came from an attack (adversary attacks and features, a card's attack on an ally). */
  fromAttack: boolean;
  /** SD4: the severity the hit marked (Not Done Yet, HF p.10: "When you take Severe damage"). */
  severity?: PcSeverity;
  /** SD4: Stress the hit made them mark (Unshakable, Brave Face: "when you would (be forced to) mark a Stress"). */
  stressMarked?: number;
  /** SD4: the damage type taken. */
  damageType?: WindowHit["type"];
}

/**
 * Whether a "you mark HP" / "you would make a death move" trigger fits the resolved hit. SD4: `sourceWithin` (Eye for an
 * Eye, Elemental Incarnation Fire: "an adversary within Melee range") reads `bandToAttacker` (unknown = any, Q18);
 * `whenYouTakeDamage` (Not Done Yet); `wouldMarkStress` (Unshakable, Brave Face).
 */
export function afterHitTriggerFits(trigger: Trigger, facts: MarkFacts, bandToAttacker?: Range): boolean {
  switch (trigger.kind) {
    case "whenYouMarkHp":
      return (
        facts.hpMarked > 0 &&
        (trigger.fromAttack !== true || facts.fromAttack) &&
        (trigger.withoutArmor !== true || facts.armorSlots === 0) &&
        (trigger.last !== true || facts.deathMove) &&
        (trigger.sourceWithin === undefined || reaches(bandToAttacker, trigger.sourceWithin))
      );
    case "whenYouTakeDamage":
      return (
        facts.hpMarked > 0 &&
        (trigger.severity === undefined || trigger.severity === facts.severity) &&
        (trigger.damageType === undefined || facts.damageType === trigger.damageType || facts.damageType === "both")
      );
    case "wouldMarkStress":
      return (facts.stressMarked ?? 0) > 0;
    case "wouldMakeDeathMove":
      return trigger.who === "self" && facts.deathMove;
    default:
      return false;
  }
}

/**
 * The card uses a resolved hit sets off for the PC who took it (CE-valor): `auto` uses run at once (Rise Up's "clear a
 * Stress", Valor-Touched's "clear an Armor Slot"), ready and affordable `reaction` uses are offered (Unbreakable, CB p.342:
 * "When you mark your last Hit Point, instead of making a death move, you can roll a d6 and clear that many Hit Points").
 */
export function afterHitUses(pc: WindowPc, facts: MarkFacts): { auto: { cardId: string; useId: string }[]; offers: string[] } {
  const auto: { cardId: string; useId: string }[] = [];
  const offers: string[] = [];
  for (const card of pc.cards) {
    for (const use of card.uses) {
      const a = use.activation;
      if ((a.kind !== "auto" && a.kind !== "reaction") || !afterHitTriggerFits(a.trigger, facts)) continue;
      if (use.limit && cardAvailability(pc, card.cardId, { useId: use.id, limit: use.limit }).state !== "ready") continue;
      if (!affordable(use, pc)) continue;
      if (a.kind === "auto") auto.push({ cardId: card.cardId, useId: use.id });
      else if (!offers.includes(card.cardId)) offers.push(card.cardId);
    }
  }
  return { auto, offers };
}

/**
 * SD4: the feature uses a resolved hit sets off for the PC who took it: `auto` uses run at once (Unshakable's d6,
 * Elemental Incarnation's Fire), ready and affordable `reaction` uses are offered (Not Done Yet, Deadly Vengeance, Eye for
 * an Eye, Brave Face). The trigger's amount is the Hit Points marked for a "mark HP" trigger, else the damage taken.
 */
export function afterHitFeatures(pc: WindowPc, facts: MarkFacts, creatures: TriggerCreatures & { taken: number }): { auto: FeatureAnswer[]; offers: string[] } {
  const auto: FeatureAnswer[] = [];
  const offers: string[] = [];
  if (!pc.actor) return { auto, offers };
  for (const effect of pc.features ?? []) {
    for (const use of effect.uses) {
      const a = use.activation;
      if ((a.kind !== "auto" && a.kind !== "reaction") || !afterHitTriggerFits(a.trigger, facts, pc.bandToAttacker)) continue;
      if (!featureReady(effect, use, pc.actor, { amount: afterHitAmount(use, facts, creatures.taken), ...(creatures.subject ? { subject: creatures.subject } : {}), ...(creatures.source ? { source: creatures.source } : {}) })) continue;
      if (a.kind === "auto") auto.push({ featureId: effect.featureId, useId: use.id });
      else if (!offers.includes(effect.featureId)) offers.push(effect.featureId);
    }
  }
  return { auto, offers };
}

/** The trigger amount of an after-hit feature use: Hit Points marked for a "mark HP" trigger, else the damage taken. */
export function afterHitAmount(use: CardUse, facts: Pick<MarkFacts, "hpMarked">, taken: number): number {
  const a = use.activation;
  return (a.kind === "auto" || a.kind === "reaction") && a.trigger.kind === "whenYouMarkHp" ? facts.hpMarked : taken;
}

/**
 * What the hit PC's prompt shows (Q14): the damage as the answers so far left it (SD4: halved, reduced or rerolled), its
 * severity against their thresholds, and the slots they may mark.
 */
export function targetPrompt(state: WindowState, target: PcDefense): { damage: number; severity: PcSeverity; maxSlots: number } {
  const folds = state.responses.flatMap((r) => r.folds ?? []);
  let extra: number | "any" = 0;
  for (const f of folds) if (f.kind === "extraArmorSlots" && applies(f.targetIds, state)) extra = extra === "any" || f.max === "any" ? "any" : extra + f.max;
  const amount = amountNow(state, folds);
  const hit = { ...state.hit, amount };
  return { damage: amount, severity: damageBeforeArmor(target, hit).severity, maxSlots: armorOptions(target, hit, extra).maxSlots };
}
