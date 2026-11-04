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

import { cardAvailability, hopeBlocked, resolveCosts, unaffordable } from "../card-effects/availability";
import { pickUse, run as runCard, type ActorState, type PlanStep, type RunPlan, type RunResult } from "../card-effects/run";
import type { CardEffect, CardUse, ConditionRef, DamageKeyword, NumberChoice, Range, Step, Trigger } from "../card-effects/types";
import { asCardEffect, runFeature, type FeatureRunResult } from "../feature-effects/run";
import type { FeatureEffect } from "../feature-effects/types";
import type { Combatant } from "../combat-actions/damage";
import { withinRange } from "../combat-actions/distance";
import type { Rng } from "../dice/index";
import type { FeatureUse } from "../../validation/characters";
import { applyHitToPc, armorOptions, armorSteps, damageBeforeArmor, hpForSeverity, marksFactor, slotsPerStep, stepDown, type HitAdjustments, type PcDefense, type PcHit, type PcHitResult, type PcSeverity } from "./severity";

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
  /**
   * Plan lanes-2, E2 (dcm-dv6): the keyword the hit's damage carries besides its type (fire; the attacking feature's or
   * card's `damage` step). Unknown (absent) = not known: a keyword trigger still fits and the player confirms (Q13).
   */
  keyword?: DamageKeyword;
  /**
   * Plan lanes-2, E2.3: what the attacker lets the hit PC pay instead of Hit Points (`grantOffers`). `hopeHp`: forced HP
   * from the hit's riders that the PC may reduce one for one with Hope (dcm-nnbl; Doom / Tentacle Rays, HF p.75: "they
   * can spend any number of Hope to reduce the number of HP marked this way by an equal amount"). `goldForHp`: a handful
   * of gold per Hit Point instead of marking it (dcm-5cn5; Money Talks, CB p.228: "When a target marks HP from the
   * Demon's standard attack, they can spend a handful of gold instead of marking HP (1 handful per HP)").
   */
  grants?: { hopeHp?: number; goldForHp?: boolean };
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
  /**
   * Plan lanes-2, E2.3 (dcm-hgvx): the PC's rule flags from the mods it carries (`Mod` `flag`): `cannotSpendHope` makes
   * every Hope cost short (Ravenous, HF p.94) and keeps the Hope grant off (`grantOffers`). Absent = none.
   */
  readonly flags?: readonly string[];
  /** Plan lanes-2, E2.3 (dcm-5cn5): the handfuls of gold on the sheet (Money Talks' grant). Absent = none. */
  readonly gold?: number;
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
  /** Plan lanes-2, E2.3: the hit PC takes an attacker's grant (`grantOffers`): `amount` Hope or handfuls of gold. */
  | { kind: "grant"; id: string; amount: number }
  | { kind: "pass" };

/**
 * What a reaction card does to the hit, from its run plan's `fold` steps (`foldsFromPlan`). `redirect`: the card's user
 * becomes the target; `reflect`: the damage goes to the attacker or a picked creature instead (the target takes none).
 */
export type Fold =
  | { kind: "redirect"; to: string }
  | { kind: "reflect"; to: "attacker" | "picked"; targetIds: string[] }
  | { kind: "extraArmorSlots"; max: number | "any"; targetIds: string[] }
  /**
   * DA8: `insteadOfArmorSlot` (Stable, HF p.12; Celestial Wings, HF p.19; user answers 2026-10-29 / 2026-10-30): the step
   * IS the hit's one armor reduction, paid with something else: no Armor Slot is marked with it, it never adds up with a
   * real slot past one step (CB p.114 "you can only mark 1 Armor Slot"), and it needs no armor.
   */
  | { kind: "reduceSeverity"; steps: number; targetIds: string[]; insteadOfArmorSlot?: boolean }
  | { kind: "reduceDamage"; amount: number; targetIds: string[] }
  /**
   * DA8: `ignoreOnHitHp` (Dark Aegis, HF p.14; user answer 2026-10-29): the damage is zero, so it has no severity; the
   * attack's other on-hit effects (conditions) still land, but any extra "mark HP" from them is ignored.
   */
  | { kind: "negateDamage"; ignoreOnHitHp?: boolean }
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
    // Plan lanes-2, E2 (dcm-ofo): `unlimited` (Enchanted Talisman, HF p.16; Rune Ward held by an ally, CB p.328) fits at
    // any range: `range` is ignored.
    case "whenAllyWouldTakeDamage":
      return role === "ally" ? trigger.unlimited === true || reaches(pc.bandToTarget, trigger.range) : trigger.includeSelf === true;
    // Plan lanes-2, E2 (dcm-dv6): a `keyword` trigger (Fireproof, HF p.22: "damage from magical or mundane flame") doesn't
    // fit a hit that carries another keyword; a hit with no known keyword still offers it (the player confirms, Q13).
    case "whenYouWouldTakeDamage":
      return (
        role === "target" &&
        typeOk(trigger.damageType) &&
        (trigger.severity === undefined || trigger.severity === severityBefore) &&
        fromOk(trigger.from) &&
        (trigger.keyword === undefined || hit.keyword === undefined || hit.keyword === trigger.keyword)
      );
    case "whenAttacked":
      return role === "target" && (trigger.stage === "rolled" || trigger.stage === "succeeded") && typeOk(trigger.damageType) && fromOk(trigger.from);
    // E2 (dcm-98d): `stage: "would"` (Unyielding Armor, CB p.342: "When you would mark an Armor Slot") fits the same way:
    // the target can mark one; it is offered only until the armor answer (`answerScope`).
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
      // Plan lanes-2, E2.3 (dcm-hgvx): Ravenous (HF p.94) and the other spending flags.
      ...(pc.flags ? { flags: pc.flags } : {}),
    }).length === 0
  );
}

/**
 * The loadout cards with a ready, affordable reaction use whose trigger fits (the responder's `cardIds`). DA8: `skip`
 * leaves out uses the answers so far rule out (as `eligibleFeatures`).
 */
export function eligibleCards(pc: WindowPc, role: "target" | "ally", hit: WindowHit, severityBefore: PcSeverity, armorCapable: boolean, skip?: (use: CardUse) => boolean): string[] {
  const out: string[] = [];
  for (const card of pc.cards) {
    const fits = card.uses.some(
      (use) =>
        use.activation.kind === "reaction" &&
        !skip?.(use) &&
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

/**
 * The actor with the trigger's subject as a fact (Loyal Protector, CB p.36: "an ally … has 2 or fewer Hit Points"). Plan
 * lanes-2, E2 (dcm-ofo): also the subject's Stress, Armor Slots and Hope, and (a PC subject) the items it holds, when known
 * (a `track` or `holdsItem` check on the subject; Enchanted Talisman, HF p.16: "the person holding the talisman").
 */
export function actorWithSubject(actor: ActorState, subject: (Combatant & { readonly hope?: number; readonly facts?: { readonly items?: readonly string[] } }) | undefined): ActorState {
  if (!subject) return actor;
  const items = subject.facts?.items;
  return {
    ...actor,
    facts: {
      ...(actor.facts ?? {}),
      subject: {
        conditions: subject.conditions,
        ...(subject.tags ? { tags: subject.tags } : {}),
        hp: subject.hp,
        hpMax: subject.hpMax,
        stress: subject.stress,
        stressMax: subject.stressMax,
        ...(subject.armor !== undefined ? { armor: subject.armor } : {}),
        ...(subject.armorMax !== undefined ? { armorMax: subject.armorMax } : {}),
        ...(subject.hope !== undefined ? { hope: subject.hope } : {}),
        ...(items !== undefined ? { items } : {}),
      },
    },
  };
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

/** Whether any step of a use matches, nested optional / choose steps included. */
function anyStepOf(use: CardUse, test: (s: Step) => boolean): boolean {
  const walk = (steps: readonly Step[]): boolean =>
    steps.some((s) => test(s) || (s.kind === "optional" && walk(s.steps)) || (s.kind === "choose" && s.options.some((o) => walk(o.steps))));
  return walk(use.steps);
}

/**
 * DA8: a use whose step stands for the hit's one Armor Slot (Stable, HF p.12: "spend a Focus instead of an Armor Slot";
 * Celestial Wings, HF p.19: "spend a Hope instead of marking an Armor Slot"; DA0's `insteadOfArmorSlot`).
 */
export const replacesArmorSlot = (use: CardUse) => anyStepOf(use, (s) => (s.kind === "reduceSeverity" || s.kind === "convertMarks") && s.insteadOfArmorSlot === true);

/** DA8: a use that changes how many Armor Slots the hit allows (Iron Will, I Am Your Shield): moot once armor is answered. */
const addsArmorSlots = (use: CardUse) => anyStepOf(use, (s) => s.kind === "extraArmorSlots");

/**
 * The feature uses this PC may answer the hit with now (SD4): `reaction` uses whose trigger fits the hit's current state
 * (`severityNow`: the severity after the answers so far, CB p.107 "the player … can apply the effects in any order"),
 * ready and affordable. DA8: `skip` leaves out uses the answers so far rule out (a second armor reduction, an extra slot
 * after the armor answer); the severity-only filter after armor is gone (user 2026-10-30, dcm-bxp.99.19.50 (3)).
 */
export function eligibleFeatures(
  pc: WindowPc,
  role: "target" | "ally",
  hit: WindowHit,
  severityNow: PcSeverity,
  armorCapable: boolean,
  trigger: TriggerCreatures & { amount: number },
  skip?: (use: CardUse) => boolean,
): FeatureAnswer[] {
  if (!pc.actor) return [];
  const out: FeatureAnswer[] = [];
  for (const effect of pc.features ?? []) {
    for (const use of effect.uses) {
      if (use.activation.kind !== "reaction") continue;
      if (skip?.(use)) continue;
      if (!triggerFits(use.activation.trigger, role, pc, hit, severityNow, armorCapable)) continue;
      if (!featureReady(effect, use, pc.actor, trigger)) continue;
      out.push({ featureId: effect.featureId, useId: use.id });
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- automatic answers to a marked Armor Slot (E2)

/** E2 (dcm-sim): an automatic card use a marked Armor Slot set off (Shield Aura's extra step), with its folds. */
export interface AutoAnswer {
  characterId: string;
  cardId: string;
  useId: string;
  folds: Fold[];
}

/** FNV-1a (32 bit) then mulberry32: dice for an automatic use, the same on every rebuild of the window. */
function fixedDice(seed: string): Rng {
  let a = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) a = Math.imul(a ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  return (sides: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * sides) + 1;
  };
}

/**
 * E2 (dcm-sim): the automatic card uses on "when you / an ally mark an Armor Slot" (Shield Aura, CB p.341: the aura-ally
 * and aura-self uses) that a marked slot of the current target sets off: run with the target as the trigger's subject,
 * free uses only (one with a cost waits for the player), ready by their limit; their folds join the hit's (a severity
 * step). A use the runner refuses (an unconfirmed situation, a gate that doesn't hold) adds nothing. `marked`: whether a
 * real Armor Slot is marked (the target's answer, or a count the preview asks about).
 */
export function armorSlotAutos(state: WindowState, marked = realSlotsChosen(state) > 0): AutoAnswer[] {
  const target = state.party?.find((p) => p.id === state.targetId);
  if (!marked || !target?.actor || state.hit.direct) return [];
  const out: AutoAnswer[] = [];
  for (const pc of state.party ?? []) {
    if (!pc.actor) continue;
    for (const card of pc.cards) {
      for (const use of card.uses) {
        const a = use.activation;
        if (a.kind !== "auto" || a.trigger.kind !== "whenArmorSlotMarked" || a.trigger.stage === "would") continue;
        if ((a.trigger.who === "self") !== (pc.id === state.targetId)) continue;
        if ((use.costs ?? []).length > 0) continue;
        if (use.limit && cardAvailability(pc, card.cardId, { useId: use.id, limit: use.limit }).state !== "ready") continue;
        const result = runCard(card, {
          actor: pc.actor,
          gmFear: 0,
          useId: use.id,
          trigger: { amount: state.hit.amount, subject: target.actor, ...(state.attacker ? { source: state.attacker } : {}) },
          rng: fixedDice(`${state.hit.attackerId}:${state.targetId}:${card.cardId}:${use.id}`),
        });
        if (!result.ok) continue;
        const folds = foldsFromPlan(result.plan, pc.id);
        if (folds.length > 0) out.push({ characterId: pc.id, cardId: card.cardId, useId: use.id, folds });
      }
    }
  }
  return out;
}

/** Every fold of the hit so far: the answers', then (E2) the automatic uses a marked Armor Slot set off. */
function allFolds(state: WindowState, marked?: boolean): Fold[] {
  return [...state.responses.flatMap((r) => r.folds ?? []), ...armorSlotAutos(state, marked).flatMap((a) => a.folds)];
}

// ---------------------------------------------------------------- the hit so far (SD4)

/** The hit as the answers so far left it: damage after reductions and rerolls, its severity now, the armor answered. */
export interface HitProgress {
  amount: number;
  /** Severity against the target's thresholds after the damage changes, Armor Slots and severity steps so far. */
  severity: PcSeverity;
  /** DA8: the Hit Points that severity marks now ("N fewer" answers counted; none when the damage is cancelled). */
  hp: number;
  /** The target answered armor: a slot, no slot, Pass, or (DA8) an answer that stands for the slot (Stable, Wings). */
  armorAnswered: boolean;
}

const applies = (targetIds: readonly string[], state: WindowState) =>
  targetIds.length === 0 || targetIds.includes(state.targetId) || targetIds.includes(state.originalTargetId);

/** DA8: an answer whose folds stand for the current target's one Armor Slot (Stable, Celestial Wings). */
function substitutes(r: WindowResponse, state: WindowState): boolean {
  return (r.folds ?? []).some((f) => f.kind === "reduceSeverity" && f.insteadOfArmorSlot === true && applies(f.targetIds, state));
}

/** The extra Armor Slots the answers so far allow the current target (I Am Your Shield "any", Iron Will +1). */
function extraSlotsNow(state: WindowState): number | "any" {
  let extra: number | "any" = 0;
  for (const f of state.responses.flatMap((r) => r.folds ?? [])) if (f.kind === "extraArmorSlots" && applies(f.targetIds, state)) extra = extra === "any" || f.max === "any" ? "any" : extra + f.max;
  return extra;
}

/** How many Armor Slots this hit allows the current target (CB p.114: one, unless an answer allows more). */
function slotAllowance(state: WindowState): number {
  const extra = extraSlotsNow(state);
  return extra === "any" ? Number.POSITIVE_INFINITY : 1 + Math.max(0, extra);
}

/** The real Armor Slots the current target marked for the hit's benefit (their `armor` answer). */
function realSlotsChosen(state: WindowState): number {
  const answer = state.responses.find((r) => r.characterId === state.targetId && r.choice.kind === "armor");
  return answer?.choice.kind === "armor" ? Math.max(1, answer.choice.slots ?? 1) : 0;
}

/** E2 (dcm-s77): the severity steps the real slots bought (whole steps of the hit's `slotsPerStep`). */
function realStepsChosen(state: WindowState): number {
  return armorSteps(state.hit, realSlotsChosen(state));
}

const substituteTaken = (state: WindowState) => state.responses.some((r) => r.characterId === state.targetId && substitutes(r, state));

/**
 * A1 (dcm-bxp.99.19.55 (6), user answer 2026-10-30): a slot substitute (Stable, Celestial Wings) leaves real slots to
 * mark beside it when the hit allows more than one Armor Slot (I Am Your Shield, CB p.341: "you can mark any number of
 * Armor Slots"; Iron Will: "mark an additional Armor Slot") and the target can mark one.
 */
function slotsLeftBesideSubstitute(state: WindowState): boolean {
  return (state.armorCapable[state.targetId] ?? false) && slotAllowance(state) >= 2;
}

/**
 * Whether `characterId` (the current target) gave the armor answer: armor, no armor, Pass, or (DA8) a slot substitute
 * when it stands for the hit's only Armor Slot. A1: with more than one slot allowed, the substitute replaces ONE of
 * them and the others are still asked for.
 */
export function armorAnswered(state: WindowState, characterId: string): boolean {
  if (characterId !== state.targetId) return false;
  const mine = state.responses.filter((r) => r.characterId === characterId);
  return mine.some((r) => isArmorAnswer(r.choice)) || (mine.some((r) => substitutes(r, state)) && !slotsLeftBesideSubstitute(state));
}

/**
 * DA8: no slot substitute fits any more ("Wings OR a real Armor Slot on a hit, never both", user 2026-10-30; Stable "the
 * Armor Slot is NOT marked", 2026-10-29): one was used already, or the real slots marked fill what the hit allows. A1
 * (dcm-bxp.99.19.55 (6)): with more than one slot allowed, one substitute may replace one of them, before or after the
 * real slots; "Don't mark" leaves the substitute open (dcm-bxp.99.19.55 (3)).
 */
function substituteBlocked(state: WindowState): boolean {
  return state.hit.direct || substituteTaken(state) || realStepsChosen(state) >= slotAllowance(state);
}

/**
 * Severity steps from the answers' folds: every plain step, plus at most one from slot substitutes (DA8: "never more
 * than 1 step in total" with the slot, CB p.114).
 */
function severitySteps(folds: readonly Fold[], state: WindowState): number {
  let plain = 0;
  let instead = 0;
  for (const f of folds) {
    if (f.kind !== "reduceSeverity" || !applies(f.targetIds, state)) continue;
    if (f.insteadOfArmorSlot) instead += f.steps;
    else plain += f.steps;
  }
  return plain + Math.min(1, instead);
}

/**
 * DA8: the uses the answers so far rule out for `role`: a second armor reduction (a slot substitute after the slot or
 * another substitute, or any substitute on direct damage, CB p.99), an extra Armor Slot once the armor answer is in.
 */
function ruledOut(state: WindowState, role: "target" | "ally", armorIn: boolean): (use: CardUse) => boolean {
  const blocked = substituteBlocked(state);
  return (use) => (role === "target" && armorIn && addsArmorSlots(use)) || (replacesArmorSlot(use) && (role !== "target" || blocked));
}

/** The damage after the answers so far: a rerolled damage replaces it (CB p.107), reductions come off it. */
function amountNow(state: WindowState, folds: readonly Fold[]): number {
  let amount = state.hit.amount;
  for (const f of folds) if (f.kind === "damageRoll") amount = f.amount;
  const reduce = folds.reduce((n, f) => n + (f.kind === "reduceDamage" && applies(f.targetIds, state) ? f.amount : 0), 0);
  return Math.max(0, amount - reduce);
}

/** The hit now for the current target (SD4): what the next answer's trigger reads. */
export function progress(state: WindowState, target: PcDefense): HitProgress {
  const folds = allFolds(state);
  // DA8: a cancelled damage (Dark Aegis, a reflection) is zero: no severity, no Hit Points (user answer 2026-10-29).
  const cancelled = folds.some((f) => f.kind === "negateDamage");
  const amount = cancelled ? 0 : amountNow(state, folds);
  const before = cancelled ? "none" : damageBeforeArmor(target, { ...state.hit, amount }).severity;
  // E2 (dcm-s77): dearer slots buy whole steps only.
  const severity = stepDown(stepDown(before, realStepsChosen(state)), severitySteps(folds, state));
  const delta = (state.hit.hpMarkedDelta ?? 0) + folds.reduce((n, f) => n + (f.kind === "hpMarked" && applies(f.targetIds, state) ? f.delta : 0), 0);
  const base = hpForSeverity(severity);
  return { amount, severity, hp: base > 0 ? Math.max(0, base + delta) * marksFactor(target, "hp") : 0, armorAnswered: armorAnswered(state, state.targetId) };
}

/** E2 (dcm-98d): a reaction on "when you would mark an Armor Slot" (Unyielding Armor, CB p.342). */
export const wouldMarkArmor = (use: CardUse) => use.activation.kind === "reaction" && use.activation.trigger.kind === "whenArmorSlotMarked" && use.activation.trigger.stage === "would";

/** Shared gate of `featureAnswers` / `cardAnswers`: who answers, in which role, with what played so far. */
function answerScope(state: WindowState, characterId: string) {
  const responder = state.responders.find((r) => r.characterId === characterId);
  const pc = state.party?.find((p) => p.id === characterId);
  const target = state.party?.find((p) => p.id === state.targetId);
  if (!responder || !pc || !target || state.closedEarly || state.released.includes(characterId)) return null;
  const mine = state.responses.filter((x) => x.characterId === characterId);
  const role = characterId === state.targetId ? ("target" as const) : ("ally" as const);
  // One answer per ally per hit, card or feature (combat-actions Q17; user 2026-10-30, dcm-bxp.99.19.48 (4)).
  if (role === "ally" && mine.length > 0) return null;
  // The target's Done (`pass`) ends their turn. After a marked slot, a slot substitute (DA8) or "Don't mark" / OK
  // (`noArmor`, A1: dcm-bxp.99.19.55 (3), user answer 2026-10-30) the turn goes on with every answer that still fits.
  if (role === "target" && mine.some((x) => x.choice.kind === "pass")) return null;
  const now = progress(state, target);
  const ruled = ruledOut(state, role, role === "target" && now.armorAnswered);
  // DA8: damage cancelled or reduced to 0 (Dark Aegis; CB p.91 "If you ever reduce incoming damage to 0 or less") is no
  // longer damage anyone "would take": those answers don't fit any more.
  // E2 (dcm-98d): a "when you would mark an Armor Slot" answer (Unyielding Armor, CB p.342) comes before the armor answer.
  const skip = (use: CardUse) =>
    ruled(use) ||
    (now.amount <= 0 && use.activation.kind === "reaction" && (use.activation.trigger.kind === "whenYouWouldTakeDamage" || use.activation.trigger.kind === "whenAllyWouldTakeDamage")) ||
    (role === "target" && now.armorAnswered && wouldMarkArmor(use));
  return { responder, pc, target, mine, role, now, skip, hit: { ...state.hit, amount: now.amount } };
}

/**
 * The feature uses `characterId` may still answer with (SD4): eligible now and not played yet in this window. Only a
 * responder listed with that feature and still owed an answer. DA8 (user 2026-10-30, CB p.107 "the player … can apply
 * the effects in any order"): after the armor answer every ready feature that still fits the hit stays offered, until
 * the target's Done (`pass`); a slot substitute (Stable, Celestial Wings) only while no armor reduction is taken.
 */
export function featureAnswers(state: WindowState, characterId: string): FeatureAnswer[] {
  const scope = answerScope(state, characterId);
  if (!scope || (scope.responder.featureIds ?? []).length === 0) return [];
  const { responder, pc, target, mine, role, now, skip, hit } = scope;
  const played = new Set(mine.flatMap((x) => (x.choice.kind === "feature" ? [x.choice.featureId] : [])));
  const creatures: TriggerCreatures = { ...(target.actor ? { subject: target.actor } : {}), ...(state.attacker ? { source: state.attacker } : {}) };
  return eligibleFeatures(pc, role, hit, now.severity, state.armorCapable[characterId] ?? false, { amount: now.amount, ...creatures }, skip).filter(
    (f) => (responder.featureIds ?? []).includes(f.featureId) && !played.has(f.featureId),
  );
}

/**
 * DA8: the reaction cards the hit PC may still play: listed for them, not played yet, and fitting the hit as the answers
 * so far left it (before or after the armor answer, CB p.107). An ally's cards are their `cardIds` until they answer.
 */
export function cardAnswers(state: WindowState, characterId: string): string[] {
  const scope = answerScope(state, characterId);
  if (!scope) return [];
  const { responder, pc, mine, role, now, skip, hit } = scope;
  const played = new Set(mine.flatMap((x) => (x.choice.kind === "card" ? [x.choice.cardId] : [])));
  const listed = responder.cardIds.filter((id) => !played.has(id));
  if (role === "ally") return listed;
  const fits = eligibleCards(pc, "target", hit, now.severity, state.armorCapable[characterId] ?? false, skip);
  return listed.filter((id) => fits.includes(id));
}

// ---------------------------------------------------------------- grants (plan lanes-2, E2.3)

/** An attacker's grant to the hit PC: `hope` (Hope before forced HP, dcm-nnbl) or `gold` (Money Talks, dcm-5cn5). */
export type GrantId = "hope" | "gold";

/** A grant the PC may take now and the most it may pay (Hope, or handfuls of gold). */
export interface GrantOffer {
  id: GrantId;
  max: number;
}

/**
 * The grants `hit` offers `pc` (the hit PC): `hope` while the riders force HP the PC may reduce with Hope, the PC has Hope
 * and no `cannotSpendHope` flag (Ravenous, HF p.94); under Unstuck (CB p.237) each HP costs the Hope factor. `gold` while
 * the attacker grants it and the PC holds a handful; the HP it replaces is capped when the hit resolves.
 */
export function grantOffers(hit: Pick<WindowHit, "grants">, pc: Pick<WindowPc, "hope" | "flags" | "gold" | "marksMultiplier">): GrantOffer[] {
  const out: GrantOffer[] = [];
  const hopeHp = Math.max(0, Math.trunc(hit.grants?.hopeHp ?? 0));
  const hope = Math.floor(Math.max(0, pc.hope ?? 0) / marksFactor(pc, "hope"));
  if (hopeHp > 0 && hope > 0 && !hopeBlocked(pc.flags)) out.push({ id: "hope", max: Math.min(hopeHp, hope) });
  const gold = Math.max(0, Math.trunc(pc.gold ?? 0));
  if (hit.grants?.goldForHp === true && gold > 0) out.push({ id: "gold", max: gold });
  return out;
}

/** The grants the current target may still take: offered, not taken yet, their turn not ended (Done) nor closed. */
export function grantAnswers(state: WindowState, characterId: string): GrantOffer[] {
  if (characterId !== state.targetId || state.closedEarly) return [];
  const pc = state.party?.find((p) => p.id === characterId);
  if (!pc) return [];
  const mine = state.responses.filter((r) => r.characterId === characterId);
  if (mine.some((r) => r.choice.kind === "pass")) return [];
  const taken = new Set(mine.flatMap((r) => (r.choice.kind === "grant" ? [r.choice.id] : [])));
  return grantOffers(state.hit, pc).filter((g) => !taken.has(g.id));
}

/** What the current target took: Hope to spend on the forced HP and handfuls of gold to pay instead of HP. */
export function grantsTaken(state: WindowState): { hope: number; gold: number } {
  const out = { hope: 0, gold: 0 };
  for (const r of state.responses) {
    if (r.characterId !== state.targetId || r.choice.kind !== "grant") continue;
    const amount = Math.max(0, Math.trunc(r.choice.amount));
    if (r.choice.id === "hope") out.hope += amount;
    else if (r.choice.id === "gold") out.gold += amount;
  }
  return out;
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

/**
 * The feature ids and card ids a PC may answer this hit with at some point (SD4): now, or (the target) once an answer
 * lowered the severity: Thick Skin on a Major hit the slot marked down to Minor (CB p.107 order). DA8: also without
 * armor, when an answer that fits now can lower it (Stable's Focus, a halving, a card's step).
 */
function answersAtOpen(pc: WindowPc, role: "target" | "ally", hit: WindowHit, severity: PcSeverity, armorCapable: boolean, creatures: TriggerCreatures): { featureIds: string[]; cardIds: string[] } {
  const features = new Set(eligibleFeatures(pc, role, hit, severity, armorCapable, { amount: hit.amount, ...creatures }).map((f) => f.featureId));
  const cards = new Set(eligibleCards(pc, role, hit, severity, armorCapable));
  if (role === "target" && (armorCapable || features.size > 0 || cards.size > 0)) {
    for (const lower of SEVERITIES.slice(SEVERITIES.indexOf(severity) + 1)) {
      for (const f of eligibleFeatures(pc, role, hit, lower, armorCapable, { amount: hit.amount, ...creatures })) features.add(f.featureId);
      for (const c of eligibleCards(pc, role, hit, lower, armorCapable)) cards.add(c);
    }
  }
  return { featureIds: [...features], cardIds: [...cards] };
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
    const { cardIds: cards, featureIds: features } = answersAtOpen(target, "target", hit, severity, armorCapable[target.id] ?? false, creatures);
    // Plan lanes-2, E2.3: a grant to answer (Hope before forced HP, gold instead of HP) makes the target a responder too, so
    // a forced-HP hit with no damage still asks them (dcm-nnbl).
    if (armorCapable[target.id] || cards.length > 0 || features.length > 0 || grantOffers(hit, target).length > 0) responders.push({ characterId: target.id, role: "target", cardIds: cards, ...(features.length > 0 ? { featureIds: features } : {}) });
    for (const pc of party) {
      if (pc.id === targetId) continue;
      const { cardIds: allyCards, featureIds: allyFeatures } = answersAtOpen(pc, "ally", hit, severity, armorCapable[pc.id] ?? false, creatures);
      if (allyCards.length > 0 || allyFeatures.length > 0) responders.push({ characterId: pc.id, role: "ally", cardIds: allyCards, ...(allyFeatures.length > 0 ? { featureIds: allyFeatures } : {}) });
    }
  }
  return { hit, originalTargetId: targetId, targetId, responders, responses: [], armorCapable, released: [], closedEarly: false, party, ...(input.attacker ? { attacker: input.attacker } : {}) };
}

const isArmorAnswer = (c: HitChoice) => c.kind === "armor" || c.kind === "noArmor" || c.kind === "pass";

/**
 * The responders still owed an answer: the target until they answer armor, and after a marked slot (or a slot
 * substitute, or "Don't mark" / OK: A1, user answer 2026-10-30) while any card or feature they hold still fits the hit,
 * until they use it or say Done (`pass`) (DA8, user 2026-10-30, CB p.107: every ready reaction stays offered, in the
 * order the player picks; SD4 kept only severity-gated ones); an ally until any answer (Q17).
 */
export function awaiting(state: WindowState): string[] {
  if (state.closedEarly) return [];
  return state.responders
    .filter((r) => {
      if (state.released.includes(r.characterId)) return false;
      const mine = state.responses.filter((x) => x.characterId === r.characterId);
      if (r.role === "target") {
        if (!armorAnswered(state, r.characterId)) return true;
        if (mine.some((x) => x.choice.kind === "pass")) return false;
        return featureAnswers(state, r.characterId).length > 0 || cardAnswers(state, r.characterId).length > 0;
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
 * Records one answer. The target answers armor / noArmor (`pass` before it counts as noArmor) once, and may play eligible
 * cards and (SD4) features before and (DA8) after a marked slot (A1: or "Don't mark") in any order (CB p.107), until
 * `pass` (Done) ends their turn; a slot substitute (Stable, Celestial Wings) is their armor answer when the hit allows one
 * slot, else it replaces one of them (A1); an ally answers once, with a card or `pass`. A card's `redirect` fold makes its user the target, who then
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
  // DA8: after the armor answer the target may still play any card or feature that fits, or say Done (`pass`); a second
  // armor answer is refused, and so is an armor answer after a slot substitute (Stable, Wings: never both, CB p.114).
  const armorDone = responder.role === "target" && armorAnswered(state, who);
  if (armorDone && (choice.kind === "armor" || choice.kind === "noArmor")) return { ok: false, code: "NOT_A_RESPONDER", detail: "The armor answer is in." };
  if (choice.kind === "card") {
    const played = state.responses.some((x) => x.characterId === who && x.choice.kind === "card" && x.choice.cardId === choice.cardId);
    if (!responder.cardIds.includes(choice.cardId) || played) return { ok: false, code: "NOT_A_RESPONDER", detail: choice.cardId };
    // DA8: the target's card must fit the hit as it is now (a card listed for a lower severity waits for it).
    if (!options.replay && responder.role === "target" && state.party && !cardAnswers(state, who).includes(choice.cardId)) return { ok: false, code: "NOT_A_RESPONDER", detail: choice.cardId };
  }
  if (choice.kind === "grant") {
    // Plan lanes-2, E2.3: only the current target, once per grant, at most what it offers now.
    if (who !== state.targetId) return { ok: false, code: "NOT_A_RESPONDER", detail: "Only the target takes a grant." };
    const taken = state.responses.some((x) => x.characterId === who && x.choice.kind === "grant" && x.choice.id === choice.id);
    const offer = grantAnswers(state, who).find((g) => g.id === choice.id);
    if (taken || (!options.replay && (!offer || !Number.isInteger(choice.amount) || choice.amount < 1 || choice.amount > offer.max))) return { ok: false, code: "NOT_A_RESPONDER", detail: choice.id };
  }
  if (choice.kind === "feature") {
    const played = state.responses.some((x) => x.characterId === who && x.choice.kind === "feature" && x.choice.featureId === choice.featureId);
    if (!(responder.featureIds ?? []).includes(choice.featureId) || played) return { ok: false, code: "NOT_A_RESPONDER", detail: choice.featureId };
  }
  // DA8: a slot substitute after another one, or after real slots that fill what the hit allows, is refused (A1).
  if (!options.replay && responder.role === "target" && substitutes(response, state) && substituteBlocked(state)) return { ok: false, code: "NOT_A_RESPONDER", detail: "The armor reduction is taken." };
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
        out.push({ kind: "reduceSeverity", steps: typeof s.amount === "number" ? s.amount : step.steps, targetIds: s.targetIds, ...(step.insteadOfArmorSlot ? { insteadOfArmorSlot: true } : {}) });
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
  options: {
    useId?: string;
    amount?: number;
    choices?: Readonly<Record<string, number>>;
    options?: Readonly<Record<string, readonly string[]>>;
    optionals?: readonly string[];
    /** DA0 / DA8: `defaultOn` optional steps the player turned off. */
    optionalsOff?: readonly string[];
    situations?: readonly string[];
  } = {},
): { result: FeatureRunResult; folds: Fold[] } {
  const useId = options.useId ?? effect.uses.find((u) => u.activation.kind === "reaction")?.id;
  const amount = options.amount ?? state.hit.amount;
  const result = runFeature(effect, useId, {
    actor: actorWithSubject(actor, creatures.target),
    gmFear: 0,
    ...(options.choices ? { choices: options.choices } : {}),
    ...(options.options ? { options: options.options } : {}),
    ...(options.optionals ? { optionals: options.optionals } : {}),
    ...(options.optionalsOff ? { optionalsOff: options.optionalsOff } : {}),
    situations: options.situations ?? [],
    trigger: { amount, subject: creatures.target, ...(creatures.attacker ? { source: creatures.attacker } : {}) },
    rng,
  });
  return { result, folds: result.ok ? withIgnoredHp(result.plan, foldsFromPlan(result.plan, actor.id, amount)) : [] };
}

/**
 * DA8: a damage cancel whose step says `ignoreOnHitHp` (Dark Aegis, user answer 2026-10-29) carries the flag on its fold,
 * so the resolution keeps the riders' extra "mark HP" off (`foldsFromPlan` keeps DA0's plain `negateDamage`).
 */
function withIgnoredHp(plan: Pick<RunPlan, "steps">, folds: Fold[]): Fold[] {
  const ignore = (plan.steps as readonly PlanStep[]).some((s) => s.kind === "fold" && s.step.kind === "negate" && s.step.what === "damage" && s.step.ignoreOnHitHp === true);
  return ignore ? folds.map((f) => (f.kind === "negateDamage" ? { kind: "negateDamage", ignoreOnHitHp: true } : f)) : folds;
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
  /**
   * DA8: the damage was cancelled with `ignoreOnHitHp` (Dark Aegis, user answer 2026-10-29): the riders' conditions still
   * land, but any extra "mark HP" from them is ignored.
   */
  hpRidersIgnored: boolean;
  /**
   * E2 (dcm-sim): conditions and effects that end because the card that made them turned this hit into no Hit Points
   * marked (`EndEvent` `reducedToNoHp`; Shield Aura, CB p.341: "If this spell causes a creature who would be damaged to
   * instead mark no Hit Points, the effect ends"). `bearerId`: the PC who took the hit; `cardId` / `ownerId`: the card
   * and its holder; `ends`: the condition or the effect label on the bearer.
   */
  endedOnNoHp: { bearerId: string; ownerId: string; cardId: string; ends: ConditionRef | { kind: "effect"; label: string } }[];
}

/** E2 (dcm-sim): what a card's steps say ends on `reducedToNoHp` (its conditions and effects), nested steps included. */
export function endsOnNoHp(card: CardEffect): (ConditionRef | { kind: "effect"; label: string })[] {
  const out: (ConditionRef | { kind: "effect"; label: string })[] = [];
  const walk = (steps: readonly Step[]) => {
    for (const s of steps) {
      if (s.kind === "condition" && s.endsOn?.includes("reducedToNoHp")) out.push(s.condition);
      else if (s.kind === "effect" && s.endsOn?.includes("reducedToNoHp")) out.push({ kind: "effect", label: s.label });
      else if (s.kind === "optional") walk(s.steps);
      else if (s.kind === "choose") for (const o of s.options) walk(o.steps);
      else if (s.kind === "check") {
        walk(s.then);
        walk(s.otherwise);
      }
    }
  };
  for (const use of card.uses) walk(use.steps);
  return out;
}

/**
 * The hit's final marks (AR3-AR5): the target's armor answer (none if they didn't answer before "Resolve now"), every
 * answer's folds in order, then `applyHitToPc`. Misses on a `negateAttack` fold, or when the attack total (rerolled by
 * an `attackRoll` fold, SD4: the new result stands, CB p.107) is below the Evasion plus any Evasion bonus (a critical
 * still hits, CB p.148). SD4: a rerolled damage replaces the amount; halvings and reductions come off it before the
 * thresholds; "N fewer Hit Points" folds (NV4) change the marks after them.
 */
export function resolveWindow(state: WindowState, party: readonly PcDefense[]): WindowResolution {
  const autos = armorSlotAutos(state);
  const folds = [...state.responses.flatMap((r) => r.folds ?? []), ...autos.flatMap((a) => a.folds)];
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
  const hpRidersIgnored = !missed && folds.some((f) => f.kind === "negateDamage" && f.ignoreOnHitHp === true);
  if (!target || missed) {
    return { originalTargetId: state.originalTargetId, targetId: state.targetId, missed, negated, result: null, reflected, manual, armorSlotsChosen, conditionNegated, hpRidersIgnored, endedOnNoHp: [] };
  }

  const marks = (list: readonly Fold[]) => {
    let extra: number | "any" = 0;
    // DA8: slot substitutes (Stable, Celestial Wings) count one step at most (CB p.114).
    const reduceSeverity = severitySteps(list, state);
    let hpDelta = 0;
    let convert: HitAdjustments["convert"];
    for (const f of list) {
      if (f.kind === "extraArmorSlots" && applies(f.targetIds, state)) extra = extra === "any" || f.max === "any" ? "any" : extra + f.max;
      if (f.kind === "hpMarked" && applies(f.targetIds, state)) hpDelta += f.delta;
      if (f.kind === "convert" && applies(f.targetIds, state)) convert = f.into;
    }
    const hit: PcHit = { ...state.hit, amount: amountNow(state, list), ...(hpDelta !== 0 ? { hpMarkedDelta: (state.hit.hpMarkedDelta ?? 0) + hpDelta } : {}) };
    return applyHitToPc(target, hit, {
      armorSlots: armorSlotsChosen,
      extraSlots: extra,
      reduceSeverity,
      negate: negated,
      ...(convert ? { convert } : {}),
    });
  };
  const result = marks(folds);
  // E2 (dcm-sim): a card whose own folds made the difference between Hit Points and none ends what it marked so.
  const endedOnNoHp: WindowResolution["endedOnNoHp"] = [];
  if (!negated && result.hpMarked === 0 && result.severityBefore !== "none") {
    const answers = [
      ...state.responses.flatMap((r) => (r.choice.kind === "card" && r.folds ? [{ characterId: r.characterId, cardId: r.choice.cardId, folds: r.folds }] : [])),
      ...autos,
    ];
    for (const a of answers) {
      const card = state.party?.find((p) => p.id === a.characterId)?.cards.find((c) => c.cardId === a.cardId);
      const ends = card ? endsOnNoHp(card) : [];
      if (ends.length === 0) continue;
      const without = folds.filter((f) => !a.folds.includes(f));
      if (marks(without).hpMarked === 0) continue;
      for (const e of ends) endedOnNoHp.push({ bearerId: state.targetId, ownerId: a.characterId, cardId: a.cardId, ends: e });
    }
  }
  return { originalTargetId: state.originalTargetId, targetId: state.targetId, missed, negated, result, reflected, manual, armorSlotsChosen, conditionNegated, hpRidersIgnored, endedOnNoHp };
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
  const folds = allFolds(state);
  // DA8: a cancelled damage (Dark Aegis) is zero: nothing for an Armor Slot to reduce.
  if (folds.some((f) => f.kind === "negateDamage")) return { damage: 0, severity: "none", maxSlots: 0 };
  const extra = extraSlotsNow(state);
  const amount = amountNow(state, folds);
  const hit = { ...state.hit, amount };
  const max = armorOptions(target, hit, extra).maxSlots;
  // A1 (dcm-bxp.99.19.55 (6)): a slot substitute (Stable, Wings) took one of the slots the hit allows (E2: one step's
  // worth of dearer slots, dcm-s77).
  const left = substituteTaken(state) && extra !== "any" ? Math.min(max, Math.max(0, extra) * slotsPerStep(hit)) : max;
  return { damage: amount, severity: damageBeforeArmor(target, hit).severity, maxSlots: left };
}

/**
 * A1: the hit PC's "mark N slots" preview (0..maxSlots) from the hit as the answers so far left it: the severity steps
 * already folded in (a slot substitute used beside further slots, dcm-bxp.99.19.55 (6)) and the "N fewer Hit Points"
 * answers come on top of each count.
 */
export function targetArmorPreview(state: WindowState, target: PcDefense): { slots: number; severity: PcSeverity; hp: number }[] {
  const prompt = targetPrompt(state, target);
  const base = damageBeforeArmor(target, { ...state.hit, amount: prompt.damage }).severity;
  const per = slotsPerStep(state.hit);
  // E2: dearer slots (dcm-s77) are listed in whole steps (0, 2, 4); a marked slot adds what it sets off (Shield Aura, dcm-sim).
  return Array.from({ length: Math.floor(prompt.maxSlots / per) + 1 }, (_, n) => {
    const folds = allFolds(state, n > 0 || realSlotsChosen(state) > 0);
    const steps = severitySteps(folds, state);
    const delta = (state.hit.hpMarkedDelta ?? 0) + folds.reduce((m, f) => m + (f.kind === "hpMarked" && applies(f.targetIds, state) ? f.delta : 0), 0);
    const severity = base === "none" ? "none" : stepDown(stepDown(base, n), steps);
    const hp = hpForSeverity(severity);
    return { slots: n * per, severity, hp: hp > 0 ? Math.max(0, hp + delta) * marksFactor(target, "hp") : 0 };
  });
}
