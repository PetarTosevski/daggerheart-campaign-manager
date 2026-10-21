// The card-effect runner (plan combat-actions, tracer CA1). Pure: turns one card use (types.ts) plus a context into an
// ordered plan with every die rolled and every number resolved. The server (CA4) checks the plan's refusals, writes what
// it changes (sheet, encounter instances, Fear) and logs it; the reaction window (AA1) folds in the `fold` steps; the
// domain tables' tests (CE-*) run their entries through it with a fixed RNG.
//
// Order (TASK-CA-CA0): requirements, limit, choices, upfront costs, one roll for all targets (R1, R9), then the steps in
// order. Book rules applied here (printed pages, CB = Core Book):
// - CB p.96: "roll once and apply that result to all of the adversaries the attack can hit … The attack is successful
//   against all targets for which the attack roll result meets or exceeds their Difficulty." (`resolveHits`)
// - CB p.96: "If a Spellcast Roll can damage a target, it's also considered an attack roll." So a critical on any action
//   roll that deals damage adds the dice's maximum (CB p.98).
// - CB p.90: "A critical success counts as a roll with Hope, even if you would've otherwise failed"; a critical clears a
//   Stress and gains a Hope; rolling with Fear gives the GM a Fear (`dualityEffects`). Reaction rolls change nothing (CB p.99).
// - CB p.90, R8: "When using a Hope Feature, if you rolled with Hope for that action, the Hope you gain from that roll can be
//   spent on that feature." The roll's Hope is gained before any `pay` step after the roll.
// - CB p.98, R2: damage = dice (Proficiency or Spellcast many when the card says so) + modifier; a critical starts from
//   the dice's maximum. "Whenever damage would be applied more than once to a creature during a PC's move, the damage is
//   always totaled before it's applied to the adversary's damage thresholds." The runner adds a move's damage per creature
//   and applies it once (before a step that reads the result, or at the end).
// - CB p.104, R9: "When your attack deals damage to more than one target, roll damage once and apply the total to each
//   target the attack succeeded against." A damage expression is rolled once per use (cached), even across a save's
//   onFail / onSuccess branches (Fireball's half damage).
// - CB p.161, R12 / Q7: an adversary's reaction roll is a d20 against the Difficulty, "If you meet or exceed the roll's
//   Difficulty, the NPC succeeds"; the server rolls it, with no Experience (the GM may undo and re-resolve).
// - CB p.107: "if you need to round to a whole number, round up unless otherwise specified" (half Proficiency, half damage
//   from a save). Resistance halving rounds down (combat-actions/damage.ts; QUESTIONS in the task doc).
//
// ```ts
// const result = run(boltBeacon, { actor, gmFear: 3, targets: [bandit], rng });
// if (!result.ok) throw refusal(result.reason);      // CARD_EXHAUSTED, CARD_COST_UNPAID, …
// for (const step of result.plan.steps) …             // pay, roll, hits, damageRoll, damage, condition, …
// ```

import { MAX_FEAR } from "../fear/index";
import { dualityEffects, rollDamage, rollDuality, weaponDice, type DicePool, type DualityEffects, type Rng } from "../dice/index";
import type { RollOutcome, RollRecord } from "../duality";
import { parseDamage } from "../adversaries/index";
import { applyDamageTo, applyHpTo, applyStressTo, clearTrack, type Combatant, type DamageResult } from "../combat-actions/damage";
import { resolveHits, type HitResult } from "../combat-actions/hits";
import { resolveDice, resolveNumber, rollDice, type NumberEnv } from "../combat-actions/numbers";
import {
  cardAvailability,
  featureUseKey,
  limitConsumed,
  limitUntil,
  resolveCosts,
  unaffordable,
  unmetRequirements,
  type PaidCost,
  type RequirementState,
} from "./availability";
import type {
  CardEffect,
  CardUse,
  ConditionRef,
  Cost,
  DamageChange,
  DamageRoll,
  DamageType,
  Duration,
  Gate,
  Mod,
  ModStat,
  NumberSource,
  OutcomeStep,
  Range,
  Recipient,
  RollFilter,
  RollSpec,
  SaveDifficulty,
  Severity,
  Step,
  TargetSpec,
  Track,
} from "./types";
import type { FeatureUse } from "../../validation/characters";
import type { DomainId, TraitId } from "../../srd/types";

// ---------------------------------------------------------------- inputs

/** A weapon as the runner needs it (the server reads it from the sheet's weapon ids). */
export interface WeaponInfo {
  /** As printed, e.g. "d8+1 phy". */
  damage: string;
  trait: TraitId;
  damageType: DamageType;
  range: Range;
}

/** The PC using the card, with the values the sheet derives (traits after effects, Spellcast value, Proficiency). */
export interface ActorState extends Combatant {
  readonly hope: number;
  readonly hopeMax: number;
  readonly armor: number;
  readonly armorMax: number;
  readonly traits: Readonly<Record<TraitId, number>>;
  /** The value of the Spellcast trait (CB p.98). */
  readonly spellcast: number;
  readonly proficiency: number;
  readonly level: number;
  readonly tier: 1 | 2 | 3 | 4;
  /** One entry per loadout / vault card: its domain. */
  readonly loadoutDomains: readonly DomainId[];
  readonly vaultDomains: readonly DomainId[];
  readonly armorWorn: boolean;
  /** Card ids whose own sheet effect is active. */
  readonly activeCardEffects: readonly string[];
  /** Tokens on this card now (sheet `cardTokens`). */
  readonly cardTokens: number;
  readonly featureUses: readonly FeatureUse[];
  readonly weapons: { readonly primary?: WeaponInfo; readonly secondary?: WeaponInfo };
}

export interface RunContext {
  actor: ActorState;
  /** The GM's Fear now. */
  gmFear: number;
  /** Which use of the card; default the first `action` use, else the first use. */
  useId?: string;
  /** The picked (or server-chosen, for `all`) targets of the use, nearest first. */
  targets?: readonly Combatant[];
  /** The creatures of steps with `to: "picked"`. */
  picked?: readonly Combatant[];
  /** The allies of steps with `to: "allies"` / `"selfAndAllies"`. */
  allies?: readonly Combatant[];
  /** The targets of a `followUp` step (Telekinesis' second target, Whirlwind's others). */
  followUp?: readonly Combatant[];
  /** What set off a reaction / rider / auto. */
  trigger?: { amount?: number; source?: Combatant; subject?: Combatant };
  /** The player's numbers, by `NumberChoice` id. */
  choices?: Readonly<Record<string, number>>;
  /** The options picked in `choose` steps, by step id. */
  options?: Readonly<Record<string, readonly string[]>>;
  /** The `optional` steps the player takes, by id. */
  optionals?: readonly string[];
  /** For each `either` cost met (in order), the option index the payer picked; default the first. */
  eitherCosts?: readonly number[];
  /** Damage or clears "divided however you wish": amount per creature id (Splintering Strike, Salvation Beam). */
  splits?: Readonly<Record<string, number>>;
  /** Situation texts the player confirmed. */
  situations?: readonly string[];
  /** Squares to the nearest enemy (Arcane Door). */
  nearestEnemy?: number;
  /** Roll inputs from the dialog. Cover disadvantage (Q2) is added by the server here. */
  roll?: {
    trait?: TraitId;
    weapon?: "primary" | "secondary";
    advantage?: number;
    disadvantage?: number;
    help?: number;
    /** Experiences, roll options and the attack bonus, already totalled. */
    modifier?: number;
    /** The GM's Difficulty for `difficulty: gm`. */
    difficulty?: number;
  };
  /** An adversary's standard attack damage (AA1 reuse: `damage.roll.kind === "standardAttack"`), e.g. "1d8+2 phy". */
  attackDamage?: string;
  rng: Rng;
}

// ---------------------------------------------------------------- outputs

/** A modifier with its numbers resolved. */
export type ResolvedMod =
  | { kind: "stat"; stat: ModStat; delta: number }
  | { kind: "trait"; trait: TraitId | "all"; delta: number }
  | { kind: "set"; stat: ModStat | TraitId; to: number }
  | Extract<Mod, { kind: "advantage" | "disadvantageAgainst" | "resistance" | "flag" }>;

export interface RollInfo {
  record: RollRecord;
  /** The Hope and Fear dice (0 for a d20 roll). */
  hope: number;
  fear: number;
  outcome: RollOutcome;
  critical: boolean;
  success: boolean;
  withHope: boolean;
  withFear: boolean;
  effects: DualityEffects;
}

/** One entry of the plan, in order. Targets are creature ids; `self` steps carry the actor's id. */
export type PlanStep =
  | { kind: "pay"; phase: "upfront" | "afterRoll" | "optional"; costs: PaidCost[]; paid: boolean }
  | { kind: "roll"; roll: RollInfo }
  | { kind: "hits"; results: HitResult[] }
  | { kind: "damageRoll"; record: RollRecord; type: DamageType | "both" }
  /** A move's total damage applied once to an adversary (R2, R3, R10). */
  | { kind: "damage"; result: DamageResult }
  /** Damage to a PC: Armor Slots and the PC's thresholds are AA1's (the reaction window); nothing is applied here. */
  | { kind: "pcDamage"; targetId: string; amount: number; type: DamageType | "both"; direct: boolean }
  | { kind: "mark"; targetId: string; track: Track; amount: number; hpMarked: number; overflow: boolean; noBenefit?: boolean }
  | { kind: "clear"; targetId: string; track: Track; amount: number }
  | { kind: "hope"; targetId: string; delta: number }
  | { kind: "fear"; delta: number }
  | { kind: "condition"; targetId: string; condition: ConditionRef; duration: Duration; endsWhen?: string }
  | { kind: "clearCondition"; targetId: string; condition: ConditionRef }
  | { kind: "effect"; targetId: string; label: string; mods: ResolvedMod[]; duration: Duration; endsWhen?: string }
  | { kind: "tokens"; op: "set" | "add" | "spend" | "clear"; before: number; after: number; die?: number }
  | { kind: "toVault"; permanent: boolean }
  | { kind: "save"; targetId: string; record: RollRecord; difficulty: number; success: boolean }
  | { kind: "check"; total: number; dice: number[]; passed: boolean }
  | { kind: "defeat"; targetId: string; amount?: number }
  /** Minion (X): extra Minions the attacker may defeat (CB p.201, Q6). */
  | { kind: "minionOffer"; targetId: string; extra: number }
  /** A step for the table: a movement prompt (Q9), the card's words (manual), or a choice still missing. */
  | {
      kind: "prompt";
      prompt: "move" | "manual" | "choose" | "split" | "pcSave";
      text: string;
      targetIds: string[];
      step?: Step;
      amount?: number;
    }
  /**
   * An outcome the runner can't apply on its own: it changes another roll or another creature's incoming damage
   * (modifyRoll, redirectDamage, extraArmorSlots, reduceSeverity, reduceDamage, negate, convertMarks, refreshFeature, a
   * rider's modifyDamage). The server or the reaction window (AA1) folds it in; `amount` is the resolved number.
   */
  | { kind: "fold"; step: OutcomeStep; targetIds: string[]; amount?: number | "any" };

export interface RunPlan {
  cardId: string;
  useId: string;
  name: string;
  activation: CardUse["activation"]["kind"];
  steps: PlanStep[];
  roll: RollInfo | null;
  hits: HitResult[];
  /** The move succeeded: the roll's outcome against a fixed Difficulty, or any target hit against theirs; true without a roll. */
  success: boolean;
  /** The limit entry written when `consumed` (Q3, Q4). */
  limit: { key: string; until: FeatureUse["until"]; consumed: boolean } | null;
  /** The actor's resources and feature uses before and after the use. */
  actor: { before: ActorResources; after: ActorResources; featureUses: FeatureUse[] };
  /** Every other creature the use changed, before and after. */
  creatures: { id: string; before: Combatant; after: Combatant }[];
  gmFearDelta: number;
  /** Targets dropped by the card's own filters (maxDifficulty, excludeFlying). */
  excluded: string[];
  /** "only one creature at a time": the server ends this card's previous effect. */
  exclusive: boolean;
}

export interface ActorResources {
  hope: number;
  stress: number;
  hp: number;
  armor: number;
  cardTokens: number;
}

export type RunRefusal = {
  ok: false;
  /** noUse: no such use; requirement: unmet (`unmet`); exhausted: CARD_EXHAUSTED; cost: CARD_COST_UNPAID (`short`); choice / targets: bad input. */
  reason: "noUse" | "requirement" | "exhausted" | "cost" | "choice" | "targets";
  detail: string;
};

export type RunResult = { ok: true; plan: RunPlan } | RunRefusal;

// ---------------------------------------------------------------- helpers

/** The use a context picks: by id, else the first `action` use, else the first. */
export function pickUse(effect: CardEffect, useId?: string): CardUse | undefined {
  if (useId !== undefined) return effect.uses.find((u) => u.id === useId);
  return effect.uses.find((u) => u.activation.kind === "action") ?? effect.uses[0];
}

const refuse = (reason: RunRefusal["reason"], detail: string): RunRefusal => ({ ok: false, reason, detail });

const MOVE_GATES = new Set<string>(["success", "failure", "critical", "withHope", "withFear"]);

/** Whether a roll filter matches a roll spec (riders: "Before you make an attack"). Exported for the server's rider offers. */
export function rollMatches(filter: RollFilter, roll: RollSpec | undefined): boolean {
  if (filter === "any") return roll !== undefined;
  if (!roll) return false;
  switch (filter) {
    case "action":
      return roll.kind !== "reaction";
    case "attack":
      return roll.kind === "attack" || roll.kind === "spellcast";
    case "weaponAttack":
      return roll.kind === "attack";
    case "spellcast":
      return roll.kind === "spellcast" || (roll.kind === "reaction" && roll.trait === "spellcast");
    case "reaction":
      return roll.kind === "reaction";
    case "damage":
      return false;
    default:
      return roll.kind === "trait" && (typeof roll.trait === "string" ? roll.trait === filter : roll.trait.includes(filter));
  }
}

/** A d20 roll (adversary attack, adversary reaction roll): two dice keep the higher / lower with advantage / disadvantage. */
export function rollD20(rng: Rng, modifier: number, advantage: number, disadvantage: number): { record: RollRecord; natural: number } {
  const net = advantage - disadvantage;
  const first = rng(20);
  const dice: RollRecord["dice"] = [{ sides: 20, value: first, role: "extra" }];
  let natural = first;
  if (net !== 0) {
    const second = rng(20);
    const keepSecond = net > 0 ? second > first : second < first;
    natural = keepSecond ? second : first;
    dice.push({ sides: 20, value: second, role: net > 0 ? "advantage" : "disadvantage" });
    if (keepSecond) dice[0] = { ...dice[0]!, dropped: true };
    else dice[1] = { ...dice[1]!, dropped: true };
  }
  return { record: { kind: "reaction", dice, modifier, total: natural + modifier, outcome: "none", manual: false }, natural };
}

function outcomeOf(hope: number, fear: number, critical: boolean, success: boolean): RollOutcome {
  if (critical) return "critical";
  if (hope > fear) return success ? "successHope" : "failHope";
  return success ? "successFear" : "failFear";
}

/** Re-rolls dice at or below `atMost` once (Not Good Enough). */
function rerollLow(record: RollRecord, atMost: number, rng: Rng): RollRecord {
  const dice = record.dice.map((d) => (d.role === "damage" && d.value <= atMost ? { ...d, value: rng(d.sides) } : d));
  return { ...record, dice, total: Math.max(0, dice.reduce((s, d) => s + (d.dropped ? 0 : d.value), 0) + record.modifier) };
}

/** Uses the maximum of the `count` lowest damage dice (Versatile Fighter). */
function maxLowest(record: RollRecord, count: number): RollRecord {
  const order = record.dice
    .map((d, i) => ({ d, i }))
    .filter((x) => x.d.role === "damage")
    .sort((a, b) => a.d.value - b.d.value)
    .slice(0, count)
    .map((x) => x.i);
  const dice = record.dice.map((d, i) => (order.includes(i) ? { ...d, value: d.sides } : d));
  return { ...record, dice, total: Math.max(0, dice.reduce((s, d) => s + (d.dropped ? 0 : d.value), 0) + record.modifier) };
}

// ---------------------------------------------------------------- the runner

interface Scope {
  /** The creatures `to: "targets"` means here. */
  targets: readonly string[];
  /** Hit or miss per creature for this scope's roll (absent = no roll: every recipient passes `hit`). */
  hits: ReadonlyMap<string, boolean> | null;
  roll: RollInfo | null;
}

interface Pending {
  amount: number;
  type: DamageType | "both";
  direct: boolean;
  minimumSeverity?: Severity;
  replaceWithHp?: number;
}

/**
 * Runs one use of a card. Refuses before anything is paid when a requirement fails, the limit is used up
 * (CARD_EXHAUSTED), a choice or the target count is out of bounds, or an upfront cost can't be paid (CARD_COST_UNPAID).
 */
export function run(effect: CardEffect, context: RunContext): RunResult {
  const use = pickUse(effect, context.useId);
  if (!use) return refuse("noUse", `No use "${context.useId ?? ""}" on ${effect.cardId}.`);
  const rng = context.rng;
  const actor0 = context.actor;

  // ---- requirements (CB p.101 aside, the card's own conditions)
  const reqState = (a: ActorState): RequirementState => ({
    hp: a.hp,
    hpMax: a.hpMax,
    stress: a.stress,
    stressMax: a.stressMax,
    armor: a.armor,
    hope: a.hope,
    armorWorn: a.armorWorn,
    loadoutDomains: a.loadoutDomains,
    activeCardEffects: a.activeCardEffects,
    nearestEnemy: context.nearestEnemy,
    situations: context.situations ?? [],
  });
  const unmet = unmetRequirements(use.requires, reqState(actor0));
  if (unmet.length > 0) return refuse("requirement", unmet.map((r) => r.kind).join(", "));

  // ---- limit (CB p.101, Q3)
  const targets0 = context.targets ?? [];
  const limitKey = use.limit ? featureUseKey(effect.cardId, use.id, use.limit.perTarget ? targets0[0]?.id : undefined) : null;
  if (use.limit) {
    const availability = cardAvailability(actor0, effect.cardId, { useId: use.id, limit: use.limit, targetId: targets0[0]?.id });
    if (availability.state === "exhausted") return refuse("exhausted", availability.label);
  }

  // ---- state
  let actor: ActorState = { ...actor0 };
  const creatures = new Map<string, Combatant>();
  const before = new Map<string, Combatant>();
  for (const c of [...targets0, ...(context.picked ?? []), ...(context.allies ?? []), ...(context.followUp ?? []), context.trigger?.source, context.trigger?.subject]) {
    if (c && c.id !== actor.id && !creatures.has(c.id)) {
      creatures.set(c.id, c);
      before.set(c.id, c);
    }
  }
  const get = (id: string): Combatant => (id === actor.id ? actor : creatures.get(id)!);
  const put = (c: Combatant) => {
    if (c.id === actor.id) actor = { ...actor, ...c };
    else creatures.set(c.id, c);
  };
  let gmFearDelta = 0;
  const steps: PlanStep[] = [];
  const choices: Record<string, number> = { ...(context.choices ?? {}) };
  const spent: Partial<Record<PaidCost["resource"], number>> = {};
  const markedSelf: Partial<Record<Track, number>> = {};
  const markedBy: Record<string, Partial<Record<Track, number>>> = {};
  const counts = { picked: targets0.length, hit: 0, failedSave: 0 };
  let lastRoll: number | undefined;
  let rollTotal: number | undefined;

  const env = (target?: Combatant): NumberEnv => ({
    traits: actor.traits,
    spellcast: actor.spellcast,
    proficiency: actor.proficiency,
    level: actor.level,
    tier: actor.tier,
    spent,
    choices,
    cardTokens: actor.cardTokens,
    gmFear: Math.max(0, Math.min(MAX_FEAR, context.gmFear + gmFearDelta)),
    self: { hp: actor.hp, stress: actor.stress, armor: actor.armor },
    target: target ? { id: target.id, hp: target.hp, stress: target.stress, armor: target.armor } : undefined,
    markedThisMove: { self: markedSelf, byTarget: markedBy },
    targetCount: counts,
    rollTotal,
    triggerAmount: context.trigger?.amount,
    loadoutDomains: actor.loadoutDomains,
    vaultDomains: actor.vaultDomains,
    lastRoll,
  });
  const num = (source: NumberSource, target?: Combatant): number => {
    const e = env(target);
    const value = resolveNumber(source, e, rng);
    lastRoll = e.lastRoll;
    return value;
  };
  const addMarked = (id: string, track: Track, n: number) => {
    if (n <= 0) return;
    const bucket = id === actor.id ? markedSelf : (markedBy[id] ??= {});
    bucket[track] = (bucket[track] ?? 0) + n;
  };

  // ---- choices
  for (const choice of use.choices ?? []) {
    const value = choices[choice.id] ?? choice.min;
    const max = choice.max ? num(choice.max) : Infinity;
    if (!Number.isInteger(value) || value < choice.min || value > max) return refuse("choice", `${choice.label}: ${value}`);
    choices[choice.id] = value;
  }

  // ---- targets (CB p.104: any that fall within the parameters)
  const excluded: string[] = [];
  let targets = targets0;
  const spec = use.targets && use.targets.side !== "trigger" ? (use.targets as TargetSpec) : undefined;
  if (spec) {
    targets = targets0.filter((t) => {
      const out = (spec.maxDifficulty !== undefined && (t.difficulty ?? 0) > spec.maxDifficulty) || (spec.excludeFlying === true && t.flying === true);
      if (out) excluded.push(t.id);
      return !out;
    });
    const n = targets0.length;
    const max =
      spec.count.kind === "one" ? 1 : spec.count.kind === "upTo" ? num(spec.count.n) : spec.count.kind === "any" && spec.count.max ? num(spec.count.max) : Infinity;
    // With an area, `count` limits the picked anchor; the server passes every creature in the area as targets.
    if (spec.area === undefined && n > max) return refuse("targets", `At most ${max} target(s).`);
  }
  if (use.targets && use.targets.side === "trigger") {
    const who = use.targets.who === "source" ? context.trigger?.source : context.trigger?.subject;
    targets = who ? [who] : [];
  }
  counts.picked = targets.length;

  // ---- upfront costs (CB p.90)
  let eitherIndex = 0;
  const pickEither = () => context.eitherCosts?.[eitherIndex++] ?? 0;
  const costAmount = (cost: Exclude<Cost, { kind: "either" | "gold" }>) => num(cost.amount);
  const payer = () => ({
    hope: actor.hope,
    stress: actor.stress,
    stressMax: actor.stressMax,
    hp: actor.hp,
    hpMax: actor.hpMax,
    armor: actor.armor,
    armorMax: actor.armorMax,
    cardTokens: actor.cardTokens,
    fear: Math.max(0, context.gmFear + gmFearDelta),
  });
  const payCosts = (paid: readonly PaidCost[]) => {
    for (const c of paid) {
      spent[c.resource] = (spent[c.resource] ?? 0) + c.amount;
      if (c.resource === "hope") actor = { ...actor, hope: actor.hope - c.amount };
      if (c.resource === "stress") {
        actor = { ...actor, stress: actor.stress + c.amount };
        addMarked(actor.id, "stress", c.amount);
      }
      if (c.resource === "hp") {
        actor = { ...actor, hp: actor.hp + c.amount };
        addMarked(actor.id, "hp", c.amount);
      }
      if (c.resource === "armor") {
        actor = { ...actor, armor: actor.armor + c.amount };
        addMarked(actor.id, "armor", c.amount);
      }
      if (c.resource === "tokens") actor = { ...actor, cardTokens: actor.cardTokens - c.amount };
      if (c.resource === "fear") gmFearDelta -= c.amount;
    }
  };
  const upfront = resolveCosts(use.costs ?? [], costAmount, pickEither);
  const short = unaffordable(upfront, payer());
  if (short.length > 0) return refuse("cost", short.join(", "));
  if (upfront.length > 0) {
    payCosts(upfront);
    steps.push({ kind: "pay", phase: "upfront", costs: upfront, paid: true });
  }

  // ---- the roll (R1, R9)
  const rollOnce = (rollSpec: RollSpec, against: readonly Combatant[]): { info: RollInfo; hits: Map<string, boolean> } => {
    const extraAdv = (rollSpec.advantage ? 1 : 0) + (context.roll?.advantage ?? 0);
    const extraDis = (rollSpec.disadvantage ? 1 : 0) + (context.roll?.disadvantage ?? 0);
    const modifier = (rollSpec.modifier ? num(rollSpec.modifier) : 0) + (context.roll?.modifier ?? 0);
    const diff = rollSpec.difficulty;
    const fixed = diff.kind === "fixed" ? diff.value : diff.kind === "gm" ? context.roll?.difficulty : undefined;
    const perTarget = diff.kind === "target" || diff.kind === "evasion";
    let info: RollInfo;
    if (rollSpec.kind === "adversaryAttack") {
      const { record, natural } = rollD20(rng, modifier, extraAdv, extraDis);
      const critical = natural === 20;
      const success = perTarget ? true : critical || fixed === undefined || record.total >= fixed;
      info = { record: { ...record, kind: "action", ...(fixed !== undefined ? { difficulty: fixed } : {}) }, hope: 0, fear: 0, outcome: "none", critical, success, withHope: false, withFear: false, effects: { hope: 0, clearStress: 0, fear: 0 } };
    } else {
      const kind = rollSpec.kind === "reaction" ? "reaction" : "action";
      const traitValue = (() => {
        if (rollSpec.kind === "spellcast") return actor.spellcast;
        if (rollSpec.kind === "reaction") return rollSpec.trait === "spellcast" ? actor.spellcast : (actor.traits[rollSpec.trait] ?? 0);
        if (rollSpec.kind === "trait") {
          const options: readonly TraitId[] = typeof rollSpec.trait === "string" ? [rollSpec.trait] : rollSpec.trait;
          const picked: TraitId = context.roll?.trait && options.includes(context.roll.trait) ? context.roll.trait : options[0]!;
          return actor.traits[picked] ?? 0;
        }
        const weapon = weaponFor(rollSpec.weapon);
        return weapon ? (actor.traits[weapon.trait] ?? 0) : 0;
      })();
      const duality = rollDuality(
        { kind, trait: traitValue, modifier, difficulty: perTarget ? undefined : fixed, advantage: extraAdv, disadvantage: extraDis, help: kind === "reaction" ? 0 : (context.roll?.help ?? 0) },
        rng,
      );
      const critical = duality.hope === duality.fear;
      const success = perTarget ? true : duality.roll.outcome === "critical" || duality.roll.outcome === "successHope" || duality.roll.outcome === "successFear";
      info = {
        record: duality.roll,
        hope: duality.hope,
        fear: duality.fear,
        outcome: duality.roll.outcome,
        critical,
        success,
        withHope: critical || duality.hope > duality.fear,
        withFear: !critical && duality.fear > duality.hope,
        effects: { hope: 0, clearStress: 0, fear: 0 },
      };
    }
    const hits = new Map<string, boolean>();
    if (perTarget) {
      const results = resolveHits(
        info.record.total,
        info.critical,
        against.map((t) => ({ id: t.id, difficulty: (diff.kind === "evasion" ? t.evasion : t.difficulty) ?? 0 })),
      );
      for (const r of results) hits.set(r.id, r.hit);
      const anyHit = results.some((r) => r.hit);
      info.success = against.length === 0 ? true : anyHit;
      if (rollSpec.kind !== "adversaryAttack") {
        info.outcome = outcomeOf(info.hope, info.fear, info.critical, info.success);
        info.record = { ...info.record, outcome: info.outcome };
      }
    } else {
      for (const t of against) hits.set(t.id, info.success);
    }
    info.effects = rollSpec.kind === "adversaryAttack" ? info.effects : dualityEffects(rollSpec.kind === "reaction" ? "reaction" : "action", info.outcome);
    return { info, hits };
  };

  function weaponFor(ref: "primary" | "secondary" | "either"): WeaponInfo | undefined {
    const slot = ref === "either" ? (context.roll?.weapon ?? "primary") : ref;
    return actor.weapons[slot] ?? (ref === "either" ? actor.weapons.primary ?? actor.weapons.secondary : undefined);
  }

  let mainRoll: RollInfo | null = null;
  let mainHits: Map<string, boolean> | null = null;
  if (use.roll) {
    const { info, hits } = rollOnce(use.roll, targets);
    mainRoll = info;
    mainHits = hits;
    rollTotal = info.record.total;
    counts.hit = [...hits.values()].filter(Boolean).length;
    steps.push({ kind: "roll", roll: info });
    if (targets.length > 0 && (use.roll.difficulty.kind === "target" || use.roll.difficulty.kind === "evasion")) {
      steps.push({ kind: "hits", results: targets.map((t) => ({ id: t.id, hit: hits.get(t.id) ?? false })) });
    }
    // R8: the roll's Hope (and a critical's Stress) lands before any later payment.
    const fx = info.effects;
    if (fx.hope) actor = { ...actor, hope: Math.min(actor.hopeMax, actor.hope + fx.hope) };
    if (fx.clearStress) actor = { ...actor, stress: Math.max(0, actor.stress - fx.clearStress) };
    if (fx.fear) gmFearDelta += fx.fear;
  }
  const success = mainRoll ? mainRoll.success : true;

  // ---- damage bookkeeping (R2, R9)
  const pending = new Map<string, Pending>();
  const damageCache = new Map<string, { record: RollRecord; type: DamageType | "both" }>();
  const preDamage: DamageChange[] = [];
  let typeOverride: DamageType | undefined;
  let lastDamageTotal = 0;
  let anyDamageRolled = false;

  const flush = () => {
    for (const [id, p] of pending) {
      const target = get(id);
      if (p.replaceWithHp !== undefined) {
        const r = applyHpTo(target, p.replaceWithHp);
        put(r.after);
        addMarked(id, "hp", r.hpMarked);
        steps.push({ kind: "mark", targetId: id, track: "hp", amount: p.replaceWithHp, hpMarked: r.hpMarked, overflow: false });
        continue;
      }
      if (target.side === "pc") {
        steps.push({ kind: "pcDamage", targetId: id, amount: Math.max(0, p.amount), type: p.type, direct: p.direct });
        continue;
      }
      const result = applyDamageTo(target, p.amount, p.type, p.minimumSeverity ? { minimumSeverity: p.minimumSeverity } : {});
      put(result.after);
      addMarked(id, "hp", result.hpMarked);
      steps.push({ kind: "damage", result });
      if (result.minionExtra > 0) steps.push({ kind: "minionOffer", targetId: id, extra: result.minionExtra });
    }
    pending.clear();
  };

  const rollDamageFor = (roll: DamageRoll, crit: boolean): { record: RollRecord; type: DamageType | "both" } => {
    const key = JSON.stringify(roll);
    const cached = damageCache.get(key);
    if (cached) return cached;
    let pool: DicePool = [];
    let flat = 0;
    let type: DamageType | "both" = "physical";
    let critical = crit;
    if (roll.kind === "dice") {
      const d = resolveDice(roll.dice, env(), rng);
      pool = [{ count: d.count, sides: d.sides }];
      flat = d.plus;
    } else if (roll.kind === "weapon") {
      const weapon = weaponFor(roll.weapon);
      let prof = actor.proficiency;
      if (roll.proficiency === "half") prof = Math.ceil(prof / 2);
      else if (roll.proficiency) prof += roll.proficiency.delta;
      for (const ch of preDamage) if (ch.kind === "proficiency") prof += ch.delta;
      if (weapon) {
        const wd = weaponDice(weapon.damage, Math.max(1, prof));
        pool = wd.dice;
        flat = wd.flat;
        type = weapon.damageType;
      }
    } else if (roll.kind === "standardAttack") {
      const parsed = context.attackDamage ? parseDamage(context.attackDamage) : null;
      if (parsed?.dice) pool = [parsed.dice];
      flat = parsed?.modifier ?? 0;
      type = parsed?.type === "mag" ? "magic" : parsed?.type === "phy/mag" ? "both" : "physical";
    } else {
      critical = false;
      flat = roll.kind === "flat" ? num(roll.amount) : roll.kind === "sameAsTrigger" ? (context.trigger?.amount ?? 0) : lastDamageTotal;
    }
    let record = pool.length > 0 ? rollDamage({ dice: pool, flat, critical }, rng) : ({ kind: "damage", dice: [], modifier: flat, total: Math.max(0, flat), outcome: "none", manual: false } as RollRecord);
    for (const ch of preDamage) {
      if (ch.kind === "reroll") record = rerollLow(record, ch.atMost, rng);
      if (ch.kind === "maxDice") record = maxLowest(record, ch.count);
    }
    const out = { record, type };
    damageCache.set(key, out);
    return out;
  };

  // ---- gates and recipients
  const moveGate = (gate: Gate, scope: Scope): boolean => {
    const r = scope.roll;
    switch (gate) {
      case "success":
        return r ? r.success : true;
      case "failure":
        return r ? !r.success : false;
      case "critical":
        return r?.critical ?? false;
      case "withHope":
        return r?.withHope ?? false;
      case "withFear":
        return r?.withFear ?? false;
      default:
        return true;
    }
  };
  const targetGate = (gate: Gate, c: Combatant, scope: Scope): boolean => {
    if (typeof gate === "string") {
      if (MOVE_GATES.has(gate)) return moveGate(gate, scope);
      switch (gate) {
        case "hit":
          return scope.hits ? (scope.hits.get(c.id) ?? false) : true;
        case "miss":
          return scope.hits ? !(scope.hits.get(c.id) ?? false) : false;
        case "targetMarkedHp":
          return (markedBy[c.id]?.hp ?? (c.id === actor.id ? markedSelf.hp : 0) ?? 0) > 0;
        case "targetDefeated":
          return get(c.id).defeated && !(before.get(c.id)?.defeated ?? false);
        case "targetStressFull":
          return c.stressMax > 0 && get(c.id).stress >= c.stressMax;
      }
      return true;
    }
    switch (gate.kind) {
      case "targetHas": {
        const now = get(c.id);
        const cond = gate.condition;
        if (cond.kind === "standard") return now.conditions.includes(cond.condition);
        return (now.tags ?? []).includes(cond.tag);
      }
      case "chosen":
        return (context.options?.[gate.choice] ?? []).includes(gate.option);
      case "requires":
        return unmetRequirements([gate.requirement], reqState(actor)).length === 0;
    }
  };
  const isTargetGate = (g: Gate) =>
    typeof g === "string" ? ["hit", "miss", "targetMarkedHp", "targetDefeated", "targetStressFull"].includes(g) : g.kind === "targetHas";
  const needsFlush = (gates: readonly Gate[] | undefined) => (gates ?? []).some((g) => g === "targetMarkedHp" || g === "targetDefeated" || g === "targetStressFull");

  /** Whether a step without per-creature recipients may run: move gates hold, and a per-target gate holds for any target. */
  const stepGate = (gates: readonly Gate[] | undefined, scope: Scope): boolean =>
    (gates ?? []).every((g) => {
      if (isTargetGate(g)) {
        if (scope.targets.length === 0) return g === "hit" ? !scope.hits : false;
        return scope.targets.some((id) => targetGate(g, get(id), scope));
      }
      return targetGate(g, actor, scope);
    });

  const recipientsOf = (to: Recipient, gates: readonly Gate[] | undefined, scope: Scope): Combatant[] => {
    let list: Combatant[];
    switch (to) {
      case "self":
        list = [actor];
        break;
      case "targets":
        list = scope.targets.map(get);
        break;
      case "picked":
        list = (context.picked ?? []).map((c) => get(c.id));
        break;
      case "triggerSource":
        list = context.trigger?.source ? [get(context.trigger.source.id)] : [];
        break;
      case "triggerSubject":
        list = context.trigger?.subject ? [get(context.trigger.subject.id)] : [];
        break;
      case "allies":
        list = (context.allies ?? []).map((c) => get(c.id));
        break;
      case "selfAndAllies":
        list = [actor, ...(context.allies ?? []).map((c) => get(c.id))];
        break;
    }
    // Per-target gates filter `targets` one by one; for anyone else they hold when they hold for any target.
    const perCreature = to === "targets";
    return list.filter((c) => (gates ?? []).every((g) => (perCreature || !isTargetGate(g) ? targetGate(g, c, scope) : stepGate([g], scope))));
  };

  const resolveMods = (mods: readonly Mod[], target?: Combatant): ResolvedMod[] =>
    mods.map((m) => {
      if (m.kind === "stat") return { kind: "stat", stat: m.stat, delta: num(m.delta, target) };
      if (m.kind === "trait") return { kind: "trait", trait: m.trait, delta: num(m.delta, target) };
      if (m.kind === "set") return { kind: "set", stat: m.stat, to: num(m.to, target) };
      return m;
    });

  // ---- steps
  const runSteps = (list: readonly Step[], scope: Scope): void => {
    for (const step of list) {
      if (needsFlush(step.when)) flush();
      if (!runStep(step, scope)) return;
    }
  };

  /** Runs one step; false stops the rest of its list (an unpaid `pay`, CB p.90). */
  const runStep = (step: Step, scope: Scope): boolean => {
    switch (step.kind) {
      case "pay": {
        if (!stepGate(step.when, scope)) return true;
        const costs = resolveCosts(step.costs, costAmount, pickEither);
        const ok = unaffordable(costs, payer()).length === 0;
        if (ok) payCosts(costs);
        steps.push({ kind: "pay", phase: "afterRoll", costs, paid: ok });
        return ok;
      }
      case "optional": {
        if (!(context.optionals ?? []).includes(step.id) || !stepGate(step.when, scope)) return true;
        if (step.limit) {
          const availability = cardAvailability(actor, effect.cardId, { useId: `${use.id}:${step.id}`, limit: step.limit });
          if (availability.state === "exhausted") return true;
        }
        const costs = resolveCosts(step.costs ?? [], costAmount, pickEither);
        if (unaffordable(costs, payer()).length > 0) {
          steps.push({ kind: "pay", phase: "optional", costs, paid: false });
          return true;
        }
        if (costs.length > 0) {
          payCosts(costs);
          steps.push({ kind: "pay", phase: "optional", costs, paid: true });
        }
        runSteps(step.steps, scope);
        if (step.limit && limitConsumed(step.limit, success)) {
          actor = { ...actor, featureUses: [...actor.featureUses, { key: featureUseKey(effect.cardId, `${use.id}:${step.id}`), until: limitUntil(step.limit.per) }] };
        }
        return true;
      }
      case "choose": {
        if (!stepGate(step.when, scope)) return true;
        const picked = context.options?.[step.id] ?? [];
        if (picked.length === 0) {
          steps.push({ kind: "prompt", prompt: "choose", text: step.label, targetIds: [], step });
          return true;
        }
        const max = step.count ? num(step.count) : 1;
        const list = (step.distinct ? [...new Set(picked)] : picked).slice(0, Math.max(0, max));
        for (const id of list) {
          const option = step.options.find((o) => o.id === id);
          if (option) runSteps(option.steps, scope);
        }
        return true;
      }
      case "save": {
        if (!stepGate(step.when, scope)) return true;
        const recipients = recipientsOf(step.to, step.when?.filter(isTargetGate), scope);
        for (const r of recipients) {
          if (r.side === "pc") {
            steps.push({ kind: "prompt", prompt: "pcSave", text: "Reaction roll", targetIds: [r.id], step });
            continue;
          }
          const difficulty = saveDifficulty(step.difficulty);
          const { record } = rollD20(rng, 0, 0, 0);
          const ok = record.total >= difficulty;
          steps.push({ kind: "save", targetId: r.id, record: { ...record, difficulty }, difficulty, success: ok });
          if (!ok) counts.failedSave += 1;
          runSteps(ok ? step.onSuccess : step.onFail, { ...scope, targets: [r.id] });
        }
        return true;
      }
      case "check": {
        if (!stepGate(step.when, scope)) return true;
        const d = resolveDice(step.dice, env(), rng);
        const dice = rollDice(d.count, d.sides, rng);
        const total = dice.reduce((s, n) => s + n, 0) + d.plus;
        lastRoll = total;
        const t = step.test;
        const passed =
          t.kind === "anyAtLeast"
            ? dice.some((n) => n >= t.value)
            : t.kind === "allAtMost"
              ? dice.length > 0 && dice.every((n) => n <= t.value)
              : t.kind === "totalAtLeast"
                ? total >= t.value
                : total <= t.value;
        steps.push({ kind: "check", total, dice, passed });
        runSteps(passed ? step.then : step.otherwise, scope);
        return true;
      }
      case "followUp": {
        if (!stepGate(step.when, scope)) return true;
        const others = (context.followUp ?? []).map((c) => get(c.id));
        if (step.roll) {
          flush();
          const { info, hits } = rollOnce(step.roll, others);
          steps.push({ kind: "roll", roll: info });
          steps.push({ kind: "hits", results: others.map((t) => ({ id: t.id, hit: hits.get(t.id) ?? false })) });
          const fx = info.effects;
          if (fx.hope) actor = { ...actor, hope: Math.min(actor.hopeMax, actor.hope + fx.hope) };
          if (fx.clearStress) actor = { ...actor, stress: Math.max(0, actor.stress - fx.clearStress) };
          if (fx.fear) gmFearDelta += fx.fear;
          runSteps(step.steps, { targets: others.map((c) => c.id), hits, roll: info });
        } else {
          const hits = new Map<string, boolean>();
          const r = scope.roll;
          if (r) for (const h of resolveHits(r.record.total, r.critical, others.map((t) => ({ id: t.id, difficulty: t.difficulty ?? t.evasion ?? 0 })))) hits.set(h.id, h.hit);
          if (r) steps.push({ kind: "hits", results: others.map((t) => ({ id: t.id, hit: hits.get(t.id) ?? false })) });
          runSteps(step.steps, { targets: others.map((c) => c.id), hits: r ? hits : null, roll: r });
        }
        return true;
      }
      default:
        runOutcome(step, scope);
        return true;
    }
  };

  const saveDifficulty = (d: SaveDifficulty): number => {
    switch (d.kind) {
      case "fixed":
        return d.value;
      case "rollTotal":
        return rollTotal ?? 0;
      case "number":
        return num(d.value);
      case "actorDifficulty":
        return actor.difficulty ?? 0;
    }
  };

  const crit = () => mainRoll !== null && mainRoll.critical && use.roll?.kind !== "reaction";

  const runOutcome = (step: OutcomeStep, scope: Scope): void => {
    const recipients = recipientsOf(step.to, step.when, scope);
    const ids = recipients.map((r) => r.id);
    const noRecipientStep = step.kind === "fear" || step.kind === "toVault" || step.kind === "tokens" || step.kind === "manual";
    if (noRecipientStep && !stepGate(step.when, scope)) return;
    if (!noRecipientStep && recipients.length === 0) return;
    switch (step.kind) {
      case "damage": {
        const rolled = rollDamageFor(step.roll, crit() && step.roll.kind !== "flat");
        anyDamageRolled = true;
        let type: DamageType | "both" = step.type === "weapon" ? rolled.type : step.type;
        if (typeOverride) type = typeOverride;
        const repeat = step.repeat ? Math.max(0, num(step.repeat)) : 1;
        let total = rolled.record.total;
        let record = rolled.record;
        if (repeat !== 1) {
          // "1d20+2 magic damage for each Stress marked": the expression rolled that many times and totalled.
          const records = [rolled.record, ...Array.from({ length: Math.max(0, repeat - 1) }, () => {
            damageCache.delete(JSON.stringify(step.roll));
            return rollDamageFor(step.roll, crit()).record;
          })].slice(0, repeat);
          total = records.reduce((s, r) => s + r.total, 0);
          record = { ...rolled.record, dice: records.flatMap((r) => r.dice), modifier: records.reduce((s, r) => s + r.modifier, 0), total };
        }
        lastDamageTotal = total;
        steps.push({ kind: "damageRoll", record, type });
        const dieSides = record.dice.find((d) => d.role === "damage")?.sides ?? 0;
        const damageDice = record.dice.filter((d) => d.role === "damage" && !d.dropped).map((d) => d.value).sort((a, b) => a - b);
        recipients.forEach((r, index) => {
          let amount = total;
          if (step.distribution === "split") {
            const share = context.splits?.[r.id];
            if (share === undefined) return;
            amount = Math.max(0, Math.min(total, share));
          } else if (step.distribution === "dropDiePerTarget") {
            // Deathrun: one die fewer for each later target (the lowest goes first; a critical's maximum goes with it).
            const dropped = damageDice.slice(0, index).reduce((s, n) => s + n, 0) + (crit() ? index * dieSides : 0);
            if (index >= damageDice.length) return;
            amount = Math.max(0, total - dropped);
          }
          if (step.extraDiePerTarget && dieSides > 0) amount += rng(dieSides);
          if (step.scale === "half") amount = Math.ceil(amount / 2);
          if (step.scale === "double") amount *= 2;
          const p = pending.get(r.id);
          pending.set(r.id, {
            amount: (p?.amount ?? 0) + amount,
            type: p && p.type !== type ? "both" : type,
            direct: (p?.direct ?? false) || step.direct === true,
            minimumSeverity: p?.minimumSeverity,
          });
        });
        if (step.distribution === "split" && recipients.some((r) => context.splits?.[r.id] === undefined)) {
          steps.push({ kind: "prompt", prompt: "split", text: "Distribute the damage", targetIds: ids, step, amount: total });
        }
        return;
      }
      case "modifyDamage": {
        const ch = step.change;
        const withPending = recipients.filter((r) => pending.has(r.id));
        if (!anyDamageRolled && (ch.kind === "proficiency" || ch.kind === "reroll" || ch.kind === "maxDice")) {
          preDamage.push(ch);
          if (!use.steps.some((s) => s.kind === "damage")) steps.push({ kind: "fold", step, targetIds: ids, amount: ch.kind === "proficiency" ? ch.delta : undefined });
          return;
        }
        if (ch.kind === "type" && !anyDamageRolled) {
          typeOverride = ch.type;
          if (!use.steps.some((s) => s.kind === "damage")) steps.push({ kind: "fold", step, targetIds: ids });
          return;
        }
        if (withPending.length === 0) {
          const amount = ch.kind === "add" || ch.kind === "replaceWithHp" ? num(ch.amount) : undefined;
          steps.push({ kind: "fold", step, targetIds: ids, ...(amount !== undefined ? { amount } : {}) });
          return;
        }
        const added = ch.kind === "add" ? num(ch.amount) : 0;
        const hp = ch.kind === "replaceWithHp" ? num(ch.amount) : 0;
        for (const r of withPending) {
          const p = pending.get(r.id)!;
          if (ch.kind === "add") p.amount += added;
          if (ch.kind === "multiply") p.amount *= ch.factor;
          if (ch.kind === "halve") p.amount = Math.ceil(p.amount / 2);
          if (ch.kind === "type") p.type = ch.type;
          if (ch.kind === "minimumSeverity") p.minimumSeverity = ch.severity;
          if (ch.kind === "replaceWithHp") p.replaceWithHp = hp;
        }
        return;
      }
      case "markHp": {
        flush();
        for (const r of recipients) {
          const amount = num(step.amount, r);
          const res = applyHpTo(get(r.id), amount);
          put(res.after);
          addMarked(r.id, "hp", res.hpMarked);
          steps.push({ kind: "mark", targetId: r.id, track: "hp", amount, hpMarked: res.hpMarked, overflow: false });
        }
        return;
      }
      case "markStress": {
        for (const r of recipients) {
          const amount = num(step.amount, r);
          const res = applyStressTo(get(r.id), amount);
          put(res.after);
          addMarked(r.id, "stress", res.stressMarked);
          addMarked(r.id, "hp", res.hpMarked);
          steps.push({ kind: "mark", targetId: r.id, track: "stress", amount, hpMarked: res.hpMarked, overflow: res.overflow });
        }
        return;
      }
      case "markArmor": {
        for (const r of recipients) {
          const c = get(r.id);
          if (c.armorMax === undefined) continue;
          const amount = num(step.amount, r);
          const armor = Math.min(c.armorMax, (c.armor ?? 0) + amount);
          put({ ...c, armor });
          addMarked(r.id, "armor", armor - (c.armor ?? 0));
          steps.push({ kind: "mark", targetId: r.id, track: "armor", amount, hpMarked: 0, overflow: false, ...(step.noBenefit ? { noBenefit: true } : {}) });
        }
        return;
      }
      case "clear": {
        if (step.track === "hp") flush();
        for (const r of recipients) {
          let amount: number;
          if (step.distribution === "split") {
            const share = context.splits?.[r.id];
            if (share === undefined) continue;
            amount = share;
          } else amount = num(step.amount, r);
          const res = clearTrack(get(r.id), step.track, amount);
          put(res.after);
          steps.push({ kind: "clear", targetId: r.id, track: step.track, amount: res.cleared });
        }
        if (step.distribution === "split" && recipients.some((r) => context.splits?.[r.id] === undefined)) {
          steps.push({ kind: "prompt", prompt: "split", text: "Divide the clears", targetIds: ids, step, amount: num(step.amount) });
        }
        return;
      }
      case "hope": {
        for (const r of recipients) {
          const n = num(step.amount, r);
          const delta = step.change === "gain" ? n : -n;
          if (r.id === actor.id) {
            const hope = Math.max(0, Math.min(actor.hopeMax, actor.hope + delta));
            steps.push({ kind: "hope", targetId: r.id, delta: hope - actor.hope });
            actor = { ...actor, hope };
          } else steps.push({ kind: "hope", targetId: r.id, delta });
        }
        return;
      }
      case "fear": {
        const n = num(step.amount);
        const current = context.gmFear + gmFearDelta;
        const next = Math.max(0, Math.min(MAX_FEAR, current + (step.change === "gain" ? n : -n)));
        gmFearDelta += next - current;
        steps.push({ kind: "fear", delta: next - current });
        return;
      }
      case "condition": {
        for (const r of recipients) {
          const c = get(r.id);
          const cond = step.condition;
          if (cond.kind === "standard") {
            if (!c.conditions.includes(cond.condition)) put({ ...c, conditions: [...c.conditions, cond.condition] });
          } else {
            const implied = (cond.implies ?? []).filter((x) => !c.conditions.includes(x));
            put({ ...c, tags: [...new Set([...(c.tags ?? []), cond.tag])], conditions: [...c.conditions, ...implied] });
          }
          steps.push({ kind: "condition", targetId: r.id, condition: cond, duration: step.duration, ...(step.endsWhen ? { endsWhen: step.endsWhen } : {}) });
        }
        return;
      }
      case "clearCondition": {
        for (const r of recipients) {
          const c = get(r.id);
          const cond = step.condition;
          if (cond.kind === "standard") put({ ...c, conditions: c.conditions.filter((x) => x !== cond.condition) });
          else put({ ...c, tags: (c.tags ?? []).filter((x) => x !== cond.tag) });
          steps.push({ kind: "clearCondition", targetId: r.id, condition: cond });
        }
        return;
      }
      case "move":
        steps.push({ kind: "prompt", prompt: "move", text: step.note ?? moveText(step), targetIds: ids, step });
        return;
      case "effect": {
        for (const r of recipients) {
          steps.push({
            kind: "effect",
            targetId: r.id,
            label: step.label,
            mods: resolveMods(step.mods, r),
            duration: step.duration,
            ...(step.endsWhen ? { endsWhen: step.endsWhen } : {}),
          });
        }
        return;
      }
      case "tokens": {
        const before = actor.cardTokens;
        const amount = step.amount ? num(step.amount) : 0;
        const max = step.max ? num(step.max) : Infinity;
        const raw = step.op === "set" ? amount : step.op === "add" ? before + amount : step.op === "spend" ? before - amount : 0;
        const after = Math.max(0, Math.min(max, raw));
        actor = { ...actor, cardTokens: after };
        if (step.op === "spend") spent.tokens = (spent.tokens ?? 0) + (before - after);
        steps.push({ kind: "tokens", op: step.op, before, after, ...(step.die ? { die: step.die } : {}) });
        return;
      }
      case "toVault":
        steps.push({ kind: "toVault", permanent: step.permanent === true });
        return;
      case "defeat": {
        flush();
        for (const r of recipients) {
          const c = get(r.id);
          const amount = step.amount ? num(step.amount, r) : undefined;
          if (amount === undefined) put({ ...c, hp: c.hpMax, defeated: true });
          steps.push({ kind: "defeat", targetId: r.id, ...(amount !== undefined ? { amount } : {}) });
        }
        return;
      }
      case "manual":
        steps.push({ kind: "prompt", prompt: "manual", text: step.text, targetIds: ids, step });
        return;
      case "reduceDamage":
        steps.push({ kind: "fold", step, targetIds: ids, amount: num(step.amount) });
        return;
      case "extraArmorSlots":
        steps.push({ kind: "fold", step, targetIds: ids, amount: step.max === "any" ? "any" : num(step.max) });
        return;
      case "reduceSeverity":
        steps.push({ kind: "fold", step, targetIds: ids, amount: step.steps });
        return;
      case "modifyRoll": {
        const ch = step.change;
        const amount = ch.kind === "add" || ch.kind === "evasion" ? num(ch.amount) : undefined;
        steps.push({ kind: "fold", step, targetIds: ids, ...(amount !== undefined ? { amount } : {}) });
        return;
      }
      case "redirectDamage":
      case "negate":
      case "convertMarks":
      case "refreshFeature":
        steps.push({ kind: "fold", step, targetIds: ids });
        return;
    }
  };

  runSteps(use.steps, { targets: targets.map((t) => t.id), hits: mainHits, roll: mainRoll });
  flush();

  // ---- the limit (Q3, Q4)
  let limit: RunPlan["limit"] = null;
  if (use.limit && limitKey) {
    const consumed = limitConsumed(use.limit, success);
    const until = limitUntil(use.limit.per);
    limit = { key: limitKey, until, consumed };
    if (consumed) actor = { ...actor, featureUses: [...actor.featureUses, { key: limitKey, until }] };
  }

  const resources = (a: ActorState): ActorResources => ({ hope: a.hope, stress: a.stress, hp: a.hp, armor: a.armor, cardTokens: a.cardTokens });
  const changed = [...creatures.entries()]
    .filter(([id, c]) => c !== before.get(id))
    .map(([id, c]) => ({ id, before: before.get(id)!, after: c }));

  return {
    ok: true,
    plan: {
      cardId: effect.cardId,
      useId: use.id,
      name: use.name,
      activation: use.activation.kind,
      steps,
      roll: mainRoll,
      hits: targets.map((t) => ({ id: t.id, hit: mainHits ? (mainHits.get(t.id) ?? false) : true })),
      success,
      limit,
      actor: { before: resources(actor0), after: resources(actor), featureUses: [...actor.featureUses] },
      creatures: changed,
      gmFearDelta,
      excluded,
      exclusive: use.exclusive === true,
    },
  };
}

function moveText(step: Extract<OutcomeStep, { kind: "move" }>): string {
  const range = step.range ? ` (${step.range})` : "";
  const verb = { knockBack: "Knock back", pull: "Pull", teleport: "Teleport", move: "Move", flee: "Flee" }[step.mode];
  return `${verb}${range}`;
}
