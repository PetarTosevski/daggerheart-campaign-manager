/**
 * The shared internals of the dice rolls (moved from convex/rolls.ts by plan combat-actions CA3, CF8: plain helpers in
 * convex/lib, no `ctx.runMutation`). Behaviour is unchanged: `convex/rolls.ts` keeps the public functions and calls these;
 * `convex/combatActions.ts` reuses the same Duality and damage steps for weapon attacks on the Combat Map.
 *
 * - `duality(ctx, loaded, args, rng, manual)`: a character's Duality roll, saved and logged (one public row), Fear gained,
 *   armed countdowns ticked, the roll's aftermath run (spotlight S1, R3 Manual note: ./rollAftermath), class-feature
 *   prompts returned. Hope and Fear follow the campaign's R3 switch (`hopeFearModeOf`). `resolveDuality` is its first half (pay, roll, apply Hope /
 *   Stress) without saving or logging, for callers that log their own rows (a combat attack).
 * - `damage(ctx, loaded, args, rng, manual)`: a damage roll, saved and logged. `resolveDamage` is its first half.
 * - Validators of the roll arguments and results (`dualityFields`, `damageFields`, ...), shared by both modules.
 */
import { v } from "convex/values";

import { withEffects } from "../../src/lib/domain/characters/effects";
import { withPassiveTraits } from "../../src/lib/domain/characters/derived";
import { BRAWLERS_STRIKE } from "../../src/lib/domain/class-features/classes/brawler";
import { afterDualityRoll, rollOptions, weaponOverrides } from "../../src/lib/domain/class-features/hooks";
import { CLASS_FEATURES } from "../../src/lib/domain/class-features/index";
import type { FeatureScope, WeaponOverride } from "../../src/lib/domain/class-features/types";
import { ikonisWeapon, type IkonisWeapon } from "../../src/lib/domain/dice/ikonis";
import {
  applyDualityEffects,
  applyRollOptions,
  assertTypedModifier,
  DiceRuleError,
  dualityEffects,
  experienceBonus,
  NotEnoughHopeError,
  OUTCOME_LABEL,
  queueRng,
  rollDamage,
  rollDuality,
  spendHope,
  typedLabel,
  weaponDice,
  type DamageInput,
  type DualityInput,
  type Rng,
} from "../../src/lib/domain/dice/index";
import { countsAsActionRoll } from "../../src/lib/domain/countdowns/advanced";
import type { RollRecord } from "../../src/lib/domain/duality";
import type { EndRoll } from "../../src/lib/domain/characters/expiry";
import { placeTideToken, rerollSlayerOnes, rollGaveHope, SLAYER_DIE_SIDES, spendSlayerDice, spendTideTokens, WITH_HOPE } from "../../src/lib/domain/session-features/index";
import { requirementMet } from "../../src/lib/domain/card-effects/availability";
import { run as runCardUse } from "../../src/lib/domain/card-effects/run";
import type { CardUse, Mod, RollFilter, RollResult, Step } from "../../src/lib/domain/card-effects/types";
import { runFeature } from "../../src/lib/domain/feature-effects/run";
import { owned } from "../../src/lib/domain/feature-effects/owned";
import { appError } from "../../src/lib/errors/app-error";
import { cardEffect } from "../../src/lib/srd/card-effects/index";
import { featureEffect } from "../../src/lib/srd/feature-effects/index";
import { getWeapon } from "../../src/lib/srd/index";
import { lastingModsOf } from "../../src/lib/domain/adversary-effects/run";
import { adversaryEffects } from "../../src/lib/srd/adversary-effects/index";
import type { TraitId } from "../../src/lib/srd/types";
import { FRAME_OF, TRAIT_LABEL } from "../../src/lib/frames/extras/common";
import type { CharacterSheet, Effect } from "../../src/lib/validation/characters";
import { motherboardState } from "./motherboardState";
import { tickArmedCountdowns } from "../countdownRolls";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logAction, newGroupId } from "./actionLog";
import { assertCanAct, loadCharacter, noteHopeSpent, readSheet, saveSheet } from "./characterSheet";
import { applyPcActionRoll, fearWithheldBy, hopeFearModeOf, outcomeSucceeds, outcomeWithFear, planPcActionRoll } from "./rollAftermath";
import { rollDie } from "./dice";
import { featureScope } from "./featureScope";
import { campaignFearState, gainFear } from "./fear";
import { applyRule } from "./mechanics";
import { actorSheetAfter, cardActor, cardIdOfEffect, conditionMarkerOf, endConditionsOnRoll, endRollOf, featureIdOfEffect, tokenKeyOf, type HostRoll } from "./cardRunner";
import { effectEndsOf, effectSource, endAdversaryConditionsOnRoll, endGrantedBenefit, endOnSheet, endSharedGrants } from "./cardRows";
import { riderStepsText } from "./adversaryFeatures";
import { partyMembers } from "./adversaryHits";
import { pcRollAdversaryUses } from "./adversaryActions";
import { rollValidator } from "./validators/actionLog";
import { traitIdValidator } from "./validators/characters";

// ---------------------------------------------------------------- validators

export const dualityKind = v.union(v.literal("action"), v.literal("reaction"));

export const dualityFields = {
  trait: traitIdValidator,
  modifier: v.number(),
  difficulty: v.optional(v.number()),
  /** Experiences used (1 Hope each, CB 90). */
  experienceIds: v.array(v.string()),
  advantage: v.number(),
  disadvantage: v.number(),
  /** Help an Ally dice (each helper spends their own Hope). */
  help: v.number(),
  /** An attack roll: effect attack bonuses apply. */
  attack: v.boolean(),
  /**
   * Plan lanes-2 wave 9, E1.3b (dcm-6qrn, user answer 2026-10-31 Q21): the weapon an attack roll is made with; absent on an
   * attack = no weapon (a non-weapon attack). Weapon-attack ends (Menacing Reach, HF p.15) and `weaponAttack` filters read it.
   */
  weapon: v.optional(v.union(v.literal("primary"), v.literal("secondary"))),
  /** Chosen `rollOptions` keys (auto options apply anyway). */
  options: v.array(v.string()),
  /** An Ikonis attack (Motherboard): its trait, Converge/Target bonus and Override's advantage apply. */
  ikonis: v.optional(v.boolean()),
  /** Slayer Dice to spend (attack rolls only, CB 48): rolled by the server and added. */
  slayerDice: v.optional(v.number()),
  /** Know the Tide tokens to spend (action rolls only, CB 77): +1 each. */
  tideTokens: v.optional(v.number()),
  /**
   * Plan lanes, E1 (dcm-733): the situations the player marks this roll as (Q13), for a live `advantage` mod with a
   * `situation` (Patron's Mantle, HF p.14: "advantage on action rolls to intimidate a target").
   */
  situations: v.optional(v.array(v.string())),
};

export const poolValidator = v.array(v.object({ count: v.number(), sides: v.number() }));

export const damageSource = v.union(
  v.object({ kind: v.literal("weapon"), slot: v.union(v.literal("primary"), v.literal("secondary")) }),
  v.object({ kind: v.literal("override"), key: v.string() }),
  /** The character's Ikonis (Motherboard, CB 301). */
  v.object({ kind: v.literal("ikonis") }),
  /** Dice named by a spell or feature ("d6 using Spellcast"): rolled as given. */
  v.object({ kind: v.literal("dice"), dice: poolValidator }),
);

export const damageFields = {
  source: damageSource,
  critical: v.boolean(),
  modifier: v.number(),
  options: v.array(v.string()),
  /** Slayer Dice to spend (CB 48): rolled by the server and added. */
  slayerDice: v.optional(v.number()),
};

export const promptValidator = v.object({
  key: v.string(),
  featureKey: v.string(),
  text: v.string(),
  choices: v.array(v.object({ key: v.string(), label: v.string() })),
});

/**
 * `fearGained` is absent for a player while "Players see the GM's Fear" is off (dcm-jh6d.62): 0 would tell them the pool
 * is full. Optional since then; the GM and co-GMs always get it.
 */
export const dualityResult = v.object({ entryId: v.id("actionLog"), roll: rollValidator, fearGained: v.optional(v.number()), prompts: v.array(promptValidator) });
export const damageResult = v.object({ entryId: v.id("actionLog"), roll: rollValidator });

export type DualityArgs = {
  kind: "action" | "reaction";
  trait: TraitId;
  modifier: number;
  difficulty?: number;
  experienceIds: string[];
  advantage: number;
  disadvantage: number;
  help: number;
  attack: boolean;
  weapon?: "primary" | "secondary";
  options: string[];
  ikonis?: boolean;
  slayerDice?: number;
  tideTokens?: number;
  situations?: string[];
};
type DamageSource = { kind: "weapon"; slot: "primary" | "secondary" } | { kind: "override"; key: string } | { kind: "ikonis" } | { kind: "dice"; dice: { count: number; sides: number }[] };
type DamageArgs = { source: DamageSource; critical: boolean; modifier: number; options: string[]; slayerDice?: number };

const MAX_OPTIONS = 20;
const MAX_VALUES = 40;

// ---------------------------------------------------------------- shared steps

/** Runs dice rules, turning their expected refusals into DICE_RULE / NOT_ENOUGH_HOPE. */
export function rules<T>(run: () => T): T {
  return applyRule("NOT_ENOUGH_HOPE", NotEnoughHopeError, () => applyRule("DICE_RULE", DiceRuleError, run));
}

export function changed(a: CharacterSheet, b: CharacterSheet): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

export function signed(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}

/**
 * The character's Ikonis as a weapon (Motherboard only), read from its
 * Motherboard module (`motherboardState`: its `characterExtras` row, seeded by
 * `characters.create`, or the legacy tracker row).
 */
async function loadIkonis(ctx: QueryCtx, campaign: Doc<"campaigns">, character: Doc<"characters">, sheet: CharacterSheet): Promise<IkonisWeapon> {
  if (campaign.frameId !== FRAME_OF.motherboard) throw appError("DICE_RULE", "Only Motherboard characters have an Ikonis.");
  const state = await motherboardState(ctx, campaign, character._id);
  const weapon = state === null ? null : ikonisWeapon(state.ikonis, state.installed, sheet.level, sheet.proficiency);
  if (weapon === null) throw appError("DICE_RULE", "Design your Ikonis first (Motherboard panel).");
  return weapon;
}

// ---------------------------------------------------------------- live card-effect mods (plan lanes, E1)

/** A card-effect mod live on a sheet now, with the sheet effect that carries it (none for a passive use). */
export type LiveMod = { mod: Mod; effectId?: string; endsOnAttack?: boolean };

/** Every step of a list, nested ones included. */
function nestedSteps(steps: readonly Step[]): Step[] {
  return steps.flatMap((s) => [
    s,
    ...(s.kind === "optional" || s.kind === "followUp" ? nestedSteps(s.steps) : []),
    ...(s.kind === "choose" ? s.options.flatMap((o) => nestedSteps(o.steps)) : []),
    ...(s.kind === "save" ? [...nestedSteps(s.onFail), ...nestedSteps(s.onSuccess)] : []),
    ...(s.kind === "check" ? [...nestedSteps(s.then), ...nestedSteps(s.otherwise)] : []),
  ]);
}

/** The requirement state of a sheet for a passive use's conditions (situations are the player's: none confirmed). */
function passiveState(sheet: CharacterSheet) {
  const actor = cardActor("self", sheet, "", undefined);
  return { hp: sheet.hp, hpMax: sheet.hpMax, stress: sheet.stress, stressMax: sheet.stressMax, armor: sheet.armorMarked, hope: sheet.hope, armorWorn: actor.armorWorn, loadoutDomains: actor.loadoutDomains, activeCardEffects: actor.activeCardEffects, situations: [] };
}

/**
 * Plan lanes, E1: the card-effect mods live on a sheet that the stored sheet effect can't hold (it keeps Evasion, attack,
 * damage and one trait): the `passive` uses of the loadout's cards and of the features held whose conditions hold, and
 * the `effect` steps behind the sheet's effects (found by the effect's owner and its label). Versatile Fighter's
 * `weaponTrait` (dcm-5dg), Parallela's `extraTargets` (dcm-y3e), Patron's Mantle's situational `advantage` (dcm-733).
 */
export function liveMods(sheet: CharacterSheet, scope: Pick<FeatureScope, "hopeAndFear">): LiveMod[] {
  const out: LiveMod[] = [];
  const state = passiveState(sheet);
  const passives = (uses: readonly CardUse[]) => {
    for (const use of uses) {
      if (use.activation.kind !== "passive" || use.mods === undefined) continue;
      if (!(use.requires ?? []).every((r) => r.kind !== "situation" && requirementMet(r, state))) continue;
      for (const mod of use.mods) out.push({ mod });
    }
  };
  for (const cardId of sheet.domainCards.loadout) passives(cardEffect(cardId)?.uses ?? []);
  for (const held of owned(sheet, { hopeAndFear: scope.hopeAndFear })) passives(featureEffect(held.featureId)?.uses ?? []);
  for (const effect of sheet.effects ?? []) {
    const cardId = cardIdOfEffect(effect);
    const featureId = cardId === null ? featureIdOfEffect(effect) : null;
    const entry = cardId !== null ? cardEffect(cardId) : featureId !== null ? featureEffect(featureId) : undefined;
    const label = effect.text.split("; ")[0];
    // E1.4b (dcm-hqk1): an upgrade's added options carry effect steps too (Reliable Backup's "backup", CB p.43).
    const stepLists: (readonly Step[])[] = [...(entry?.uses ?? []).map((u) => u.steps), ...upgradeOptionSteps(entry)];
    for (const list of stepLists) {
      for (const step of nestedSteps(list)) {
        if (step.kind !== "effect" || step.label !== label) continue;
        const endsOnAttack = (step.endsOn ?? []).includes("bearerAttacks");
        for (const mod of step.mods) out.push({ mod, effectId: effect.id, ...(endsOnAttack ? { endsOnAttack } : {}) });
      }
    }
  }
  return out;
}

/** The steps of the options an entry's upgrades add (`patch.extraOptions`, Reliable Backup's two benefits, CB p.43). */
function upgradeOptionSteps(entry: object | undefined): (readonly Step[])[] {
  const out: (readonly Step[])[] = [];
  const upgrades = entry !== undefined && "upgrades" in entry ? (entry.upgrades as readonly { patch?: { extraOptions?: readonly { steps: readonly Step[] }[] } }[] | undefined) : undefined;
  for (const up of upgrades ?? []) {
    for (const o of up.patch?.extraOptions ?? []) out.push(o.steps);
  }
  return out;
}

/**
 * Whether a roll filter covers a plain Duality roll (its kind, trait and whether it is an attack). E1.3b (dcm-6qrn): a
 * `weaponAttack` needs the weapon the player named; an attack with no weapon is an `attack` only.
 */
export function filterCoversRoll(on: RollFilter, roll: { kind: "action" | "reaction"; trait: TraitId; attack: boolean; weapon?: "primary" | "secondary" }): boolean {
  switch (on) {
    case "any":
      return true;
    case "action":
      return roll.kind === "action";
    case "reaction":
      return roll.kind === "reaction";
    case "attack":
      return roll.attack;
    case "weaponAttack":
      return roll.attack && roll.weapon !== undefined;
    case "spellcast":
    case "damage":
      return false;
    default:
      return roll.trait === on;
  }
}

const MAX_SITUATIONS = 10;

/**
 * Plan lanes, E1: a roll trigger's `result` and `duality` filters on a finished roll. A critical is a success with Hope
 * (CB p.90). `successWithHope` (Favor, HF p.14; Ethereal Visage, CB p.45; dcm-a9n, dcm-nhr), `successWithFear`
 * (Dread-Touched, HF p.181; dcm-1o3); `duality` narrows any result to a roll with Hope / Fear (Courage, CB p.48: "When you
 * fail a roll with Fear"; dcm-5z3).
 */
export function rollResultHolds(result: RollResult | undefined, duality: "hope" | "fear" | undefined, roll: HostRoll): boolean {
  if (duality === "hope" && !roll.withHope) return false;
  if (duality === "fear" && !roll.withFear) return false;
  switch (result) {
    case undefined:
    case "any":
      return true;
    case "success":
      return roll.success;
    case "failure":
      return !roll.success;
    case "critical":
      return roll.critical;
    case "successWithHope":
      return roll.success && roll.withHope;
    case "successWithFear":
      return roll.success && roll.withFear;
    case "withHope":
      return roll.withHope;
    case "withFear":
      return roll.withFear;
  }
}

/** A Duality roll record as a trigger reads it. */
export function hostRollOfRecord(roll: RollRecord): HostRoll {
  const critical = roll.outcome === "critical";
  return { success: critical || roll.outcome === "successHope" || roll.outcome === "successFear", critical, withHope: critical || roll.outcome === "successHope" || roll.outcome === "failHope", withFear: roll.outcome === "successFear" || roll.outcome === "failFear" };
}

/** Whether a use only touches its actor (no targets, every step on `self`): it can run off the map. */
function selfOnly(use: CardUse): boolean {
  if (use.targets !== undefined && use.targets.side !== "self") return false;
  return nestedSteps(use.steps).every((st) => !("to" in st) || st.to === "self");
}

/**
 * Plan lanes, E1: the automatic `afterYouRoll` uses a plain Duality roll sets off (dcm-5z3 Courage, CB p.48: "When you fail
 * a roll with Fear, you gain a Hope"): the loadout cards' and the held features' `auto` uses whose roll filter covers the
 * roll and whose result holds, that touch only the actor (a target filter, `fromUse` or `cardDomain` never holds on a plain
 * roll). Success and failure need the Difficulty: without one only the Hope / Fear and critical filters can hold. A use
 * that can't run (its limit, a condition, a situation the player has not confirmed) is skipped quietly.
 */
export function plainRollAutos(sheet: CharacterSheet, args: Pick<DualityArgs, "kind" | "trait" | "attack">, roll: RollRecord, scope: Pick<FeatureScope, "hopeAndFear">, gmFear: number, rng: Rng): { sheet: CharacterSheet; names: string[]; gmFearDelta: number } {
  const host = hostRollOfRecord(roll);
  let next = sheet;
  const names: string[] = [];
  let gmFearDelta = 0;
  const fires = (use: CardUse): boolean => {
    if (use.activation.kind !== "auto" || use.activation.trigger.kind !== "afterYouRoll") return false;
    const t = use.activation.trigger;
    if (t.roll === "damage" || !filterCoversRoll(t.roll, args)) return false;
    if (t.against !== undefined || t.fromUse !== undefined || t.cardDomain !== undefined) return false;
    if ((t.result === "success" || t.result === "failure" || t.result === "successWithHope" || t.result === "successWithFear") && roll.difficulty === undefined) return false;
    return rollResultHolds(t.result, t.duality, host) && selfOnly(use);
  };
  for (const cardId of sheet.domainCards.loadout) {
    const effect = cardEffect(cardId);
    if (effect === undefined) continue;
    for (const use of effect.uses) {
      if (!fires(use)) continue;
      const result = runCardUse(effect, { actor: cardActor("self", next, cardId, undefined), gmFear, useId: use.id, targets: [], rng });
      if (!result.ok) continue;
      next = actorSheetAfter(next, result.plan, "self", use.name, { rng });
      gmFearDelta += result.plan.gmFearDelta;
      names.push(use.name);
    }
  }
  for (const held of owned(sheet, { hopeAndFear: scope.hopeAndFear })) {
    const entry = featureEffect(held.featureId);
    if (entry === undefined) continue;
    for (const use of entry.uses) {
      if (!fires(use)) continue;
      const result = runFeature(entry, use.id, { actor: cardActor("self", next, tokenKeyOf(held.featureId), undefined), gmFear, targets: [], rng });
      if (!result.ok) continue;
      next = actorSheetAfter(next, result.plan, "self", held.name, { rng });
      gmFearDelta += result.plan.gmFearDelta;
      names.push(use.name);
    }
  }
  return { sheet: next, names, gmFearDelta };
}

/**
 * Plan lanes, E1 (dcm-733, Q13): one advantage die per live `advantage` mod with a `situation` the player marked this roll
 * as, when its roll filter covers the roll (Patron's Mantle, HF p.14: "advantage on action rolls to intimidate a target").
 * A mod without a situation is not counted here (the passive features already reach the roll another way).
 */
export function situationalAdvantage(sheet: CharacterSheet, args: Pick<DualityArgs, "kind" | "trait" | "attack" | "weapon" | "situations">, scope: Pick<FeatureScope, "hopeAndFear">): { advantage: number; labels: string[]; effectIds: string[] } {
  const marked = args.situations ?? [];
  if (marked.length > MAX_SITUATIONS) throw new DiceRuleError("Too many situations.");
  if (marked.length === 0) return { advantage: 0, labels: [], effectIds: [] };
  let advantage = 0;
  const labels: string[] = [];
  // E1.3b (dcm-79v1): the sheet effects whose advantage this roll used (a granted benefit ends once used).
  const effectIds: string[] = [];
  for (const { mod, effectId } of liveMods(sheet, scope)) {
    if (mod.kind !== "advantage" || mod.situation === undefined || !marked.includes(mod.situation)) continue;
    if (!filterCoversRoll(mod.on, args)) continue;
    advantage += 1;
    labels.push(`advantage: ${mod.situation}`);
    if (effectId !== undefined) effectIds.push(effectId);
  }
  return { advantage, labels, effectIds };
}

/**
 * Plan lanes-2 wave 10, E1.4b (dcm-hqk1; user answer 2026-10-31): a live `dualityDie` mod with a `situation` changes the
 * Hope Die only on a roll the player marks as that situation (Reliable Backup, CB p.43: "When you make a Presence Roll in
 * conversation, they back you up. You can roll a d20 as your Hope Die"; the dice box's "In conversation" check box).
 * Mods without a situation are not read here. Only the Hope Die is swapped (no SRD entry gives a situational Fear Die).
 */
export function situationalHopeDie(mods: readonly LiveMod[], situations: readonly string[] | undefined): { sides: number | undefined; labels: string[] } {
  const marked = situations ?? [];
  let sides: number | undefined;
  const labels: string[] = [];
  for (const { mod } of mods) {
    if (mod.kind !== "dualityDie" || mod.die !== "hope" || mod.situation === undefined || !marked.includes(mod.situation)) continue;
    sides = Math.max(sides ?? 0, mod.sides);
    labels.push(`d${mod.sides} Hope Die: ${mod.situation}`);
  }
  return { sides, labels };
}

/**
 * E1.4b (dcm-hqk1): whether a sheet effect may end on this roll by its `RollEnd.situation` (CB p.43: the backup ends on "a
 * Presence Roll in conversation"): an end without a situation always may; one with a situation only when the player marked
 * the roll as it. The rest of the `RollEnd` is E6's end engine (`endOnSheet`).
 */
export function rollEndSituationHolds(effect: Effect, situations: readonly string[] | undefined): boolean {
  const situation = effectEndsOf(effect)?.endsOnRoll?.situation;
  return situation === undefined || (situations ?? []).includes(situation);
}

const ADV_SHEET_EFFECT = /^card:([^/:]+)\/(.+):\d+$/;

/** The steps of the entry a sheet effect came from: an adversary feature (`card:<adversaryId>/<feature>:n`) or a card / PC feature. */
function sheetEffectSteps(effect: Effect): { steps: readonly unknown[]; label: string } | null {
  const label = effect.text.split("; ")[0] ?? "";
  const adv = ADV_SHEET_EFFECT.exec(effect.id);
  if (adv) return { steps: (adversaryEffects(adv[1]!).find((e) => e.feature === adv[2]!)?.uses ?? []).map((u) => u.steps), label };
  const src = effectSource(effect);
  if (src === null) return null;
  const entry = cardEffect(src.sourceId) ?? featureEffect(src.sourceId);
  return entry === undefined ? null : { steps: entry.uses.map((u) => u.steps), label: src.label };
}

/**
 * Plan lanes-2 wave 9, E1.3b (dcm-mm0f / dcm-kti, PC-roll half): the mods of what a PC carries that act on their own rolls,
 * read back from the entry that gave it (the sheet effect stores only its text): Poisoned's d6 before each action roll
 * (CB p.211), Envelop's Stress, Ignite's 1d4 (CB p.215-216), Shadow Shackles' Hope (CB p.222) as `bearerRider`s;
 * Taunted / Sandstorm / Light and Shadow as `disadvantage`.
 */
export function sheetBearerMods(sheet: Pick<CharacterSheet, "effects">): { label: string; mod: Mod }[] {
  const out: { label: string; mod: Mod }[] = [];
  for (const e of sheet.effects ?? []) {
    const found = sheetEffectSteps(e);
    if (found === null) continue;
    for (const mod of lastingModsOf(found.steps, found.label)) if (mod.kind === "bearerRider" || mod.kind === "disadvantage") out.push({ label: found.label, mod });
  }
  return out;
}

/** E1.4b (dcm-b41o): every lasting mod of what a PC carries, read back from the entry that gave it (flags included). */
export function sheetCarriedMods(sheet: Pick<CharacterSheet, "effects">): { label: string; mod: Mod }[] {
  const out: { label: string; mod: Mod }[] = [];
  for (const e of sheet.effects ?? []) {
    const found = sheetEffectSteps(e);
    if (found === null) continue;
    for (const mod of lastingModsOf(found.steps, found.label)) out.push({ label: found.label, mod });
  }
  return out;
}

/**
 * E1.3b (dcm-mm0f): what the bearer's mods do to this roll. A `disadvantage` mod covering the roll with nothing the server
 * can't see (`beyond`, `unlessTarget`, `situation` are left out here: the map attack reads `beyond`) gives one
 * disadvantage die each; a `bearerRider` on `actionRoll`, `acts` (an action roll is an action) or `attack` is named in the
 * roll's line as a reminder of its steps (the steps are not run yet: follow-up).
 */
export function bearerRollMods(sheet: Pick<CharacterSheet, "effects">, args: Pick<DualityArgs, "kind" | "trait" | "attack" | "weapon">): { disadvantage: number; labels: string[]; reminders: string[] } {
  let disadvantage = 0;
  const labels: string[] = [];
  const reminders: string[] = [];
  for (const { label, mod } of sheetBearerMods(sheet)) {
    if (mod.kind === "disadvantage") {
      if (mod.beyond !== undefined || mod.unlessTarget !== undefined || mod.situation !== undefined) continue;
      if (!filterCoversRoll(mod.on, args)) continue;
      disadvantage += 1;
      labels.push(`disadvantage: ${label}`);
    }
    // E1.4b (dcm-l1er, user answer 2026-10-31): a bearerRider on the roll runs in `bearerRiderRuns`; no reminder here.
  }
  return { disadvantage, labels, reminders };
}

/** Whether a `bearerRider` rides on this roll: `actionRoll` / `acts` on an action roll, `attack` on an attack, its `roll` filter. */
export function bearerRiderFires(rider: Extract<Mod, { kind: "bearerRider" }>["rider"], args: Pick<DualityArgs, "kind" | "trait" | "attack" | "weapon">): boolean {
  const on = rider.on;
  const fires = (on === "actionRoll" && args.kind === "action") || (on === "acts" && args.kind === "action") || (on === "attack" && args.attack);
  return fires && (rider.roll === undefined || filterCoversRoll(rider.roll, args));
}

/** "marks 1 Stress", "marks 2 HP", "spends 1 Hope": what a rider changed on the bearer. */
function changesText(before: CharacterSheet, after: CharacterSheet): string {
  const parts: string[] = [];
  const d = (n: number, word: string, up: string, down: string) => {
    if (n > 0) parts.push(`${up} ${n} ${word}`);
    else if (n < 0) parts.push(`${down} ${-n} ${word}`);
  };
  d(after.stress - before.stress, "Stress", "marks", "clears");
  d(after.hp - before.hp, "HP", "marks", "clears");
  d(after.hope - before.hope, "Hope", "gains", "spends");
  d(after.armorMarked - before.armorMarked, "Armor Slot", "marks", "clears");
  return parts.length > 0 ? parts.join(", ") : "no change";
}

/**
 * Plan lanes-2 wave 10, E1.4b (dcm-l1er; user answer 2026-10-31: "Bearer riders on a PC's own rolls run automatically"):
 * the `bearerRider`s of what the PC carries that ride on this roll run as a plan on the bearer, before the roll, in the
 * roll's row: Poisoned's d6 before each action roll (CB p.211: on 4 or lower, mark a Stress), Envelop's Stress, Ignite's
 * 1d4 (CB p.215-216), Shadow Shackles' Hope (CB p.222: "must spend a Hope to make an action roll"). The rider's dice are
 * the server's (`rng`, as Slayer Dice: a typed-in roll types only its own dice). A cost the bearer can't pay refuses the
 * roll (DICE_RULE); a rider the runner can't run stays a reminder line.
 */
export function bearerRiderRuns(sheet: CharacterSheet, args: Pick<DualityArgs, "kind" | "trait" | "attack" | "weapon">, rng: Rng): { sheet: CharacterSheet; lines: string[] } {
  let next = sheet;
  const lines: string[] = [];
  for (const { label, mod } of sheetBearerMods(sheet)) {
    if (mod.kind !== "bearerRider" || !bearerRiderFires(mod.rider, args)) continue;
    const use: CardUse = { id: "bearer", name: label, activation: { kind: "action" }, ...(mod.rider.costs ? { costs: mod.rider.costs } : {}), steps: mod.rider.steps };
    const result = runCardUse({ cardId: `bearer-${label}`, uses: [use] } as never, { actor: cardActor("self", next, "", undefined), gmFear: 0, useId: "bearer", targets: [], rng });
    if (!result.ok) {
      if (result.reason === "cost") throw new DiceRuleError(`${label}: pay its cost to make this roll (${riderStepsText(mod.rider.steps) || "a cost"}).`);
      lines.push(`${label}: ${riderStepsText(mod.rider.steps)} (not automated)`);
      continue;
    }
    const after = actorSheetAfter(next, result.plan, "self", label, { rng });
    const prompts = result.plan.steps.flatMap((s) => (s.kind === "prompt" ? [s.text] : []));
    lines.push(`${label}: ${changesText(next, after)}${prompts.length > 0 ? ` (${prompts.join("; ")})` : ""}`);
    next = after;
  }
  return { sheet: next, lines };
}

// ---------------------------------------------------------------- die changes (moved from ./combatActions, E1.4b)

/** Recomputes a roll record's total from its dice (the dropped ones don't count). */
export function retotal(record: RollRecord): RollRecord {
  return { ...record, total: record.dice.reduce((s, d) => s + (d.dropped ? 0 : d.value), 0) + record.modifier };
}

/**
 * DA2 (Rise to the Challenge, CB p.48: "roll a d20 as your Hope Die"): a die source whose next 12-sided draw, once armed,
 * draws `sides` instead. A Duality roll draws its Hope Die first (`rollDuality`: Hope, Fear, then the advantage dice), so
 * arming it right before the roll swaps the Hope Die only. Put it outside a recorder so the held attack replays the value.
 */
export function hopeDieSwitch(base: Rng): { rng: Rng; arm: (sides: number | undefined) => void } {
  let next: number | undefined;
  return {
    rng: (sides) => {
      if (next !== undefined && sides === 12) {
        const s = next;
        next = undefined;
        return base(s);
      }
      return base(sides);
    },
    arm: (sides) => {
      next = sides !== undefined && sides !== 12 ? sides : undefined;
    },
  };
}

/**
 * Plan lanes, E1 (dcm-3ou, dcm-jog): the roll with bonuses added to the duality dice's results (Backhanded Guidance, HF
 * p.87: "add 1d6 to the result of their Fear Die"; Ill Omen, HF p.95: "their Fear Die gains a bonus equal to the amount
 * of Fear you have"), its total and its outcome read again. The die keeps its sides; its value is the result with the bonus.
 *
 * User answer 2026-10-31: a bonus never makes a critical; a critical needs the dice to match as rolled (a roll that was
 * a critical stays one). Otherwise the bonus only decides Hope vs Fear, and a tie after the bonus is WITH FEAR.
 */
export function withDieBonuses(record: RollRecord, bonuses: readonly { die: "hope" | "fear"; amount: number }[]): RollRecord {
  const add = { hope: 0, fear: 0 };
  for (const b of bonuses) add[b.die] += b.amount;
  if (add.hope === 0 && add.fear === 0) return record;
  const dice = record.dice.map((d) => ((d.role === "hope" || d.role === "fear") && !d.dropped ? { ...d, value: d.value + add[d.role] } : d));
  const next = retotal({ ...record, dice });
  if (record.outcome === "critical") return next;
  const hope = dice.find((d) => d.role === "hope" && !d.dropped)?.value ?? 0;
  const fear = dice.find((d) => d.role === "fear" && !d.dropped)?.value ?? 0;
  const success = record.difficulty === undefined || next.total >= record.difficulty;
  const outcome: RollRecord["outcome"] = hope > fear ? (success ? "successHope" : "failHope") : success ? "successFear" : "failFear";
  return { ...next, outcome };
}

/** `withDieBonuses` with one bonus. */
export function withDieBonus(record: RollRecord, die: "hope" | "fear", amount: number): RollRecord {
  return withDieBonuses(record, [{ die, amount }]);
}

/** The roll record with its Hope Die's sides set (the value was already drawn from those sides). */
export function withHopeSides(record: RollRecord, sides: number | undefined): RollRecord {
  if (sides === undefined || sides === 12) return record;
  return { ...record, dice: record.dice.map((d) => (d.role === "hope" ? { ...d, sides } : d)) };
}

/** Pays a Duality roll's costs (Experiences, roll options) and builds the resolver's input. */
export function prepareDuality(sheet: CharacterSheet, args: DualityArgs, scope: FeatureScope, ikonis: IkonisWeapon | null): { paid: CharacterSheet; input: DualityInput; extras: string[] } {
  if (args.options.length > MAX_OPTIONS) throw new DiceRuleError("Too many options.");
  const situational = situationalAdvantage(sheet, args, scope);
  const bearer = bearerRollMods(sheet, args);
  assertTypedModifier(args.modifier);
  // DA19 (B1, dcm-bxp.99.19.19): the passive features' trait bonuses (a Beastform's statistics, CB p.30) on top of effects.
  const live = withPassiveTraits(withEffects(sheet), scope);
  const exp = experienceBonus(sheet.experiences, args.experienceIds);
  const opts = applyRollOptions(spendHope(sheet, exp.hope), rollOptions(sheet, args.kind, CLASS_FEATURES, scope), args.options);
  const attack = args.attack || ikonis !== null;
  const spent = spendSessionFeatures(opts.sheet, args, attack);
  return {
    paid: spent.sheet,
    input: {
      kind: args.kind,
      trait: live.traits[ikonis?.trait ?? args.trait],
      modifier: args.modifier + exp.value + opts.modifier + spent.tide + (attack ? live.attackBonus : 0) + (ikonis?.attack ?? 0),
      ...(args.difficulty !== undefined ? { difficulty: args.difficulty } : {}),
      advantage: args.advantage + opts.advantage + (ikonis?.advantage ? 1 : 0) + situational.advantage,
      disadvantage: args.disadvantage + bearer.disadvantage,
      help: args.help,
      extraDice: [...opts.extraDice, ...opts.namedDice],
      // Slayer Dice come last, already rolled by the server rng (a manual roll types in only its own dice).
      fixedDice: [...opts.fixedDice, ...spent.slayer],
    },
    extras: [...(ikonis ? [ikonis.label, ...ikonis.augments] : []), ...exp.names, ...opts.labels, ...spent.labels, ...situational.labels, ...bearer.labels, ...bearer.reminders],
  };
}

/**
 * One Slayer d6 each, rolled with the server's rng whatever the roll's own dice come from (U3). Weapon Specialist
 * (CB 48, dcm-bxp.62) then rerolls any 1s once per long rest, with the same rng: `sheet` comes back with the use marked
 * and `labels` names the reroll.
 */
function rollSlayerDice(sheet: CharacterSheet, n: number): { sheet: CharacterSheet; dice: { sides: number; value: number }[]; labels: string[] } {
  const rolled = Array.from({ length: n }, () => ({ sides: SLAYER_DIE_SIDES, value: rollDie(SLAYER_DIE_SIDES) }));
  const specialist = rerollSlayerOnes(sheet, rolled, rollDie);
  return { sheet: specialist.sheet, dice: specialist.dice, labels: specialist.label !== undefined ? [specialist.label] : [] };
}

/** "Slayer d6 ×2 (4, 6)". */
function slayerLabel(dice: readonly { value: number }[]): string[] {
  return dice.length === 0 ? [] : [`Slayer d6${dice.length > 1 ? ` ×${dice.length}` : ""} (${dice.map((d) => d.value).join(", ")})`];
}

/**
 * Spends a Duality roll's Slayer Dice (attack rolls only, K2) and Tide tokens (action rolls only, K3) through the
 * session-features rules, and rolls the Slayer Dice. Refusals: DICE_RULE (wrong roll, more than held),
 * CLASS_FEATURE_RULE (Tide tokens without Know the Tide).
 */
function spendSessionFeatures(sheet: CharacterSheet, args: DualityArgs, attack: boolean): { sheet: CharacterSheet; tide: number; slayer: { sides: number; value: number }[]; labels: string[] } {
  const slayerCount = args.slayerDice ?? 0;
  const tideCount = args.tideTokens ?? 0;
  if (slayerCount !== 0 && (args.kind !== "action" || !attack)) throw new DiceRuleError("Slayer Dice add to attack rolls and damage rolls only.");
  const afterSlayer = spendSlayerDice(sheet, slayerCount);
  const tide = spendTideTokens(afterSlayer, tideCount);
  if (tideCount !== 0 && args.kind !== "action") throw new DiceRuleError("Know the Tide tokens add to action rolls only.");
  const slayer = rollSlayerDice(tide.sheet, slayerCount);
  return {
    sheet: slayer.sheet,
    tide: tide.modifier,
    slayer: slayer.dice,
    labels: [...(tide.modifier > 0 ? [`Know the Tide +${tide.modifier}`] : []), ...slayerLabel(slayer.dice), ...slayer.labels],
  };
}

/** " vs 14" when the GM set the Difficulty, " vs DC 14 (player)" when a player typed it (review M1). */
export function versus(difficulty: number | undefined, gm: boolean): string {
  if (difficulty === undefined) return "";
  return gm ? ` vs ${difficulty}` : ` vs DC ${difficulty} (player)`;
}

function dualitySummary(name: string, args: Pick<DualityArgs, "kind" | "trait" | "modifier">, roll: RollRecord, extras: string[], gm: boolean): string {
  const using = extras.length > 0 ? ` (${extras.join(", ")})` : "";
  const manual = roll.manual ? " [manual]" : "";
  return `${name}: ${TRAIT_LABEL[args.trait]} ${args.kind} roll ${roll.total}${typedLabel(args.modifier)}${versus(roll.difficulty, gm)}, ${OUTCOME_LABEL[roll.outcome]}${using}${manual}`;
}

/** `gm`: the roller is the campaign's GM, so their typed values are the GM's call. */
export type Loaded = { campaign: Doc<"campaigns">; character: Doc<"characters">; sheet: CharacterSheet; gm: boolean };

/** A character the user edits (owner or GM), with its sheet. */
export async function editable(ctx: QueryCtx, user: Doc<"users">, characterId: Id<"characters">): Promise<Loaded> {
  const { campaign, character, permission } = await loadCharacter(ctx, user, characterId, "edit", "owner");
  return { campaign, character, sheet: readSheet(character.sheet), gm: permission === "owner" };
}

/** How far back a damage roll looks for the character's latest action roll. */
const CRITICAL_SCAN = 20;

/** A damage critical counts as rolled when the character's latest live action roll was a critical success; else it is declared (review M1). */
async function criticalRolled(ctx: QueryCtx, characterId: Id<"characters">): Promise<boolean> {
  const rows = await ctx.db
    .query("actionLog")
    .withIndex("by_character_at", (q) => q.eq("characterId", characterId))
    .order("desc")
    .take(CRITICAL_SCAN);
  const last = rows.find((r) => r.undoneAt === undefined && r.roll?.kind === "action");
  return last?.roll?.outcome === "critical";
}

/**
 * The first half of `duality`: checks the character can act, pays the roll's costs, rolls (or reads typed-in dice) and
 * applies Hope, Stress and a Know the Tide token to the sheet. Saves and logs nothing: `paid` is the sheet after the
 * costs, `next` the sheet to save, `effects.fear` the Fear the GM should gain.
 */
export async function resolveDuality(ctx: QueryCtx, loaded: Loaded, args: DualityArgs, rng: Rng, manual: boolean) {
  const { campaign, character, sheet } = loaded;
  assertCanAct(character, sheet);
  const scope = featureScope(campaign);
  const ikonis = args.ikonis ? await loadIkonis(ctx, campaign, character, sheet) : null;
  // E1.4b (dcm-l1er): the bearer's riders on this roll run first, with the server's dice, on the sheet the roll pays from.
  const riders = rules(() => bearerRiderRuns(sheet, args, rollDie));
  const { paid, input, extras: prepared } = rules(() => prepareDuality(riders.sheet, args, scope, ikonis));
  const trait = ikonis?.trait ?? args.trait;
  // E1.4b (dcm-hqk1): a situational d20 Hope Die the player marked (Reliable Backup); the Hope Die is drawn first.
  const hopeDie = situationalHopeDie(args.situations && args.situations.length > 0 ? liveMods(sheet, scope) : [], args.situations);
  const swap = hopeDieSwitch(rng);
  swap.arm(hopeDie.sides);
  const rolled = rules(() => rollDuality(input, swap.rng));
  swap.arm(undefined);
  const roll: RollRecord = withHopeSides({ ...rolled.roll, manual }, hopeDie.sides);
  const extras = [...prepared, ...hopeDie.labels, ...riders.lines];
  // Plan rule-switches RA: R3 Manual gains neither the roll's Hope nor its Fear (`dualityEffects`).
  const hopeFear = hopeFearModeOf(campaign);
  const effects = dualityEffects(args.kind, roll.outcome, hopeFear);
  // A roll with Fear places a Know the Tide token in the same saved sheet and row, so undoing the roll takes it back (U4).
  const next = placeTideToken(applyDualityEffects(paid, effects), roll.outcome, args.kind).sheet;
  return { scope, paid, next, extras, trait, rolled, roll, effects, hopeFear };
}

/**
 * Plan lanes-2, E1 (dcm-wn7): the sheet after its bearer made `record` with E6's end engine: the condition markers that end
 * on it (`endConditionsOnRoll`), then every other effect whose entry ends on the roll (`endOnSheet`). `labels` name what
 * ended ("X ends") for the roll's summary. A damage or free roll ends nothing.
 */
export function rollEndsOnSheet(sheet: CharacterSheet, record: RollRecord, extra: Omit<EndRoll, "kind" | "success" | "duality">, situations?: readonly string[]): { sheet: CharacterSheet; labels: string[]; ended: Effect[] } {
  const base = endRollOf(record, extra.attack);
  if (base === null) return { sheet, labels: [], ended: [] };
  const markers = endConditionsOnRoll(sheet, record, extra.attack);
  // E1.4b (dcm-hqk1): an end that names a situation waits for a roll the player marked as it.
  const own = endOnSheet(markers.sheet, { kind: "roll", roll: { ...base, ...extra } }, { only: (e) => conditionMarkerOf(e) === null && rollEndSituationHolds(e, situations) });
  const labels = [...markers.ended.map((e) => `${e.condition} ends`), ...own.ended.map((e) => `${e.text.split("; ")[0] ?? e.source} ends`)];
  return { sheet: own.sheet, labels, ended: own.ended };
}

/**
 * Plan lanes-2 wave 9, E1.3b (dcm-79v1, roll half): the benefits a roll used end where their entry says so. Each effect
 * whose advantage the roll took (`effectIds`) ends on `benefitGranted` (Forest Sprites, CB p.339: "A sprite vanishes after
 * granting a benefit"; `endGrantedBenefit`); then every other party sheet's copy of a shared grant that ended goes too
 * (Bird's-Eye View, CB p.33: "The first time a character makes a roll to act on this information, they gain advantage";
 * `endSharedGrants`). `ended`: what already ended on the roller's sheet from the roll itself.
 */
export function grantEndsOnRoll<K>(
  sheet: CharacterSheet,
  effectIds: readonly string[],
  ended: readonly Effect[],
  party: readonly { key: K; sheet: CharacterSheet }[],
): { sheet: CharacterSheet; labels: string[]; party: { key: K; sheet: CharacterSheet; lines: string[] }[] } {
  let next = sheet;
  const labels: string[] = [];
  const all: Effect[] = [...ended];
  for (const id of new Set(effectIds)) {
    const out = endGrantedBenefit(next, id);
    next = out.sheet;
    all.push(...out.ended);
    labels.push(...out.ended.map((e) => `${e.text.split("; ")[0] ?? e.source} ends`));
  }
  const shared = endSharedGrants(all, party).map((p) => ({ key: p.key, sheet: p.sheet, lines: p.lines }));
  return { sheet: next, labels, party: shared };
}

/** Rolls (or reads typed-in dice), applies Hope, Stress and Fear, saves and logs. */
export async function duality(ctx: MutationCtx & { user: Doc<"users"> }, loaded: Loaded, args: DualityArgs, rng: Rng, manual: boolean) {
  const { campaign, character, sheet } = loaded;
  const resolved = await resolveDuality(ctx, loaded, args, rng, manual);
  const { scope, paid, trait, rolled, hopeFear } = resolved;
  let { roll, effects } = resolved;
  let rolledNext = resolved.next;
  // E1.4b (dcm-m7tm, roll half): the running encounter's adversary uses on this PC's roll (Ill Omen, HF p.95; Backhanded
  // Guidance, HF p.87). Their die bonuses decide Hope vs Fear only (user answer 2026-10-31: never a critical, a tie is
  // with Fear; `withDieBonuses`), so the roll's Hope, Stress and Fear follow the changed outcome.
  const advUses = await pcRollAdversaryUses(ctx, campaign, {
    characterId: character._id,
    roll: { kind: args.kind, trait, attack: args.attack, weapon: args.weapon !== undefined, ...hostRollOfRecord(roll), total: roll.total },
  });
  if (advUses.bonuses.length > 0) {
    roll = withDieBonuses(roll, advUses.bonuses);
    effects = dualityEffects(args.kind, roll.outcome, hopeFear);
    rolledNext = placeTideToken(applyDualityEffects(paid, effects), roll.outcome, args.kind).sheet;
  }
  // Plan lanes, E1: the automatic uses the roll sets off (Courage), with the server's dice, in the same row (undo reverts them).
  const autos = plainRollAutos(rolledNext, args, roll, scope, (await campaignFearState(ctx, campaign._id)).fear, rollDie);
  // Plan lanes-2, E1 (dcm-wn7): the roller's effects and sourced conditions that end on this roll (Spectral Mist, HF p.181:
  // "until you make an action roll"; Reliable Backup, CB p.43: "a Presence Roll"; duration nextRoll), in the same row.
  // E1.3b (dcm-6qrn): an attack roll with a named weapon is a weapon attack with that weapon; without one, "other".
  const attackEnd = args.attack ? (args.weapon !== undefined ? { attack: "weapon" as const, weapon: args.weapon } : { attack: "other" as const }) : {};
  const rolledEnds = rollEndsOnSheet(autos.sheet, roll, { trait, ...attackEnd }, args.situations);
  // E1.4b (dcm-wli0, roll half): adversary-given conditions that end on the bearer's roll (Slowed, Rattled, HF p.69).
  const advEnds = endAdversaryConditionsOnRoll(rolledEnds.sheet, roll, "attack" in attackEnd ? attackEnd.attack : undefined);
  const ends = { ...rolledEnds, sheet: advEnds.sheet, labels: [...rolledEnds.labels, ...advEnds.ended.map((m) => `${m.condition} ends`)] };
  // E1.3b (dcm-79v1): a granted benefit the roll used ends; a shared grant's copies on the other sheets with it.
  const usedGrants = rules(() => situationalAdvantage(sheet, args, scope)).effectIds;
  const others = usedGrants.length > 0 || ends.ended.length > 0 ? (await partyMembers(ctx, campaign._id)).filter((m) => m.character._id !== character._id) : [];
  const grants = grantEndsOnRoll(ends.sheet, usedGrants, ends.ended, others.map((m) => ({ key: m, sheet: m.sheet })));
  const next = grants.sheet;
  const advNames = advUses.bonuses.map((b) => `${b.feature} ${b.amount >= 0 ? "+" : ""}${b.amount} ${b.die === "hope" ? "Hope" : "Fear"} Die`);
  const extras = [...resolved.extras, ...advNames, ...autos.names, ...ends.labels, ...grants.labels];
  const { gained: rolledFear } = effects.fear > 0 ? await gainFear(ctx, campaign._id, effects.fear) : { gained: 0 };
  const gained = rolledFear + (autos.gmFearDelta > 0 ? (await gainFear(ctx, campaign._id, autos.gmFearDelta)).gained : 0);
  // dcm-z9rz.23: the roll's costs (Experiences, options, the bearer's riders) count as spent even when it gains Hope, so a
  // paid roll saves (and logs its `before`) even when its gain left the sheet as it was.
  const hopePaid = sheet.hope - paid.hope;
  const sheetChanged = changed(sheet, next) || hopePaid > 0;
  noteHopeSpent(ctx, character._id, hopePaid);
  if (sheetChanged) await saveSheet(ctx, character._id, next);
  // Plan rule-switches RA (S1, R3): what the roll sets off. A plain roll has no group; it gets one only when a GM note joins
  // it (undoing the roll takes the note back), so a Book roll's row stays as it was.
  const aftermath = await planPcActionRoll(ctx, campaign, {
    characterId: character._id,
    name: sheet.name,
    kind: args.kind,
    success: outcomeSucceeds(roll.outcome),
    withFear: outcomeWithFear(roll.outcome),
    fearWithheld: fearWithheldBy(hopeFear, args.kind, roll.outcome),
  });
  const groupId = aftermath.notes.length > 0 ? newGroupId() : undefined;
  const entryId = await logAction(ctx, {
    campaignId: campaign._id,
    characterId: character._id,
    actorId: ctx.user._id,
    kind: "roll",
    visibility: "public",
    summary: dualitySummary(sheet.name, { kind: args.kind, trait, modifier: args.modifier }, roll, extras, loaded.gm),
    roll,
    ...(groupId !== undefined ? { groupId } : {}),
    ...(sheetChanged ? { before: sheet } : {}),
    ...(gained !== 0 ? { fearDelta: gained } : {}),
    // `paid` is the sheet after the roll's costs and before its gains (K2: the Slayer store takes back only a gained Hope;
    // R3 Manual gains none).
    ...(args.kind === "action" && WITH_HOPE.includes(roll.outcome) ? { hopeGained: effects.hope > 0 && rollGaveHope(paid, roll.outcome, args.kind) } : {}),
    undoable: true,
  });
  await applyPcActionRoll(ctx, campaign, aftermath, { groupId, actorId: ctx.user._id });
  // E1.3b (dcm-79v1): the other sheets whose shared grant ended, each a row with its sheet before (undo puts it back).
  for (const p of grants.party) {
    await saveSheet(ctx, p.key.character._id, p.sheet);
    await logAction(ctx, { campaignId: campaign._id, characterId: p.key.character._id, actorId: ctx.user._id, kind: "feature", visibility: "public", summary: p.lines.join("; ").slice(0, 1000), before: p.key.sheet, undoable: true });
  }
  // E1.4b (dcm-m7tm): what the adversary uses did, for the GM (their own writes are E7's).
  if (advUses.lines.length > 0) {
    await logAction(ctx, { campaignId: campaign._id, actorId: ctx.user._id, kind: "combat", visibility: "gm", summary: advUses.lines.join("; ").slice(0, 1000), undoable: false });
  }
  // Armed countdowns tick right after the action roll resolves (countdowns-advanced K1, CB p.162); never a reaction roll (CB p.99).
  if (countsAsActionRoll(roll, { logKind: "roll", undone: false })) {
    await tickArmedCountdowns(ctx, { campaignId: campaign._id, entryId, outcome: roll.outcome, actorId: ctx.user._id });
  }
  // Reaction rolls prompt too (Strange Patterns: "a Duality Die shows it", CB 50); prompts that need Hope check the roll kind.
  const prompts = afterDualityRoll(next, { hope: rolled.hope, fear: rolled.fear, roll }, CLASS_FEATURES, scope);
  return { entryId, roll, fearGained: gained, prompts };
}

/**
 * Whether a damage source deals magic damage, for `physicalOnly` options (Combat Training, CB 48): a weapon by
 * its damage type, where "either" (Shadowblade: "you can deal physical or magic damage") counts as physical; an
 * override by its definition (unset is physical); the Ikonis and custom dice as physical (Motherboard has no
 * Combat Training anyway, CB 295).
 */
function magicDamage(sheet: CharacterSheet, source: DamageSource, overrides: readonly WeaponOverride[]): boolean {
  if (source.kind === "weapon") {
    const weaponId = source.slot === "primary" ? sheet.primaryWeaponId : sheet.secondaryWeaponId;
    return (weaponId ? getWeapon(weaponId) : undefined)?.damageType === "magic";
  }
  if (source.kind === "override") return overrides.find((o) => o.key === source.key)?.damageType === "magic";
  return false;
}

/**
 * The damage dice of a source: weapon dice at Proficiency (CB 98), a class
 * override, the Ikonis, or dice as given. Option dice are bonus dice, so a
 * critical maxes feature damage dice (Sneak Attack) but not named held dice (a Rally Die; CB 98, user 2026-10-21).
 */
function prepareDamage(sheet: CharacterSheet, args: DamageArgs, scope: FeatureScope, ikonis: IkonisWeapon | null): { paid: CharacterSheet; input: DamageInput; label: string } {
  if (args.options.length > MAX_OPTIONS) throw new DiceRuleError("Too many options.");
  assertTypedModifier(args.modifier);
  const overrides = weaponOverrides(sheet, CLASS_FEATURES, scope);
  let source = args.source;
  // Brawler's Strike as the primary weapon is the I Am the Weapon override when it applies (HF 10).
  if (source.kind === "weapon" && source.slot === "primary" && sheet.primaryWeaponId === BRAWLERS_STRIKE && overrides.some((o) => o.key === "brawlersStrike")) {
    source = { kind: "override", key: "brawlersStrike" };
  }
  const magic = magicDamage(sheet, source, overrides);
  const available = rollOptions(sheet, "damage", CLASS_FEATURES, scope).filter((o) => !(magic && o.physicalOnly));
  const opts = applyRollOptions(sheet, available, args.options);
  const live = withEffects(sheet);
  const fixed = opts.fixedDice.reduce((s, d) => s + d.value, 0);
  const base = { critical: args.critical, bonusDice: opts.extraDice, namedDice: opts.namedDice };
  const extra = args.modifier + opts.modifier + fixed;
  let input: DamageInput;
  let label: string;
  if (source.kind === "weapon") {
    const weaponId = source.slot === "primary" ? sheet.primaryWeaponId : sheet.secondaryWeaponId;
    const weapon = weaponId ? getWeapon(weaponId) : undefined;
    if (!weapon) throw new DiceRuleError(`No ${source.slot} weapon is equipped.`);
    const { dice, flat } = weaponDice(weapon.damage, sheet.proficiency, weapon.id === BRAWLERS_STRIKE);
    input = { ...base, dice, flat: flat + extra + live.damageBonus };
    label = weapon.name;
  } else if (source.kind === "override") {
    const key = source.key;
    const override = overrides.find((o) => o.key === key);
    if (!override) throw new DiceRuleError("That attack isn't available.");
    input = { ...base, dice: override.dice, flat: override.flat + extra + live.damageBonus, ...(override.critBase !== undefined ? { critBase: override.critBase } : {}) };
    label = override.label;
  } else if (source.kind === "ikonis") {
    if (ikonis === null) throw new DiceRuleError("Only Motherboard characters have an Ikonis.");
    input = { ...base, dice: ikonis.dice, flat: ikonis.flat + extra + live.damageBonus };
    label = [ikonis.label, ...ikonis.augments].join(", ");
  } else {
    input = { ...base, dice: source.dice, flat: extra };
    label = source.dice.map((d) => `${d.count}d${d.sides}`).join("+");
  }
  return { paid: spendSlayerDice(opts.sheet, args.slayerDice ?? 0), input, label: [label, ...opts.labels].join(", ") };
}

/**
 * Adds spent Slayer Dice to a damage roll as extra d6s (K2: "rolling them and adding their result to the roll").
 * A critical does not max them: it maxes the damage dice only (CB 98; user 2026-10-21).
 */
function withSlayerDamage(roll: RollRecord, slayer: readonly { sides: number; value: number }[]): RollRecord {
  if (slayer.length === 0) return roll;
  const dice = [...roll.dice, ...slayer.map((d) => ({ ...d, role: "extra" as const }))];
  const total = Math.max(0, dice.reduce((s, d) => s + d.value, 0) + roll.modifier);
  return { ...roll, dice, total };
}

/**
 * The first half of `damage`: checks the character can act, pays the roll options and rolls the damage dice (Slayer
 * Dice added) on `loaded.sheet`. Saves and logs nothing: `paid` is the sheet to save, `label` names the source.
 */
export async function resolveDamage(ctx: QueryCtx, loaded: Loaded, args: DamageArgs, rng: Rng, manual: boolean) {
  const { campaign, character, sheet } = loaded;
  assertCanAct(character, sheet);
  const ikonis = args.source.kind === "ikonis" ? await loadIkonis(ctx, campaign, character, sheet) : null;
  const prepared = rules(() => prepareDamage(sheet, args, featureScope(campaign), ikonis));
  const { sheet: paid, dice: slayer, labels } = rollSlayerDice(prepared.paid, args.slayerDice ?? 0);
  const roll: RollRecord = withSlayerDamage({ ...rules(() => rollDamage(prepared.input, rng)), manual }, slayer);
  return { paid, roll, label: prepared.label, slayer, slayerLabels: [...slayerLabel(slayer), ...labels] };
}

export async function damage(ctx: MutationCtx & { user: Doc<"users"> }, loaded: Loaded, args: DamageArgs, rng: Rng, manual: boolean) {
  const { campaign, character, sheet } = loaded;
  const { paid, roll, label, slayerLabels } = await resolveDamage(ctx, loaded, args, rng, manual);
  const critical = !args.critical ? "" : (await criticalRolled(ctx, character._id)) ? "critical " : "critical (declared) ";
  const sheetChanged = changed(sheet, paid);
  if (sheetChanged) await saveSheet(ctx, character._id, paid);
  const entryId = await logAction(ctx, {
    campaignId: campaign._id,
    characterId: character._id,
    actorId: ctx.user._id,
    kind: "roll",
    visibility: "public",
    summary: `${sheet.name}: ${critical}damage ${roll.total}${typedLabel(args.modifier)} (${[label, ...slayerLabels].join(", ")})${manual ? " [manual]" : ""}`,
    roll,
    ...(sheetChanged ? { before: sheet } : {}),
    undoable: true,
  });
  return { entryId, roll };
}

/** Typed-in dice must all be used: the queue refuses missing, out-of-range and extra values. */
export function manualRng(values: number[]) {
  if (values.length > MAX_VALUES) throw appError("DICE_RULE", "Too many dice.");
  return queueRng(values);
}
