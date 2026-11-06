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
//   Plan rule-switches RA2: `context.hopeFear` is the campaign's R3 switch; Manual gains no Hope or Fear from a roll with
//   Hope or Fear (a critical keeps its Hope and Stress clear), so a later Hope cost needs Hope the PC already holds.
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
// Plan sheet-drawer, SD1: the runner executes SD0's vocabulary NV1-NV19 for cards and features alike (the feature runner
// in src/lib/domain/feature-effects/run.ts wraps `run`):
// - NV1: `tokens` costs spend Favor, Focus or held dice (`pool`); a held die's value is its stored value or a roll; the
//   `resource` step changes Favor or Focus ("You can hold a maximum of 6 Focus", HF p.12).
// - NV2: a `delegate` step asks `context.delegate` (the D5 feature, feature-effects/delegate.ts) and takes back the
//   resources it changed; without a handler the plan carries the step for the server.
// - NV3 upgrades are applied by the feature runner before the use runs. NV5 `endsOn`, NV7 `effect.option`, NV9 `versus`
//   and NV14 / NV19 mods travel on the plan's condition and effect steps. NV15: a trait mod with `choice` takes the
//   player's pick; `holdLimit` is resolved for the server.
// - NV4 `adjustHpMarked`, NV18 `addTargets` and roll changes on another roll (NV8) are `fold` steps with their numbers.
// - NV8 damage changes on this move's damage: reroll chosen or low dice, double matching or chosen dice, a secondary
//   weapon die, an extra die dropping the lowest, ones as the maximum or plus a die, a die size step, added damage of
//   another type. "When a feature allows you to reroll a die, you always take the new result" (CB p.107).
// - Q6 / CB p.107 rounding up: "halve incoming damage" against a known incoming amount folds the halved amount, rounded up.
// - NV11 `area`, NV19 `help` and NV13 (`actor: "companion"`, the companion recipient) are plan steps / fields.
// - NV17 `replaceHopeGain` takes back the Hope this move's roll gave and gives a Favor or removes a Fear instead.
// - `context.limitKeys` names the `featureUses` key and `until` of a limit (cards: `card:` keys, scene stored as session).
//
// Plan drawer-answers, DA0 (the user's answers of 2026-10-29 / 2026-10-30): a `defaultOn` optional runs unless named in
// `context.optionalsOff`; a `rolledFirst` target count is the server's `context.rolledTargetCount` (`rollTargetCount`
// rolls it); a trait roll marked `attack` is an attack for `rollMatches`; an `intoMelee` move is a server move prompt; a
// `rolledBy` use pays and sends an `allyRoll` prompt, and the roller's run (`context.roller`) rolls and runs the steps.
// `negate` stress / `ignoreOnHitHp`, `insteadOfArmorSlot` and `stanceDrops` travel on fold and condition steps as is.
//
// ```ts
// const result = run(boltBeacon, { actor, gmFear: 3, targets: [bandit], rng });
// if (!result.ok) throw refusal(result.reason);      // CARD_EXHAUSTED, CARD_COST_UNPAID, …
// for (const step of result.plan.steps) …             // pay, roll, hits, damageRoll, damage, condition, …
// ```

import { MAX_FEAR } from "../fear/index";
import { dualityEffects, rollDamage, rollDuality, weaponDice, type DicePool, type DualityEffects, type HopeFearMode, type Rng } from "../dice/index";
import type { RollOutcome, RollRecord } from "../duality";
import { parseDamage } from "../adversaries/index";
import { applyDamageTo, applyHpTo, applyStressTo, clearTrack, type Combatant, type DamageResult } from "../combat-actions/damage";
import { resolveHits, type HitResult } from "../combat-actions/hits";
import { resolveDice, resolveNumber, rollDice, type MapCreature, type MarkedTracks, type NumberEnv } from "../combat-actions/numbers";
import {
  clearBlocked,
  featureUseKey,
  stateCheckMet,
  keyAvailability,
  limitConsumed,
  limitUntil,
  resolveCosts,
  shortfalls,
  unaffordable,
  unaffordableBy,
  unmetRequirements,
  type PaidCost,
  type PayerState,
  type RequirementState,
  type StateFacts,
} from "./availability";
import type {
  AreaSpec,
  CardEffect,
  CardUse,
  ConditionRef,
  CheckTest,
  Cost,
  DamageChange,
  DamageRoll,
  DamageType,
  DiceExpr,
  DieSides,
  Duration,
  EndEvent,
  Escape,
  Gate,
  HeldDieKind,
  Limit,
  Mod,
  ModStat,
  NumberSource,
  OutcomeStep,
  Payer,
  Range,
  Recipient,
  Resource,
  RollEnd,
  RollFilter,
  RollSpec,
  SaveDifficulty,
  Severity,
  StateCheck,
  Step,
  TargetSpec,
  Track,
  Versus,
} from "./types";
import type { Shortfall } from "../../errors/app-error";
import type { FeatureUse } from "../../validation/characters";
import { TRAIT_IDS, type DomainId, type TraitId } from "../../srd/types";

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
  // ---- SD1 (sheet-drawer), all optional: absent reads as none / unknown.
  /** Warlock Favor (`classState.favor`, HF p.14). */
  readonly favor?: number;
  /** Martial Focus (`classState.martial.focus`, HF p.12). */
  readonly focus?: number;
  /** Held dice (Rally, Prayer, Patron, Combo; Slayer Dice as unrolled d6s), spent by `tokens` costs with a held-die `pool`. */
  readonly heldDice?: readonly HeldDieState[];
  /**
   * The size of the actor's class dice, for `DiceExpr.sidesOf`. Lanes-2 E3 (dcm-b9hc): `companion` is the Beastbound
   * companion's damage die (d6 at level 1, stepped by Vicious; CB p.40).
   */
  readonly dieSides?: Partial<Record<HeldDieKind | "unstoppable" | "companion", number>>;
  /** What `situation.check` reads (NV7). */
  readonly facts?: StateFacts;
  // ---- Plan lanes-2, tracer E3 (round 2; docs/tasks/TASK-LN2-E3.md). Optional: absent reads as 0 / unknown.
  /** dcm-rs1z, dcm-e80y: the Know the Tide tokens held (CB p.77; `tideTokens` numbers). */
  readonly tideTokens?: number;
  /** dcm-rs1z, dcm-e80y: the current value of each class die (the Unstoppable Die, CB p.36; a held Rally Die; `classDie`). */
  readonly classDice?: Partial<Record<HeldDieKind | "unstoppable", number>>;
  /** dcm-rs1z: the actor's derived stats (`stat` numbers: Armor Score, thresholds, Evasion). */
  readonly stats?: MarkedTracks["stats"];
  /** dcm-b9hc (CB p.40: "Choose whether they deal physical or magic damage"): the companion's damage type; default physical. */
  readonly companionDamageType?: DamageType;
  /**
   * Plan lanes-2 E8.4 (dcm-7l0g): limited rerolls of held dice the actor holds, applied when any use spends dice of that
   * kind (Weapon Specialist, CB p.48: the Slayer Dice's 1s once per long rest). Spent: `key` is in `featureUses`.
   */
  readonly heldRerolls?: readonly HeldRerollGrant[];
}

/** A once-per reroll of held dice (`ActorState.heldRerolls`): the dice of kind `die` showing `atMost` or less. */
export interface HeldRerollGrant {
  readonly die: HeldDieKind;
  readonly atMost: number;
  /** The `featureUses` key the reroll spends, and until when. */
  readonly key: string;
  readonly until: FeatureUse["until"];
}

/** A held die as the runner spends it: `value` when it was rolled on receipt (Prayer Dice), else it is rolled when spent. */
export interface HeldDieState {
  readonly id: string;
  readonly kind: HeldDieKind;
  readonly sides: number;
  readonly value?: number;
}

/** The actor's resources a D5 feature reads and changes (NV2). */
export interface DelegateSnapshot {
  hope: number;
  stress: number;
  hp: number;
  armor: number;
  favor?: number;
  focus?: number;
  heldDice: readonly HeldDieState[];
  featureUses: readonly FeatureUse[];
}

/** What a `delegate` step asks: the D5 `FeatureMeta.key`, its `FeatureParams`, and the actor's resources now. */
export interface DelegateRequest {
  feature: string;
  params: { choice?: string; amount?: number; targetId?: string; dieIndexes?: number[] };
  actor: DelegateSnapshot;
  /** Plan lanes, E3 (dcm-d1d): the use's own roll (or the follow-up's) the step runs after, e.g. Ranger's Focus's attack. */
  roll?: RollRecord;
  /** E3 (dcm-d1d): whether that roll hit the step's target (absent: no per-target roll). */
  hit?: boolean;
}

/** The D5 feature's answer: the actor's resources after it, its feed line and any Fear it gave the GM; or a refusal. */
export type DelegateAnswer = { ok: true; actor: DelegateSnapshot; summary: string; fearDelta?: number } | { ok: false; detail: string };

export type DelegateHandler = (request: DelegateRequest) => DelegateAnswer;

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
  /**
   * What set off a reaction / rider / auto. Plan lanes, V (widened): `damageType`: the type of the damage the trigger
   * carries (Encore, CB p.335; dcm-86z; E1 fills it, E3 reads it).
   */
  trigger?: { amount?: number; source?: Combatant; subject?: Combatant; damageType?: DamageType | "both" };
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
  /**
   * Plan rule-switches RA2 (bead dcm-jh6d.67): the campaign's R3 `hopeFearFromRolls` mode (cardRunner `buildRun`). Absent:
   * Book. Manual: the use's action rolls gain no Hope and give no Fear (`dualityEffects`); a critical still does.
   */
  hopeFear?: HopeFearMode;
  /** An adversary's standard attack damage (AA1 reuse: `damage.roll.kind === "standardAttack"`), e.g. "1d8+2 phy". */
  attackDamage?: string;
  rng: Rng;
  // ---- SD1 (sheet-drawer)
  /**
   * The `featureUses` key and `until` of a limit (`useId` the use, or `<useId>:<optionalId>` for an optional step's
   * limit). Default: the card keys (`featureUseKey`) and `limitUntil` (scene stored as session).
   */
  limitKeys?: { key: (useId: string, targetId?: string) => string; until: (limit: Limit | Limit["per"]) => FeatureUse["until"] };
  /** Runs a `delegate` step's D5 feature (NV2). Without it the plan carries the step undone, for the server. */
  delegate?: DelegateHandler;
  /** The actor's companion (Q4): the creature of a `companion` pick. */
  companion?: Combatant;
  /** Damage dice the player picked, by index among this move's damage dice: to reroll (`rerollChosen`), to double (`doubleDice` chosen). */
  damageDice?: { reroll?: readonly number[]; double?: readonly number[] };
  /** Held dice picked for a delegated D5 feature (`FeatureParams.dieIndexes`, Prayer Dice). */
  dieIndexes?: readonly number[];
  // ---- DA0 (drawer-answers)
  /** `defaultOn` optional steps the player turned off (by id); a `defaultOn` optional runs unless named here. */
  optionalsOff?: readonly string[];
  /**
   * The count of an `upTo` target count the server rolled before the pick (`rolledFirst`, Warden's Protection; dcm-d95).
   * Given, it is the use's maximum and the runner rolls nothing for it; a `rolledFirst` count without it refuses the use.
   */
  rolledTargetCount?: number;
  /**
   * A `rolledBy` use's roller (Cannonball's ally): absent, the actor's run pays and sends the `allyRoll` prompt; given,
   * this run is the roller's roll (no costs or limit again), with the roller's traits, and its Hope / Fear go to them.
   */
  roller?: RollerState;
  // ---- Plan lanes, tracer E3 (steps, choices and saves; docs/tasks/TASK-LN-E3.md). All optional: absent reads as today.
  /** dcm-bz8: the option each chooser of a `choose` step with `by` picked, by step id, then by creature id. */
  chooserOptions?: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>;
  /** dcm-bz8 / dcm-6ju: whether each chooser of an `optional` step with `by` takes it, by step id, then by creature id. */
  chooserOptionals?: Readonly<Record<string, Readonly<Record<string, boolean>>>>;
  /** dcm-5xi: the Hope other PCs hold now (by id), for `hope.ifUnable` and `track` `hope` checks; unknown: not decided. */
  hopeOf?: Readonly<Record<string, number>>;
  /** dcm-xp0: named tokens on creatures now (bramble tokens), by creature id, then by name. */
  creatureTokens?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** dcm-0gh: handfuls of gold a creature carries (by id), for a `gold` number (CB p.104: "10 handfuls to 1 bag"). */
  goldOf?: Readonly<Record<string, number>>;
  /** dcm-qbn: the held dice (by id) the player picked to spend; a `tokens` cost with a held-die pool spends these first. */
  heldDicePicks?: readonly string[];
  /** dcm-d1b: the Hope and Fear Die of the host roll a rider rides on (a `dualityDie` number reads it without a roll of its own). */
  hostRoll?: { hope: number; fear: number };
  /**
   * dcm-rou / dcm-7az: the creatures of each further link of a repeating `followUp` (link 0 is `followUp`). Creatures
   * named in an earlier link or as a target are dropped ("not already targeted", CB p.328).
   */
  chain?: readonly (readonly Combatant[])[];
  /** dcm-q0a: the allies who pay to raise a `raised` save's Difficulty (Enchanting Song's other Sirens). */
  saveRaisers?: readonly Combatant[];
  /** dcm-b77: how many times a `falling` save was made before (its Difficulty falls by `step` each time). */
  saveAttempt?: number;
  /** dcm-kkx: the labels of the lasting effects each creature carries now (by id), for `effect.stacking`. */
  effectsOn?: Readonly<Record<string, readonly string[]>>;
  // ---- Plan lanes-2, tracer E3 (round 2; docs/tasks/TASK-LN2-E3.md). All optional: absent reads as before.
  /**
   * dcm-4zti: the numbers the server knows beyond the actor's tracks (cardRunner `BuiltRun.numbers`): the actor's and each
   * creature's slot maximums, stats, gold and tokens (`self` / `byId`), and the creatures on the map (`creatureCount`).
   */
  numbers?: { self?: Partial<MarkedTracks>; byId?: Readonly<Record<string, Partial<MarkedTracks>>>; creatures?: readonly MapCreature[] };
  /** dcm-4zti, dcm-a9c: what each payer of a `paidBy` cost holds (Rune Ward's holder, CB p.328; Tactician's ally). */
  payers?: Partial<Record<Payer, PayerState>>;
  /**
   * dcm-fbsr, dcm-5kxg: the lasting mods each creature carries now (by id; the actor too): `marksMultiplier` doubles its
   * costs and marks (Unstuck, CB p.237), flags `cannotClearHp` / `cannotClearStress` stop its clears (Afflicted, HF p.95),
   * `cannotSpendHope` its Hope spends (Ravenous, HF p.94).
   */
  modsOn?: Readonly<Record<string, readonly Mod[]>>;
  /**
   * dcm-va0f (Unleash Hellfire, HF p.88: "If a target takes damage from multiple bursts, combine the damage"): for a use
   * with `TargetSpec.points`, the indexes of the points whose area holds each creature (by id). A `perArea` damage step
   * rolls once per point and each creature takes the sum of its points'.
   */
  pointsOf?: Readonly<Record<string, readonly number[]>>;
  // ---- Plan lanes-2, tracer E3.3 (round 3; docs/tasks/TASK-LN3-E3.md). All optional: absent reads as before.
  /**
   * dcm-ldom (Hive Mind, HF p.65; Pack Fury, HF p.70-77): the creatures on the live map seen from the actor, for a
   * `creatureCount` number in a step this runner resolves (the adversary runner forwards its own `creatures`). Wins over
   * `numbers.creatures` when both are given.
   */
  creatures?: readonly MapCreature[];
  /**
   * dcm-q13x (user answer 2026-10-31, Chain Lightning, CB p.328): each link of a repeating `followUp` rolls its damage
   * again ("every new wave of chained targets gets a fresh 2d8+4 roll"); off, the links share the move's damage (R9).
   * Default off until the card tests that pin the shared roll move with it (see the task doc); the server sets it.
   */
  freshLinkDamage?: boolean;
}

/** DA0: the creature that makes a `rolledBy` use's roll. */
export interface RollerState {
  readonly id: string;
  readonly traits: Readonly<Record<TraitId, number>>;
  readonly proficiency: number;
}

// ---------------------------------------------------------------- outputs

/** A modifier with its numbers resolved. */
export type ResolvedMod =
  | { kind: "stat"; stat: ModStat; delta: number; versus?: Versus }
  | { kind: "trait"; trait: TraitId | "all"; delta: number }
  | { kind: "set"; stat: ModStat | TraitId; to: number }
  | Extract<Mod, { kind: "advantage" | "disadvantageAgainst" | "resistance" | "flag" }>
  // Plan lanes, tracer V: widened mods travel as written (no numbers resolved yet; the lanes that read them resolve them).
  | Extract<
      Mod,
      {
        kind:
          | "attackedRider"
          | "bearerRider"
          | "disadvantage"
          | "mustAttack"
          | "weaponTrait"
          | "extraTargets"
          | "forcedMoveReduce"
          | "moveLimit"
          | "replaceCondition"
          | "dualityDie"
          | "gmControl"
          | "standardAttack"
          | "features"
          | "weakness"
          // Plan lanes-2, tracer V2 (TASK-LN-V2.md): travel as written too.
          | "cannotAttackTarget"
          | "moveRange"
          | "damageTaken"
          | "marksMultiplier";
      }
    >;

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
  /** E3: `payerId` names a payer other than the actor (a chooser of a `by` optional, dcm-6ju; a save raiser, dcm-q0a). */
  | { kind: "pay"; phase: "upfront" | "afterRoll" | "optional"; costs: PaidCost[]; paid: boolean; payerId?: string }
  | { kind: "roll"; roll: RollInfo }
  | { kind: "hits"; results: HitResult[] }
  | { kind: "damageRoll"; record: RollRecord; type: DamageType | "both" }
  /** A move's total damage applied once to an adversary (R2, R3, R10). */
  | { kind: "damage"; result: DamageResult }
  /** Damage to a PC: Armor Slots and the PC's thresholds are AA1's (the reaction window); nothing is applied here. */
  | { kind: "pcDamage"; targetId: string; amount: number; type: DamageType | "both"; direct: boolean }
  /** `reduceWithHope`: HP from a `markHp` with `reduceWith: "hope"`; the PC may spend Hope to mark fewer (dcm-nnbl). */
  | { kind: "mark"; targetId: string; track: Track; amount: number; hpMarked: number; overflow: boolean; noBenefit?: boolean; reduceWithHope?: boolean }
  | { kind: "clear"; targetId: string; track: Track; amount: number }
  | { kind: "hope"; targetId: string; delta: number }
  | { kind: "fear"; delta: number }
  /**
   * Lanes-2 E3 (dcm-iedr's runner half, dcm-b77, dcm-8bv): the step's `mods` (numbers resolved; a `recorded` number reads
   * `recorded`), `endsOnCaster`, `endsOnRoll`, `escape`, the `record` number resolved when given, and the Fear a
   * `gmSpendsFear` end costs.
   */
  | {
      kind: "condition";
      targetId: string;
      condition: ConditionRef;
      duration: Duration;
      endsWhen?: string;
      endsOn?: readonly EndEvent[];
      mods?: ResolvedMod[];
      endsOnCaster?: readonly EndEvent[];
      endsOnRoll?: RollEnd;
      escape?: Escape;
      recorded?: number;
      endFear?: number;
    }
  | { kind: "clearCondition"; targetId: string; condition: ConditionRef }
  | {
      kind: "effect";
      targetId: string;
      label: string;
      mods: ResolvedMod[];
      duration: Duration;
      endsWhen?: string;
      /** SD1: the events that also end it (NV5) and the option it stands for (NV7, "Channeling Fire"). */
      endsOn?: readonly EndEvent[];
      option?: string;
      /** E3 (dcm-kkx): `replace`: the server ends an older copy with this label first (`refuse` copies are dropped by the runner when it knows). */
      stacking?: "stack" | "replace" | "refuse";
      /** Lanes-2 E3 (dcm-rao5, dcm-8bv): one grant shared by the use's recipients; the Fear a `gmSpendsFear` end costs. */
      sharedGrant?: boolean;
      endFear?: number;
    }
  /**
   * SD1 (NV2): a D5 feature run inside this use. `done`: the handler ran it (`summary` is its feed line); otherwise the
   * server runs it with `params`.
   */
  | { kind: "delegate"; feature: string; params: DelegateRequest["params"]; targetIds: string[]; done: boolean; summary?: string }
  /** SD1 (NV1): Favor or Focus changed. */
  | { kind: "resource"; targetId: string; resource: "favor" | "focus"; before: number; after: number }
  /** SD1 (NV11, Q14): a live map area; `centreId` is the creature it is centred on (null: a picked square). */
  | { kind: "area"; area: Omit<AreaSpec, "mods"> & { mods: ResolvedMod[] }; centreId: string | null; targetIds: string[] }
  /** SD1 (NV19, Q12): a named Help an Ally: the ally's next action roll gets a d`die` advantage die; `free`: no Hope. */
  | { kind: "help"; targetId: string; die: DieSides; free: boolean }
  | { kind: "tokens"; op: "set" | "add" | "spend" | "clear"; before: number; after: number; die?: number }
  /** E3 (dcm-xp0): named tokens (`name`, bramble tokens) on a creature instead of this card; the server stores them. */
  | { kind: "creatureTokens"; targetId: string; name: string; op: "set" | "add" | "spend" | "clear"; before: number; after: number }
  | { kind: "toVault"; permanent: boolean }
  /**
   * E3: `autoFail`: the recipient failed without rolling (dcm-fev; `record` has no dice); `raisedBy`: the allies who paid
   * to raise the Difficulty (dcm-q0a); `advantage` / `disadvantage` on the roll (dcm-rb0).
   */
  | {
      kind: "save";
      targetId: string;
      record: RollRecord;
      difficulty: number;
      success: boolean;
      autoFail?: boolean;
      raisedBy?: string[];
      advantage?: number;
      disadvantage?: number;
    }
  /** E3 (dcm-27j): `row` / `label`: the row of the check's table the total landed in. */
  | { kind: "check"; total: number; dice: number[]; passed: boolean; row?: number; label?: string }
  /**
   * E3 (dcm-8x8, dcm-5fc): end a lasting effect, condition or area on `targetId` that `of` (a card or feature id) made;
   * `own`: this use's own card or feature ("this spell ends"). The server ends it (lane E6).
   */
  | { kind: "endEffect"; targetId: string; of: string; own: boolean; option?: string }
  /** E3 (dcm-0gh): a change to `targetId`'s inventory (steal an item, take gold, damage a weapon); the server writes it. */
  /** Lanes-2 E3 (dcm-vf7i): `giveGold` (`amount` handfuls) and `giveItem` (`text` names it; unset: the GM's pick) to the recipient. */
  | {
      kind: "inventory";
      targetId: string;
      op: "take" | "takeGold" | "damageWeapon" | "giveGold" | "giveItem";
      item?: "any" | "consumable" | "mostValuable" | "metalWeapon";
      amount?: number;
      text?: string;
    }
  /** Lanes-2 E3 (dcm-awh, dcm-4xl): the recipient shifts into martial stance `stance` (Stance Fighter, HF p.12); the server sets it. */
  | { kind: "setStance"; targetId: string; stance: string }
  /**
   * Lanes-2 E3 (dcm-war): the use `useId` is spent until `until` (Rune Ward's 8, CB p.328). The runner already wrote the
   * entries into `plan.actor.featureUses` (as `exhaustKey`); this step is for the feed.
   */
  | { kind: "exhaust"; key: string; until: FeatureUse["until"] }
  /**
   * Lanes-2 E3 (dcm-c8h3, dcm-zi3k): the attackers make an attack against a creature `against` picks (Words of Discord,
   * CB p.335; Beguiled, HF p.75). `againstIds`: the creatures the use named for it (`picked`, never an attacker); empty:
   * the GM picks. An adversary attacker makes its standard attack; a PC is prompted (the server's).
   */
  | { kind: "forcedAttack"; attackerIds: string[]; against: TargetSpec; againstIds: string[] }
  /** Lanes-2 E3 (dcm-3ag5, Transform, HF p.142): the adversary instance takes stat block `adversaryId`, keeping its marks. */
  | { kind: "changeForm"; targetId: string; adversaryId: string }
  /**
   * Lanes-2 E3 (dcm-inou, dcm-sa2; Weapon Specialist, CB p.48: "reroll any 1s"): the held dice of `die` this use spent that
   * showed `atMost` or less, rolled again once each (`before` / `after` in spend order); `spent: heldDie` follows them.
   */
  | { kind: "heldReroll"; die: HeldDieKind; before: number[]; after: number[] }
  | { kind: "defeat"; targetId: string; amount?: number }
  /** Minion (X): extra Minions the attacker may defeat (CB p.201, Q6). */
  | { kind: "minionOffer"; targetId: string; extra: number }
  /**
   * A step for the table: a movement prompt (Q9), the card's words (manual), or a choice still missing.
   * DA0 (widened): a `move` with `server: true` is one the server makes itself (`intoMelee`: into Melee range of
   * `anchorId`); `allyRoll` asks the ally in `targetIds` to make a `rolledBy` use's roll, `amount` the Proficiency its
   * damage uses when it is the actor's.
   */
  | {
      kind: "prompt";
      prompt: "move" | "manual" | "choose" | "split" | "pcSave" | "allyRoll" | "followUp";
      text: string;
      targetIds: string[];
      step?: Step;
      amount?: number;
      server?: boolean;
      anchorId?: string;
      /**
       * E3: a `pcSave`'s advantage / disadvantage dice (dcm-rb0) and its Difficulty when the runner knows it (dcm-q0a);
       * `chooserId`: the creature a per-recipient `choose` asks (dcm-bz8). A `followUp` prompt asks for the next link of
       * a repeating follow-up (dcm-rou, dcm-7az; `amount` is the link's index, `targetIds` the last link's creatures).
       */
      advantage?: number;
      disadvantage?: number;
      difficulty?: number;
      chooserId?: string;
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
  /** SD1 (NV15): "up to N creatures at once": past N the server ends the oldest. */
  holdLimit?: number;
  /** SD1 (NV13, Q4): the companion makes this use (from its own token). */
  actorKind?: "companion";
}

export interface ActorResources {
  hope: number;
  stress: number;
  hp: number;
  armor: number;
  cardTokens: number;
  /** SD1 (NV1): present when the actor has them. */
  favor?: number;
  focus?: number;
  heldDice?: HeldDieState[];
}

export type RunRefusal = {
  ok: false;
  /** noUse: no such use; requirement: unmet (`unmet`); exhausted: CARD_EXHAUSTED; cost: CARD_COST_UNPAID (`short`); choice / targets: bad input. */
  reason: "noUse" | "requirement" | "exhausted" | "cost" | "choice" | "targets";
  detail: string;
  /** dcm-bxp.99.32.2: on a `cost` refusal, the first short resource with what the use needs and what the payer has. */
  shortfall?: Shortfall;
};

export type RunResult = { ok: true; plan: RunPlan } | RunRefusal;

// ---------------------------------------------------------------- helpers

/** The use a context picks: by id, else the first `action` use, else the first. */
export function pickUse(effect: CardEffect, useId?: string): CardUse | undefined {
  if (useId !== undefined) return effect.uses.find((u) => u.id === useId);
  return effect.uses.find((u) => u.activation.kind === "action") ?? effect.uses[0];
}

const refuse = (reason: RunRefusal["reason"], detail: string, shortfall?: Shortfall): RunRefusal => ({ ok: false, reason, detail, ...(shortfall ? { shortfall } : {}) });

/** dcm-bxp.99.32.2: a Hope cost refused by a flag (Ravenous): the use's Hope, of which the payer may spend none. */
const hopeShortfall = (costs: readonly PaidCost[]): Shortfall => ({ resource: "hope", need: costs.filter((c) => c.resource === "hope" && c.pool === undefined).reduce((n, c) => n + c.amount, 0), have: 0 });

const MOVE_GATES = new Set<string>(["success", "failure", "critical", "withHope", "withFear"]);

/** NV8 damage changes that work on the rolled dice. */
const DICE_CHANGES = new Set<DamageChange["kind"]>(["rerollChosen", "doubleDice", "addWeaponDie", "extraDie", "ones", "dieSize"]);

const DIE_SIZES: readonly DieSides[] = [4, 6, 8, 10, 12, 20];

/** A die `steps` sizes up (or down) the d4-d6-d8-d10-d12-d20 ladder (Mythic Beast, CB p.35: "d6 becomes d8, d8 becomes d10"). */
export function stepDie(sides: number, steps: number): number {
  const at = DIE_SIZES.indexOf(sides as DieSides);
  if (at < 0) return sides;
  return DIE_SIZES[Math.max(0, Math.min(DIE_SIZES.length - 1, at + steps))]!;
}

/** Held dice per kind, for the payer's room (NV1). */
function heldCounts(dice: readonly HeldDieState[]): Partial<Record<HeldDieKind, number>> {
  const out: Partial<Record<HeldDieKind, number>> = {};
  for (const d of dice) out[d.kind] = (out[d.kind] ?? 0) + 1;
  return out;
}

const FOCUS_MAX = 6;
const FAVOR_MAX = 99;

/** Whether a roll filter matches a roll spec (riders: "Before you make an attack"). Exported for the server's rider offers. */
export function rollMatches(filter: RollFilter, roll: RollSpec | undefined): boolean {
  if (filter === "any") return roll !== undefined;
  if (!roll) return false;
  switch (filter) {
    case "action":
      return roll.kind !== "reaction";
    case "attack":
      // DA0: a trait roll marked `attack` (a Beastform's form attack, CB p.30) is an attack roll too.
      return roll.kind === "attack" || roll.kind === "spellcast" || (roll.kind === "trait" && roll.attack === true);
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
  /** E3 (dcm-bz8): inside a `by` choose / optional, the creature making the pick (`to: "chooser"`). */
  chooser?: string;
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
    ...(a.facts ? { facts: a.facts } : {}),
  });
  const unmet = unmetRequirements(use.requires, reqState(actor0));
  if (unmet.length > 0) return refuse("requirement", unmet.map((r) => r.kind).join(", "));

  // DA0 (`rolledBy`, Cannonball): the actor's run pays and sends the roll to the roller (`sending`); the roller's run
  // (`rolling`) makes the roll and runs the steps, and pays no cost or limit again.
  const roller = use.rolledBy && context.roller ? context.roller : null;
  const sending = use.rolledBy !== undefined && roller === null;

  // ---- limit (CB p.101, Q3)
  const targets0 = context.targets ?? [];
  const keyOf = context.limitKeys?.key ?? ((useId: string, targetId?: string) => featureUseKey(effect.cardId, useId, targetId));
  const untilOf = context.limitKeys?.until ?? limitUntil;
  const limitKey = use.limit && !roller ? keyOf(use.id, use.limit.perTarget ? targets0[0]?.id : undefined) : null;
  if (use.limit && limitKey) {
    const availability = keyAvailability(actor0, limitKey, use.limit);
    if (availability.state === "exhausted") return refuse("exhausted", availability.label);
  }

  // ---- state
  let actor: ActorState = { ...actor0 };
  const creatures = new Map<string, Combatant>();
  const before = new Map<string, Combatant>();
  const extra = [...(context.chain ?? []).flat(), ...(context.saveRaisers ?? [])];
  for (const c of [...targets0, ...(context.picked ?? []), ...(context.allies ?? []), ...(context.followUp ?? []), context.trigger?.source, context.trigger?.subject, context.companion, ...extra]) {
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
  /** NV2: a delegated D5 feature refused (its RuleError text); the whole use is refused, nothing is written. */
  let delegateRefusal: string | null = null;
  /** E3: a step's bad input (dcm-40m: the same option in two distinct choose steps); the use is refused. */
  let stepRefusal: string | null = null;
  const snapshot = (): DelegateSnapshot => ({
    hope: actor.hope,
    stress: actor.stress,
    hp: actor.hp,
    armor: actor.armor,
    heldDice: actor.heldDice ?? [],
    featureUses: actor.featureUses,
    ...(actor.favor !== undefined ? { favor: actor.favor } : {}),
    ...(actor.focus !== undefined ? { focus: actor.focus } : {}),
  });
  const steps: PlanStep[] = [];
  const choices: Record<string, number> = { ...(context.choices ?? {}) };
  const spent: Partial<Record<Resource, number>> = {};
  const markedSelf: Partial<Record<Track, number>> = {};
  const markedBy: Record<string, Partial<Record<Track, number>>> = {};
  const counts = { picked: targets0.length, hit: 0, failedSave: 0 };
  let lastRoll: number | undefined;
  let rollTotal: number | undefined;
  let mainRoll: RollInfo | null = null;

  /** The Proficiency the use's numbers read: the roller's when a `rolledBy` use says so, else the actor's. */
  const proficiencyOf = () => (roller && use.rolledBy?.proficiency === "roller" ? roller.proficiency : actor.proficiency);
  // Lanes-2 E3 (dcm-rs1z, dcm-4zti): the server's numbers for the actor and each creature, under the runner's own tracks.
  const extrasOf = (id: string): Partial<MarkedTracks> => (id === actor.id ? (context.numbers?.self ?? {}) : (context.numbers?.byId?.[id] ?? {}));
  /**
   * Lanes-2 E3.3 (dcm-91tx, dcm-bxp.99.19.4): the stats a creature shows on its own: its thresholds, Evasion and (a PC's)
   * Armor Score, which is its Armor Slots (CB, character creation: "you have a number of slots equal to your Armor
   * Score"). The server's `numbers` and the actor's `stats` win over these.
   */
  const ownStats = (c: Combatant): NonNullable<MarkedTracks["stats"]> => ({
    ...(c.thresholds.major !== null ? { majorThreshold: c.thresholds.major } : {}),
    ...(c.thresholds.severe !== null ? { severeThreshold: c.thresholds.severe } : {}),
    ...(c.evasion !== undefined ? { evasion: c.evasion } : {}),
    ...(c.side === "pc" && c.armorMax !== undefined ? { armorScore: c.armorMax } : {}),
  });
  const tracksOf = (c: Combatant): MarkedTracks => {
    const known = extrasOf(c.id);
    const merged = { ...ownStats(c), ...(known.stats ?? {}), ...(c.id === actor.id ? (actor.stats ?? {}) : {}) };
    const stats = Object.keys(merged).length > 0 ? merged : undefined;
    const tokens = tokensOn.get(c.id) ?? known.tokens;
    return {
      ...known,
      hp: c.hp,
      stress: c.stress,
      armor: c.armor,
      hpMax: c.hpMax,
      stressMax: c.stressMax,
      ...(c.armorMax !== undefined ? { armorMax: c.armorMax } : {}),
      ...(stats ? { stats } : {}),
      ...(tokens ? { tokens } : {}),
    };
  };
  /** dcm-a9c (5), dcm-d1b: the duality dice a `dualityDie` number reads: this move's roll, else the host roll. */
  const dualityOf = (): { hope: number; fear: number } | undefined =>
    mainRoll && mainRoll.record.kind !== "reaction" && mainRoll.hope + mainRoll.fear > 0 ? { hope: mainRoll.hope, fear: mainRoll.fear } : context.hostRoll;
  const env = (target?: Combatant): NumberEnv => ({
    traits: actor.traits,
    spellcast: actor.spellcast,
    proficiency: proficiencyOf(),
    level: actor.level,
    tier: actor.tier,
    spent,
    choices,
    cardTokens: actor.cardTokens,
    gmFear: Math.max(0, Math.min(MAX_FEAR, context.gmFear + gmFearDelta)),
    self: tracksOf(actor),
    target: target ? { id: target.id, ...tracksOf(target) } : undefined,
    markedThisMove: { self: markedSelf, byTarget: markedBy },
    targetCount: counts,
    rollTotal,
    triggerAmount: context.trigger?.amount,
    loadoutDomains: actor.loadoutDomains,
    vaultDomains: actor.vaultDomains,
    lastRoll,
    ...(actor.dieSides ? { dieSides: actor.dieSides } : {}),
    // Lanes-2 E3 (dcm-rs1z, dcm-e80y, dcm-4zti): what E5's numbers.ts reads beyond the tracks.
    ...(dualityOf() ? { dualityDice: dualityOf() } : {}),
    ...((context.creatures ?? context.numbers?.creatures) ? { creatures: context.creatures ?? context.numbers?.creatures } : {}),
    ...(actor.classDice ? { classDice: actor.classDice } : {}),
    ...(actor.tideTokens !== undefined ? { tideTokens: actor.tideTokens } : {}),
  });
  /** E3 (dcm-xp0): named tokens on creatures, as this use changes them. */
  const tokensOn = new Map<string, Record<string, number>>(Object.entries(context.creatureTokens ?? {}).map(([id, t]) => [id, { ...t }]));
  const tokensOf = (id: string, name: string) => tokensOn.get(id)?.[name] ?? 0;
  /** E3 (dcm-5xi): a creature's Hope, when known. */
  const hopeChanged = new Map<string, number>();
  const hopeOf = (id: string): number | undefined => {
    if (id === actor.id) return actor.hope;
    const known = context.hopeOf?.[id];
    return known === undefined ? undefined : Math.max(0, known + (hopeChanged.get(id) ?? 0));
  };
  const freeOf = (c: Combatant, track: Track): number => {
    const now = get(c.id);
    const max = track === "hp" ? now.hpMax : track === "stress" ? now.stressMax : (now.armorMax ?? 0);
    const marked = track === "hp" ? now.hp : track === "stress" ? now.stress : (now.armor ?? 0);
    return Math.max(0, max - marked);
  };
  /**
   * E3: the sources only the runner can read (the duality dice, free slots, creature tokens, gold) become fixed numbers
   * before `resolveNumber` sees them, at any depth; the rest stay as written (numbers.ts reads them, lane E5).
   */
  /** Lanes-2 E3 (dcm-b77): the `record` number of the condition whose mods are being resolved. */
  let recordedNow: number | undefined;
  const bindNumber = (source: NumberSource, target?: Combatant): NumberSource => {
    const fixedOf = (value: number): NumberSource => ({ kind: "fixed", value });
    const whoOf = (who: "self" | "target") => (who === "self" ? actor : target);
    switch (source.kind) {
      case "dualityDie": {
        // dcm-d1b (Midnight-Touched, CB p.337: "add the result of your Fear Die"): this move's roll, else the host roll.
        const r = dualityOf();
        return r ? fixedOf(source.die === "hope" ? r.hope : r.fear) : source;
      }
      case "recorded":
        // Lanes-2 E3 (dcm-b77): inside a condition's mods, the number its `record` kept (Banish's return Difficulty).
        return recordedNow === undefined ? source : fixedOf(recordedNow);
      case "free": {
        const c = whoOf(source.who);
        return c ? fixedOf(freeOf(c, source.track)) : source;
      }
      case "creatureTokens": {
        const c = whoOf(source.who);
        return c ? fixedOf(tokensOf(c.id, source.name)) : source;
      }
      case "gold": {
        const c = whoOf(source.who);
        const handfuls = c ? context.goldOf?.[c.id] : undefined;
        return handfuls === undefined ? source : fixedOf(source.unit === "bag" ? Math.floor(handfuls / 10) : handfuls);
      }
      case "sum":
      case "product":
      case "max":
        return { ...source, of: source.of.map((n) => bindNumber(n, target)) };
      case "calc":
        return { ...source, of: bindNumber(source.of, target), ...(source.max ? { max: bindNumber(source.max, target) } : {}) };
      case "dice":
        return { ...source, dice: bindDice(source.dice, target) };
      default:
        return source;
    }
  };
  const bindDice = (dice: DiceExpr, target?: Combatant): DiceExpr => ({
    ...dice,
    count: bindNumber(dice.count, target),
    ...(dice.plus ? { plus: bindNumber(dice.plus, target) } : {}),
  });
  const num = (source: NumberSource, target?: Combatant): number => {
    const e = env(target);
    const value = resolveNumber(bindNumber(source, target), e, rng);
    lastRoll = e.lastRoll;
    return value;
  };
  const diceOf = (expr: DiceExpr) => resolveDice(bindDice(expr), env(), rng);
  const addMarked = (id: string, track: Track, n: number) => {
    if (n <= 0) return;
    const bucket = id === actor.id ? markedSelf : (markedBy[id] ??= {});
    bucket[track] = (bucket[track] ?? 0) + n;
  };

  // ---- choices
  // E3: `values` (Teleport, CB p.333: "+3 / +1 / 0 / -2"; dcm-uyc) allows only the listed numbers (default the first one
  // at or above `min`); `afterTargets` (Share the Burden, CB p.335; dcm-fnq) is checked once the targets are known, so its
  // `max` reads the (first) target.
  const checkChoice = (choice: NonNullable<CardUse["choices"]>[number], target?: Combatant): string | null => {
    const fallback = choice.values ? (choice.values.find((n) => n >= choice.min) ?? choice.min) : choice.min;
    const value = choices[choice.id] ?? fallback;
    const max = choice.max ? num(choice.max, target) : Infinity;
    if (!Number.isInteger(value) || value < choice.min || value > max) return `${choice.label}: ${value}`;
    if (choice.values && !choice.values.includes(value)) return `${choice.label}: ${value} is not one of ${choice.values.join(", ")}`;
    choices[choice.id] = value;
    return null;
  };
  for (const choice of use.choices ?? []) {
    if (choice.afterTargets) continue;
    const bad = checkChoice(choice);
    if (bad) return refuse("choice", bad);
  }

  // ---- targets (CB p.104: any that fall within the parameters)
  const excluded: string[] = [];
  let targets = targets0;
  const useTargets = roller && use.rolledBy ? use.rolledBy.targets : use.targets;
  const spec = useTargets && useTargets.side !== "trigger" ? (useTargets as TargetSpec) : undefined;
  if (spec) {
    targets = targets0.filter((t) => {
      const out = (spec.maxDifficulty !== undefined && (t.difficulty ?? 0) > spec.maxDifficulty) || (spec.excludeFlying === true && t.flying === true);
      if (out) excluded.push(t.id);
      return !out;
    });
    const n = targets0.length;
    const count = spec.count;
    // DA0 (dcm-d95): a count rolled before the pick is the server's number; the runner never rolls it again.
    if (count.kind === "upTo" && count.rolledFirst === true && context.rolledTargetCount === undefined) {
      return refuse("targets", "Roll the number of targets first.");
    }
    const max =
      count.kind === "one"
        ? 1
        : count.kind === "upTo"
          ? (context.rolledTargetCount ?? num(count.n))
          : count.kind === "any" && count.max
            ? num(count.max)
            : Infinity;
    // With an area, `count` limits the picked anchor; the server passes every creature in the area as targets.
    if (spec.area === undefined && n > max) return refuse("targets", `At most ${max} target(s).`);
  }
  if (useTargets && useTargets.side === "trigger") {
    const who = useTargets.who === "source" ? context.trigger?.source : context.trigger?.subject;
    targets = who ? [who] : [];
  }
  counts.picked = targets.length;
  for (const choice of use.choices ?? []) {
    if (!choice.afterTargets) continue;
    const bad = checkChoice(choice, targets[0] ? get(targets[0].id) : undefined);
    if (bad) return refuse("choice", bad);
  }

  // ---- upfront costs (CB p.90)
  let eitherIndex = 0;
  const pickEither = () => context.eitherCosts?.[eitherIndex++] ?? 0;
  const costAmount = (cost: Exclude<Cost, { kind: "either" | "gold" }>) => num(cost.amount);
  // Lanes-2 E3 (dcm-fbsr, dcm-5kxg): the lasting mods a creature carries (`context.modsOn`).
  const modsOf = (id: string): readonly Mod[] => context.modsOn?.[id] ?? [];
  const hasFlag = (id: string, flag: Extract<Mod, { kind: "flag" }>["flag"]) => modsOf(id).some((m) => m.kind === "flag" && m.flag === flag);
  /** Lanes-2 E3.3 (dcm-hgvx): a creature's rules flags (`Mod` `flag`), as `PayerState.flags` and `clearBlocked` read them. */
  const flagsOf = (id: string): string[] => modsOf(id).flatMap((m) => (m.kind === "flag" ? [m.flag] : []));
  /** dcm-hgvx: a payer the server described, with the flags its creature carries here added (Ravenous, HF p.94). */
  const payersWithFlags = (): Partial<Record<Payer, PayerState>> => {
    const out: Partial<Record<Payer, PayerState>> = {};
    for (const [key, state] of Object.entries(context.payers ?? {}) as [Payer, PayerState][]) {
      const who = payerOf(key);
      const extra = who ? flagsOf(who.id) : [];
      out[key] = extra.length > 0 ? { ...state, flags: [...new Set([...(state.flags ?? []), ...extra])] } : state;
    }
    return out;
  };
  const payer = (): PayerState => ({
    hope: actor.hope,
    stress: actor.stress,
    stressMax: actor.stressMax,
    hp: actor.hp,
    hpMax: actor.hpMax,
    armor: actor.armor,
    armorMax: actor.armorMax,
    cardTokens: actor.cardTokens,
    fear: Math.max(0, context.gmFear + gmFearDelta),
    favor: actor.favor ?? 0,
    focus: actor.focus ?? 0,
    heldDice: heldCounts(actor.heldDice ?? []),
    // Lanes-2 E3.3 (dcm-hgvx): `unaffordable` refuses a Hope cost while `cannotSpendHope` holds.
    flags: flagsOf(actor.id),
  });
  /** Lanes-2 E3 (dcm-inou, dcm-sa2): the held dice this use spent, by kind, for a `rerollHeld` change. */
  const heldSpent: { kind: HeldDieKind; dice: { sides: number; value: number }[] }[] = [];
  /** NV1: spends from Favor, Focus or held dice; the spent dice's values (stored, else rolled) feed `spent: heldDie`. */
  const payPool = (c: PaidCost): PaidCost => {
    const pool = c.pool!;
    if (pool === "favor") {
      actor = { ...actor, favor: (actor.favor ?? 0) - c.amount };
      spent.favor = (spent.favor ?? 0) + c.amount;
      return c;
    }
    if (pool === "focus") {
      actor = { ...actor, focus: (actor.focus ?? 0) - c.amount };
      spent.focus = (spent.focus ?? 0) + c.amount;
      return c;
    }
    const held = actor.heldDice ?? [];
    // E3 (dcm-qbn, Prayer Dice, CB p.44: the values are known, so the player picks which to spend): picked dice first.
    const picks = context.heldDicePicks ?? [];
    const ofKind = held.filter((d) => d.kind === pool);
    const dice = [...ofKind.filter((d) => picks.includes(d.id)), ...ofKind.filter((d) => !picks.includes(d.id))].slice(0, c.amount);
    let values = dice.map((d) => d.value ?? rng(d.sides));
    // Plan lanes-2 E8.4 (dcm-7l0g, dcm-40rt; Weapon Specialist, CB p.48: "once per long rest when you roll your Slayer
    // Dice, reroll any 1s"): an unspent `heldRerolls` grant of this kind rerolls the low dice just rolled, once each, and
    // spends its key (the dice box's own `WEAPON_SPECIALIST_KEY`), whichever use spent the dice (Slayer's own rider).
    for (const g of actor.heldRerolls ?? []) {
      if (g.die !== pool || actor.featureUses.some((u) => u.key === g.key) || !values.some((n) => n <= g.atMost)) continue;
      const before: number[] = [];
      const after: number[] = [];
      values = values.map((n, i) => {
        if (n > g.atMost) return n;
        const next = rng(dice[i]!.sides);
        before.push(n);
        after.push(next);
        return next;
      });
      actor = { ...actor, featureUses: [...actor.featureUses, { key: g.key, until: g.until }] };
      steps.push({ kind: "heldReroll", die: pool, before, after });
    }
    const ids = new Set(dice.map((d) => d.id));
    actor = { ...actor, heldDice: held.filter((d) => !ids.has(d.id)) };
    spent.heldDie = (spent.heldDie ?? 0) + values.reduce((s, n) => s + n, 0);
    heldSpent.push({ kind: pool, dice: dice.map((d, i) => ({ sides: d.sides, value: values[i]! })) });
    return { ...c, values };
  };
  /** Pays resolved costs; returns them with the spent dice's values filled in. */
  const payCosts = (paid: readonly PaidCost[]): PaidCost[] =>
    paid.map((c) => {
      if (c.pool !== undefined) return payPool(c);
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
      return c;
    });
  /** Unstuck (CB p.237: "they must double the amount spent or marked"): the factor on `what` for creature `id`. */
  const multiplierOf = (id: string, what: "hope" | Track): number =>
    modsOf(id).reduce((f, m) => (m.kind === "marksMultiplier" && m.of.includes(what) ? f * m.factor : f), 1);
  /** Ravenous (HF p.94: "a PC can't spend Hope"): Hope in the costs of a creature that can't spend it. */
  const hopeBarred = (id: string, costs: readonly PaidCost[]) => hasFlag(id, "cannotSpendHope") && costs.some((c) => c.resource === "hope" && c.pool === undefined && c.amount > 0);
  /** Resolved costs for payer `id`, its Hope spends and marks multiplied (dcm-fbsr). */
  const costsFor = (list: readonly Cost[], id: string): PaidCost[] =>
    resolveCosts(list, costAmount, pickEither).map((c) =>
      c.pool === undefined && (c.resource === "hope" || c.resource === "stress" || c.resource === "hp" || c.resource === "armor") ? { ...c, amount: c.amount * multiplierOf(id, c.resource) } : c,
    );
  /**
   * E3: pays `costs` for `c`: the actor as any payment (CB p.90); another creature (a `by` chooser, a save raiser, a
   * `paidBy` payer) marks its Stress / HP on its own track and loses Hope it holds. Lanes-2 E3 (dcm-a9c, dcm-4zti): a
   * `payer` the server described (`context.payers`) is checked with `unaffordableBy`; otherwise unknown Hope is taken as
   * enough (the server checks it). False (and nothing paid) when it can't.
   */
  const payBy = (c: Combatant, costs: readonly PaidCost[], phase: "upfront" | "afterRoll" | "optional", payerKey?: Payer): boolean => {
    if (costs.length === 0) return true;
    if (c.id === actor.id) {
      const ok = unaffordable(costs, payer()).length === 0 && !hopeBarred(actor.id, costs);
      steps.push({ kind: "pay", phase, costs: ok ? payCosts(costs) : [...costs], paid: ok });
      return ok;
    }
    const hopeNeeded = costs.reduce((n, x) => n + (x.resource === "hope" ? x.amount : 0), 0);
    const hope = hopeOf(c.id);
    const described = payerKey ? unaffordableBy(costs, payerKey, payersWithFlags()) : null;
    const short = described !== null ? described.length > 0 : hope !== undefined && hope < hopeNeeded;
    if (short || hopeBarred(c.id, costs)) {
      steps.push({ kind: "pay", phase, costs: [...costs], paid: false, payerId: c.id });
      return false;
    }
    steps.push({ kind: "pay", phase, costs: [...costs], paid: true, payerId: c.id });
    for (const x of costs) {
      if (x.resource === "stress") {
        const res = applyStressTo(get(c.id), x.amount);
        put(res.after);
        addMarked(c.id, "stress", res.stressMarked);
        addMarked(c.id, "hp", res.hpMarked);
        steps.push({ kind: "mark", targetId: c.id, track: "stress", amount: x.amount, hpMarked: res.hpMarked, overflow: res.overflow });
      } else if (x.resource === "hp") {
        const res = applyHpTo(get(c.id), x.amount);
        put(res.after);
        addMarked(c.id, "hp", res.hpMarked);
        steps.push({ kind: "mark", targetId: c.id, track: "hp", amount: x.amount, hpMarked: res.hpMarked, overflow: false });
      } else if (x.resource === "armor") {
        const now = get(c.id);
        const armor = Math.min(now.armorMax ?? 0, (now.armor ?? 0) + x.amount);
        put({ ...now, armor });
        addMarked(c.id, "armor", armor - (now.armor ?? 0));
        steps.push({ kind: "mark", targetId: c.id, track: "armor", amount: x.amount, hpMarked: 0, overflow: false });
      } else if (x.resource === "hope") {
        hopeChanged.set(c.id, (hopeChanged.get(c.id) ?? 0) - x.amount);
        steps.push({ kind: "hope", targetId: c.id, delta: -x.amount });
      }
    }
    return true;
  };
  /** Lanes-2 E3: the creature a `paidBy` payer names (`chooser`: the scope's chooser). */
  const payerOf = (who: Payer, chooser?: string): Combatant | undefined => {
    switch (who) {
      case "self":
        return actor;
      case "triggerSubject":
        return context.trigger?.subject ? get(context.trigger.subject.id) : undefined;
      case "triggerSource":
        return context.trigger?.source ? get(context.trigger.source.id) : undefined;
      case "picked":
        return context.picked?.[0] ? get(context.picked[0].id) : undefined;
      case "chooser":
        return chooser ? get(chooser) : undefined;
    }
  };
  // Lanes-2 E3 (dcm-a9c (2), dcm-uj0, dcm-8yr): a use `paidBy` another creature (Rune Ward's holder) is paid by them, and
  // refused when they can't (checked against `context.payers` when the server gives it).
  const upfrontPayer = use.paidBy && use.paidBy !== "self" && !roller ? payerOf(use.paidBy) : actor;
  if (!upfrontPayer) return refuse("cost", `No ${use.paidBy ?? "payer"} to pay.`);
  const upfront = roller ? [] : costsFor(use.costs ?? [], upfrontPayer.id);
  if (upfrontPayer.id !== actor.id) {
    const payers = payersWithFlags();
    const described = unaffordableBy(upfront, use.paidBy, payers);
    if ((described !== null && described.length > 0) || hopeBarred(upfrontPayer.id, upfront)) {
      const state = payers[use.paidBy ?? "self"];
      return refuse("cost", (described?.length ? described : ["hope"]).join(", "), (state ? shortfalls(upfront, state)[0] : undefined) ?? hopeShortfall(upfront));
    }
    if (!payBy(upfrontPayer, upfront, "upfront", use.paidBy)) return refuse("cost", "hope");
  } else {
    const short = unaffordable(upfront, payer());
    if (short.length > 0) return refuse("cost", short.join(", "), shortfalls(upfront, payer())[0]);
    if (hopeBarred(actor.id, upfront)) return refuse("cost", "hope", hopeShortfall(upfront));
    if (upfront.length > 0) {
      steps.push({ kind: "pay", phase: "upfront", costs: payCosts(upfront), paid: true });
    }
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
      // Lanes-2 E3 (dcm-mhn, Eye of the Sage, HF p.70: "critically succeeds on a roll of 19-20"): a widened crit range.
      const critical = natural >= Math.min(20, rollSpec.critRange ?? 20);
      const success = perTarget ? true : critical || fixed === undefined || record.total >= fixed;
      info = { record: { ...record, kind: "action", ...(fixed !== undefined ? { difficulty: fixed } : {}) }, hope: 0, fear: 0, outcome: "none", critical, success, withHope: false, withFear: false, effects: { hope: 0, clearStress: 0, fear: 0 } };
    } else {
      const kind = rollSpec.kind === "reaction" ? "reaction" : "action";
      const traitValue = (() => {
        if (rollSpec.kind === "spellcast") return actor.spellcast;
        if (rollSpec.kind === "reaction") {
          // Lanes-2 E3 (dcm-fjh, dcm-a9c (4); Attack of Opportunity, CB p.48: "a reaction roll using a trait of your
          // choice"): `anyTrait` rolls the trait the player picked, else the default.
          const trait = rollSpec.anyTrait && context.roll?.trait ? context.roll.trait : rollSpec.trait;
          return trait === "spellcast" ? actor.spellcast : (actor.traits[trait] ?? 0);
        }
        if (rollSpec.kind === "trait") {
          const options: readonly TraitId[] = typeof rollSpec.trait === "string" ? [rollSpec.trait] : rollSpec.trait;
          const picked: TraitId = context.roll?.trait && options.includes(context.roll.trait) ? context.roll.trait : options[0]!;
          // DA0: a `rolledBy` use rolls with the roller's trait ("using Agility or Strength (their choice)", CB p.33).
          return (roller ? roller.traits : actor.traits)[picked] ?? 0;
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
    info.effects = rollSpec.kind === "adversaryAttack" ? info.effects : dualityEffects(rollSpec.kind === "reaction" ? "reaction" : "action", info.outcome, context.hopeFear);
    return { info, hits };
  };

  /**
   * NV8: a change to rolled damage dice (CB p.107: a reroll always takes the new result). Dice picks are indexes among
   * the move's damage dice that are not dropped (`context.damageDice`); a change it can't make returns the record as is.
   */
  function changeDice(record: RollRecord, ch: DamageChange): RollRecord {
    type Die = RollRecord["dice"][number];
    const live = (d: Die) => d.role === "damage" && !d.dropped;
    const byPick = (picks: readonly number[], f: (d: Die) => Die) => {
      const chosen = new Set(picks);
      let i = 0;
      return record.dice.map((d) => (live(d) ? (chosen.has(i++) ? f(d) : d) : d));
    };
    let dice: Die[] = record.dice;
    let modifier = record.modifier;
    switch (ch.kind) {
      case "rerollChosen": {
        if (ch.below) {
          const below = num(ch.below);
          dice = record.dice.map((d) => (live(d) && d.value < below ? { ...d, value: rng(d.sides) } : d));
        } else dice = byPick(context.damageDice?.reroll ?? [], (d) => ({ ...d, value: rng(d.sides) }));
        break;
      }
      case "doubleDice": {
        if (ch.which === "matching") {
          const seen = new Map<number, number>();
          for (const d of record.dice) if (live(d)) seen.set(d.value, (seen.get(d.value) ?? 0) + 1);
          dice = record.dice.map((d) => (live(d) && (seen.get(d.value) ?? 0) > 1 ? { ...d, value: d.value * 2 } : d));
        } else dice = byPick((context.damageDice?.double ?? []).slice(0, ch.count ?? 1), (d) => ({ ...d, value: d.value * 2 }));
        break;
      }
      case "addWeaponDie": {
        const weapon = actor.weapons[ch.weapon];
        const sides = weapon ? weaponDice(weapon.damage, 1).dice[0]?.sides : undefined;
        if (sides === undefined) return record;
        dice = [...record.dice, { sides, value: rng(sides), role: "damage" }];
        break;
      }
      case "extraDie": {
        const first = record.dice.find(live);
        if (!first) return record;
        const all: Die[] = [...record.dice, { sides: first.sides, value: rng(first.sides), role: "damage" }];
        let lowest = -1;
        all.forEach((d, i) => {
          if (live(d) && (lowest < 0 || d.value < all[lowest]!.value)) lowest = i;
        });
        dice = all.map((d, i) => (i === lowest ? { ...d, dropped: true } : d));
        break;
      }
      case "ones": {
        const ones = record.dice.filter((d) => live(d) && d.value === 1).length;
        if (ch.asMax) dice = record.dice.map((d) => (live(d) && d.value === 1 ? { ...d, value: d.sides } : d));
        else if (ch.add) {
          const added: Die[] = [];
          for (let n = 0; n < ones; n++) {
            const d = diceOf(ch.add);
            for (const value of rollDice(d.count, d.sides, rng)) added.push({ sides: d.sides, value, role: "damage" });
            modifier += d.plus;
          }
          dice = [...record.dice, ...added];
        }
        break;
      }
      default:
        return record;
    }
    return { ...record, dice, modifier, total: Math.max(0, dice.reduce((s, d) => s + (d.dropped ? 0 : d.value), 0) + modifier) };
  }

  function weaponFor(ref: "primary" | "secondary" | "either"): WeaponInfo | undefined {
    const slot = ref === "either" ? (context.roll?.weapon ?? "primary") : ref;
    return actor.weapons[slot] ?? (ref === "either" ? actor.weapons.primary ?? actor.weapons.secondary : undefined);
  }

  let mainHits: Map<string, boolean> | null = null;
  /** The Hope this move's roll actually gave (NV17 takes it back). */
  let rollHopeGained = 0;
  if (sending) {
    // DA0: the actor's half of a `rolledBy` use: costs paid, the roll goes to the picked ally (Cannonball, CB p.33).
    const proficiency = use.rolledBy!.proficiency === "actor" ? { amount: actor.proficiency } : {};
    steps.push({ kind: "prompt", prompt: "allyRoll", text: `${use.name}: make the roll`, targetIds: targets.map((t) => t.id), ...proficiency });
  } else if (use.roll) {
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
    if (roller) {
      // DA0: the roller's action roll: its Hope and a critical's Stress clear are the roller's (CB p.90).
      if (fx.hope) steps.push({ kind: "hope", targetId: roller.id, delta: fx.hope });
      if (fx.clearStress) steps.push({ kind: "clear", targetId: roller.id, track: "stress", amount: fx.clearStress });
    } else if (fx.hope) {
      const hope = Math.min(actor.hopeMax, actor.hope + fx.hope);
      rollHopeGained = hope - actor.hope;
      actor = { ...actor, hope };
    }
    if (fx.clearStress && !roller) actor = { ...actor, stress: Math.max(0, actor.stress - fx.clearStress) };
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
  /**
   * dcm-vv2 item 2 (E3): the damage cache is per follow-up roll. R9 rolls one damage per move's attack (cached across a
   * save's branches); a follow-up with its own roll (Double Swipe's second attack) is a new attack with its own damage.
   */
  let damageScope = "main";
  let followUps = 0;
  const damageKey = (roll: DamageRoll) => `${damageScope}|${JSON.stringify(roll)}`;
  /** The latest damage roll's plan entry, for NV8 changes made after it was rolled. */
  let lastDamage: { index: number; key: string; record: RollRecord } | null = null;

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
    const key = damageKey(roll);
    const cached = damageCache.get(key);
    if (cached) return cached;
    let pool: DicePool = [];
    let flat = 0;
    let type: DamageType | "both" = "physical";
    let critical = crit;
    if (roll.kind === "dice") {
      const d = diceOf(roll.dice);
      pool = [{ count: d.count, sides: d.sides }];
      flat = d.plus;
    } else if (roll.kind === "weapon") {
      const weapon = weaponFor(roll.weapon);
      let prof = proficiencyOf();
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
    } else if (roll.kind === "companion") {
      // Lanes-2 E3 (dcm-b9hc, dcm-2z2; CB p.40: "their damage die is a d6 … using your Proficiency", "Choose whether they
      // deal physical or magic damage"): the companion's die (`dieSides.companion`, d6 by default) x Proficiency.
      let prof = proficiencyOf();
      for (const ch of preDamage) if (ch.kind === "proficiency") prof += ch.delta;
      pool = [{ count: Math.max(1, prof), sides: actor.dieSides?.companion ?? 6 }];
      type = actor.companionDamageType ?? "physical";
    } else {
      critical = false;
      flat = roll.kind === "flat" ? num(roll.amount) : roll.kind === "sameAsTrigger" ? (context.trigger?.amount ?? 0) : lastDamageTotal;
      // Lanes-2 E3 (dcm-86z, Encore, CB p.335: "the same damage … that your ally dealt"): the trigger's type, for a step
      // typed `weapon`.
      if (roll.kind === "sameAsTrigger" && context.trigger?.damageType) type = context.trigger.damageType;
    }
    // NV8: "Your damage die increases by one size" (Mythic Beast, CB p.35) before the dice are rolled.
    const sizeSteps = preDamage.reduce((n, ch) => n + (ch.kind === "dieSize" ? ch.steps : 0), 0);
    if (sizeSteps !== 0) pool = pool.map((p) => ({ ...p, sides: stepDie(p.sides, sizeSteps) }));
    let record = pool.length > 0 ? rollDamage({ dice: pool, flat, critical }, rng) : ({ kind: "damage", dice: [], modifier: flat, total: Math.max(0, flat), outcome: "none", manual: false } as RollRecord);
    for (const ch of preDamage) {
      if (ch.kind === "reroll") record = rerollLow(record, ch.atMost, rng);
      if (ch.kind === "maxDice") record = maxLowest(record, ch.count);
      record = changeDice(record, ch);
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
      case "targetCheck":
        // E3: read for each recipient (`who: "target"`); a state the runner can't decide holds (the table confirms, Q13).
        return checkOn(gate.check, get(c.id)) ?? true;
    }
  };
  /**
   * E3: a `StateCheck` on a recipient. The runner decides what it tracks itself during the use (marks and free slots,
   * Hope it knows, named tokens: dcm-5xi, dcm-xp0, dcm-18i); the rest goes to availability.ts `stateCheckMet` (lane E5)
   * with the recipient as its target. Undefined: not known.
   */
  const checkOn = (check: StateCheck, c: Combatant): boolean | undefined => {
    const between = (n: number, lo?: number, hi?: number) => (lo === undefined || n >= lo) && (hi === undefined || n <= hi);
    const whoOf = (who: "self" | "target" | "subject" | undefined): Combatant | undefined =>
      who === "self" ? actor : who === "subject" ? (context.trigger?.subject ? get(context.trigger.subject.id) : undefined) : c;
    switch (check.kind) {
      case "track": {
        const w = whoOf(check.who);
        if (!w) return undefined;
        let n: number | undefined;
        if (check.track === "hope") {
          const hope = hopeOf(w.id);
          n = hope === undefined ? undefined : check.measure === "marked" ? hope : w.id === actor.id ? actor.hopeMax - hope : undefined;
        } else n = check.measure === "free" ? freeOf(w, check.track) : check.track === "hp" ? w.hp : check.track === "stress" ? w.stress : (w.armor ?? 0);
        return n === undefined ? undefined : between(n, check.atLeast, check.atMost);
      }
      case "tokens": {
        if (check.name === undefined) return (check.who ?? "self") === "self" ? between(actor.cardTokens, check.atLeast, check.atMost) : undefined;
        const w = whoOf(check.who ?? "target");
        return w ? between(tokensOf(w.id, check.name), check.atLeast, check.atMost) : undefined;
      }
      case "not": {
        const inner = checkOn(check.check, c);
        return inner === undefined ? undefined : !inner;
      }
      case "anyOf": {
        const all = check.checks.map((x) => checkOn(x, c));
        return all.some((x) => x === true) ? true : all.every((x) => x === false) ? false : undefined;
      }
      default: {
        const facts: StateFacts = { ...(actor.facts ?? {}), target: { conditions: c.conditions, tags: c.tags ?? [], hp: c.hp, hpMax: c.hpMax } };
        return stateCheckMet(check, { ...reqState(actor), facts });
      }
    }
  };
  const isTargetGate = (g: Gate) =>
    typeof g === "string" ? ["hit", "miss", "targetMarkedHp", "targetDefeated", "targetStressFull"].includes(g) : g.kind === "targetHas" || g.kind === "targetCheck";
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

  const recipientsOf = (to: Recipient, gates: readonly Gate[] | undefined, scope: Scope, pick?: TargetSpec): Combatant[] => {
    let list: Combatant[];
    switch (to) {
      case "self":
        list = [actor];
        break;
      case "targets":
        list = scope.targets.map(get);
        break;
      case "picked":
        // NV13 (Q4): a companion pick is the actor's companion.
        if (pick?.companion) list = context.companion ? [get(context.companion.id)] : [];
        else list = (context.picked ?? []).map((c) => get(c.id));
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
      case "chooser":
        // E3 (dcm-bz8): inside a `by` choose / optional, the creature making that pick.
        list = scope.chooser ? [get(scope.chooser)] : [];
        break;
    }
    // E3 (dcm-y45, Stunning Sunlight, CB p.341: "targets you succeeded against"): a pick only among the use's targets or
    // the ones its roll hit (no roll: every target).
    if (pick?.among) {
      const among = pick.among;
      list = list.filter((c) => scope.targets.includes(c.id) && (among === "targets" || !scope.hits || scope.hits.get(c.id) === true));
    }
    // Per-target gates filter `targets` one by one; for anyone else they hold when they hold for any target.
    const perCreature = to === "targets";
    return list.filter((c) => (gates ?? []).every((g) => (perCreature || !isTargetGate(g) ? targetGate(g, c, scope) : stepGate([g], scope))));
  };

  const resolveMods = (mods: readonly Mod[], target?: Combatant): ResolvedMod[] =>
    mods.map((m) => {
      if (m.kind === "stat") return { kind: "stat", stat: m.stat, delta: num(m.delta, target), ...(m.versus ? { versus: m.versus } : {}) };
      if (m.kind === "trait") {
        // NV15: "choose one trait to raise" takes the player's pick in that choice id (a trait id), else the default.
        const picked = m.choice ? context.options?.[m.choice]?.[0] : undefined;
        const trait = picked !== undefined && (TRAIT_IDS as readonly string[]).includes(picked) ? (picked as TraitId) : m.trait;
        return { kind: "trait", trait, delta: num(m.delta, target) };
      }
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
        // Lanes-2 E3 (dcm-a9c (2), dcm-8yr): a `paidBy` payment is the payer's (a chooser inside a `by` step).
        const who = step.paidBy && step.paidBy !== "self" ? payerOf(step.paidBy, scope.chooser) : actor;
        if (!who) {
          steps.push({ kind: "pay", phase: "afterRoll", costs: resolveCosts(step.costs, costAmount, pickEither), paid: false });
          return false;
        }
        return payBy(who, costsFor(step.costs, who.id), "afterRoll", step.paidBy);
      }
      case "optional": {
        if (step.by) {
          // E3 (dcm-6ju; Money Talks, CB p.228): each chooser decides and pays for themselves.
          if (!stepGate(step.when, scope)) return true;
          for (const c of recipientsOf(step.by.to, undefined, scope, step.by.pick)) {
            const taken = context.chooserOptionals?.[step.id]?.[c.id] ?? step.defaultOn === true;
            if (!taken) continue;
            const costs = costsFor(step.costs ?? [], c.id);
            if (!payBy(c, costs, "optional", "chooser")) continue;
            runSteps(step.steps, { ...scope, chooser: c.id });
          }
          return true;
        }
        // DA0: a `defaultOn` add-on runs unless the player turned it off (Draining Bane, dcm-bxp.99.19.15).
        const taken = step.defaultOn === true ? !(context.optionalsOff ?? []).includes(step.id) : (context.optionals ?? []).includes(step.id);
        if (!taken || !stepGate(step.when, scope)) return true;
        const optionalKey = keyOf(`${use.id}:${step.id}`);
        if (step.limit) {
          const availability = keyAvailability(actor, optionalKey, step.limit);
          if (availability.state === "exhausted") return true;
        }
        const costs = costsFor(step.costs ?? [], actor.id);
        if (unaffordable(costs, payer()).length > 0 || hopeBarred(actor.id, costs)) {
          steps.push({ kind: "pay", phase: "optional", costs, paid: false });
          return true;
        }
        if (costs.length > 0) {
          steps.push({ kind: "pay", phase: "optional", costs: payCosts(costs), paid: true });
        }
        runSteps(step.steps, scope);
        if (step.limit && limitConsumed(step.limit, success)) {
          // Lanes-2 E3 (dcm-rs1z): the whole Limit, so its `period` is stored once the period ends (E5 round 2).
          actor = { ...actor, featureUses: [...actor.featureUses, { key: optionalKey, until: untilOf(step.limit) }] };
        }
        return true;
      }
      case "choose": {
        if (!stepGate(step.when, scope)) return true;
        const max = step.count ? num(step.count) : 1;
        // E3 (dcm-40m, Twin Fang, HF p.9: "a second poison"): an option picked in `distinctFrom` can't be picked here.
        const other = step.distinctFrom ? (context.options?.[step.distinctFrom] ?? []) : [];
        const runPicks = (picked: readonly string[], inner: Scope): boolean => {
          if (picked.some((id) => other.includes(id))) {
            stepRefusal = `${step.label}: pick another option than in ${step.distinctFrom ?? ""}.`;
            return false;
          }
          const list = (step.distinct ? [...new Set(picked)] : picked).slice(0, Math.max(0, max));
          for (const id of list) {
            const option = step.options.find((o) => o.id === id);
            if (option) runSteps(option.steps, inner);
          }
          return true;
        };
        if (step.by) {
          // E3 (dcm-bz8; Critical Inspiration, CB p.341: "all allies … can clear a Stress or gain a Hope"): each chooser
          // picks their own option; `to: "chooser"` inside it is them. A chooser without a pick gets a choose prompt.
          for (const c of recipientsOf(step.by.to, undefined, scope, step.by.pick)) {
            const picked = context.chooserOptions?.[step.id]?.[c.id] ?? [];
            if (picked.length === 0) {
              steps.push({ kind: "prompt", prompt: "choose", text: step.label, targetIds: [c.id], step, chooserId: c.id });
              continue;
            }
            if (!runPicks(picked, { ...scope, chooser: c.id })) return false;
          }
          return true;
        }
        const picked = context.options?.[step.id] ?? [];
        if (picked.length === 0) {
          steps.push({ kind: "prompt", prompt: "choose", text: step.label, targetIds: [], step });
          return true;
        }
        return runPicks(picked, scope);
      }
      case "save": {
        if (!stepGate(step.when, scope)) return true;
        const recipients = recipientsOf(step.to, step.when?.filter(isTargetGate), scope, step.pick);
        if (recipients.length === 0) return true;
        // dcm-q0a (Enchanting Song, CB p.226: "Other Sirens … can mark a Stress to each add a +1 bonus to the Difficulty"):
        // the raisers pay once for the step; the Difficulty is the same for every recipient.
        const raisedBy: string[] = [];
        const difficulty = saveDifficulty(step.difficulty, raisedBy);
        const raised = raisedBy.length > 0 ? { raisedBy } : {};
        for (const r of recipients) {
          const own: Scope = { ...scope, targets: [r.id] };
          const now = get(r.id);
          // dcm-fev (Bee-Ruption, HF p.77: "Restrained targets automatically fail the reaction roll").
          const autoFail = (step.autoFail ?? []).some((ref) => (ref.kind === "standard" ? now.conditions.includes(ref.condition) : (now.tags ?? []).includes(ref.tag)));
          if (autoFail) {
            const record: RollRecord = { kind: "reaction", dice: [], modifier: 0, total: 0, outcome: "none", manual: false, difficulty };
            steps.push({ kind: "save", targetId: r.id, record, difficulty, success: false, autoFail: true, ...raised });
            counts.failedSave += 1;
            runSteps(step.onFail, own);
            continue;
          }
          // dcm-rb0 (Entice, HF p.85): advantage / disadvantage while `modsWhen` holds for this recipient.
          const modsHold = (step.modsWhen ?? []).every((g) => targetGate(g, now, own));
          const advantage = step.advantage && modsHold ? 1 : 0;
          const disadvantage = step.disadvantage && modsHold ? 1 : 0;
          const extra = { ...(advantage ? { advantage } : {}), ...(disadvantage ? { disadvantage } : {}) };
          if (r.side === "pc") {
            steps.push({ kind: "prompt", prompt: "pcSave", text: "Reaction roll", targetIds: [r.id], step, difficulty, ...extra });
            continue;
          }
          const { record } = rollD20(rng, 0, advantage, disadvantage);
          const ok = record.total >= difficulty;
          steps.push({ kind: "save", targetId: r.id, record: { ...record, difficulty }, difficulty, success: ok, ...extra, ...raised });
          if (!ok) counts.failedSave += 1;
          runSteps(ok ? step.onSuccess : step.onFail, own);
        }
        return true;
      }
      case "check": {
        if (!stepGate(step.when, scope)) return true;
        const d = diceOf(step.dice);
        const dice = rollDice(d.count, d.sides, rng);
        const total = dice.reduce((s, n) => s + n, 0) + d.plus;
        lastRoll = total;
        // dcm-27j (Broken Magic, HF p.68: "1-2 … 3-4 … 5-6"): the table row holding the total runs; no row: then / otherwise.
        const rowIndex = step.table ? step.table.findIndex((x) => total >= x.atLeast && total <= x.atMost) : -1;
        const row = rowIndex >= 0 ? step.table![rowIndex]! : null;
        if (row) {
          steps.push({ kind: "check", total, dice, passed: true, row: rowIndex, ...(row.label ? { label: row.label } : {}) });
          runSteps(row.steps, scope);
          return true;
        }
        const passed = testPasses(step.test, dice, total);
        steps.push({ kind: "check", total, dice, passed });
        runSteps(passed ? step.then : step.otherwise, scope);
        return true;
      }
      case "followUp": {
        if (!stepGate(step.when, scope)) return true;
        // E3 (dcm-rou, dcm-7az): a repeating follow-up runs one link per creature list (`followUp`, then `chain`), each
        // without the creatures already targeted, until a link is empty (`noTargets`), its roll hits no one (`miss`), the
        // `costEach` can't be paid or `max` repeats ran. Out of given links, a `followUp` prompt asks for the next one.
        const repeat = step.repeat;
        if (!repeat) {
          runLink(step, scope, (context.followUp ?? []).map((c) => get(c.id)));
          return true;
        }
        const links: (readonly Combatant[])[] = [context.followUp ?? [], ...(context.chain ?? [])];
        const seen = new Set<string>(scope.targets);
        let ran = 0;
        let last: string[] = [];
        let open = true;
        for (let i = 0; i < links.length; i++) {
          const others = links[i]!.filter((c) => !seen.has(c.id)).map((c) => get(c.id));
          if (others.length === 0 || (i > 0 && repeat.max !== undefined && i > repeat.max)) {
            open = false;
            break;
          }
          if (i > 0 && !payBy(actor, costsFor(repeat.costEach ?? [], actor.id), "afterRoll")) {
            open = false;
            break;
          }
          for (const c of others) seen.add(c.id);
          const damageBefore = steps.length;
          // Lanes-2 E3.3 (dcm-q13x, user answer 2026-10-31: "every new wave of chained targets gets a fresh 2d8+4 roll"):
          // each link is its own damage scope, so its damage is rolled again; one roll still serves the whole link (R9).
          const outerScope = damageScope;
          if (context.freshLinkDamage && !step.roll) damageScope = `${outerScope}|link${i}`;
          const hitAny = runLink(step, scope, others);
          damageScope = outerScope;
          ran = i + 1;
          last = others.map((c) => c.id);
          // Lanes-2 E3 (dcm-4yg4, Lightning Strike, HF p.91: "Each time the lightning bounces, decrease the damage it deals
          // by 1d10"): the link's damage changes once per link before it.
          if (repeat.perLink && i > 0) applyPerLink(repeat.perLink, i, others);
          if (repeat.until === "miss" && !hitAny) {
            open = false;
            break;
          }
          // Lanes-2 E3 (dcm-4yg4): `checkFails` goes on while the check holds: fresh `dice` (Lightning Strike: "roll a d6. On
          // a result of 4 or higher, the lightning bounces"), or the link's own damage dice (Lightning Bolt, HF p.96: "If
          // all results are even … until you roll an odd result").
          if (repeat.until === "checkFails" && repeat.check) {
            let dice: number[];
            let total: number;
            if (repeat.check.dice) {
              const d = diceOf(repeat.check.dice);
              dice = rollDice(d.count, d.sides, rng);
              total = dice.reduce((n, x) => n + x, 0) + d.plus;
            } else {
              const rolled = steps.slice(damageBefore).filter((x): x is Extract<PlanStep, { kind: "damageRoll" }> => x.kind === "damageRoll").pop();
              dice = (rolled?.record.dice ?? []).filter((x) => x.role === "damage" && !x.dropped).map((x) => x.value);
              total = rolled?.record.total ?? 0;
            }
            const passed = testPasses(repeat.check.test, dice, total);
            steps.push({ kind: "check", total, dice, passed });
            if (!passed) {
              open = false;
              break;
            }
          }
        }
        if (open && ran > 0 && (repeat.max === undefined || ran <= repeat.max)) {
          steps.push({ kind: "prompt", prompt: "followUp", text: step.note ?? "Pick the next targets (none ends it)", targetIds: last, step, amount: ran });
        }
        return true;
      }
      default:
        runOutcome(step, scope);
        return true;
    }
  };

  const saveDifficulty = (d: SaveDifficulty, raisedBy?: string[]): number => {
    switch (d.kind) {
      case "fixed":
        return d.value;
      case "rollTotal":
        return rollTotal ?? 0;
      case "number":
        return num(d.value);
      case "actorDifficulty":
        return actor.difficulty ?? 0;
      case "raised": {
        // E3 (dcm-q0a): each raiser that pays adds `each`. The server picks the raisers within `allies.within` (positions
        // are the server's); without `raisedBy` (a nested base) nobody pays.
        const base = saveDifficulty(d.base);
        if (!raisedBy) return base;
        for (const c of context.saveRaisers ?? []) {
          if (payBy(get(c.id), costsFor([d.cost], c.id), "afterRoll")) raisedBy.push(c.id);
        }
        return base + d.each * raisedBy.length;
      }
      case "falling":
        // E3 (dcm-b77, Banish, CB p.333: "the Difficulty gains a -1 penalty and the target makes another reaction roll").
        return num(d.start) - d.step * Math.max(0, context.saveAttempt ?? 0);
    }
  };


  /** Lanes-2 E3 (dcm-4yg4): a repeating follow-up's `perLink` change, `times` over, on the link's pending damage. */
  const applyPerLink = (change: DamageChange, times: number, others: readonly Combatant[]): void => {
    const withPending = others.filter((c) => pending.has(c.id));
    if (change.kind !== "add" || withPending.length === 0) {
      for (let k = 0; k < times; k++) steps.push({ kind: "fold", step: { kind: "modifyDamage", to: "targets", change }, targetIds: others.map((c) => c.id) });
      return;
    }
    let delta = 0;
    for (let k = 0; k < times; k++) delta += num(change.amount);
    for (const c of withPending) {
      const p = pending.get(c.id)!;
      p.amount = Math.max(0, p.amount + delta);
    }
  };

  /**
   * One run of a `followUp`'s steps against `others`: with its own roll (Telekinesis) or the scope's (Whirlwind). A
   * follow-up with its own roll is a new attack, so its damage is rolled again (dcm-vv2 item 2: a per-follow-up damage
   * cache); without one it shares the move's roll and damage (Whirlwind: "the same roll and damage", R9). True when the
   * roll hit any of them (no roll: true).
   */
  const runLink = (step: Extract<Step, { kind: "followUp" }>, scope: Scope, others: readonly Combatant[]): boolean => {
    const outer = damageScope;
    if (step.roll) damageScope = `followUp${++followUps}`;
    let hitAny: boolean;
    if (step.roll) {
      flush();
      const { info, hits } = rollOnce(step.roll, others);
      steps.push({ kind: "roll", roll: info });
      steps.push({ kind: "hits", results: others.map((t) => ({ id: t.id, hit: hits.get(t.id) ?? false })) });
      const fx = info.effects;
      if (fx.hope) actor = { ...actor, hope: Math.min(actor.hopeMax, actor.hope + fx.hope) };
      if (fx.clearStress) actor = { ...actor, stress: Math.max(0, actor.stress - fx.clearStress) };
      if (fx.fear) gmFearDelta += fx.fear;
      hitAny = [...hits.values()].some(Boolean);
      runSteps(step.steps, { targets: others.map((c) => c.id), hits, roll: info });
    } else {
      const hits = new Map<string, boolean>();
      const r = scope.roll;
      if (r) for (const h of resolveHits(r.record.total, r.critical, others.map((t) => ({ id: t.id, difficulty: t.difficulty ?? t.evasion ?? 0 })))) hits.set(h.id, h.hit);
      if (r) steps.push({ kind: "hits", results: others.map((t) => ({ id: t.id, hit: hits.get(t.id) ?? false })) });
      hitAny = r ? [...hits.values()].some(Boolean) : true;
      runSteps(step.steps, { targets: others.map((c) => c.id), hits: r ? hits : null, roll: r });
    }
    damageScope = outer;
    return hitAny;
  };

  /** dcm-vv2 item 2 (E3): a critical is the scope's roll's (a follow-up's own roll), not always the use's main roll. */
  const crit = (scope: Scope) => scope.roll !== null && scope.roll.critical && scope.roll.record.kind !== "reaction";

  const runOutcome = (step: OutcomeStep, scope: Scope): void => {
    const recipients = recipientsOf(step.to, step.when, scope, step.pick);
    const ids = recipients.map((r) => r.id);
    const noRecipientStep = step.kind === "fear" || step.kind === "toVault" || (step.kind === "tokens" && step.holder !== "recipient") || step.kind === "manual";
    /**
     * E3 (dcm-0ib, Siphon Essence, HF p.180: "clear a number of Hit Points equal to the number of Hit Points the target
     * marked from this attack"): a number for the actor reads `who: "target"` as the scope's single target.
     */
    const amountFor = (source: NumberSource, r: Combatant): number =>
      num(source, r.id === actor.id && scope.targets.length === 1 && scope.targets[0] !== actor.id ? get(scope.targets[0]!) : r);
    if (noRecipientStep && !stepGate(step.when, scope)) return;
    if (!noRecipientStep && recipients.length === 0) return;
    switch (step.kind) {
      case "damage": {
        if (step.perArea && context.pointsOf) {
          // Lanes-2 E3 (dcm-va0f, Unleash Hellfire, HF p.88: "If a target takes damage from multiple bursts, combine the
          // damage"): one roll per point; each recipient takes the sum of the points whose area holds it.
          const outer = damageScope;
          const totals = new Map<number, number>();
          let pointType: DamageType | "both" = "physical";
          const points = [...new Set(recipients.flatMap((r) => context.pointsOf?.[r.id] ?? []))].sort((a, b) => a - b);
          for (const i of points) {
            damageScope = `${outer}|point${i}`;
            const rolled = rollDamageFor(step.roll, crit(scope) && step.roll.kind !== "flat");
            const type: DamageType | "both" = typeOverride ?? (step.type === "weapon" ? rolled.type : step.type);
            steps.push({ kind: "damageRoll", record: rolled.record, type });
            totals.set(i, rolled.record.total);
            pointType = type;
          }
          damageScope = outer;
          anyDamageRolled = points.length > 0;
          for (const r of recipients) {
            let amount = (context.pointsOf[r.id] ?? []).reduce((n, i) => n + (totals.get(i) ?? 0), 0);
            if (amount === 0) continue;
            if (step.scale === "half") amount = Math.ceil(amount / 2);
            if (step.scale === "double") amount *= 2;
            const type = pointType;
            const p = pending.get(r.id);
            pending.set(r.id, { amount: (p?.amount ?? 0) + amount, type: p && p.type !== type ? "both" : type, direct: (p?.direct ?? false) || step.direct === true, minimumSeverity: p?.minimumSeverity });
          }
          return;
        }
        const rolled = rollDamageFor(step.roll, crit(scope) && step.roll.kind !== "flat");
        anyDamageRolled = true;
        let type: DamageType | "both" = step.type === "weapon" ? rolled.type : step.type;
        if (typeOverride) type = typeOverride;
        const repeat = step.repeat ? Math.max(0, num(step.repeat)) : 1;
        let total = rolled.record.total;
        let record = rolled.record;
        if (repeat !== 1) {
          // "1d20+2 magic damage for each Stress marked": the expression rolled that many times and totalled.
          const records = [rolled.record, ...Array.from({ length: Math.max(0, repeat - 1) }, () => {
            damageCache.delete(damageKey(step.roll));
            return rollDamageFor(step.roll, crit(scope)).record;
          })].slice(0, repeat);
          total = records.reduce((s, r) => s + r.total, 0);
          record = { ...rolled.record, dice: records.flatMap((r) => r.dice), modifier: records.reduce((s, r) => s + r.modifier, 0), total };
        }
        lastDamageTotal = total;
        steps.push({ kind: "damageRoll", record, type });
        lastDamage = { index: steps.length - 1, key: damageKey(step.roll), record };
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
            const dropped = damageDice.slice(0, index).reduce((s, n) => s + n, 0) + (crit(scope) ? index * dieSides : 0);
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
        // NV8: dice changes ride on this move's damage roll: before it is rolled they wait for it; after it, they change
        // it and the creatures' pending damage by the difference. Without a damage roll of its own it is a fold.
        if (DICE_CHANGES.has(ch.kind)) {
          if (!anyDamageRolled && use.steps.some((s) => s.kind === "damage")) {
            preDamage.push(ch);
            return;
          }
          if (lastDamage && withPending.length > 0 && ch.kind !== "dieSize") {
            const next = changeDice(lastDamage.record, ch);
            const delta = next.total - lastDamage.record.total;
            const entry = steps[lastDamage.index];
            if (entry && entry.kind === "damageRoll") steps[lastDamage.index] = { ...entry, record: next };
            const cached = damageCache.get(lastDamage.key);
            if (cached) damageCache.set(lastDamage.key, { ...cached, record: next });
            lastDamage = { ...lastDamage, record: next };
            lastDamageTotal += delta;
            for (const r of withPending) pending.get(r.id)!.amount += delta;
            return;
          }
          steps.push({ kind: "fold", step, targetIds: ids, ...(ch.kind === "rerollChosen" && ch.below ? { amount: num(ch.below) } : {}) });
          return;
        }
        // Q6, CB p.107 "round up": halving incoming damage the trigger carries folds the halved amount.
        if (ch.kind === "halve" && withPending.length === 0 && context.trigger?.amount !== undefined) {
          steps.push({ kind: "fold", step, targetIds: ids, amount: Math.ceil(context.trigger.amount / 2) });
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
          if (ch.kind === "add") {
            p.amount += added;
            // NV8: added damage of another type makes the total both types (as two damage steps do; CB p.99).
            if (ch.type && p.type !== ch.type) p.type = "both";
          }
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
        if (step.distribution === "split") {
          // E3 (dcm-zhc, Force Salvo, HF p.81: "The same creature can be targeted by up to three force bolts"): the marks
          // are spread as the actor picks (`splits`), at most `maxPer` on one, never more than the total.
          let left = Math.max(0, num(step.amount));
          const total = left;
          for (const r of recipients) {
            const share = context.splits?.[r.id];
            if (share === undefined) continue;
            const amount = Math.max(0, Math.min(share, step.maxPer ?? Infinity, left));
            left -= amount;
            if (amount === 0) continue;
            const res = applyHpTo(get(r.id), amount);
            put(res.after);
            addMarked(r.id, "hp", res.hpMarked);
            steps.push({ kind: "mark", targetId: r.id, track: "hp", amount, hpMarked: res.hpMarked, overflow: false, ...(step.reduceWith === "hope" ? { reduceWithHope: true } : {}) });
          }
          if (recipients.some((r) => context.splits?.[r.id] === undefined)) {
            steps.push({ kind: "prompt", prompt: "split", text: step.maxPer ? `Divide the marks (at most ${step.maxPer} each)` : "Divide the marks", targetIds: ids, step, amount: total });
          }
          return;
        }
        for (const r of recipients) {
          // Lanes-2 E3 (dcm-fbsr, Unstuck, CB p.237: "they must double the amount spent or marked").
          const amount = amountFor(step.amount, r) * multiplierOf(r.id, "hp");
          const res = applyHpTo(get(r.id), amount);
          put(res.after);
          addMarked(r.id, "hp", res.hpMarked);
          steps.push({ kind: "mark", targetId: r.id, track: "hp", amount, hpMarked: res.hpMarked, overflow: false, ...(step.reduceWith === "hope" ? { reduceWithHope: true } : {}) });
        }
        return;
      }
      case "markStress": {
        const markStress = (r: Combatant, base: number) => {
          const amount = base * multiplierOf(r.id, "stress");
          const res = applyStressTo(get(r.id), amount);
          put(res.after);
          addMarked(r.id, "stress", res.stressMarked);
          addMarked(r.id, "hp", res.hpMarked);
          steps.push({ kind: "mark", targetId: r.id, track: "stress", amount, hpMarked: res.hpMarked, overflow: res.overflow });
        };
        if (step.distribution === "split") {
          // Lanes-2 E3 (dcm-63j, Mind Meld, HF p.74: "distributed among allies as it chooses"): the marks spread as the
          // chooser picks (`splits`), never more than the total; a missing share is a split prompt.
          let left = Math.max(0, num(step.amount));
          const total = left;
          for (const r of recipients) {
            const share = context.splits?.[r.id];
            if (share === undefined) continue;
            const amount = Math.max(0, Math.min(share, left));
            left -= amount;
            if (amount > 0) markStress(r, amount);
          }
          if (recipients.some((r) => context.splits?.[r.id] === undefined)) {
            steps.push({ kind: "prompt", prompt: "split", text: "Divide the Stress", targetIds: ids, step, amount: total });
          }
          return;
        }
        for (const r of recipients) markStress(r, amountFor(step.amount, r));
        return;
      }
      case "markArmor": {
        for (const r of recipients) {
          const c = get(r.id);
          // Lanes-2 E3 (dcm-nsjj, dcm-18i; Spit Acid, CB p.210: "If they can't mark an Armor Slot, they must mark an
          // additional HP"): a recipient with no free Armor Slot runs `ifUnable` instead (`to: "targets"` is them).
          if (step.ifUnable && (c.armorMax === undefined || (c.armor ?? 0) >= c.armorMax)) {
            runSteps(step.ifUnable, { ...scope, targets: [r.id], hits: null });
            continue;
          }
          if (c.armorMax === undefined) continue;
          const amount = num(step.amount, r) * multiplierOf(r.id, "armor");
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
          } else amount = amountFor(step.amount, r);
          // Lanes-2 E3 (dcm-5kxg; Afflicted, Nightmare Stare, HF p.95: "the target can't clear HP or Stress").
          // Lanes-2 E3.3 (dcm-hgvx): read through E5's `clearBlocked`, the one place that maps a track to its flag.
          if ((step.track === "hp" || step.track === "stress") && clearBlocked(step.track, flagsOf(r.id))) {
            steps.push({ kind: "prompt", prompt: "manual", text: `Can't clear ${step.track === "hp" ? "Hit Points" : "Stress"} now`, targetIds: [r.id], step });
            continue;
          }
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
        // Lanes-2 E3 (dcm-nh44, Stone of Omens, HF p.62: "which they can distribute among the PCs however they wish"): a
        // `split` gain goes out as the chooser picks (`splits`), never more than the total; a missing share is a prompt.
        const split = step.distribution === "split" && step.change === "gain";
        let splitLeft = split ? Math.max(0, num(step.amount)) : 0;
        if (split && recipients.some((r) => context.splits?.[r.id] === undefined)) {
          steps.push({ kind: "prompt", prompt: "split", text: "Divide the Hope", targetIds: ids, step, amount: splitLeft });
        }
        for (const r of recipients) {
          let n: number;
          if (split) {
            const share = context.splits?.[r.id];
            if (share === undefined) continue;
            n = Math.max(0, Math.min(share, splitLeft));
            splitLeft -= n;
            if (n === 0) continue;
          } else n = amountFor(step.amount, r);
          const delta = step.change === "gain" ? n : -n;
          if (step.change === "lose" && step.ifUnable) {
            // E3 (dcm-5xi, Dreadhowl, CB p.222: "If a target is not able to lose a Hope, they must instead mark 2 Stress"):
            // a recipient holding less Hope than the loss runs `ifUnable` instead (to: "targets" is them). Unknown Hope:
            // the loss goes out and the table is asked.
            const held = hopeOf(r.id);
            if (held !== undefined && held < n) {
              runSteps(step.ifUnable, { ...scope, targets: [r.id], hits: null });
              continue;
            }
            if (held === undefined) {
              steps.push({ kind: "prompt", prompt: "manual", text: step.note ?? "If they can't lose the Hope, apply the alternative", targetIds: [r.id], step });
            }
          }
          if (r.id === actor.id) {
            const hope = Math.max(0, Math.min(actor.hopeMax, actor.hope + delta));
            steps.push({ kind: "hope", targetId: r.id, delta: hope - actor.hope });
            actor = { ...actor, hope };
          } else {
            hopeChanged.set(r.id, (hopeChanged.get(r.id) ?? 0) + delta);
            steps.push({ kind: "hope", targetId: r.id, delta });
          }
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
          // Lanes-2 E3 (dcm-iedr runner half, dcm-b77, dcm-8bv): the condition's mods (a `recorded` number reads the
          // `record` kept with it: Banish, CB p.333), caster / roll ends, escape and the Fear a `gmSpendsFear` end costs.
          const recorded = step.record ? num(step.record, r) : undefined;
          recordedNow = recorded;
          const mods = step.mods && step.mods.length > 0 ? resolveMods(step.mods, r) : undefined;
          recordedNow = undefined;
          steps.push({
            kind: "condition",
            targetId: r.id,
            condition: cond,
            duration: step.duration,
            ...(step.endsWhen ? { endsWhen: step.endsWhen } : {}),
            ...(step.endsOn ? { endsOn: step.endsOn } : {}),
            ...(mods ? { mods } : {}),
            ...(step.endsOnCaster ? { endsOnCaster: step.endsOnCaster } : {}),
            ...(step.endsOnRoll ? { endsOnRoll: step.endsOnRoll } : {}),
            ...(step.escape ? { escape: step.escape } : {}),
            ...(recorded !== undefined ? { recorded } : {}),
            ...(step.endFear ? { endFear: num(step.endFear, r) } : {}),
          });
        }
        return;
      }
      case "clearCondition": {
        for (const r of recipients) {
          const c = get(r.id);
          if (step.all) {
            // E3 (dcm-730, Purifying Aura, HF p.86: "and all conditions"): every condition and tag the recipient carries.
            put({ ...c, conditions: [], tags: [] });
            for (const x of c.conditions) steps.push({ kind: "clearCondition", targetId: r.id, condition: { kind: "standard", condition: x } as ConditionRef });
            for (const tag of c.tags ?? []) steps.push({ kind: "clearCondition", targetId: r.id, condition: { kind: "tag", tag } as ConditionRef });
            continue;
          }
          const cond = step.condition;
          if (cond.kind === "standard") put({ ...c, conditions: c.conditions.filter((x) => x !== cond.condition) });
          else put({ ...c, tags: (c.tags ?? []).filter((x) => x !== cond.tag) });
          steps.push({ kind: "clearCondition", targetId: r.id, condition: cond });
        }
        return;
      }
      case "move": {
        if (step.mode === "intoMelee") {
          // DA0 (Charge, dcm-bxp.99.19.16): the server moves the recipients into Melee range of the use's first target.
          const anchorId = (step.relativeTo === "triggerSource" ? context.trigger?.source?.id : undefined) ?? scope.targets[0] ?? (context.picked ?? [])[0]?.id;
          steps.push({ kind: "prompt", prompt: "move", text: step.note ?? moveText(step), targetIds: ids, step, server: true, ...(anchorId ? { anchorId } : {}) });
          return;
        }
        if (step.mode === "ground") {
          // E3 (dcm-yzr, Mystic Tether, CB p.333: "this spell grounds … them"): a flying recipient lands.
          for (const r of recipients) if (get(r.id).flying) put({ ...get(r.id), flying: false });
        }
        steps.push({ kind: "prompt", prompt: "move", text: step.note ?? moveText(step), targetIds: ids, step });
        return;
      }
      case "effect": {
        for (const r of recipients) {
          // E3 (dcm-kkx, Blight Seed, HF p.9: "This effect can't stack"): a `refuse` copy on a creature that has it is dropped.
          if (step.stacking === "refuse" && (context.effectsOn?.[r.id] ?? []).includes(step.label)) {
            steps.push({ kind: "prompt", prompt: "manual", text: `${step.label}: already on them (it can't stack)`, targetIds: [r.id], step });
            continue;
          }
          steps.push({
            kind: "effect",
            targetId: r.id,
            label: step.label,
            mods: resolveMods(step.mods, r),
            duration: step.duration,
            ...(step.endsWhen ? { endsWhen: step.endsWhen } : {}),
            ...(step.endsOn ? { endsOn: step.endsOn } : {}),
            ...(step.option ? { option: step.option } : {}),
            ...(step.stacking && step.stacking !== "stack" ? { stacking: step.stacking } : {}),
            // Lanes-2 E3 (dcm-rao5 Bird's-Eye View, CB p.33; dcm-8bv Marked for Death, HF p.8).
            ...(step.sharedGrant ? { sharedGrant: true } : {}),
            ...(step.endFear ? { endFear: num(step.endFear, r) } : {}),
          });
        }
        return;
      }
      case "tokens": {
        if (step.holder === "recipient") {
          // E3 (dcm-xp0, Encumber, CB p.218: bramble tokens on the target): named tokens on each recipient.
          const name = step.name ?? "tokens";
          for (const r of recipients) {
            const before = tokensOf(r.id, name);
            const amount = step.amount ? num(step.amount, r) : 0;
            const max = step.max ? num(step.max, r) : Infinity;
            const raw = step.op === "set" ? amount : step.op === "add" ? before + amount : step.op === "spend" ? before - amount : 0;
            const after = Math.max(0, Math.min(max, raw));
            tokensOn.set(r.id, { ...(tokensOn.get(r.id) ?? {}), [name]: after });
            steps.push({ kind: "creatureTokens", targetId: r.id, name, op: step.op, before, after });
          }
          return;
        }
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
        if (ch.kind === "rerollHeld" && heldSpent.some((h) => h.kind === ch.die)) {
          // Lanes-2 E3 (dcm-inou, dcm-sa2; Weapon Specialist, CB p.48: "when you roll your Slayer Dice, reroll any 1s"): the
          // dice of that kind this use spent showing `atMost` or less are rolled again once each; `spent: heldDie` follows.
          const before: number[] = [];
          const after: number[] = [];
          for (const h of heldSpent) {
            if (h.kind !== ch.die) continue;
            h.dice = h.dice.map((d) => {
              if (d.value > ch.atMost) return d;
              const next = rng(d.sides);
              before.push(d.value);
              after.push(next);
              return { ...d, value: next };
            });
          }
          spent.heldDie = (spent.heldDie ?? 0) + after.reduce((n, v) => n + v, 0) - before.reduce((n, v) => n + v, 0);
          steps.push({ kind: "heldReroll", die: ch.die, before, after });
          return;
        }
        const amount = ch.kind === "add" || ch.kind === "evasion" || ch.kind === "dieBonus" ? num(ch.amount) : undefined;
        steps.push({ kind: "fold", step, targetIds: ids, ...(amount !== undefined ? { amount } : {}) });
        return;
      }
      // ---- SD1: the sheet-drawer outcomes (NV1, NV2, NV4, NV11, NV17, NV18, NV19)
      case "delegate": {
        const p = step.params;
        const choice = p?.choice ?? (p?.choiceFrom ? context.options?.[p.choiceFrom]?.[0] : undefined);
        const other = recipients.find((r) => r.id !== actor.id);
        const params: DelegateRequest["params"] = {
          ...(choice !== undefined ? { choice } : {}),
          ...(p?.amount ? { amount: num(p.amount) } : {}),
          ...(other ? { targetId: other.id } : {}),
          ...(context.dieIndexes ? { dieIndexes: [...context.dieIndexes] } : {}),
        };
        if (!context.delegate) {
          steps.push({ kind: "delegate", feature: step.feature, params, targetIds: ids, done: false });
          return;
        }
        // E3 (dcm-d1d, Ranger's Focus, CB p.38: "make the attack's target your Focus"): the D5 feature gets the roll the
        // step runs after (the use's own, or its follow-up's) and whether it hit the step's target.
        const hostHit = other && scope.hits ? { hit: scope.hits.get(other.id) ?? false } : {};
        const answer = context.delegate({ feature: step.feature, params, actor: snapshot(), ...(scope.roll ? { roll: scope.roll.record } : {}), ...hostHit });
        if (!answer.ok) {
          delegateRefusal = answer.detail;
          return;
        }
        const a = answer.actor;
        actor = {
          ...actor,
          hope: a.hope,
          stress: a.stress,
          hp: a.hp,
          armor: a.armor,
          heldDice: a.heldDice,
          featureUses: a.featureUses,
          ...(a.favor !== undefined ? { favor: a.favor } : {}),
          ...(a.focus !== undefined ? { focus: a.focus } : {}),
        };
        if (answer.fearDelta) {
          const current = context.gmFear + gmFearDelta;
          gmFearDelta += Math.max(0, Math.min(MAX_FEAR, current + answer.fearDelta)) - current;
        }
        steps.push({ kind: "delegate", feature: step.feature, params, targetIds: ids, done: true, summary: answer.summary });
        return;
      }
      case "adjustHpMarked":
        steps.push({ kind: "fold", step, targetIds: ids, amount: num(step.amount) });
        return;
      case "resource": {
        for (const r of recipients) {
          if (r.id !== actor.id) continue;
          const max = step.resource === "focus" ? FOCUS_MAX : FAVOR_MAX;
          const before = (step.resource === "focus" ? actor.focus : actor.favor) ?? 0;
          const n = num(step.amount);
          const raw = step.change === "gain" ? before + n : step.change === "lose" ? before - n : n;
          const after = Math.max(0, Math.min(max, raw));
          actor = step.resource === "focus" ? { ...actor, focus: after } : { ...actor, favor: after };
          steps.push({ kind: "resource", targetId: r.id, resource: step.resource, before, after });
        }
        return;
      }
      case "area": {
        const spec = step.area;
        const centreId = spec.centre === "self" ? actor.id : spec.centre === "target" ? (scope.targets[0] ?? ids.find((id) => id !== actor.id) ?? null) : null;
        steps.push({ kind: "area", area: { ...spec, mods: resolveMods(spec.mods ?? []) }, centreId, targetIds: ids });
        return;
      }
      case "replaceHopeGain": {
        // NV17: only the Hope this move's own roll gave can be taken instead; for another roll it is a fold.
        if (rollHopeGained <= 0) {
          steps.push({ kind: "fold", step, targetIds: ids });
          return;
        }
        rollHopeGained -= 1;
        actor = { ...actor, hope: actor.hope - 1 };
        steps.push({ kind: "hope", targetId: actor.id, delta: -1 });
        if (step.with === "favor") {
          const before = actor.favor ?? 0;
          const after = Math.min(FAVOR_MAX, before + 1);
          actor = { ...actor, favor: after };
          steps.push({ kind: "resource", targetId: actor.id, resource: "favor", before, after });
        } else {
          const current = context.gmFear + gmFearDelta;
          const next = Math.max(0, current - 1);
          gmFearDelta += next - current;
          steps.push({ kind: "fear", delta: next - current });
        }
        return;
      }
      case "addTargets":
        steps.push({ kind: "fold", step, targetIds: ids, amount: num(step.count) });
        return;
      case "help":
        for (const r of recipients) steps.push({ kind: "help", targetId: r.id, die: step.die, free: step.free === true });
        return;
      case "redirectDamage":
      case "negate":
      case "convertMarks":
      case "refreshFeature":
        steps.push({ kind: "fold", step, targetIds: ids });
        return;
      case "endEffect":
        // E3 (dcm-8x8 Confusing Aura, CB p.329: "this spell ends"; dcm-5fc Howling Rampage, HF p.40: "drop out of Wolf
        // Form"): the server ends the effect (lane E6).
        for (const id of ids) steps.push({ kind: "endEffect", targetId: id, of: step.of ?? effect.cardId, own: step.of === undefined, ...(step.option ? { option: step.option } : {}) });
        return;
      case "inventory":
        // E3 (dcm-0gh, Quick Hands, CB p.225): the server changes the recipient's inventory. Lanes-2 E3 (dcm-vf7i,
        // Contacts Everywhere, CB p.43: "1 handful of gold, a unique tool, or a mundane object"): `giveGold` / `giveItem`
        // to the recipient (`text` names the item; unset: the GM's pick).
        for (const r of recipients) {
          steps.push({
            kind: "inventory",
            targetId: r.id,
            op: step.op,
            ...(step.item ? { item: step.item } : {}),
            ...(step.amount ? { amount: num(step.amount, r) } : step.op === "giveGold" ? { amount: 1 } : {}),
            ...(step.text ? { text: step.text } : {}),
          });
        }
        return;
      case "setStance": {
        // Lanes-2 E3 (dcm-awh, Stance Fighter, HF p.12: "shift into a martial stance"): the stance named, or the player's
        // pick in `choice`; without either the table picks.
        const stance = step.stance ?? (step.choice ? context.options?.[step.choice]?.[0] : undefined);
        if (stance === undefined) {
          steps.push({ kind: "prompt", prompt: "manual", text: step.note ?? "Pick a martial stance", targetIds: ids, step });
          return;
        }
        for (const r of recipients) steps.push({ kind: "setStance", targetId: r.id, stance });
        return;
      }
      case "exhaust": {
        // Lanes-2 E3 (dcm-war, dcm-a9c (3); Rune Ward, CB p.328: "If the Ward Die result is 8, the ward's power ends … It
        // can be recharged for free on your next rest"): the use (or `useId`) is spent until `per`.
        const useId = step.useId ?? use.id;
        const key = keyOf(useId);
        const times = effect.uses.find((u) => u.id === useId)?.limit?.times ?? 1;
        // As availability.ts `exhaustKey`, with this runner's `until` (cards store a scene limit as session).
        const until = untilOf(step.per);
        const have = actor.featureUses.filter((u) => u.key === key).length;
        actor = { ...actor, featureUses: [...actor.featureUses, ...Array.from({ length: Math.max(0, times - have) }, () => ({ key, until }))] };
        steps.push({ kind: "exhaust", key, until });
        // The card's words stay a line for the table until the feed shows `exhaust` entries (follow-up dcm-q40t).
        if (step.note) steps.push({ kind: "prompt", prompt: "manual", text: step.note, targetIds: ids, step });
        return;
      }
      case "forcedAttack": {
        // Lanes-2 E3 (dcm-c8h3 Words of Discord, CB p.335; dcm-zi3k Beguiled, HF p.75): the recipients attack a creature
        // `against` picks: the use's `picked` creatures (never an attacker), else the GM picks.
        const againstIds = (context.picked ?? []).map((c) => c.id).filter((id) => !ids.includes(id));
        steps.push({ kind: "forcedAttack", attackerIds: ids, against: step.against, againstIds });
        return;
      }
      case "changeForm":
        // Lanes-2 E3 (dcm-3ag5, Transform, HF p.142): an adversary takes the other stat block, keeping its marks; a PC
        // recipient is the table's.
        for (const r of recipients) {
          if (r.side === "pc") steps.push({ kind: "prompt", prompt: "manual", text: step.note ?? "Change form", targetIds: [r.id], step });
          else steps.push({ kind: "changeForm", targetId: r.id, adversaryId: step.adversaryId });
        }
        return;
      // Plan lanes, tracer V: new outcome steps (TASK-LN-V.md); until their lane runs them, the table does it by hand.
      case "loadout":
      case "revive":
      case "deathMove":
      case "downtime":
      case "armorCost":
        steps.push({ kind: "prompt", prompt: "manual", text: step.note ?? step.kind, targetIds: ids, step });
        return;
    }
  };

  // DA0: a `rolledBy` use's steps run in the roller's run, after their roll.
  if (!sending) runSteps(use.steps, { targets: targets.map((t) => t.id), hits: mainHits, roll: mainRoll });
  flush();
  if (delegateRefusal !== null) return refuse("choice", delegateRefusal);
  if (stepRefusal !== null) return refuse("choice", stepRefusal);

  // ---- the limit (Q3, Q4)
  let limit: RunPlan["limit"] = null;
  if (use.limit && limitKey) {
    const consumed = limitConsumed(use.limit, success);
    const until = untilOf(use.limit);
    limit = { key: limitKey, until, consumed };
    if (consumed) actor = { ...actor, featureUses: [...actor.featureUses, { key: limitKey, until }] };
  }

  const resources = (a: ActorState): ActorResources => ({
    hope: a.hope,
    stress: a.stress,
    hp: a.hp,
    armor: a.armor,
    cardTokens: a.cardTokens,
    ...(a.favor !== undefined ? { favor: a.favor } : {}),
    ...(a.focus !== undefined ? { focus: a.focus } : {}),
    ...(a.heldDice !== undefined ? { heldDice: [...a.heldDice] } : {}),
  });
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
      ...(use.holdLimit ? { holdLimit: num(use.holdLimit) } : {}),
      ...(use.actor === "companion" ? { actorKind: "companion" as const } : {}),
    },
  };
}

/**
 * DA0 (dcm-d95): rolls the target count of a use whose `upTo` count is `rolledFirst` (Warden's Protection's 1d4, CB
 * p.31), for the server to store before the player picks; null for any other use. The run then takes it as
 * `RunContext.rolledTargetCount`.
 */
export function rollTargetCount(use: CardUse, actor: ActorState, rng: Rng, choices: Readonly<Record<string, number>> = {}): number | null {
  const spec = use.targets;
  if (!spec || spec.side === "trigger" || spec.count.kind !== "upTo" || spec.count.rolledFirst !== true) return null;
  const env: NumberEnv = {
    traits: actor.traits,
    spellcast: actor.spellcast,
    proficiency: actor.proficiency,
    level: actor.level,
    tier: actor.tier,
    spent: {},
    // Lanes-2 E3 (dcm-q3t1, dcm-gov; Otherworldly Ire, HF p.15: "spend any number of Favor to roll that many Patron
    // Dice"): the count reads the player's choices (the Favor chosen); the caller pays the Favor with the roll.
    choices: { ...choices },
    cardTokens: actor.cardTokens,
    gmFear: 0,
    self: { hp: actor.hp, stress: actor.stress, armor: actor.armor },
    ...(actor.classDice ? { classDice: actor.classDice } : {}),
    ...(actor.tideTokens !== undefined ? { tideTokens: actor.tideTokens } : {}),
    markedThisMove: { self: {}, byTarget: {} },
    targetCount: { picked: 0, hit: 0, failedSave: 0 },
    loadoutDomains: actor.loadoutDomains,
    vaultDomains: actor.vaultDomains,
    ...(actor.dieSides ? { dieSides: actor.dieSides } : {}),
  };
  return Math.max(0, resolveNumber(spec.count.n, env, rng));
}

/** A check's test on its dice and total (dcm-27j; lanes-2 dcm-4yg4: every die's parity). */
function testPasses(t: CheckTest, dice: readonly number[], total: number): boolean {
  switch (t.kind) {
    case "anyAtLeast":
      return dice.some((n) => n >= t.value);
    case "allAtMost":
      return dice.length > 0 && dice.every((n) => n <= t.value);
    case "totalAtLeast":
      return total >= t.value;
    case "totalAtMost":
      return total <= t.value;
    // Lanes-2 V2 (dcm-4yg4, Lightning Bolt, HF p.96: "If all results are even").
    case "allEven":
    case "allOdd":
      return dice.length > 0 && dice.every((n) => (n % 2 === 0) === (t.kind === "allEven"));
    // dcm-27j: a fate roll's parity (CB p.168; Stone of Omens, HF p.62).
    case "even":
    case "odd":
      return (total % 2 === 0) === (t.kind === "even");
  }
}

function moveText(step: Extract<OutcomeStep, { kind: "move" }>): string {
  const range = step.range ? ` (${step.range})` : "";
  const verb = {
    knockBack: "Knock back",
    pull: "Pull",
    teleport: "Teleport",
    move: "Move",
    flee: "Flee",
    intoMelee: "Move into Melee range",
    ground: "Ground",
    leaveScene: "Leave the scene",
    // Plan lanes-2, V2 (dcm-z5a6, dcm-lvgm): a label until its lane moves the token.
    withCaster: "Move along with the caster",
  }[step.mode];
  return `${verb}${range}`;
}
