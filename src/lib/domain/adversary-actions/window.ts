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
import { run as runCard, type ActorState, type PlanStep, type RunPlan, type RunResult } from "../card-effects/run";
import type { CardEffect, CardUse, Range, Trigger } from "../card-effects/types";
import type { Combatant } from "../combat-actions/damage";
import { withinRange } from "../combat-actions/distance";
import type { Rng } from "../dice/index";
import type { FeatureUse } from "../../validation/characters";
import { applyHitToPc, armorOptions, damageBeforeArmor, type HitAdjustments, type PcDefense, type PcHit, type PcHitResult, type PcSeverity } from "./severity";

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
}

/** Who must or may answer (the stored `HitResponder`): the target (armor) or an ally with an eligible reaction card. */
export interface Responder {
  characterId: string;
  role: "target" | "ally";
  cardIds: string[];
}

/** An answer (the stored `HitChoice`). */
export type HitChoice =
  | { kind: "armor"; slots?: number }
  | { kind: "noArmor" }
  | { kind: "card"; cardId: string; useId?: string }
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
  | { kind: "evasion"; amount: number; targetIds: string[] }
  | { kind: "convert"; into: "stress" | "hope"; targetIds: string[] }
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
    default:
      return false;
  }
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

// ---------------------------------------------------------------- the machine

export interface OpenInput {
  hit: WindowHit;
  targetId: string;
  /** Every PC in the scene, the target included. */
  party: readonly WindowPc[];
}

/**
 * Opens the window (Q13): the target is a responder when they can mark an Armor Slot or hold an eligible card; every
 * other PC with an eligible card is an ally responder. A window with no responder is complete at once.
 */
export function openWindow(input: OpenInput): WindowState {
  const { hit, targetId, party } = input;
  const armorCapable: Record<string, boolean> = {};
  for (const pc of party) armorCapable[pc.id] = armorOptions(pc, hit).canUseArmor;
  const target = party.find((p) => p.id === targetId);
  const responders: Responder[] = [];
  if (target) {
    const severity = damageBeforeArmor(target, hit).severity;
    const cards = eligibleCards(target, "target", hit, severity, armorCapable[target.id] ?? false);
    if (armorCapable[target.id] || cards.length > 0) responders.push({ characterId: target.id, role: "target", cardIds: cards });
    for (const pc of party) {
      if (pc.id === targetId) continue;
      const allyCards = eligibleCards(pc, "ally", hit, severity, armorCapable[pc.id] ?? false);
      if (allyCards.length > 0) responders.push({ characterId: pc.id, role: "ally", cardIds: allyCards });
    }
  }
  return { hit, originalTargetId: targetId, targetId, responders, responses: [], armorCapable, released: [], closedEarly: false };
}

const isArmorAnswer = (c: HitChoice) => c.kind === "armor" || c.kind === "noArmor" || c.kind === "pass";

/** The responders still owed an answer: the target until they answer armor, an ally until any answer (Q17). */
export function awaiting(state: WindowState): string[] {
  if (state.closedEarly) return [];
  return state.responders
    .filter((r) => {
      if (state.released.includes(r.characterId)) return false;
      const mine = state.responses.filter((x) => x.characterId === r.characterId);
      if (r.role === "target") return !mine.some((x) => isArmorAnswer(x.choice));
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
 * before that; an ally answers once, with a card or `pass`. A card's `redirect` fold makes its user the target, who then
 * owes an armor answer if they can mark a slot (the first target is released). Errors: REQUEST_NOT_OPEN (complete),
 * NOT_A_RESPONDER (not listed, already answered, or a card they weren't offered).
 */
export function respond(state: WindowState, response: WindowResponse): RespondResult {
  if (isComplete(state)) return { ok: false, code: "REQUEST_NOT_OPEN", detail: "The window is closed." };
  const who = response.characterId;
  const responder = state.responders.find((r) => r.characterId === who);
  if (!responder || !awaiting(state).includes(who)) return { ok: false, code: "NOT_A_RESPONDER", detail: who };
  const choice = response.choice;
  if (responder.role === "ally" && (choice.kind === "armor" || choice.kind === "noArmor")) return { ok: false, code: "NOT_A_RESPONDER", detail: "Only the target marks armor." };
  if (choice.kind === "card") {
    const played = state.responses.some((x) => x.characterId === who && x.choice.kind === "card" && x.choice.cardId === choice.cardId);
    if (!responder.cardIds.includes(choice.cardId) || played) return { ok: false, code: "NOT_A_RESPONDER", detail: choice.cardId };
  }
  let next: WindowState = { ...state, responses: [...state.responses, { ...response, ...(response.folds ? { folds: [...response.folds] } : {}) }] };
  const redirect = (response.folds ?? []).find((f): f is Extract<Fold, { kind: "redirect" }> => f.kind === "redirect");
  if (choice.kind === "card" && redirect && redirect.to !== next.targetId) {
    const newTarget = redirect.to;
    const canArmor = next.armorCapable[newTarget] ?? false;
    const old = next.targetId;
    next = {
      ...next,
      targetId: newTarget,
      released: [...new Set([...next.released, old])],
      responders: next.responders
        .map((r) => (r.characterId === old ? { ...r, role: "ally" as const } : r.characterId === newTarget ? { ...r, role: "target" as const } : r))
        .concat(next.responders.some((r) => r.characterId === newTarget) ? [] : [{ characterId: newTarget, role: "target" as const, cardIds: [] }]),
    };
    // The new target owes an armor answer only if they can mark a slot; otherwise their card was their answer.
    if (!canArmor) next = { ...next, responses: [...next.responses, { characterId: newTarget, choice: { kind: "noArmor" } }] };
  }
  return { ok: true, state: next };
}

// ---------------------------------------------------------------- folds from a card's run

/** Turns a reaction card's run plan into folds on the hit (I Am Your Shield: redirect + extraArmorSlots any). */
export function foldsFromPlan(plan: Pick<RunPlan, "steps">, responderId: string): Fold[] {
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
        else out.push({ kind: "manual", text: step.note ?? `Negate ${step.what}` });
        break;
      case "modifyRoll":
        if (step.change.kind === "fail") out.push({ kind: "negateAttack" });
        else if (step.change.kind === "evasion") out.push({ kind: "evasion", amount: typeof s.amount === "number" ? s.amount : 0, targetIds: s.targetIds });
        else out.push({ kind: "manual", text: step.note ?? `Change the roll (${step.change.kind})` });
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
}

const applies = (targetIds: readonly string[], state: WindowState) =>
  targetIds.length === 0 || targetIds.includes(state.targetId) || targetIds.includes(state.originalTargetId);

/**
 * The hit's final marks (AR3-AR5): the target's armor answer (none if they didn't answer before "Resolve now"), every
 * card's folds in order, then `applyHitToPc`. Misses on a `negateAttack` fold or an Evasion bonus that beats the kept
 * attack total (a critical still hits, CB p.148).
 */
export function resolveWindow(state: WindowState, party: readonly PcDefense[]): WindowResolution {
  const folds = state.responses.flatMap((r) => r.folds ?? []);
  const target = party.find((p) => p.id === state.targetId);
  const manual: string[] = [];
  let missed = folds.some((f) => f.kind === "negateAttack");
  const evasionBonus = folds.filter((f): f is Extract<Fold, { kind: "evasion" }> => f.kind === "evasion" && applies(f.targetIds, state)).reduce((n, f) => n + f.amount, 0);
  if (evasionBonus > 0) {
    const evasion = (party.find((p) => p.id === state.targetId) as WindowPc | undefined)?.evasion;
    if (state.hit.attackTotal !== undefined && evasion !== undefined) {
      if (!state.hit.critical && state.hit.attackTotal < evasion + evasionBonus) missed = true;
    } else manual.push(`+${evasionBonus} Evasion against this attack`);
  }
  const reflects = folds.filter((f): f is Extract<Fold, { kind: "reflect" }> => f.kind === "reflect");
  const negated = missed || folds.some((f) => f.kind === "negateDamage");
  for (const f of folds) if (f.kind === "manual") manual.push(f.text);

  const armorAnswer = [...state.responses].reverse().find((r) => r.characterId === state.targetId && isArmorAnswer(r.choice));
  const armorSlotsChosen = armorAnswer?.choice.kind === "armor" ? Math.max(1, armorAnswer.choice.slots ?? 1) : 0;
  const reflected = reflects.map((f) => ({ to: f.to, targetIds: f.targetIds, amount: state.hit.amount }));
  if (!target || missed) {
    return { originalTargetId: state.originalTargetId, targetId: state.targetId, missed, negated, result: null, reflected, manual, armorSlotsChosen };
  }

  let extra: number | "any" = 0;
  let reduceSeverity = 0;
  let reduceDamage = 0;
  let convert: HitAdjustments["convert"];
  for (const f of folds) {
    if (f.kind === "extraArmorSlots" && applies(f.targetIds, state)) extra = extra === "any" || f.max === "any" ? "any" : extra + f.max;
    if (f.kind === "reduceSeverity" && applies(f.targetIds, state)) reduceSeverity += f.steps;
    if (f.kind === "reduceDamage" && applies(f.targetIds, state)) reduceDamage += f.amount;
    if (f.kind === "convert" && applies(f.targetIds, state)) convert = f.into;
  }
  const result = applyHitToPc(target, state.hit, {
    armorSlots: armorSlotsChosen,
    extraSlots: extra,
    reduceDamage,
    reduceSeverity,
    negate: negated,
    ...(convert ? { convert } : {}),
  });
  return { originalTargetId: state.originalTargetId, targetId: state.targetId, missed, negated, result, reflected, manual, armorSlotsChosen };
}

/** What the hit PC's prompt shows (Q14): the damage, its severity against their thresholds, and the slots they may mark. */
export function targetPrompt(state: WindowState, target: PcDefense): { damage: number; severity: PcSeverity; maxSlots: number } {
  const folds = state.responses.flatMap((r) => r.folds ?? []);
  let extra: number | "any" = 0;
  for (const f of folds) if (f.kind === "extraArmorSlots" && applies(f.targetIds, state)) extra = extra === "any" || f.max === "any" ? "any" : extra + f.max;
  return { damage: state.hit.amount, severity: damageBeforeArmor(target, state.hit).severity, maxSlots: armorOptions(target, state.hit, extra).maxSlots };
}
