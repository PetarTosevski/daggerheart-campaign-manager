// The adversary-feature runner (plan combat-actions, tracer AA1; analysis Part B, B3.4). Pure: turns one use of an
// adversary feature (types.ts, AA0) plus a context into an ordered plan with every die rolled and every number
// resolved. The server (AA2) checks the refusals, opens a reaction window for every `incoming` hit (window.ts in
// adversary-actions), writes the rest and logs it; the AE-* tables' tests run their entries through it with a fixed RNG.
//
// It does not copy the card runner: it translates the feature into a one-use card effect and runs it through CA1's
// `run` (card-effects/run.ts), which already knows the outcome and flow steps, `adversaryAttack` against Evasion, the
// `standardAttack` damage, limits, costs (Fear and Stress included) and gates. What is adversary-only is done here:
// - Requirements (`AdversaryRequirement`), the spotlight check (AR6, CB p.194: "For an adversary to use an action, they
//   must have the spotlight"), and Q19's rule that Fear is spent only on the GM's tap (`fearConfirmed`).
// - The Attack Modifier (CB p.160), an Experience for a Fear (CB p.160), passive and instance attack bonuses.
// - Horde (X) once half the HP is marked (AR10, CB p.199) and direct damage on the standard attack (CB p.99).
// - Minion Group Attack (AR9, CB p.201): "On a success, they deal X damage each. Combine this damage."
// - The adversary-only steps (`summon`, `countdown`, `spotlight`) become plan steps of their own.
// - Damage to PCs comes back as `incoming` hits for the reaction window (Q13), with forced Armor Slots (CB p.195) moved
//   into the hit so the window applies them with the damage.
// Order: requirements, spotlight, Fear confirmation, then the card runner's limit, choices, targets, upfront costs, one
// roll for all targets (AR7), steps. Prompt numbers (summon counts, countdown starts) are resolved after the steps.
//
// ```ts
// const result = run(feature, { adversaryId: "bandit", self, attack, tier: 1, gmFear: 3, spotlit: true, targets, rng });
// if (!result.ok) throw appError(result.code ?? "VALIDATION");   // ADVERSARY_NOT_SPOTLIT, NOT_ENOUGH_FEAR, …
// for (const hit of result.plan.incoming) openWindow(...);         // one reaction window per hit PC
// ```

import type { AdversaryActionErrorCode } from "../../errors/adversaryActions";
import type { FeatureUse } from "../../validation/characters";
import type { Range as SrdRange } from "../../srd/types";
import { parseDamage } from "../adversaries/index";
import { parseAttackModifier, standardAttackDamage } from "../adversary-actions/attack";
import { adversaryNumberEnv, unmetAdversaryRequirements, type AdversaryState, type PassiveSummary } from "../adversary-actions/features";
import { resolveCosts } from "../card-effects/availability";
import { run as runCard, type ActorState, type PlanStep, type RollInfo, type RunPlan } from "../card-effects/run";
import type { AttackedRider, CardEffect, CardUse, CheckRow, ConditionRef, Cost, EndEvent, Escape, Mod, NumberSource, Range as AdversaryRange, RollEnd, RollSpec, Step } from "../card-effects/types";
import { rangeFromWeapon } from "../combat-actions/distance";
import type { Combatant } from "../combat-actions/damage";
import type { HitResult } from "../combat-actions/hits";
import { resolveNumber, type MapCreature } from "../combat-actions/numbers";
import type { Rng } from "../dice/index";
import type {
  AdversaryActivation,
  AdversaryCost,
  AdversaryFeatureEffect,
  AdversaryFeatureUse,
  AdversaryModifier,
  AdversaryOnlyStep,
  AdversaryStep,
} from "./types";

// ---------------------------------------------------------------- inputs

/** An instance effect's numbers (convex/lib/validators/encounters.ts `InstanceEffect`), as the runner reads them. */
export interface InstanceModifiers {
  attack?: number;
  damage?: number;
  /** Blighting Strike: its next successful attack deals half damage. */
  halfDamage?: boolean;
  /** Goad Them On: its next attack is made with disadvantage. */
  disadvantage?: boolean;
}

/** The stat block's standard attack (`AdversaryDef.attack`, a custom block's `attack`). */
export interface StandardAttack {
  name: string;
  modifier: number | string;
  /** SRD form ("Very Close") or the vocabulary's ("veryClose"). */
  range: SrdRange | AdversaryRange;
  damage: string;
}

export interface AdversaryRunContext {
  adversaryId: string;
  /** The instance using the feature (side "adversary"): tracks, conditions, thresholds, Difficulty. */
  self: Combatant;
  attack: StandardAttack;
  tier: 1 | 2 | 3 | 4;
  /** Tokens on its stat block (the instance's `tokens`). */
  tokens?: number;
  /** This instance's feature uses (limits per scene; key `adversaryFeatureUseKey`). */
  featureUses?: readonly FeatureUse[];
  /** The GM's Fear now. */
  gmFear: number;
  /** Whether the adversary has the spotlight now (CB p.194). */
  spotlit: boolean;
  /** The GM tapped "Spend N Fear" (Q19); without it a Fear cost refuses with `confirmFear`. */
  fearConfirmed?: boolean;
  /** Which use of the feature; default the first `action` use, else the first. */
  useId?: string;
  /** The PCs (or creatures) targeted, nearest first; for `all`, every creature in the area. */
  targets?: readonly Combatant[];
  picked?: readonly Combatant[];
  /** Its allies for `to: "allies"` steps. */
  allies?: readonly Combatant[];
  followUp?: readonly Combatant[];
  /** What set off a reaction or an automatic use (the attacker, the PC who rolled, the amount). */
  trigger?: { amount?: number; source?: Combatant; subject?: Combatant };
  /** `choose` step picks and `optional` steps the GM took (an optional Fear step defaults to No, Q19). */
  options?: Readonly<Record<string, readonly string[]>>;
  optionals?: readonly string[];
  eitherCosts?: readonly number[];
  splits?: Readonly<Record<string, number>>;
  /** Situation texts the GM confirmed. */
  situations?: readonly string[];
  /** Extra d20s (CB p.161). */
  advantage?: number;
  disadvantage?: number;
  /** An Experience added for a Fear (CB p.160): adds its value and an upfront cost of 1 Fear. */
  experience?: { name: string; value: number };
  /** The other Minions of a Group Attack (same name, within range of the target); the group is `self` plus these. */
  group?: readonly Combatant[];
  /** Horde (X) damage text (`hordeDamage(def)`); falls back to `passives.horde`. */
  hordeX?: string | null;
  /** Its passives in force (`passiveSummary`). */
  passives?: PassiveSummary;
  /** Its instance effects, summed. */
  instance?: InstanceModifiers;
  /** Answers `allyWithin` requirements; absent (no map, Q18): they hold. */
  allyWithin?: AdversaryState["allyWithin"];
  /** AA2b (bead dcm-vv2 10): roll a dice Attack Modifier only for a use that attacks (the server sets it). */
  attackDiceOnAttacks?: boolean;
  /**
   * Lane E7 (dcm-xyw, dcm-51s, dcm-346): what this adversary's attacks get against each target, by target id: the
   * `attackedRider` mods on the target's effects and conditions that apply to this attacker (the caller filters `by`:
   * `caster` / `others` / `anyone`). Advantage when every target carries it (one roll for all targets, AR7), the target's
   * Evasion halved, direct damage and a damage change on its hit.
   */
  attackedRiders?: Readonly<Record<string, readonly AttackedRider[]>>;
  // ---- Plan lanes-2, lane E7 (dcm-e16o, dcm-0n1u, dcm-8rh): per-creature facts the card runner reads, forwarded as given.
  /** The Hope each PC holds now, by id (Dreadhowl, Howl at the Moon: `hope.ifUnable`; dcm-5xi). */
  hopeOf?: Readonly<Record<string, number>>;
  /** The allies who may pay to raise a `raised` save's Difficulty (Enchanting Song's other Sirens; dcm-q0a). */
  saveRaisers?: readonly Combatant[];
  /** Named tokens on creatures now, by creature id then name (Encumber's bramble tokens; dcm-xp0). */
  creatureTokens?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Handfuls of gold each creature carries, by id (Quick Hands; dcm-0gh). */
  goldOf?: Readonly<Record<string, number>>;
  /** The creatures of each further link of a repeating follow-up (Rip & Tear; dcm-7az). Link 0 is `followUp`. */
  chain?: readonly (readonly Combatant[])[];
  /**
   * The creatures on the live map seen from this adversary (`creatureCount`: Hive Mind, Pack Fury, Drain and Multiply's
   * Horde HP; dcm-ttz). Read by the numbers this runner resolves itself (upfront Fear, summon / countdown / spotlight
   * prompts); absent: none counted.
   */
  creatures?: readonly MapCreature[];
  /** The labels of the lasting effects each creature carries now, by id (`effect.stacking`; dcm-kkx). */
  effectsOn?: Readonly<Record<string, readonly string[]>>;
  rng: Rng;
}

// ---------------------------------------------------------------- outputs

/** The adversary-only steps, resolved. */
export type AdversaryPromptStep =
  /** Lane E7 (dcm-145, dcm-v27): `hp`, the summoned instance's HP resolved (Drain and Multiply); `duplicate`, a token of itself. */
  | { kind: "summon"; label: string; count: number; adversaryId?: string; range?: AdversaryRange; hp?: number; duplicate?: boolean; note?: string }
  | {
      kind: "countdown";
      op: "start" | "tick" | "prompt";
      label: string;
      start?: number;
      amount?: number;
      loop: boolean;
      onTrigger?: string;
      /** Lane E7 (dcm-m5s, dcm-bxp.78): increasing / decreasing (CB p.163), the event at 0, what advances it. */
      direction?: "increasing" | "decreasing";
      onZero?: string;
      tickOn?: "actionRoll" | "spotlight" | "marksHp" | "takesDamage" | "other";
      note?: string;
    }
  | { kind: "spotlight"; who: "self" | "allies" | "sameName" | "picked"; count?: number; within?: AdversaryRange; name?: string; note?: string };

export type AdversaryPlanStep = PlanStep | AdversaryPromptStep;

/** One PC hit by the use: opens a reaction window before anything is marked (Q13). Mirrors the incoming-hit payload. */
export interface IncomingHitDraft {
  targetId: string;
  /** The move's total against this PC, before armor (R2). */
  amount: number;
  type: "physical" | "magic" | "both";
  direct: boolean;
  /** "mark an Armor Slot without gaining its benefit" (CB p.195), taken out of `creatures[].after`. */
  forcedArmor: number;
  critical: boolean;
  /** The attack roll's total (for a reaction that raises Evasion); never shown to players (Q14). */
  attackTotal?: number;
}

export interface AdversaryPlan {
  adversaryId: string;
  feature: string;
  useId: string;
  activation: AdversaryActivation["kind"];
  needsSpotlight: boolean;
  steps: AdversaryPlanStep[];
  roll: RollInfo | null;
  hits: HitResult[];
  success: boolean;
  /** The per-instance limit entry written when `consumed`. */
  limit: RunPlan["limit"];
  self: {
    before: Combatant;
    after: Combatant;
    tokens: { before: number; after: number };
    featureUses: FeatureUse[];
  };
  /** Every other creature changed (PCs marked by `markStress` / `markHp`, allies), before and after. */
  creatures: { id: string; before: Combatant; after: Combatant }[];
  gmFearDelta: number;
  /** Fear paid by this use (feature costs, the Experience). */
  fearSpent: number;
  incoming: IncomingHitDraft[];
  /**
   * AA2b (AE-t2-core note 2): the PC reaction rolls the use asks for (its `prompt pcSave` steps) with the save as the
   * entry wrote it, so adversary-only steps in its branches (Petrifying Gaze's Petrification countdown) keep their kind.
   */
  saves?: { targetIds: string[]; step: Extract<AdversaryStep, { kind: "save" }> }[];
  /**
   * PCs whose last HP was marked by a forced mark in this plan (the window flags death moves for hits), and (lane E7,
   * dcm-702) PCs a `deathMove` step names (CRONCH!, HF p.70: "The target must make a death move").
   */
  deathMoves: string[];
  /** Lane E7 (dcm-icd): creatures a `move` step with `mode: "leaveScene"` takes out of the scene (Survival Instinct, Bolt). */
  fled: string[];
  /** Lane E7 (dcm-145): creatures a `revive` step brought back (Won't Stay Dead, Corpse Whisperer), itself included. */
  revived: string[];
  /**
   * Plan lanes-2, lane E7 (dcm-iedr): what the card runner's `condition` plan step drops, per condition the plan gives:
   * the entry's `mods` (bearer riders, attacked riders, disadvantage, flags), `endsOnCaster` (Envelop: "until the Shark
   * takes Severe damage"), `endsOnRoll` (Slowed: "until they roll with Hope"), `escape`, `record` and `endFear`, read
   * from the entry's own step by the condition's name. Only conditions whose step carries any of them are listed.
   */
  conditionDetails: AdversaryConditionDetail[];
  /** Group Attack: the other Minions that took part (the server spotlights them, CB p.201). */
  group: string[];
  /** A passive use's modifiers. */
  modifiers: readonly AdversaryModifier[];
  excluded: string[];
}

/** Lane E7 (dcm-iedr): a condition the plan gives with the fields its plan step leaves out (see `AdversaryPlan.conditionDetails`). */
export interface AdversaryConditionDetail {
  targetId: string;
  condition: ConditionRef;
  mods?: readonly Mod[];
  endsOnCaster?: readonly EndEvent[];
  endsOnRoll?: RollEnd;
  escape?: Escape;
  record?: NumberSource;
  endFear?: NumberSource;
}

type ConditionStep = Extract<Step, { kind: "condition" }>;

/** The condition's printed name (a standard condition or a tag). */
export const conditionName = (c: ConditionRef): string => (c.kind === "standard" ? c.condition : c.tag);

/**
 * Lane E7 (dcm-iedr): every `condition` step of a step list, nested flows and check-table rows included, by condition
 * name (the first one wins). Walks the data generically: any object with `kind: "condition"` and a `condition` ref.
 */
export function conditionStepsOf(steps: readonly unknown[]): Map<string, ConditionStep> {
  const out = new Map<string, ConditionStep>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const o = node as Record<string, unknown>;
    if (o.kind === "condition" && typeof o.condition === "object" && o.condition !== null) {
      const name = conditionName(o.condition as ConditionRef);
      if (!out.has(name)) out.set(name, o as unknown as ConditionStep);
    }
    for (const value of Object.values(o)) if (typeof value === "object") walk(value);
  };
  walk(steps);
  return out;
}

/**
 * Lane E7, round 2 (dcm-iedr, dcm-xyw, dcm-yd5h, dcm-mm0f): the mods of the lasting step a stored effect or condition
 * came from, found again in its entry's steps by its label (an `effect` step's `label`, a `condition` step's name; the
 * first match wins). The server stores only the label and the source; the riders (`attackedRider`, `bearerRider`) are
 * read back from the entry when they are needed. Empty when nothing matches.
 */
export function lastingModsOf(steps: readonly unknown[], label: string): readonly Mod[] {
  let found: readonly Mod[] | undefined;
  const walk = (node: unknown): void => {
    if (found !== undefined || node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const n of node) walk(n);
      return;
    }
    const o = node as Record<string, unknown>;
    const named = o.kind === "effect" && o.label === label ? true : o.kind === "condition" && typeof o.condition === "object" && o.condition !== null && conditionName(o.condition as ConditionRef) === label;
    if (named && Array.isArray(o.mods)) {
      found = o.mods as readonly Mod[];
      return;
    }
    for (const value of Object.values(o)) if (typeof value === "object") walk(value);
  };
  walk(steps);
  return found ?? [];
}

export type AdversaryRunRefusal = {
  ok: false;
  /**
   * noUse / requirement / exhausted / passive: ADVERSARY_FEATURE_UNAVAILABLE; spotlight: ADVERSARY_NOT_SPOTLIT;
   * cost: NOT_ENOUGH_FEAR when Fear is short, else ADVERSARY_FEATURE_UNAVAILABLE (a full Stress track can't pay);
   * confirmFear: ask "Spend N Fear?" first (Q19, `detail` = N); choice / targets: bad input.
   */
  reason: "noUse" | "requirement" | "exhausted" | "spotlight" | "confirmFear" | "cost" | "choice" | "targets";
  code: AdversaryActionErrorCode | null;
  detail: string;
};

export type AdversaryRunResult = { ok: true; plan: AdversaryPlan } | AdversaryRunRefusal;

// ---------------------------------------------------------------- helpers

/** The use a context picks: by id, else the first `action` use, else the first. */
export function pickAdversaryUse(effect: AdversaryFeatureEffect, useId?: string): AdversaryFeatureUse | undefined {
  if (useId !== undefined) return effect.uses.find((u) => u.id === useId);
  return effect.uses.find((u) => u.activation.kind === "action") ?? effect.uses[0];
}

/** The id the card runner keys an adversary feature by: `card:<adversaryId>/<feature>[:<useId>]` in the instance's uses. */
export function adversaryFeatureId(adversaryId: string, feature: string): string {
  return `${adversaryId}/${feature}`;
}

/** The feature-use key of a limited adversary feature (stored per instance by AA2). */
export function adversaryFeatureUseKey(adversaryId: string, feature: string, useId?: string): string {
  const base = `card:${adversaryFeatureId(adversaryId, feature)}`;
  return useId && useId !== "main" ? `${base}:${useId}` : base;
}

/** The use id of the standard attack in `standardAttackEffect`. */
export const STANDARD_ATTACK_USE = "standardAttack";

const toRange = (r: StandardAttack["range"]): AdversaryRange => {
  const srd: readonly string[] = ["Melee", "Very Close", "Close", "Far", "Very Far"];
  return srd.includes(r) ? rangeFromWeapon(r as SrdRange) : (r as AdversaryRange);
};

/**
 * The standard attack as a feature (CB p.195: "When you spotlight an adversary, you can always use their standard attack
 * as long as they are within range"; CB p.161: "an adversary can only hit one target with their standard attack"): an
 * action needing the spotlight, d20 + ATK against Evasion, one target in the attack's range, its printed damage on a hit.
 */
export function standardAttackEffect(adversaryId: string, attack: Pick<StandardAttack, "name" | "range">): AdversaryFeatureEffect {
  return {
    adversaryId,
    feature: attack.name,
    uses: [
      {
        id: STANDARD_ATTACK_USE,
        activation: { kind: "action" },
        needsSpotlight: true,
        roll: { kind: "adversaryAttack", difficulty: { kind: "evasion" } },
        targets: { side: "enemy", range: toRange(attack.range), count: { kind: "one" } },
        steps: [{ kind: "damage", to: "targets", when: ["hit"], roll: { kind: "standardAttack" }, type: "weapon" }],
      },
    ],
  };
}

const fixed = (value: number): NumberSource => ({ kind: "fixed", value });

/** Fear an upfront cost list asks for (with the GM's `either` picks), to ask "Spend N Fear?" first (Q19). */
export function upfrontFear(costs: readonly AdversaryCost[] | undefined, context: Pick<AdversaryRunContext, "eitherCosts" | "self" | "tokens" | "tier" | "gmFear" | "rng"> & Partial<Pick<AdversaryRunContext, "trigger" | "targets" | "creatures">>): number {
  if (!costs || costs.length === 0) return 0;
  // AA2b (bead dcm-yle): a cost read from the trigger (My Turn: "spend a number of Fear equal to the HP marked") asks first.
  const env = adversaryNumberEnv({ hp: context.self.hp, stress: context.self.stress, tokens: context.tokens ?? 0 }, context.tier, context.gmFear, {
    ...(context.trigger?.amount !== undefined ? { triggerAmount: context.trigger.amount } : {}),
    targetCount: { picked: context.targets?.length ?? 0, hit: 0, failedSave: 0 },
    ...(context.creatures ? { creatures: context.creatures } : {}),
  });
  let i = 0;
  const paid = resolveCosts(costs as readonly Cost[], (c) => resolveNumber(c.amount, env, context.rng), () => context.eitherCosts?.[i++] ?? 0);
  return paid.filter((c) => c.resource === "fear").reduce((s, c) => s + c.amount, 0);
}

/** Whether a step list holds a `followUp` that makes an adversary attack roll (Double Swipe, Discordant Visions). */
export function hasFollowUpAttack(steps: readonly AdversaryStep[]): boolean {
  return steps.some((s) => {
    if (s.kind === "followUp") return s.roll?.kind === "adversaryAttack" || hasFollowUpAttack(s.steps);
    if (s.kind === "optional") return hasFollowUpAttack(s.steps);
    if (s.kind === "choose") return s.options.some((o) => hasFollowUpAttack(o.steps));
    if (s.kind === "check") return hasFollowUpAttack(s.then) || hasFollowUpAttack(s.otherwise) || hasFollowUpAttack(tableSteps(s.table));
    return false;
  });
}

/**
 * Lane E7, round 2 (dcm-b3bb): the steps of a check's table rows (Broken Magic's d6, Tentacle Rays' d8 beams; dcm-27j).
 * A row holds card steps; every adversary step kind the runner reads in them is a card kind, so they read as adversary
 * steps here.
 */
function tableSteps(table: readonly CheckRow[] | undefined): readonly AdversaryStep[] {
  return (table ?? []).flatMap((r) => r.steps as readonly AdversaryStep[]);
}

const refuse = (reason: AdversaryRunRefusal["reason"], code: AdversaryActionErrorCode | null, detail: string): AdversaryRunRefusal => ({
  ok: false,
  reason,
  code,
  detail,
});

const UNAVAILABLE: AdversaryActionErrorCode = "ADVERSARY_FEATURE_UNAVAILABLE";

// ---------------------------------------------------------------- the runner

/**
 * Runs one use of an adversary feature: an action (needs the spotlight unless the entry says otherwise), a reaction or
 * automatic use (pass `trigger`), or a passive (returns its modifiers and runs any steps). Refuses before anything is
 * paid; see `AdversaryRunRefusal` for the error codes.
 */
export function run(effect: AdversaryFeatureEffect, context: AdversaryRunContext): AdversaryRunResult {
  const use = pickAdversaryUse(effect, context.useId);
  if (!use) return refuse("noUse", UNAVAILABLE, `No use "${context.useId ?? ""}" on ${effect.feature}.`);
  const self = context.self;
  const tokens = context.tokens ?? 0;

  // ---- requirements, spotlight, Fear confirmation (CB p.194, Q19)
  // Lane E7 (dcm-cdz): conditions a passive gives it while it holds (Hand of Glory's Hidden) count for its requirements.
  const passiveConditions = context.passives?.selfConditions ?? [];
  const state: AdversaryState = {
    hp: self.hp,
    hpMax: self.hpMax,
    stress: self.stress,
    stressMax: self.stressMax,
    conditions: [...new Set([...self.conditions, ...passiveConditions.flatMap((c) => (c.kind === "standard" ? [c.condition] : []))])],
    tags: [...new Set([...(self.tags ?? []), ...passiveConditions.flatMap((c) => (c.kind === "tag" ? [c.tag] : []))])],
    tokens,
    situations: context.situations ?? [],
    ...(context.allyWithin ? { allyWithin: context.allyWithin } : {}),
  };
  const unmet = unmetAdversaryRequirements(use.requires, state);
  if (unmet.length > 0) return refuse("requirement", UNAVAILABLE, unmet.map((r) => r.kind).join(", "));
  if (use.needsSpotlight && !context.spotlit) return refuse("spotlight", "ADVERSARY_NOT_SPOTLIT", effect.feature);

  const experienceFear = context.experience ? 1 : 0;
  const fearAsked = upfrontFear(use.costs, context) + experienceFear;
  if (fearAsked > 0 && context.fearConfirmed !== true) return refuse("confirmFear", null, String(fearAsked));

  // ---- the attack's numbers (CB p.160, p.199, p.99)
  const passives = context.passives;
  const instance = context.instance ?? {};
  const atk = parseAttackModifier(context.attack.modifier);
  const isAttack = use.roll?.kind === "adversaryAttack";
  // AA2b (bead dcm-vv2 10): with `attackDiceOnAttacks` (the server), a dice Attack Modifier ("+2d4") is rolled only for a
  // use that attacks. Off by default: the AE tables' fixed dice still feed it on every run (see TASK-CA-AA2b.md).
  const attacks = isAttack || (use.roll === undefined && hasFollowUpAttack(use.steps));
  const bonusDice = atk.dice && (attacks || context.attackDiceOnAttacks !== true) ? Array.from({ length: atk.dice.count }, () => context.rng(atk.dice!.sides)) : [];
  const rollModifier = isAttack
    ? atk.flat + bonusDice.reduce((s, n) => s + n, 0) + (context.experience?.value ?? 0) + (passives?.attackBonus ?? 0) + (instance.attack ?? 0)
    : 0;
  const direct = passives?.directAttacks === true || parseDamage(context.attack.damage)?.direct === true;
  const attackDamage = standardAttackDamage(context.attack.damage, self, context.hordeX ?? passives?.horde ?? null, {
    add: passives?.attackDamageAdd ?? 0,
    ...(passives?.attackDamageType ? { type: passives.attackDamageType } : {}),
  });
  const groupSize = use.groupAttack ? 1 + (context.group?.length ?? 0) : 1;
  // Lane E7 (dcm-vv2 1): a follow-up attack of a use that makes no attack roll of its own ("Get Over Here!", Discordant
  // Visions) is still the adversary's attack: d20 + ATK (CB p.160) with the passive and instance attack bonuses. A use
  // whose own roll attacks passes them to every roll already (`roll.modifier` below).
  const followUpAtk = isAttack ? 0 : atk.flat + bonusDice.reduce((s, n) => s + n, 0) + (passives?.attackBonus ?? 0) + (instance.attack ?? 0);
  const ridersOn = (id: string) => context.attackedRiders?.[id] ?? [];
  // Lane E7 (dcm-xyw): "the target's Evasion is halved against this attack" (Peerless Accuracy, CB p.224), from the roll
  // or a rider on the target; rounded up (QUESTIONS in TASK-LN-E7.md).
  // Lane E7, round 2 (dcm-4c9m): the passive flag `attacksHalveEvasion` (Never Misses, CB p.228: "When the Flickerfly makes
  // an attack, the target's Evasion is halved") halves it on every attack, the standard attack included.
  const alwaysHalved = passives?.flags.includes("attacksHalveEvasion") === true;
  const halved = (list: readonly Combatant[] | undefined, spec: RollSpec | undefined): Combatant[] | undefined =>
    list?.map((t) =>
      spec?.kind === "adversaryAttack" && t.evasion !== undefined && (alwaysHalved || spec.halveEvasion === true || ridersOn(t.id).some((r) => r.halveEvasion === true))
        ? { ...t, evasion: Math.ceil(t.evasion / 2) }
        : t,
    );
  const followUpRoll = (list: readonly AdversaryStep[]): RollSpec | undefined => {
    for (const s of list) {
      if (s.kind === "followUp" && s.roll) return s.roll;
      const nested =
        s.kind === "followUp" || s.kind === "optional" ? followUpRoll(s.steps) : s.kind === "choose" ? followUpRoll(s.options.flatMap((o) => o.steps)) : s.kind === "check" ? followUpRoll([...s.then, ...s.otherwise, ...tableSteps(s.table)]) : undefined;
      if (nested) return nested;
    }
    return undefined;
  };
  const targetsIn = halved(context.targets, use.roll);
  const followUpIn = halved(context.followUp, followUpRoll(use.steps));
  // Advantage from riders (Sunsear Arrows' Glowing, Drag and Bag) when every target of the one roll carries it (AR7).
  const riderAdvantage =
    isAttack && (context.targets?.length ?? 0) > 0 && context.targets!.every((t) => ridersOn(t.id).some((r) => r.advantage === true)) ? 1 : 0;

  // ---- translate the feature into a card use
  const prompts = new Map<Step, AdversaryOnlyStep>();
  const saves = new Map<Step, Extract<AdversaryStep, { kind: "save" }>>();
  const translate = (list: readonly AdversaryStep[]): Step[] => list.map((s) => translateStep(s));
  const translateStep = (step: AdversaryStep): Step => {
    switch (step.kind) {
      case "summon":
      case "countdown":
      case "spotlight": {
        const placeholder: Step = { kind: "manual", to: "self", text: step.kind === "spotlight" ? "Spotlight" : step.label, ...(step.when ? { when: step.when } : {}) };
        prompts.set(placeholder, step);
        return placeholder;
      }
      case "pay":
        return { ...step, costs: step.costs as readonly Cost[] };
      case "optional":
        return { ...step, ...(step.costs ? { costs: step.costs as readonly Cost[] } : {}), steps: translate(step.steps) };
      case "choose":
        return { ...step, options: step.options.map((o) => ({ ...o, steps: translate(o.steps) })) };
      case "save": {
        const translated: Step = { ...step, onFail: translate(step.onFail), onSuccess: translate(step.onSuccess) };
        saves.set(translated, step);
        return translated;
      }
      case "check":
        // dcm-b3bb: table rows are translated like `then` / `otherwise` (a follow-up attack in a row gets the ATK).
        return {
          ...step,
          then: translate(step.then),
          otherwise: translate(step.otherwise),
          ...(step.table ? { table: step.table.map((r) => ({ ...r, steps: translate(r.steps as readonly AdversaryStep[]) })) } : {}),
        };
      case "followUp": {
        // dcm-vv2 1: entries written before it carry the ATK in the follow-up's own `modifier`; that one stands as written.
        const roll = step.roll?.kind === "adversaryAttack" && followUpAtk !== 0 && step.roll.modifier === undefined ? { ...step.roll, modifier: fixed(followUpAtk) } : step.roll;
        return { ...step, ...(roll ? { roll } : {}), steps: translate(step.steps) };
      }
      case "damage": {
        let out = step;
        if (isAttack && direct && (step.roll.kind === "standardAttack" || passives?.directAttacks)) out = { ...out, direct: true };
        if (groupSize > 1) out = { ...out, repeat: out.repeat ? { kind: "product", of: [out.repeat, fixed(groupSize)] } : fixed(groupSize) };
        return out;
      }
      default:
        return step;
    }
  };
  const steps = translate(use.steps);
  // Instance effects ride on its attacks' hits: a flat damage bonus, then Blighting Strike's half damage.
  if (isAttack && instance.damage) steps.push({ kind: "modifyDamage", to: "targets", when: ["hit"], change: { kind: "add", amount: fixed(instance.damage) } });
  if (isAttack && instance.halfDamage) steps.push({ kind: "modifyDamage", to: "targets", when: ["hit"], change: { kind: "halve" } });

  const costs: Cost[] = [...((use.costs ?? []) as readonly Cost[]), ...(experienceFear ? [{ kind: "fear" as const, amount: fixed(1) }] : [])];
  const cardUse: CardUse = {
    id: use.id,
    name: effect.feature,
    activation: { kind: "action" },
    ...(use.limit ? { limit: use.limit } : {}),
    ...(costs.length > 0 ? { costs } : {}),
    ...(use.roll ? { roll: use.roll } : {}),
    ...(use.targets ? { targets: use.targets } : {}),
    steps,
  };
  const cardEffect: CardEffect = { cardId: adversaryFeatureId(effect.adversaryId, effect.feature), uses: [cardUse] };

  const actor: ActorState = {
    ...self,
    armor: 0,
    armorMax: 0,
    hope: 0,
    hopeMax: 0,
    traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
    spellcast: 0,
    proficiency: 1,
    level: context.tier,
    tier: context.tier,
    loadoutDomains: [],
    vaultDomains: [],
    armorWorn: false,
    activeCardEffects: [],
    cardTokens: tokens,
    featureUses: context.featureUses ?? [],
    weapons: {},
  };

  const result = runCard(cardEffect, {
    actor,
    gmFear: context.gmFear,
    useId: use.id,
    ...(targetsIn ? { targets: targetsIn } : {}),
    ...(context.picked ? { picked: context.picked } : {}),
    ...(context.allies ? { allies: context.allies } : {}),
    ...(followUpIn ? { followUp: followUpIn } : {}),
    ...(context.trigger ? { trigger: context.trigger } : {}),
    ...(context.options ? { options: context.options } : {}),
    ...(context.optionals ? { optionals: context.optionals } : {}),
    ...(context.eitherCosts ? { eitherCosts: context.eitherCosts } : {}),
    ...(context.splits ? { splits: context.splits } : {}),
    ...(context.hopeOf ? { hopeOf: context.hopeOf } : {}),
    ...(context.saveRaisers ? { saveRaisers: context.saveRaisers } : {}),
    ...(context.creatureTokens ? { creatureTokens: context.creatureTokens } : {}),
    ...(context.goldOf ? { goldOf: context.goldOf } : {}),
    ...(context.chain ? { chain: context.chain } : {}),
    ...(context.effectsOn ? { effectsOn: context.effectsOn } : {}),
    situations: context.situations ?? [],
    roll: {
      modifier: rollModifier,
      // Lane E7 (dcm-1ch): "make a standard attack with advantage" on a group attack (On My Signal, CB p.212).
      advantage: (context.advantage ?? 0) + riderAdvantage + (isAttack && use.groupAttack?.advantage ? 1 : 0),
      disadvantage: (context.disadvantage ?? 0) + (isAttack && instance.disadvantage ? 1 : 0),
    },
    attackDamage,
    rng: context.rng,
  });
  if (!result.ok) {
    if (result.reason === "exhausted") return refuse("exhausted", UNAVAILABLE, result.detail);
    if (result.reason === "cost") return refuse("cost", result.detail.split(", ").includes("fear") ? "NOT_ENOUGH_FEAR" : UNAVAILABLE, result.detail);
    if (result.reason === "requirement" || result.reason === "noUse") return refuse(result.reason, UNAVAILABLE, result.detail);
    return refuse(result.reason, null, result.detail);
  }
  const plan = result.plan;

  // ---- adversary-only steps back in place, their numbers resolved now
  // AA2b (bead dcm-vv2 7 / 9, AE-t2-core 1): prompt numbers read the trigger's amount, the latest roll before them and the
  // use's target counts (Summoning Ritual's tick, To Me, My Pretties' summon count, Endless Legions' "twice the PCs").
  const targetCount = {
    picked: context.targets?.length ?? 0,
    hit: plan.hits.filter((h) => h.hit).length,
    failedSave: plan.steps.filter((s) => s.kind === "save" && !s.success).length,
  };
  let lastRoll: number | undefined;
  const savesOut: NonNullable<AdversaryPlan["saves"]> = [];
  for (const s of plan.steps) {
    const original = s.kind === "prompt" && s.prompt === "pcSave" && s.step ? saves.get(s.step) : undefined;
    if (original && s.kind === "prompt") savesOut.push({ targetIds: [...s.targetIds], step: original });
  }
  const env = () =>
    adversaryNumberEnv({ hp: plan.actor.after.hp, stress: plan.actor.after.stress, tokens: plan.actor.after.cardTokens }, context.tier, context.gmFear + plan.gmFearDelta, {
      ...(context.trigger?.amount !== undefined ? { triggerAmount: context.trigger.amount } : {}),
      ...(lastRoll !== undefined ? { lastRoll } : {}),
      targetCount,
      ...(context.creatures ? { creatures: context.creatures } : {}),
    });
  const num = (src: NumberSource) => resolveNumber(src, env(), context.rng);
  const outSteps: AdversaryPlanStep[] = plan.steps.map((s): AdversaryPlanStep => {
    if (s.kind === "check") lastRoll = s.total;
    else if (s.kind === "damageRoll") lastRoll = s.record.total;
    const original = s.kind === "prompt" && s.step ? prompts.get(s.step) : undefined;
    if (!original) return s;
    const note = original.note !== undefined ? { note: original.note } : {};
    switch (original.kind) {
      case "summon":
        return {
          kind: "summon",
          label: original.label,
          count: num(original.count),
          ...(original.adversaryId ? { adversaryId: original.adversaryId } : {}),
          ...(original.range ? { range: original.range } : {}),
          ...(original.hp ? { hp: num(original.hp) } : {}),
          ...(original.duplicate ? { duplicate: true } : {}),
          ...note,
        };
      case "countdown":
        return {
          kind: "countdown",
          op: original.op,
          label: original.label,
          ...(original.start ? { start: num(original.start) } : {}),
          ...(original.amount ? { amount: num(original.amount) } : original.op === "tick" ? { amount: 1 } : {}),
          loop: original.loop === true,
          ...(original.onTrigger ? { onTrigger: original.onTrigger } : {}),
          ...(original.direction ? { direction: original.direction } : {}),
          ...(original.onZero ? { onZero: original.onZero } : {}),
          ...(original.tickOn ? { tickOn: original.tickOn } : {}),
          ...note,
        };
      case "spotlight":
        return {
          kind: "spotlight",
          who: original.who,
          ...(original.count ? { count: num(original.count) } : {}),
          ...(original.within ? { within: original.within } : {}),
          ...(original.name ? { name: original.name } : {}),
          ...note,
        };
    }
  });

  // ---- PCs: hits for the reaction window; forced Armor Slots move into the hit (CB p.195)
  const creatures = plan.creatures.map((c) => ({ ...c }));
  const incoming: IncomingHitDraft[] = [];
  const critical = isAttack && (plan.roll?.critical ?? false);
  for (const step of plan.steps) {
    if (step.kind !== "pcDamage") continue;
    const prior = incoming.find((h) => h.targetId === step.targetId);
    if (prior) {
      prior.amount += step.amount;
      prior.direct = prior.direct || step.direct;
      if (prior.type !== step.type) prior.type = "both";
      continue;
    }
    incoming.push({
      targetId: step.targetId,
      amount: step.amount,
      type: step.type,
      direct: step.direct,
      forcedArmor: 0,
      critical,
      ...(isAttack && plan.roll ? { attackTotal: plan.roll.record.total } : {}),
    });
  }
  for (const hit of incoming) {
    const forced = plan.steps
      .filter((s): s is Extract<PlanStep, { kind: "mark" }> => s.kind === "mark" && s.track === "armor" && s.noBenefit === true && s.targetId === hit.targetId)
      .reduce((n, s) => n + s.amount, 0);
    if (forced === 0) continue;
    const entry = creatures.find((c) => c.id === hit.targetId);
    if (entry) {
      const marked = (entry.after.armor ?? 0) - (entry.before.armor ?? 0);
      hit.forcedArmor = Math.min(forced, marked);
      entry.after = { ...entry.after, armor: (entry.after.armor ?? 0) - hit.forcedArmor };
    }
  }
  // Lane E7 (dcm-xyw, dcm-51s, dcm-346): the riders its attacks get against each hit target. Deathlock (CB p.225: "Attacks
  // made by the Hunter against a Deathlocked target deal direct damage"), Tag Team (HF p.65: an extra 1d12 magic), I've
  // Got 'Em (CB p.213: double damage from attacks by other adversaries).
  if (attacks) {
    for (const hit of incoming) {
      for (const r of ridersOn(hit.targetId)) {
        if (r.direct) hit.direct = true;
        const d = r.damage;
        if (d?.kind === "add") {
          hit.amount += num(d.amount);
          if (d.type && d.type !== hit.type) hit.type = "both";
        } else if (d?.kind === "multiply") hit.amount *= d.factor;
        else if (d?.kind === "halve") hit.amount = Math.floor(hit.amount / 2);
      }
    }
  }
  const deathMoves = creatures.filter((c) => c.after.side === "pc" && c.before.hp < c.before.hpMax && c.after.hp >= c.after.hpMax).map((c) => c.id);

  // ---- lane E7: steps the card runner leaves as prompts that change the table (dcm-702, dcm-145, dcm-icd)
  const known = [...(context.targets ?? []), ...(context.picked ?? []), ...(context.allies ?? []), ...(context.followUp ?? [])];
  const fled: string[] = [];
  const revived: string[] = [];
  let selfHp = plan.actor.after.hp;
  let selfStress = plan.actor.after.stress;
  const handled = new Set<AdversaryPlanStep>();
  for (const s of outSteps) {
    if (s.kind !== "prompt" || !s.step) continue;
    const step = s.step;
    if (step.kind === "deathMove") {
      // "The target must make a death move" (CRONCH!, HF p.70): the window's death-move flag, not a manual line.
      for (const id of s.targetIds) if (!deathMoves.includes(id) && known.find((c) => c.id === id)?.side !== "adversary") deathMoves.push(id);
      handled.add(s);
    } else if (step.kind === "revive") {
      // Won't Stay Dead (CB p.217): "re-forms with no marked HP"; Corpse Whisperer (HF p.80): "half its HP cleared"
      // (half the HP rounded up, cleared from the marked ones); Midnight Heart: HP and Stress.
      const cleared = (c: Pick<Combatant, "hp" | "hpMax">) => (step.clearHp === "all" ? 0 : Math.max(0, c.hp - Math.ceil(c.hpMax / 2)));
      for (const id of s.targetIds) {
        if (id === self.id) {
          selfHp = cleared({ hp: selfHp, hpMax: self.hpMax });
          if (step.clearStress) selfStress = 0;
        } else {
          let entry = creatures.find((c) => c.id === id);
          if (!entry) {
            const c = known.find((k) => k.id === id);
            if (!c) continue;
            entry = { id, before: c, after: c };
            creatures.push(entry);
          }
          entry.after = { ...entry.after, hp: cleared(entry.after), ...(step.clearStress ? { stress: 0 } : {}), defeated: false };
        }
        revived.push(id);
      }
      handled.add(s);
    } else if (step.kind === "move" && step.mode === "leaveScene") {
      // Survival Instinct, Bolt, Cowardly (HF p.62, p.64): "flees the scene". The prompt stays for the GM.
      for (const id of s.targetIds) if (!fled.includes(id)) fled.push(id);
    }
  }
  const stepsOut = handled.size > 0 ? outSteps.filter((s) => !handled.has(s)) : outSteps;

  // ---- the adversary itself
  // AA2b (bead dcm-vv2 5): a feature that clears a defeated instance's HP brings it back (The Work Never Ends, Come Back
  // Worse); a defeated instance whose HP stayed put stays defeated.
  const hpAfter = selfHp;
  let selfAfter: Combatant = { ...self, hp: hpAfter, stress: selfStress, defeated: hpAfter >= self.hpMax || (self.defeated && hpAfter >= self.hp) };
  for (const s of plan.steps) {
    if (s.kind === "condition" && s.targetId === self.id) {
      const c = s.condition;
      if (c.kind === "standard") {
        if (!selfAfter.conditions.includes(c.condition)) selfAfter = { ...selfAfter, conditions: [...selfAfter.conditions, c.condition] };
      } else selfAfter = { ...selfAfter, tags: [...new Set([...(selfAfter.tags ?? []), c.tag])] };
    }
    if (s.kind === "clearCondition" && s.targetId === self.id) {
      const c = s.condition;
      selfAfter = c.kind === "standard" ? { ...selfAfter, conditions: selfAfter.conditions.filter((x) => x !== c.condition) } : { ...selfAfter, tags: (selfAfter.tags ?? []).filter((x) => x !== c.tag) };
    }
  }
  // ---- lane E7 (dcm-iedr): the condition steps' fields the card runner's plan step leaves out
  const conditionSteps = conditionStepsOf(use.steps);
  const conditionDetails: AdversaryConditionDetail[] = [];
  for (const s of plan.steps) {
    if (s.kind !== "condition") continue;
    const original = conditionSteps.get(conditionName(s.condition));
    if (!original) continue;
    const detail: AdversaryConditionDetail = {
      targetId: s.targetId,
      condition: s.condition,
      ...(original.mods && original.mods.length > 0 ? { mods: original.mods } : {}),
      ...(original.endsOnCaster && original.endsOnCaster.length > 0 ? { endsOnCaster: original.endsOnCaster } : {}),
      ...(original.endsOnRoll ? { endsOnRoll: original.endsOnRoll } : {}),
      ...(original.escape ? { escape: original.escape } : {}),
      ...(original.record ? { record: original.record } : {}),
      ...(original.endFear ? { endFear: original.endFear } : {}),
    };
    if (Object.keys(detail).length > 2) conditionDetails.push(detail);
  }

  const fearSpent = plan.steps
    .filter((s): s is Extract<PlanStep, { kind: "pay" }> => s.kind === "pay" && s.paid)
    .flatMap((s) => s.costs)
    .filter((c) => c.resource === "fear")
    .reduce((n, c) => n + c.amount, 0);

  return {
    ok: true,
    plan: {
      adversaryId: effect.adversaryId,
      feature: effect.feature,
      useId: use.id,
      activation: use.activation.kind,
      needsSpotlight: use.needsSpotlight,
      steps: stepsOut,
      roll: plan.roll,
      hits: plan.hits,
      success: plan.success,
      limit: plan.limit,
      self: { before: self, after: selfAfter, tokens: { before: tokens, after: plan.actor.after.cardTokens }, featureUses: plan.actor.featureUses },
      creatures,
      gmFearDelta: plan.gmFearDelta,
      fearSpent,
      incoming,
      deathMoves,
      fled,
      revived,
      ...(savesOut.length > 0 ? { saves: savesOut } : {}),
      conditionDetails,
      group: use.groupAttack ? (context.group ?? []).map((c) => c.id) : [],
      modifiers: use.modifiers ?? [],
      excluded: plan.excluded,
    },
  };
}

/** The standard attack (`standardAttackEffect`) through `run`. */
export function runStandardAttack(context: AdversaryRunContext): AdversaryRunResult {
  return run(standardAttackEffect(context.adversaryId, context.attack), { ...context, useId: STANDARD_ATTACK_USE });
}
