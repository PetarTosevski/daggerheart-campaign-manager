// Reading an adversary's feature entries (plan combat-actions, tracer AA1; rules AR6, AR8): requirements, the passive
// modifiers in force, which reactions and automatic effects an event sets off, and what a spotlight costs. Pure: the
// server (AA2) and the Encounter tab / map UI ask the same questions.
//
// CB p.194: "For an adversary to use an action, they must have the spotlight. Passives and reactions typically don't
//   require the spotlight." "To make one of these moves, you must spend Fear as described, even if you already spent a
//   Fear to spotlight the adversary."
// CB p.195: "Adversary reactions are features that don't take effect until their specific trigger occurs … When it
//   triggers, you can choose to immediately use the reaction, and you don't have to spend Fear to interrupt the PCs with
//   this reaction (unless otherwise specified)." Q19 (a): a reaction is a one-tap prompt defaulting to No; `auto` uses
//   (Momentum's Fear) happen without asking.
// CB p.153: "You can spend a Fear to make an additional GM move, shifting the spotlight to another adversary."
// CB p.195, "Relentless (X)": "This adversary can be spotlighted up to X times per GM turn."
// Q18 (a): with no live map the GM targets PCs from the party list, with no range or line-of-sight restrictions. So every
//   range narrowing below holds when the band is unknown.
//
// ```ts
// unmetAdversaryRequirements(use.requires, { hp: 3, hpMax: 6, stress: 0, stressMax: 3, conditions: [], tokens: 0 });
// passiveSummary(effects, state).attackBonus;      // the attack bonus of the passives in force
// triggeredUses(effects, { kind: "onHit", attack: "standard" }, state); // Momentum: auto
// spotlightCost({ spotlightsThisTurn: 1, instanceSpotlights: 0, relentless: null }); // { fear: 1, overLimit: false }
// ```

import type { ConditionRef, DamageKeyword, DamageType, Mod, Range, RollFilter, RollResult, Severity, StateCheck } from "../card-effects/types";
import { withinRange } from "../combat-actions/distance";
import { resolveNumber, type NumberEnv } from "../combat-actions/numbers";
import type { Rng } from "../dice/index";
import { hordeHalved } from "../encounters/damage";
import { spotlightCostsFear } from "../encounters/spotlight";
import type {
  AdversaryFeatureEffect,
  AdversaryFeatureUse,
  AdversaryModifier,
  AdversaryRequirement,
  AdversaryTrigger,
} from "../adversary-effects/types";
import type { ResistanceLevel } from "../combat-actions/damage";
import type { TraitId } from "../../srd/types";

// ---------------------------------------------------------------- state and requirements

/** What an adversary's requirements read: the instance's tracks, conditions, stat-block tokens and the GM's confirmations. */
export interface AdversaryState {
  hp: number;
  hpMax: number;
  stress: number;
  stressMax: number;
  conditions: readonly string[];
  tags?: readonly string[];
  /** Tokens on its stat block (the instance's `tokens`). */
  tokens: number;
  /** Situation texts the GM confirmed ("While flying"). */
  situations?: readonly string[];
  /** Answers "another Dire Wolf is within Melee range of the target"; absent (no map, Q18): holds. */
  allyWithin?: (req: Extract<AdversaryRequirement, { kind: "allyWithin" }>) => boolean;
}

const hasCondition = (s: Pick<AdversaryState, "conditions" | "tags">, c: ConditionRef) =>
  c.kind === "standard" ? s.conditions.includes(c.condition) : (s.tags ?? []).includes(c.tag);

const inBounds = (n: number, atLeast: number | undefined, atMost: number | undefined) => (atLeast === undefined || n >= atLeast) && (atMost === undefined || n <= atMost);

/**
 * Lane E7 (dcm-2f3, dcm-cdz): a state check on the adversary itself, as far as its own state answers it: its conditions,
 * stat-block tokens, HP / Stress, and `not` / `anyOf` of those. Undefined when the engine can't read it (another
 * creature, the map): the GM's confirmation of the requirement's text decides then.
 */
export function adversaryStateCheck(check: StateCheck, s: AdversaryState): boolean | undefined {
  switch (check.kind) {
    case "hasCondition":
      return (check.who ?? "self") === "self" ? hasCondition(s, check.condition) : undefined;
    case "tokens":
      return (check.who ?? "self") === "self" && check.name === undefined ? inBounds(s.tokens, check.atLeast, check.atMost) : undefined;
    case "track": {
      if (check.who !== "self" || (check.track !== "hp" && check.track !== "stress")) return undefined;
      const marked = check.track === "hp" ? s.hp : s.stress;
      const max = check.track === "hp" ? s.hpMax : s.stressMax;
      return inBounds(check.measure === "marked" ? marked : max - marked, check.atLeast, check.atMost);
    }
    case "not": {
      const inner = adversaryStateCheck(check.check, s);
      return inner === undefined ? undefined : !inner;
    }
    case "anyOf": {
      const results = check.checks.map((c) => adversaryStateCheck(c, s));
      if (results.some((r) => r === true)) return true;
      return results.every((r) => r === false) ? false : undefined;
    }
    default:
      return undefined;
  }
}

/** Whether one requirement holds. `half` = half or more of the HP (CB p.199, rounded up like the tracker). */
export function adversaryRequirementMet(req: AdversaryRequirement, s: AdversaryState): boolean {
  switch (req.kind) {
    case "hpMarkedAtLeast":
      return req.value === "half" ? hordeHalved(s) : s.hp >= req.value;
    case "hpMarkedAtMost":
      return s.hp <= req.value;
    case "stressMarkedAtMost":
      return s.stress <= req.value;
    case "hasCondition":
      // Lane E7 (dcm-2f3): `lacks`, Magical Weakness (CB p.231: "While Dazed, they can't use their Regeneration action").
      return hasCondition(s, req.condition) !== (req.lacks === true);
    case "tokens":
      return inBounds(s.tokens, req.atLeast, req.atMost);
    case "allyWithin":
      return s.allyWithin ? s.allyWithin(req) : true;
    case "situation": {
      // Lane E7: a `check` the engine reads decides by itself (Hand of Glory's tokens); otherwise the GM confirms the text.
      const read = req.check ? adversaryStateCheck(req.check, s) : undefined;
      return read ?? (s.situations ?? []).includes(req.text);
    }
  }
}

/** The requirements that don't hold (empty = the use may go ahead). */
export function unmetAdversaryRequirements(reqs: readonly AdversaryRequirement[] | undefined, s: AdversaryState): AdversaryRequirement[] {
  return (reqs ?? []).filter((r) => !adversaryRequirementMet(r, s));
}

// ---------------------------------------------------------------- passives

/** The passive modifiers in force, summed. Numbers are resolved (Pool: "a bonus equal to the number of tokens"). */
export interface PassiveSummary {
  /** Bonus to its attack rolls (`stat attack` mods on self). */
  attackBonus: number;
  /** Change to its Difficulty. */
  difficulty: number;
  /** Strongest resistance per type (CB p.99); undefined when none. */
  resistance?: { physical: ResistanceLevel; magic: ResistanceLevel };
  /** Horde (X) damage text, Minion (X), Relentless (X). */
  horde: string | null;
  minion: number | null;
  relentless: number | null;
  spotlightCostsFear: boolean;
  /** "The Ogre's attacks deal direct damage" (CB p.99). */
  directAttacks: boolean;
  /** A change to its standard attack's damage. */
  attackDamageAdd: number;
  attackDamageType?: DamageType;
  /** Card flags on self (flying, cannotBeRestrained, …) and any other self mod as is. */
  flags: string[];
  /** AA2b (bead dcm-vv2 3): rolls it makes with advantage (`advantage` self mods: Aquatic Attacker, Out of Nowhere). */
  advantage?: RollFilter[];
  /**
   * Lane E7 (dcm-cdz): conditions it has while the passive holds (Hand of Glory, HF p.67: Hidden while its stat block has
   * a token; Fish-Tailed, HF p.82: Vulnerable out of the water). The server adds them to its conditions as it reads them.
   */
  selfConditions?: ConditionRef[];
  /** Lane E7 (dcm-yea, dcm-dv6): weaknesses on self (Made of Straw, HF p.79: "double damage from fire"). */
  weaknesses?: { type?: DamageType; keyword?: DamageKeyword }[];
  /** AA2b: rolls made against it with disadvantage (`disadvantageAgainst` self mods: Wind Lord). */
  disadvantageAgainst?: RollFilter[];
  /** Mods and condition auras on others, for the server to show or apply. */
  auras: Extract<AdversaryModifier, { kind: "mod" | "conditionAura" }>[];
}

const LEVELS: readonly ResistanceLevel[] = ["none", "resistant", "immune"];
const stronger = (a: ResistanceLevel, b: ResistanceLevel) => (LEVELS.indexOf(b) > LEVELS.indexOf(a) ? b : a);

/**
 * A minimal number environment for passives, costs and prompts: tokens, Fear, the adversary's tracks; no PC traits.
 * AA2b (beads dcm-vv2 7 / 9, dcm-yle): `extra` carries what the use knows: the trigger's amount (My Turn's Fear,
 * Summoning Ritual's tick), the latest roll (To Me, My Pretties' summon count) and the target counts (Endless Legions).
 */
export function adversaryNumberEnv(s: Pick<AdversaryState, "hp" | "stress" | "tokens">, tier: 1 | 2 | 3 | 4, gmFear = 0, extra: Partial<Pick<NumberEnv, "triggerAmount" | "lastRoll" | "targetCount" | "creatures">> = {}): NumberEnv {
  return {
    // Plan lanes-2, lane E7 (dcm-8rh, dcm-ttz): the live map's creatures for `creatureCount`.
    ...(extra.creatures ? { creatures: extra.creatures } : {}),
    ...(extra.triggerAmount !== undefined ? { triggerAmount: extra.triggerAmount } : {}),
    ...(extra.lastRoll !== undefined ? { lastRoll: extra.lastRoll } : {}),
    traits: { agility: 0, strength: 0, finesse: 0, instinct: 0, presence: 0, knowledge: 0 },
    spellcast: 0,
    proficiency: 1,
    level: tier,
    tier,
    spent: {},
    choices: {},
    cardTokens: s.tokens,
    gmFear,
    self: { hp: s.hp, stress: s.stress },
    markedThisMove: { self: {}, byTarget: {} },
    targetCount: extra.targetCount ?? { picked: 0, hit: 0, failedSave: 0 },
    loadoutDomains: [],
    vaultDomains: [],
  };
}

/** A dice text's modifier: "+2", "-1" (bead dcm-vv2 4: Will-o'-the-Wisps' Horde (1d4-1) once read "1d4+-1"), "" for 0. */
const plusText = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `${n}` : "");

/** Every `passive` use whose requirements hold. */
export function activePassives(effects: readonly AdversaryFeatureEffect[], s: AdversaryState): { effect: AdversaryFeatureEffect; use: AdversaryFeatureUse }[] {
  const out: { effect: AdversaryFeatureEffect; use: AdversaryFeatureUse }[] = [];
  for (const effect of effects) {
    for (const use of effect.uses) {
      if (use.activation.kind === "passive" && unmetAdversaryRequirements(use.requires, s).length === 0) out.push({ effect, use });
    }
  }
  return out;
}

/**
 * Sums the passive modifiers in force (B3.2): attack bonus, Difficulty, resistance, Horde / Minion / Relentless,
 * direct attacks, standard-attack damage changes, flags and auras. Dice in a passive's number are rolled with `rng`
 * (none in the SRD; a fixed 1 is used without one).
 */
export function passiveSummary(effects: readonly AdversaryFeatureEffect[], s: AdversaryState, tier: 1 | 2 | 3 | 4 = 1, rng: Rng = () => 1, gmFear = 0): PassiveSummary {
  // AA2b (bead dcm-vv2 6): the GM's Fear now (The Beast Unleashed, Terror-Fueled read it).
  const env = adversaryNumberEnv(s, tier, gmFear);
  const n = (src: Parameters<typeof resolveNumber>[0]) => resolveNumber(src, env, rng);
  const out: PassiveSummary = {
    attackBonus: 0,
    difficulty: 0,
    horde: null,
    minion: null,
    relentless: null,
    spotlightCostsFear: false,
    directAttacks: false,
    attackDamageAdd: 0,
    flags: [],
    advantage: [],
    disadvantageAgainst: [],
    auras: [],
  };
  const selfMod = (m: Mod) => {
    if (m.kind === "stat" && m.stat === "attack") out.attackBonus += n(m.delta);
    else if (m.kind === "stat" && m.stat === "difficulty") out.difficulty += n(m.delta);
    else if (m.kind === "resistance") {
      const r = out.resistance ?? { physical: "none", magic: "none" };
      if (m.type !== "magic") r.physical = stronger(r.physical, m.level);
      if (m.type !== "physical") r.magic = stronger(r.magic, m.level);
      out.resistance = r;
    } else if (m.kind === "flag") out.flags.push(m.flag);
    else if (m.kind === "advantage") (out.advantage ??= []).push(m.on);
    else if (m.kind === "disadvantageAgainst") (out.disadvantageAgainst ??= []).push(m.on);
    else if (m.kind === "weakness") (out.weaknesses ??= []).push({ ...(m.type ? { type: m.type } : {}), ...(m.keyword ? { keyword: m.keyword } : {}) });
  };
  for (const { use } of activePassives(effects, s)) {
    for (const mod of use.modifiers ?? []) {
      switch (mod.kind) {
        case "mod":
          if ((mod.to ?? "self") === "self") selfMod(mod.mod);
          else out.auras.push(mod);
          break;
        case "horde": {
          const d = mod.damage;
          out.horde =
            d.kind === "flat"
              ? String(n(d.amount))
              : `${n(d.dice.count)}d${d.dice.sides}${plusText(d.dice.plus ? n(d.dice.plus) : 0)}`;
          break;
        }
        case "minion":
          out.minion = mod.threshold;
          break;
        case "relentless":
          // Lane E7 (dcm-gx1): "X is the Hydra's number of heads" (CB p.231), read when it is spotlighted; at least 1.
          out.relentless = mod.timesFrom ? Math.max(1, n(mod.timesFrom)) : mod.times;
          break;
        case "selfCondition":
          (out.selfConditions ??= []).push(mod.condition);
          break;
        case "spotlightCostsFear":
          out.spotlightCostsFear = true;
          break;
        case "directAttacks":
          out.directAttacks = true;
          break;
        case "attackDamage":
          if (mod.add) out.attackDamageAdd += n(mod.add);
          if (mod.type) out.attackDamageType = mod.type;
          break;
        case "conditionAura":
          out.auras.push(mod);
          break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- triggers

/** A first-time fact: whether this is the first time in the scene / ever. */
export interface FirstTime {
  scene: boolean;
  ever: boolean;
}

/** A PC's roll as a trigger sees it. */
export interface RollFacts {
  kind: "action" | "reaction";
  trait?: TraitId;
  attack?: boolean;
  weapon?: boolean;
  spellcast?: boolean;
  success: boolean;
  withHope: boolean;
  withFear: boolean;
  total?: number;
  /** Lane E7 (dcm-2gn): a critical success (CB p.90: it counts as a success with Hope). */
  critical?: boolean;
}

/** An adversary ally of this one dealt damage, marked HP or was defeated (`band` from this adversary). */
export interface AllyEvent {
  kind: "allyDealtDamage" | "allyMarksHp" | "allyDefeated";
  band?: Range;
  allyName?: string;
  /** Lane E7 (dcm-2gn): the ally's stat-block type ("Leader"; Cowardly, HF p.64). */
  allyType?: string;
}

/**
 * Something that happened at the table, from the feature owner's point of view ("self" = the adversary whose features
 * are checked). Bands are measured from it (or as each trigger says); an unknown band (no map, Q18) passes every range test.
 */
export type AdversaryEvent =
  | { kind: "onHit"; attack: "standard" | "feature"; band?: Range; target?: { conditions: readonly string[]; tags?: readonly string[] }; withAdvantage?: boolean }
  | { kind: "onMiss"; attack: "standard" | "feature" }
  | { kind: "onAttack"; stage: "before" | "beforeDamage" | "after"; attack: "standard" | "feature" }
  | { kind: "onDealDamage"; severity?: Severity; toPc: boolean }
  | { kind: "onTargetMarksHp"; attack: "standard" | "feature" }
  | { kind: "onDefeatPc" }
  /** Lane E7 (dcm-2gn, dcm-dv6): `weaponAttack` (Archer's Bane, HF p.62), `keywords` of the damage (fire: Made of Straw). */
  | {
      kind: "onDamaged";
      stage: "would" | "did";
      severity?: Severity;
      damageType?: DamageType | "both";
      fromAttack?: boolean;
      attackerBand?: Range;
      first?: FirstTime;
      weaponAttack?: boolean;
      keywords?: readonly DamageKeyword[];
    }
  /** `amount` 0 with `fromAttack`: a successful attack that marked no HP (Unreal Form, CB p.237; lane E7, dcm-2gn). */
  | { kind: "onMarkHp"; stage: "would" | "did"; amount: number; last: boolean; fromAttack?: boolean; attackerBand?: Range; damageType?: DamageType | "both" }
  | { kind: "onHpMarked"; before: number; after: number; hpMax: number }
  /** Lane E7 (dcm-2gn, dcm-63j): `stage` (default `did`); `would` before the Stress is marked (Mind Meld, HF p.74). */
  | { kind: "onMarkStress"; last: boolean; first?: FirstTime; stage?: "would" | "did" }
  | { kind: "onDefeated"; damageType?: DamageType | "both" }
  | AllyEvent
  | { kind: "onAttacked"; stage: "targeted" | "succeeded" | "failed"; attackerBand?: Range; weapon?: boolean }
  | { kind: "pcRolls"; roll: RollFacts; band?: Range; againstSelf?: boolean }
  | { kind: "pcMoves"; into?: Range; outOf?: Range }
  | { kind: "pcMarksHp"; band?: Range; severity?: Severity; fromSelf?: boolean }
  | { kind: "pcHope"; change: "gain" | "spend" | "none"; band?: Range }
  /** Lane E7 (dcm-2gn): `byFear`, the GM spent a Fear to spotlight it (Intimidating, HF p.89). */
  | { kind: "onSpotlight"; first?: FirstTime; tokens: number; byFear?: boolean }
  | { kind: "allySpotlit"; band?: Range }
  | { kind: "wouldGainCondition"; condition: ConditionRef }
  | { kind: "timing"; at: Extract<AdversaryTrigger, { kind: "timing" }>["at"] }
  | { kind: "situation"; text: string }
  // ---- lane E7 (dcm-2gn): the V trigger kinds
  /** A PC takes the spotlight (`band` from this adversary). */
  | { kind: "pcSpotlit"; band?: Range }
  /** An adversary ally makes an attack: `made` before its result is known, else `succeeded` / `failed`. */
  | { kind: "allyAttacks"; band?: Range; stage: "made" | "succeeded" | "failed" }
  /** A PC would deal (or dealt) damage to a creature `band` from this adversary. */
  | { kind: "pcDealsDamage"; band?: Range; stage: "would" | "did" }
  /** The PCs finished a rest. */
  | { kind: "pcsRest"; rest: "short" | "long" }
  /**
   * Plan lanes-2, lane E7 (dcm-xobk): a PC escaped what this adversary put on them (Encumber's bramble tokens, CB p.218:
   * "All bramble tokens can be removed by succeeding on a Finesse Roll (12 + the number of bramble tokens)"; Drain and
   * Multiply spawns a Minion per token removed). `tokens`: how many came off, `name` their name, `condition` the condition
   * escaped. No `AdversaryTrigger` matches it yet: the trigger kind is a vocabulary gap (filed for V3); until then
   * `matchesTrigger` answers false (kinds differ) and the GM fires the reaction by hand with `trigger.amount` = `tokens`.
   */
  | { kind: "pcEscapes"; tokens: number; name?: string; condition?: string; band?: Range };

const SEV: readonly Severity[] = ["minor", "major", "severe"];
const atLeast = (sev: Severity | undefined, min: Severity | undefined) => min === undefined || (sev !== undefined && SEV.indexOf(sev) >= SEV.indexOf(min));
const within = (band: Range | undefined, range: Range | undefined) => range === undefined || band === undefined || withinRange(band, range);
const beyond = (band: Range | undefined, range: Range | undefined) => range === undefined || band === undefined || !withinRange(band, range);
const attackOk = (filter: "standard" | "any" | undefined, attack: "standard" | "feature") => filter !== "standard" || attack === "standard";
const typeOk = (want: DamageType | undefined, got: DamageType | "both" | undefined) => want === undefined || got === undefined || got === want || got === "both";
const firstOk = (want: "scene" | "ever" | undefined, got: FirstTime | undefined) => want === undefined || (got !== undefined && got[want]);
const nameOk = (want: string | undefined, got: string | undefined) => want === undefined || got === undefined || got === want;
const sameCondition = (a: ConditionRef, b: ConditionRef) =>
  a.kind === "standard" ? b.kind === "standard" && b.condition === a.condition : b.kind === "tag" && b.tag === a.tag;

function rollFilterOk(filter: RollFilter | undefined, r: RollFacts): boolean {
  switch (filter) {
    case undefined:
    case "any":
      return true;
    case "action":
      return r.kind === "action";
    case "reaction":
      return r.kind === "reaction";
    case "attack":
      return r.attack === true;
    case "weaponAttack":
      return r.weapon === true;
    case "spellcast":
      return r.spellcast === true;
    case "damage":
      return false;
    default:
      return r.trait === filter;
  }
}

/**
 * Lane E7 (dcm-2gn): a PC roll's result against a trigger's `result`. A critical success is a success with Hope (CB
 * p.90); `critical` needs it marked on the roll.
 */
function rollResultOk(result: RollResult | "failureWithFear" | "failureWithHope", r: RollFacts): boolean {
  switch (result) {
    case "any":
      return true;
    case "success":
      return r.success;
    case "failure":
      return !r.success;
    case "withHope":
      return r.withHope;
    case "withFear":
      return r.withFear;
    case "critical":
      return r.critical === true;
    case "successWithHope":
      return r.success && r.withHope;
    case "successWithFear":
      return r.success && r.withFear;
    case "failureWithFear":
      return !r.success && r.withFear;
    case "failureWithHope":
      return !r.success && r.withHope;
  }
}

/** Whether an event sets off a trigger (AR8). Every narrowing of the trigger must hold; unknown facts pass (Q18). */
export function matchesTrigger(trigger: AdversaryTrigger, event: AdversaryEvent): boolean {
  if (trigger.kind === "onHpMarkedAtLeast") {
    if (event.kind !== "onHpMarked") return false;
    const v = trigger.value === "half" ? Math.ceil(event.hpMax / 2) : trigger.value;
    return event.before < v && event.after >= v;
  }
  if (trigger.kind !== event.kind) return false;
  switch (trigger.kind) {
    case "onHit": {
      const e = event as Extract<AdversaryEvent, { kind: "onHit" }>;
      return (
        attackOk(trigger.attack, e.attack) &&
        within(e.band, trigger.within) &&
        beyond(e.band, trigger.beyond) &&
        (trigger.targetHas === undefined || (e.target !== undefined && hasCondition(e.target, trigger.targetHas))) &&
        (trigger.withAdvantage !== true || e.withAdvantage === true)
      );
    }
    case "onMiss":
      return attackOk(trigger.attack, (event as Extract<AdversaryEvent, { kind: "onMiss" }>).attack);
    case "onAttack": {
      const e = event as Extract<AdversaryEvent, { kind: "onAttack" }>;
      return e.stage === trigger.stage && attackOk(trigger.attack, e.attack);
    }
    case "onDealDamage": {
      const e = event as Extract<AdversaryEvent, { kind: "onDealDamage" }>;
      return atLeast(e.severity, trigger.minSeverity) && (trigger.toPc !== true || e.toPc);
    }
    case "onTargetMarksHp":
      return attackOk(trigger.attack, (event as Extract<AdversaryEvent, { kind: "onTargetMarksHp" }>).attack);
    case "onDefeatPc":
      return true;
    case "onDamaged": {
      const e = event as Extract<AdversaryEvent, { kind: "onDamaged" }>;
      return (
        e.stage === (trigger.stage ?? "did") &&
        atLeast(e.severity, trigger.minSeverity) &&
        typeOk(trigger.damageType, e.damageType) &&
        (trigger.fromAttack !== true || e.fromAttack === true) &&
        within(e.attackerBand, trigger.attackerWithin) &&
        beyond(e.attackerBand, trigger.attackerBeyond) &&
        firstOk(trigger.first, e.first) &&
        // Lane E7 (dcm-2gn, dcm-dv6): only a weapon attack's damage; only damage carrying the keyword (as `fromAttack`,
        // the event must say so).
        (trigger.weaponAttack !== true || e.weaponAttack === true) &&
        (trigger.keyword === undefined || (e.keywords ?? []).includes(trigger.keyword))
      );
    }
    case "onMarkHp": {
      const e = event as Extract<AdversaryEvent, { kind: "onMarkHp" }>;
      return (
        e.stage === (trigger.stage ?? "did") &&
        // Lane E7 (dcm-2gn): Unreal Form (CB p.237: "marks 1 or fewer Hit Points from a successful attack") also fires on 0.
        (e.amount > 0 || (trigger.includeZero === true && e.fromAttack === true)) &&
        (trigger.atLeast === undefined || e.amount >= trigger.atLeast) &&
        (trigger.atMost === undefined || e.amount <= trigger.atMost) &&
        (trigger.last !== true || e.last) &&
        (trigger.fromAttack !== true || e.fromAttack === true) &&
        within(e.attackerBand, trigger.attackerWithin) &&
        typeOk(trigger.damageType, e.damageType)
      );
    }
    case "onMarkStress": {
      const e = event as Extract<AdversaryEvent, { kind: "onMarkStress" }>;
      return (e.stage ?? "did") === (trigger.stage ?? "did") && (trigger.last !== true || e.last) && firstOk(trigger.first, e.first);
    }
    case "onDefeated":
      return typeOk(trigger.damageType, (event as Extract<AdversaryEvent, { kind: "onDefeated" }>).damageType);
    case "allyDealtDamage":
    case "allyMarksHp":
    case "allyDefeated": {
      const e = event as AllyEvent;
      // Lane E7 (dcm-2gn): Cowardly (HF p.64: "an allied Leader is defeated") narrows by the stat block's type.
      const typeWanted = trigger.kind === "allyDefeated" ? trigger.allyType : undefined;
      return within(e.band, trigger.range) && nameOk(trigger.allyName, e.allyName) && (typeWanted === undefined || e.allyType?.toLowerCase() === typeWanted.toLowerCase());
    }
    case "onAttacked": {
      const e = event as Extract<AdversaryEvent, { kind: "onAttacked" }>;
      return (
        e.stage === trigger.stage &&
        within(e.attackerBand, trigger.attackerWithin) &&
        beyond(e.attackerBand, trigger.attackerBeyond) &&
        (trigger.weapon !== true || e.weapon === true)
      );
    }
    case "pcRolls": {
      const e = event as Extract<AdversaryEvent, { kind: "pcRolls" }>;
      const r = e.roll;
      return (
        rollFilterOk(trigger.roll, r) &&
        rollResultOk(trigger.result ?? "any", r) &&
        // Lane E7 (dcm-2gn): Vexing Word (HF p.80), Counterspell: "not a critical success".
        (trigger.notCritical !== true || r.critical !== true) &&
        within(e.band, trigger.within) &&
        (trigger.againstSelf !== true || e.againstSelf === true) &&
        (trigger.totalAtMost === undefined || (r.total !== undefined && r.total <= trigger.totalAtMost))
      );
    }
    case "pcMoves": {
      const e = event as Extract<AdversaryEvent, { kind: "pcMoves" }>;
      return (trigger.into === undefined || e.into === trigger.into) && (trigger.outOf === undefined || e.outOf === trigger.outOf);
    }
    case "pcMarksHp": {
      const e = event as Extract<AdversaryEvent, { kind: "pcMarksHp" }>;
      return within(e.band, trigger.within) && atLeast(e.severity, trigger.minSeverity) && (trigger.fromSelf !== true || e.fromSelf === true);
    }
    case "pcHope": {
      const e = event as Extract<AdversaryEvent, { kind: "pcHope" }>;
      return e.change === trigger.change && within(e.band, trigger.within);
    }
    case "pcEscapes":
      return false; // matched in wave 10 (dcm-0hlq, dcm-thwj)
    case "onSpotlight": {
      const e = event as Extract<AdversaryEvent, { kind: "onSpotlight" }>;
      // Lane E7 (dcm-2gn): Intimidating (HF p.89) only when the GM spent a Fear to spotlight it.
      return firstOk(trigger.first, e.first) && (trigger.noTokens !== true || e.tokens === 0) && (trigger.byFear !== true || e.byFear === true);
    }
    case "allySpotlit":
      return within((event as Extract<AdversaryEvent, { kind: "allySpotlit" }>).band, trigger.range);
    case "wouldGainCondition": {
      const e = event as Extract<AdversaryEvent, { kind: "wouldGainCondition" }>;
      return trigger.condition === undefined || sameCondition(trigger.condition, e.condition);
    }
    case "timing":
      return (event as Extract<AdversaryEvent, { kind: "timing" }>).at === trigger.at;
    case "situation":
      return (event as Extract<AdversaryEvent, { kind: "situation" }>).text === trigger.text;
    // ---- lane E7 (dcm-2gn): the V trigger kinds
    case "pcSpotlit":
      // Fear Aura (HF p.66): "When a PC takes the spotlight within Very Close range".
      return within((event as Extract<AdversaryEvent, { kind: "pcSpotlit" }>).band, trigger.within);
    case "allyAttacks": {
      // Pack Alpha (HF p.76): any attack an ally makes; Air Support (HF p.83): "an ally fails an attack".
      const e = event as Extract<AdversaryEvent, { kind: "allyAttacks" }>;
      return within(e.band, trigger.range) && ((trigger.stage ?? "made") === "made" || e.stage === trigger.stage);
    }
    case "pcDealsDamage": {
      // Drake Guard Dog (HF p.82): "When a PC would deal damage to a creature within Close range".
      const e = event as Extract<AdversaryEvent, { kind: "pcDealsDamage" }>;
      return within(e.band, trigger.within) && e.stage === (trigger.stage ?? "did");
    }
    case "pcsRest":
      // Midnight Heart (HF p.88): "When the PCs finish a long rest".
      return trigger.rest === undefined || (event as Extract<AdversaryEvent, { kind: "pcsRest" }>).rest === trigger.rest;
  }
}

/** A reaction to offer (a one-tap prompt, default No, Q19) or an automatic effect to run, for one event. */
export interface TriggeredUse {
  effect: AdversaryFeatureEffect;
  use: AdversaryFeatureUse;
  /** `reaction`: ask the GM; `auto`: run without asking. */
  mode: "reaction" | "auto";
}

/** The reaction and automatic uses an event sets off, whose requirements hold, in table order (AR8). */
export function triggeredUses(effects: readonly AdversaryFeatureEffect[], event: AdversaryEvent, s: AdversaryState): TriggeredUse[] {
  const out: TriggeredUse[] = [];
  for (const effect of effects) {
    for (const use of effect.uses) {
      const a = use.activation;
      if ((a.kind === "reaction" || a.kind === "auto") && matchesTrigger(a.trigger, event) && unmetAdversaryRequirements(use.requires, s).length === 0) {
        out.push({ effect, use, mode: a.kind });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- spotlight

export interface SpotlightInput {
  /** Spotlights of any adversary so far this GM turn (`turnSpotlights`). */
  spotlightsThisTurn: number;
  /** This instance's spotlights so far this GM turn (`spotlightsThisTurn`). */
  instanceSpotlights: number;
  /** Relentless (X), "X" when variable, null without it. */
  relentless: number | "X" | null;
  /** "You must spend a Fear to spotlight the X". */
  costsFear?: boolean;
}

/**
 * What spotlighting this adversary now costs (AR6): 1 Fear for an additional GM move after the turn's first spotlight
 * (CB p.153, the tracker's `spotlightCostsFear`), or always with a "must spend a Fear to spotlight" passive; never more
 * than 1 (see the task doc's QUESTIONS). `overLimit`: past its spotlights per GM turn (1, or Relentless X); a warning,
 * like the tracker.
 */
export function spotlightCost(input: SpotlightInput): { fear: number; overLimit: boolean } {
  const limit = input.relentless === "X" ? Infinity : (input.relentless ?? 1);
  const fear = spotlightCostsFear(input.spotlightsThisTurn) || input.costsFear === true ? 1 : 0;
  return { fear, overLimit: input.instanceSpotlights + 1 > limit };
}

// ---------------------------------------------------------------- countdowns (lane E7, dcm-bxp.78)
//
// User answers 2026-10-30 (dcm-bxp.78): core rule (CB p.162). A Start button on the tracker's countdown prompt and on the
// instance stat block; armed only when the countdown ticks on action rolls (CB p.162: a standard countdown "ticks down
// every time a player makes an action roll"); one whose text ticks on another event (spotlight, marks HP, takes damage)
// starts unarmed. Private, like the environments' countdowns. Per-PC ones are named "<Adversary>: <Feature> - <PC>".

const COUNTDOWN_IN_TEXT = /(?:(?:[A-Z][\w-]*)\s+){0,2}Countdown \((?:(?:Loop|Increasing|Decreasing|Long-Term)\s+)?(?:\d+d\d+(?:\s*\+\s*\d+)?|\d+)\)/g;

/** The countdowns a feature names: its printed label first, then each one its text names ("Doom Countdown (4)"). */
export function adversaryCountdownLabels(feature: { countdown?: string; text: string }): string[] {
  const labels: string[] = [];
  if (feature.countdown !== undefined) labels.push(feature.countdown);
  for (const match of feature.text.matchAll(COUNTDOWN_IN_TEXT)) {
    const label = match[0].trim();
    if (!labels.some((l) => l.toLowerCase() === label.toLowerCase())) labels.push(label);
  }
  return labels;
}

/**
 * Whether a feature's countdown ticks on action rolls (it starts armed). The entry's `tickOn` decides when it has one;
 * else the text: "It ticks down when the Dullahan is spotlighted", "ticks down when a PC rolls with Fear" tick on
 * something else; a countdown whose text names no advancement is a standard one (CB p.162).
 */
export function adversaryCountdownArmed(text: string, tickOn?: "actionRoll" | "spotlight" | "marksHp" | "takesDamage" | "other"): boolean {
  if (tickOn !== undefined) return tickOn === "actionRoll";
  const advance = /(?:ticks? down|advances?)\s+(?:when|whenever|each time|every time)\b[^.]*/i.exec(text);
  return advance === null || /\baction rolls?\b/i.test(advance[0]);
}

/** "Bear 2: Doom Countdown", or for a per-PC countdown "Bear 2: Doom Countdown - Mira" (user answer, dcm-bxp.78). */
export function adversaryCountdownName(instanceLabel: string, featureName: string, pcName?: string): string {
  return `${instanceLabel}: ${featureName}${pcName ? ` - ${pcName}` : ""}`;
}

/** A label's flat bonus on rolled dice ("Countdown (1d6+1)", the Empress's Doom Countdown) and the label without it. */
export function countdownLabelBonus(label: string): { label: string; plus: number } {
  const m = /(\d+d\d+)\s*\+\s*(\d+)\)/i.exec(label);
  return m ? { label: label.replace(m[0], `${m[1]})`), plus: Number(m[2]) } : { label, plus: 0 };
}
