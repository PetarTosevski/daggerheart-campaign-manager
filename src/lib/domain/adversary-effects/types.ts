/**
 * The adversary-effect vocabulary (plan combat-actions, tracer AA0; analysis Part B, B3.2). A closed, typed set of
 * building blocks that describes what an adversary feature does, so a pure runner (AA1 `run.ts`) can turn a feature
 * effect plus a context into an ordered plan the server executes (AA2).
 *
 * Binding rules for everyone who writes feature entries (the eight AE-* tracers):
 * - This file is the vocabulary. Feature tracers never change it; a step it cannot express becomes a `manual` step
 *   with the feature's words, and the tracer files a bead.
 * - It reuses the card vocabulary (src/lib/domain/card-effects/types.ts, CA0) and never changes it: every outcome
 *   step (`OutcomeStep`) as is, the flow steps with adversary children, `RollSpec`, `TargetSpec`, `Limit`, `Mod`,
 *   `Gate` and the number sources. In those types "self" / "you" is the adversary using the feature and "enemy" /
 *   "targets" are PCs; "allies" are the adversary's allies.
 * - Pure types plus a few `as const` lists: no framework imports, no `any`.
 * - Book pages are printed pages (CB = Core Book, HF = Hope & Fear). Examples: docs/tasks/TASK-CA-AA0.md.
 */

import type {
  ConditionRef,
  DamageKeyword,
  DamageRoll,
  DamageType,
  FlowStep,
  Gate,
  Limit,
  Mod,
  NumberSource,
  OutcomeStep,
  Range,
  RollFilter,
  RollResult,
  RollSpec,
  Severity,
  StateCheck,
  TargetSpec,
  TriggerTargets,
} from "../card-effects/types";
import { STEP_KINDS } from "../card-effects/types";

// ---------------------------------------------------------------- costs

/**
 * What a feature costs the GM or the adversary (CB p.194).
 * - `fear`: "Spend a Fear" / "spend 2 Fear": paid from the GM's pool even if a Fear already paid the spotlight (CB p.194);
 *   asked first, never spent without the GM's tap (Q19).
 * - `stress`: "Mark a Stress": the adversary marks Stress on its own track (CB p.194). A full track can't pay it.
 * - `hp`: "mark a HP" on the adversary.
 * - `either`: the GM picks one option; each option is a list of costs paid together.
 */
export type AdversaryCost =
  | { kind: "fear"; amount: NumberSource }
  | { kind: "stress"; amount: NumberSource }
  | { kind: "hp"; amount: NumberSource }
  | { kind: "either"; options: readonly (readonly AdversaryCost[])[] };

// ---------------------------------------------------------------- triggers

/** Which of the adversary's attacks a trigger concerns: its printed standard attack, or any attack it makes. */
export type AttackFilter = "standard" | "any";

/**
 * What sets off a reaction or an automatic effect (AR8, CB p.195: "features that don't take effect until their
 * specific trigger occurs"). "This adversary" is the feature's owner; "a PC" is any PC unless `within` narrows it
 * (measured from this adversary). Every field is optional narrowing; unset means "any".
 */
export type AdversaryTrigger =
  /**
   * This adversary hit: "When the X makes a successful (standard) attack (against a PC) (within Melee range)"
   * (Momentum, CB p.195; Heavy Hitter "deals damage with a standard attack"). `targetHas`: "against a Vulnerable
   * target"; `withAdvantage`: "a standard attack that has advantage".
   */
  | {
      kind: "onHit";
      attack?: AttackFilter;
      within?: Range;
      beyond?: Range;
      targetHas?: ConditionRef;
      withAdvantage?: boolean;
    }
  /** "When the X fails a standard attack". */
  | { kind: "onMiss"; attack?: AttackFilter }
  /**
   * Around its own attack: `before` ("Before the X makes an attack"), `beforeDamage` ("Before rolling damage for the
   * X's attack"), `after` ("After making a standard attack").
   */
  | { kind: "onAttack"; stage: "before" | "beforeDamage" | "after"; attack?: AttackFilter }
  /** "When the X deals damage (to a PC)", "deals Severe damage". */
  | { kind: "onDealDamage"; minSeverity?: Severity; toPc?: boolean }
  /** "When an attack from the X causes a target to mark HP" (any extra condition in the text is a `requires` or a gate). */
  | { kind: "onTargetMarksHp"; attack?: AttackFilter }
  /** "When the X defeats a PC" (the PC marks their last HP from it). */
  | { kind: "onDefeatPc" }
  /**
   * This adversary takes damage (`stage: "would"` before it is marked: Vampire Mistform's halving; `did` after).
   * `minSeverity`: "takes Severe damage", "Major or greater"; `attackerWithin` / `attackerBeyond`: "from an attack
   * within Close range", "a creature beyond Very Close range"; `first`: "takes damage for the first time".
   */
  /**
   * Plan lanes, V (widened): `weaponAttack`: only damage from a weapon attack (Archer's Bane, HF p.62; dcm-2gn); `keyword`
   * (Made of Straw, HF p.79: fire; dcm-dv6).
   */
  | {
      kind: "onDamaged";
      stage?: "would" | "did";
      minSeverity?: Severity;
      damageType?: DamageType;
      fromAttack?: boolean;
      attackerWithin?: Range;
      attackerBeyond?: Range;
      first?: "scene" | "ever";
      weaponAttack?: boolean;
      keyword?: DamageKeyword;
    }
  /**
   * This adversary marks HP: "marks HP", "marks 2 or more HP", "marks 2 or fewer HP from an attack within Melee range",
   * "marks their last HP", "would mark any number of HP" (`stage: "would"`).
   */
  | {
      kind: "onMarkHp";
      stage?: "would" | "did";
      atLeast?: number;
      atMost?: number;
      last?: boolean;
      fromAttack?: boolean;
      attackerWithin?: Range;
      damageType?: DamageType;
      /**
       * Plan lanes, V (widened): also fires when a successful attack leaves 0 HP marked (Unreal Form, CB p.237: "marks 1 or
       * fewer Hit Points from a successful attack"; dcm-2gn).
       */
      includeZero?: boolean;
    }
  /** Crossing a mark: "When the X has 3 or more HP marked", "marks half their HP" (fires once, when it is crossed). */
  | { kind: "onHpMarkedAtLeast"; value: number | "half" }
  /** "marks a Stress", "The first time in a scene the X marks their last Stress". */
  /** Plan lanes, V (widened): `stage: "would"`, before the Stress is marked (Mind Meld, HF p.74; dcm-2gn, dcm-63j). */
  | { kind: "onMarkStress"; last?: boolean; first?: "scene" | "ever"; stage?: "would" | "did" }
  /** "When the X is defeated (by an attack that deals physical damage)"; "Once per scene when …" is the use's `limit`. */
  | { kind: "onDefeated"; damageType?: DamageType }
  /** "When an ally within Close range deals damage" (an adversary ally of this one). */
  | { kind: "allyDealtDamage"; range?: Range; allyName?: string }
  /** "When an allied Vampire marks HP", "When a creature within Close range takes damage from a different adversary". */
  | { kind: "allyMarksHp"; range?: Range; allyName?: string }
  /**
   * "When an ally dies within Close range", "an allied Leader is defeated".
   * Plan lanes, V (widened): `allyType` narrows by the stat block's type (Cowardly, HF p.64: a Leader; dcm-2gn).
   */
  | { kind: "allyDefeated"; range?: Range; allyName?: string; allyType?: string }
  /**
   * An attack against this adversary: `targeted` ("a PC within Close range targets the X with an attack", "a creature
   * moves into Melee range to make an attack"), `succeeded` ("After a successful attack against the X within Melee
   * range"), `failed` ("When a PC fails an attack roll against the X"). `weapon`: "makes a weapon attack against it".
   */
  | {
      kind: "onAttacked";
      stage: "targeted" | "succeeded" | "failed";
      attackerWithin?: Range;
      attackerBeyond?: Range;
      weapon?: boolean;
    }
  /**
   * A PC's roll: "When a PC within Close range fails with Fear", "rolls with Fear", "makes a Presence Roll", "succeeds
   * on a Spellcast Roll", "rolls a 14 or lower on a Presence Roll made against the X" (`totalAtMost`).
   */
  /**
   * Plan lanes, V (widened): `result` takes every `RollResult` (Urco Fearmonger, HF p.80: "failure with Hope"; Mind Games:
   * "succeeds with Fear"; dcm-2gn); `notCritical` (Vexing Word, HF p.80; Archmage Counterspell: "not a critical success").
   */
  | {
      kind: "pcRolls";
      roll?: RollFilter;
      result?: RollResult | "failureWithFear" | "failureWithHope";
      within?: Range;
      againstSelf?: boolean;
      totalAtMost?: number;
      notCritical?: boolean;
    }
  /**
   * "When a PC moves within Melee range", "A PC must mark a Stress to move out of the X's Melee range" (`outOf`).
   * Plan lanes-2, V2 (widened): `stage: "would"`: before the move is made, so a `negate` `move` can stop it (Shield Wall, CB
   * p.212: "A creature who tries to move within Very Close range of the Guard must succeed on an Agility Roll"; dcm-xobk).
   */
  | { kind: "pcMoves"; into?: Range; outOf?: Range; stage?: "would" | "did" }
  /** "When a PC takes Severe damage within Very Close range of the X", "a PC marks HP from the X's standard attack". */
  | { kind: "pcMarksHp"; within?: Range; minSeverity?: Severity; fromSelf?: boolean }
  /** "When a PC within Close range of the X gains a Hope", "a PC with no Hope takes the spotlight". */
  | { kind: "pcHope"; change: "gain" | "spend" | "none"; within?: Range }
  /**
   * "When the X is in the spotlight for the first time", "When you spotlight the X and they don't have a token on their stat block".
   * Plan lanes, V (widened): `byFear`: the GM spent a Fear to spotlight it (Intimidating, HF p.89; dcm-2gn).
   */
  | { kind: "onSpotlight"; first?: "scene" | "ever"; noTokens?: boolean; byFear?: boolean }
  /** "When you spotlight an ally within Far range" (the GM spotlights another adversary). */
  | { kind: "allySpotlit"; range?: Range }
  /** "When a condition would be imposed on the X". */
  | { kind: "wouldGainCondition"; condition?: ConditionRef }
  /** "When the X first appears", "When combat begins", the start or end of a scene. */
  | { kind: "timing"; at: "appears" | "combatStart" | "sceneStart" | "sceneEnd" | "gmTurnStart" | "gmTurnEnd" }
  /**
   * A story trigger the engine can't see ("When a PC or group is discussing something sensitive", "When the X's eggs
   * are threatened"): offered to the GM as a button with the text.
   */
  | { kind: "situation"; text: string }
  // ---- Plan lanes, tracer V (widened; dcm-2gn)
  /** "When a PC takes the spotlight within Very Close range" (Fear Aura, HF p.66; Panicked). */
  | { kind: "pcSpotlit"; within?: Range }
  /** "When an ally within Close range makes an attack" (Pack Alpha, HF p.76); `stage: "failed"`: "an ally fails an attack" (Air Support, HF p.83). */
  | { kind: "allyAttacks"; range?: Range; stage?: "made" | "succeeded" | "failed" }
  /** "When a PC would deal damage to a creature within Close range" of this adversary (Drake Guard Dog, HF p.82). */
  | { kind: "pcDealsDamage"; within?: Range; stage?: "would" | "did" }
  /** "When the PCs finish a long rest" (Midnight Heart, HF p.88); `rest` narrows the rest. */
  | { kind: "pcsRest"; rest?: "short" | "long" };

/** Every trigger kind, for exhaustive switches and coverage tests (checked against `AdversaryTrigger` below). */
export const ADVERSARY_TRIGGER_KINDS = [
  "onHit",
  "onMiss",
  "onAttack",
  "onDealDamage",
  "onTargetMarksHp",
  "onDefeatPc",
  "onDamaged",
  "onMarkHp",
  "onHpMarkedAtLeast",
  "onMarkStress",
  "onDefeated",
  "allyDealtDamage",
  "allyMarksHp",
  "allyDefeated",
  "onAttacked",
  "pcRolls",
  "pcMoves",
  "pcMarksHp",
  "pcHope",
  "onSpotlight",
  "allySpotlit",
  "wouldGainCondition",
  "timing",
  "situation",
  // Plan lanes, tracer V
  "pcSpotlit",
  "allyAttacks",
  "pcDealsDamage",
  "pcsRest",
] as const;

export type AdversaryTriggerKind = (typeof ADVERSARY_TRIGGER_KINDS)[number];

/**
 * How a feature is started.
 * - `action`: a Use button for the GM; needs the spotlight unless `needsSpotlight` says otherwise (CB p.194).
 * - `reaction`: when `trigger` happens the GM gets a one-tap prompt defaulting to No (Q19); no Fear to interrupt
 *   unless a cost says so (CB p.195).
 * - `auto`: happens by itself when `trigger` happens, no prompt (Momentum's Fear gain, Q19; a passive's rider such as
 *   "Targets who mark HP from the X's standard attack are knocked back").
 * - `passive`: always on while `requires` holds; only `modifiers` (resistance, Horde, Minion, Relentless, flying).
 */
export type AdversaryActivation =
  | { kind: "action" }
  | { kind: "reaction"; trigger: AdversaryTrigger }
  | { kind: "auto"; trigger: AdversaryTrigger }
  | { kind: "passive" };

// ---------------------------------------------------------------- requirements

/** A state the feature needs. `situation` covers what the engine can't see; the GM confirms it. */
export type AdversaryRequirement =
  /** "When the Horde has marked half or more of their HP", "When the X has 4 or more HP marked". */
  | { kind: "hpMarkedAtLeast"; value: number | "half" }
  /** "If the X makes its first attack in a scene before it's marked HP or Stress": `hpMarkedAtMost` 0 and `stressMarkedAtMost` 0. */
  | { kind: "hpMarkedAtMost"; value: number }
  | { kind: "stressMarkedAtMost"; value: number }
  /**
   * "While Hidden", "If the X is Hidden when …".
   * Plan lanes, V (widened): `lacks`: the adversary does NOT have it (Magical Weakness, CB p.231: "While Dazed, they can't
   * use their Regeneration action"; dcm-2f3).
   */
  | { kind: "hasCondition"; condition: ConditionRef; lacks?: boolean }
  /** "they don't have a token on their stat block" (`atMost` 0); tokens on the stat block (Pool). */
  | { kind: "tokens"; atLeast?: number; atMost?: number }
  /** "another Dire Wolf is within Melee range of the target" (`name` unset: any ally). */
  | { kind: "allyWithin"; range: Range; of?: "self" | "target"; name?: string }
  /**
   * "While flying", "While the X is on their mount", "When the X attacks from the water".
   * Plan lanes, V (widened): `check`, as on the card `situation` requirement: a state the engine reads itself ("self" is
   * this adversary); `text` still says it for a reader that doesn't.
   */
  | { kind: "situation"; text: string; check?: StateCheck };

// ---------------------------------------------------------------- passive modifiers

/**
 * An always-on modifier of a passive feature (B3.2: resistance, attack bonus, Horde X, Minion X, Relentless).
 * - `mod`: any card-vocabulary modifier on this adversary: resistance and immunity (`{kind: "resistance"}`, CB p.99),
 *   an attack bonus (`{kind: "stat", stat: "attack"}`), Difficulty (`stat: "difficulty"`), disadvantage against it,
 *   flags such as `flying` or `cannotBeRestrained`. `to: "allies"` / `"pcs"` with `within` for auras ("renders all
 *   non-Harpies Vulnerable" is a `condition` aura below).
 * - `horde`: Horde (X), CB p.199: "When the Horde has marked half or more of their HP, their standard attack deals X
 *   damage instead."
 * - `minion`: Minion (X), CB p.201: defeated by any damage; "For every X damage a PC deals to the Minion, defeat an
 *   additional Minion within range the attack would succeed against."
 * - `relentless`: Relentless (X): "can be spotlighted up to X times per GM turn".
 * - `spotlightCostsFear`: "You must spend a Fear to spotlight the X".
 * - `directAttacks`: "The Ogre's attacks deal direct damage" (CB p.99).
 * - `attackDamage`: a change to its standard attack's damage while the requirements hold (`add`, or a new type).
 * - `conditionAura`: PCs (or allies) within `within` have the condition while it holds.
 */
export type AdversaryModifier =
  | { kind: "mod"; mod: Mod; to?: "self" | "allies" | "pcs"; within?: Range }
  | { kind: "horde"; damage: Extract<DamageRoll, { kind: "dice" } | { kind: "flat" }> }
  | { kind: "minion"; threshold: number }
  /** Plan lanes, V (widened): `timesFrom`: X read when it is spotlighted (Hydra, CB p.231: "the Hydra's number of heads", its stat-block tokens; dcm-gx1). */
  | { kind: "relentless"; times: number; timesFrom?: NumberSource }
  | { kind: "spotlightCostsFear" }
  | { kind: "directAttacks" }
  | { kind: "attackDamage"; add?: NumberSource; type?: DamageType }
  | { kind: "conditionAura"; condition: ConditionRef; to: "pcs" | "allies" | "all"; within: Range }
  /**
   * Plan lanes, V: the adversary itself has the condition while the use's `requires` hold (Hand of Glory, HF p.67: Hidden
   * while its stat block has 1 or more tokens; Fish-Tailed, HF p.82: Vulnerable out of the water; dcm-cdz).
   */
  | { kind: "selfCondition"; condition: ConditionRef };

// ---------------------------------------------------------------- steps

interface AdversaryStepBase {
  when?: readonly Gate[];
  /** A short reading of the feature for the feed and the task docs. */
  note?: string;
}

type CardFlow<K extends FlowStep["kind"]> = Extract<FlowStep, { kind: K }>;

/** One option of a `choose` step, with adversary steps. */
export interface AdversaryChooseOption {
  id: string;
  label: string;
  steps: readonly AdversaryStep[];
}

/**
 * The card vocabulary's flow steps with adversary children and adversary costs: `pay` (a cost after the roll),
 * `optional` (Heavy Hitter "you can spend a Fear to gain a +X bonus to the damage roll": a one-tap prompt, Q19),
 * `choose`, `save` (PCs make a reaction roll, AR11), `check` and `followUp` ("Mark a Stress to make two standard
 * attacks": a second `adversaryAttack` roll with `standardAttack` damage).
 */
export type AdversaryFlowStep =
  | (Omit<CardFlow<"pay">, "costs"> & { costs: readonly AdversaryCost[] })
  | (Omit<CardFlow<"optional">, "costs" | "steps"> & { costs?: readonly AdversaryCost[]; steps: readonly AdversaryStep[] })
  | (Omit<CardFlow<"choose">, "options"> & { options: readonly AdversaryChooseOption[] })
  | (Omit<CardFlow<"save">, "onFail" | "onSuccess"> & {
      onFail: readonly AdversaryStep[];
      onSuccess: readonly AdversaryStep[];
    })
  /** Plan lanes, V: a `table` row holds card steps (outcome and card flow steps; no summon / countdown / spotlight; dcm-27j). */
  | (Omit<CardFlow<"check">, "then" | "otherwise"> & { then: readonly AdversaryStep[]; otherwise: readonly AdversaryStep[] })
  | (Omit<CardFlow<"followUp">, "steps"> & { steps: readonly AdversaryStep[] });


/** The steps only adversaries have: GM prompts the engine shows but does not decide. */
export type AdversaryOnlyStep =
  /**
   * Summon prompt (B3.2): "summon 1d4 Minions", "calls three Jagged Knife Lackeys". The GM adds the instances to the
   * running encounter; `adversaryId` preselects an SRD adversary.
   */
  /**
   * Plan lanes, V (widened): `hp`: the summoned instance's HP (Drain and Multiply, CB p.218: "The Horde's HP is equal to the
   * number of Minions combined"; dcm-145); `duplicate`: a second token of this same adversary instead of a new instance
   * (Blink Beast, HF p.71; dcm-v27).
   */
  | (AdversaryStepBase & {
      kind: "summon";
      label: string;
      count: NumberSource;
      adversaryId?: string;
      range?: Range;
      hp?: NumberSource;
      duplicate?: boolean;
    })
  /**
   * Countdown prompt (B3.2): `start` a countdown printed with the feature ("Countdown (5)", `AdversaryFeature.countdown`),
   * `tick` one (`amount`, default 1), or `prompt` the GM with the text. `loop`: "Countdown (Loop 4)".
   */
  | (AdversaryStepBase & {
      kind: "countdown";
      op: "start" | "tick" | "prompt";
      label: string;
      start?: NumberSource;
      amount?: NumberSource;
      loop?: boolean;
      /** What happens when it triggers, as printed. */
      onTrigger?: string;
      /**
       * Plan lanes, V (widened): `direction`: an increasing / decreasing countdown (CB p.163: "each time a decreasing
       * countdown triggers, its starting value decreases by 1"; All-Consuming Rage, CB p.235; dcm-m5s), with `onZero` (the
       * major event at 0). `tickOn`: what advances it (dcm-bxp.78, user answer 2026-10-30: armed only for `actionRoll`).
       */
      direction?: "increasing" | "decreasing";
      onZero?: string;
      tickOn?: "actionRoll" | "spotlight" | "marksHp" | "takesDamage" | "other";
    })
  /**
   * Spotlight other adversaries: "Mark a Stress to spotlight 1d4 allies" (`allies`, `count`), "spotlight all Ruffians
   * within Close range" (`sameName`), "spotlight another adversary" (`picked`). Free: no Fear (the feature's cost paid).
   */
  | (AdversaryStepBase & {
      kind: "spotlight";
      who: "self" | "allies" | "sameName" | "picked";
      count?: NumberSource;
      within?: Range;
      name?: string;
    });

/** Every step of an adversary feature: the card outcome steps as is, the adapted flow steps and the adversary-only ones. */
export type AdversaryStep = AdversaryFlowStep | OutcomeStep | AdversaryOnlyStep;

/** Every adversary step kind (the card's `STEP_KINDS` plus the adversary-only ones), checked against `AdversaryStep`. */
export const ADVERSARY_STEP_KINDS = [...STEP_KINDS, "summon", "countdown", "spotlight"] as const;

export type AdversaryStepKind = (typeof ADVERSARY_STEP_KINDS)[number];

// ---------------------------------------------------------------- uses, effects

/**
 * One usable part of a feature. Most features have one use ("main"); a feature with an always-on part and a triggered
 * part has two. The runner resolves it in this order: `requires`, `limit`, upfront `costs`, the spotlight check,
 * `roll` (once for all `targets`, AR7), then `steps`.
 */
export interface AdversaryFeatureUse {
  /** "main" for a single use, else a slug of the part. Unique within the feature. */
  id: string;
  activation: AdversaryActivation;
  /**
   * Whether the adversary must have the spotlight (AR6, CB p.194: actions need it; "Passives and reactions typically
   * don't require the spotlight"). Written out on every use so the entry states what the text says.
   */
  needsSpotlight: boolean;
  requires?: readonly AdversaryRequirement[];
  /** "Once per scene", "Up to three times per scene" (`per: "scene"`, `times`); recorded per instance by AA2. */
  limit?: Limit;
  costs?: readonly AdversaryCost[];
  /** "Make an attack against …": `{kind: "adversaryAttack", difficulty: {kind: "evasion"}}` (AR1); one roll for all targets. */
  roll?: RollSpec;
  targets?: TargetSpec | TriggerTargets;
  /**
   * Minion Group Attack (AR9, CB p.201): "spotlight all adversaries with this name within `within` of the target. Those
   * Minions move into Melee range of the target and make one shared attack roll. On a success, they deal X damage each.
   * Combine this damage." The damage step's roll is the X per Minion; the engine multiplies it by the group size.
   */
  /**
   * Plan lanes, V (widened): `name` (adversaries of another name: On My Signal, CB p.212, the Archer Guards), `eachRolls`:
   * each makes its own attack roll and the damage on one target combines (dcm-1ch), `advantage`.
   */
  groupAttack?: { within: Range; name?: string; eachRolls?: boolean; advantage?: boolean };
  /** Plan lanes, V (widened): one target at a time: a new use clears what the last one placed (Judgment, CB p.236; Deathlock; dcm-vkp). */
  exclusive?: boolean;
  /** `passive` uses: the always-on modifiers. */
  modifiers?: readonly AdversaryModifier[];
  steps: readonly AdversaryStep[];
}

/**
 * The effect entry of one adversary feature (`AdversaryFeature` in src/lib/srd/types.ts). Lives in
 * src/lib/srd/adversary-effects/<tier>-<source>.ts; exactly one per printed feature (Q15).
 */
export interface AdversaryFeatureEffect {
  adversaryId: string;
  /** The feature name exactly as printed (`AdversaryFeature.name`, unique within its stat block). */
  feature: string;
  uses: readonly AdversaryFeatureUse[];
}

/** The eight tier / source groups the AE-* tracers fill in parallel. */
export const ADVERSARY_EFFECT_GROUPS = [
  "t1-core",
  "t1-hf",
  "t2-core",
  "t2-hf",
  "t3-core",
  "t3-hf",
  "t4-core",
  "t4-hf",
] as const;

export type AdversaryEffectGroup = (typeof ADVERSARY_EFFECT_GROUPS)[number];

// ---------------------------------------------------------------- drift checks

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const stepKindsMatch: Same<AdversaryStepKind, AdversaryStep["kind"]> = true;
const triggerKindsMatch: Same<AdversaryTriggerKind, AdversaryTrigger["kind"]> = true;
void stepKindsMatch;
void triggerKindsMatch;
