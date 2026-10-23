/**
 * The card-effect vocabulary (plan combat-actions, tracer CA0; analysis section 3.1). A closed, typed set of
 * building blocks that describes what a domain card does in combat, so a pure runner (CA1 `run.ts`) can turn an
 * effect plus a context into an ordered plan the server executes (CA4) and the reaction window folds in (AA1).
 *
 * Binding rules for everyone who writes effect entries (the ten CE-* tracers, AA0's adversary vocabulary):
 * - This file is the vocabulary. Domain tracers never change it; a step the vocabulary cannot express becomes a
 *   `manual` step with the card's words, and the tracer files a bead (analysis section 5).
 * - Pure types plus a few `as const` lists: no framework imports, no `any`.
 * - "You" / `self` is the actor: the PC whose card it is, or (when AA0 reuses the outcome steps) the adversary
 *   using a feature. "Enemy" is the other side: adversaries for a PC, PCs for an adversary.
 * - Book pages are printed pages (CB = Core Book). Examples for every part: docs/tasks/TASK-CA-CA0.md.
 */

import type { RangeBandKey } from "../combat-map/ranges";
import type { DomainId, TraitId } from "../../srd/types";

// ---------------------------------------------------------------- basics

/** The Defined Ranges (CB p.103): Melee, Very Close, Close, Far, Very Far. */
export type Range = RangeBandKey | "veryFar";

/** Die sizes the cards and stat blocks roll. */
export type DieSides = 4 | 6 | 8 | 10 | 12 | 20;

/** Damage types (CB p.98). */
export type DamageType = "physical" | "magic";

/** Damage severity against thresholds (CB p.91). */
export type Severity = "minor" | "major" | "severe";

/** Tracks a creature marks. `armor` is Armor Slots (PCs only). */
export type Track = "hp" | "stress" | "armor";

/**
 * What a cost or a "spent" amount draws from. `fear` and `gold` are for AA0 (adversary features).
 * Plan sheet-drawer, SD0 (NV1, widened): `favor` (Warlock Favor, HF p.14, the sheet's `classState.favor`), `focus` (the
 * Martial Artist's Focus, HF p.12, `classState.martial.focus`) and `heldDie` (a Rally, Prayer, Patron, Slayer or Combo
 * die spent; as a `spent` number it is the spent dice's total value: "spend a Prayer Die to reduce incoming damage by
 * the die's value", CB p.44).
 */
export type Resource = "hope" | "stress" | "hp" | "armor" | "tokens" | "fear" | "gold" | "favor" | "focus" | "heldDie";

/**
 * The held dice a feature can spend or roll (NV1). The sheet keeps Rally, Prayer, Patron and Combo dice in `heldDice`
 * (`HELD_DIE_KINDS`) and Slayer Dice in `sessionFeatures.slayerDice`; D5 owns both records (NV2 `delegate`).
 */
export type HeldDieKind = "rally" | "prayer" | "patron" | "slayer" | "combo";

/**
 * A number on a card. Most are `fixed`; the rest are read from the actor, the move or the target when the runner
 * resolves the step. `calc` wraps another source for "half your Agility", "twice your Strength", "minimum 1".
 */
export type NumberSource =
  | { kind: "fixed"; value: number }
  /** "equal to your Strength" (the actor's trait, after effects). */
  | { kind: "trait"; trait: TraitId }
  /** "using your Spellcast trait" (CB p.98): the value of the actor's Spellcast trait. */
  | { kind: "spellcast" }
  /** "using your Proficiency" (CB p.98). */
  | { kind: "proficiency" }
  | { kind: "level" }
  /** What this use paid: "the Hope spent", "for each Stress marked", "the tokens spent". */
  | { kind: "spent"; resource: Resource }
  /** A number the player picked in the use's `choices` (by choice id), e.g. "spend any number of Hope". */
  | { kind: "chosen"; choice: string }
  /** Tokens on this card right now. */
  | { kind: "cardTokens" }
  /** Fear in the GM's pool (Umbral Veil, Avatar of Terror). */
  | { kind: "gmFear" }
  /** Currently marked on the actor's or the target's track (Battle Monster: "the number of Hit Points you currently have marked"). */
  | { kind: "marked"; who: "self" | "target"; track: Track }
  /** Marked on that track by this move (Siphon Essence: "equal to the number of Hit Points the target marked from this attack"). */
  | { kind: "markedThisMove"; who: "self" | "target"; track: Track }
  /** How many targets: picked, hit by the roll, or failed the reaction roll (Night Terror: "equal to the number of targets that are Horrified"). */
  | { kind: "targetCount"; which: "picked" | "hit" | "failedSave" }
  /** The total of this move's action roll (Chain Lightning: "a Difficulty equal to the result of your Spellcast Roll"). */
  | { kind: "rollTotal" }
  /** The number the trigger carries: the damage the ally dealt (Encore), the HP you marked (Never Upstaged), the Stress transferred. */
  | { kind: "triggerAmount" }
  /** Cards of a domain in the actor's loadout (or loadout and vault): Fane of the Wilds. */
  | { kind: "domainCards"; domain: DomainId; includeVault: boolean }
  /**
   * Rolled when the step resolves: "1d4 Stress", "clear 1d4 Hit Points". `keep: "highest"` for "the highest result rolled".
   * SD0 (NV12, widened): `keep: "countAtLeast"` counts the dice that rolled `atLeast` or higher (Deathless Embrace "clear a
   * Hit Point for each result of 4 or higher", HF p.13); without `atLeast` it counts every die.
   */
  | { kind: "dice"; dice: DiceExpr; keep?: "sum" | "highest" | "countAtLeast"; atLeast?: number }
  /** The total of the latest dice this use rolled (a `dice` source or a `check`): Thorn Skin "deal that amount of damage back". */
  | { kind: "lastRoll" }
  /** One value per tier (Bare Bones: "Tier 1: 9/19 • Tier 2: 11/24 …" as two sources). */
  | { kind: "byTier"; values: readonly [number, number, number, number] }
  /** Bare Bones: "3 + your Strength". */
  | { kind: "sum"; of: readonly NumberSource[] }
  /** Rage Up: twice your Strength for each time you Rage Up. */
  | { kind: "product"; of: readonly NumberSource[] }
  /** Cruel Precision: "equal to either your Finesse or Agility" (the better one). */
  | { kind: "max"; of: readonly NumberSource[] }
  /** Arithmetic on another source, applied in this order: times, divide (rounded), plus, then min / max. */
  | {
      kind: "calc";
      of: NumberSource;
      times?: number;
      divide?: number;
      round?: "down" | "up";
      plus?: number;
      min?: number;
      max?: NumberSource;
    };

/** Dice such as "d8+2 using your Proficiency" ({count: proficiency, sides: 8, plus: 2}) or "2d6" ({count: 2, sides: 6}). */
export interface DiceExpr {
  count: NumberSource;
  sides: DieSides;
  plus?: NumberSource;
  /**
   * SD0 (NV1, widened): the dice are the actor's own class die, whose size the sheet holds (Patron Dice, HF p.14: "roll a
   * number of Patron Dice equal to the Favor spent"; the Rally, Combo and Unstoppable dice). `sides` is then the size at
   * level 1, used when the sheet has none.
   */
  sidesOf?: HeldDieKind | "unstoppable";
}

/** How long a condition or effect lasts. Maps onto the sheet's `EFFECT_UNTIL` where one exists (src/lib/validation/characters.ts). */
export type Duration =
  /** "temporarily" (CB p.102): until the target clears it or the GM spends Fear to end it; the GM clears it in the tracker. */
  | "temporary"
  /** "until your next rest" (any rest). */
  | "rest"
  | "longRest"
  | "session"
  /** "until the end of the scene". */
  | "scene"
  /** Until the bearer is next hit or next attacked (the sheet's `hit`). */
  | "hit"
  /** "until the next time you make an action roll" (Vanishing Dodge, Spectral Mist, Inevitable's advantage). */
  | "nextRoll"
  /** Until a stated event the engine does not track (`endsWhen` says which); ended by hand. */
  | "manual"
  /** "permanently". */
  | "permanent";

/**
 * SD0 (NV5): events that end a lasting condition or effect besides its `Duration`, which still ends it too ("until you
 * take Severe damage or your next rest", Elemental Incarnation, CB p.30: duration `rest`, `endsOn: ["takeSevere"]`).
 * With duration `manual` only the events (and the End button) end it. The engine watches them (SD1, SD4, SD5, SD8):
 * - `takeSevere`: the bearer takes Severe damage (Patron's Mantle, HF p.14). `dealSevere`: the bearer deals Severe
 *   damage (Patron's Fury, HF p.15). `markHp`: the bearer marks a Hit Point (Night's Glamour, HF p.17).
 * - `rollWithFear`: the bearer rolls with Fear (Vanishing Act, CB p.42). `bearerFails`: the bearer fails a roll
 *   (Draining Bane's d12 attacks, HF p.14). `bearerMarksStress`: the bearer marks a Stress (Midnight Vine: "until it
 *   marks a Stress to clear this condition", HF p.9).
 * - `usedAgain`: the same feature is used again (Eye of the Storm, HF p.23). `dealDamage`: the bearer deals damage
 *   (Night's Glamour). `attackSucceeds`: the bearer's next successful attack (Menacing Reach, HF p.15). `lastHp`: the
 *   bearer marks their last Hit Point (Beastform, CB p.30; martial stances, HF p.12). `majorDamage`: the bearer takes
 *   Major or greater damage (the "Fragile" Beastforms, CB p.32).
 */
export type EndEvent =
  | "takeSevere"
  | "dealSevere"
  | "markHp"
  | "rollWithFear"
  | "bearerFails"
  | "bearerMarksStress"
  | "usedAgain"
  | "dealDamage"
  | "attackSucceeds"
  | "lastHp"
  | "majorDamage";

/** The conditions the encounter tracker and the sheet already know (src/lib/validation/characters.ts, convex/lib/validators/encounters.ts). */
export type StandardCondition = "vulnerable" | "restrained" | "hidden" | "distracted" | "cloaked" | "unconscious";

/**
 * A condition a step gives or tests. Card-specific ones (Enraptured, Stunned, On Fire, Asleep, Silenced, Horrified,
 * Corroded, Chained, Invisible, Spectral, Banished, …) are a `tag`, which lands in the instance's GM `tags` (or the
 * sheet effect's text); `implies` lists the standard conditions the tag carries (Horrified: "While Horrified, they're
 * Vulnerable").
 */
export type ConditionRef =
  | { kind: "standard"; condition: StandardCondition }
  | { kind: "tag"; tag: string; implies?: readonly StandardCondition[] };

/** Which weapon an attack or damage uses. `either`: the player picks primary or secondary ("one of your active weapons"). */
export type WeaponRef = "primary" | "secondary" | "either";

/**
 * SD0 (NV9): a creature a defence or bonus is keyed to, read from the map and the sheet when the attack resolves:
 * - `tagged`: the creature carrying the actor's tag (Ranger's Focus, Marked for Death; the instance's GM `tags`).
 * - `hexed`: a creature the actor Hexed (`classState.hexes`, Vexing Malison, HF p.16).
 * - `inCompanionReach`: a creature within Melee range of the actor's companion (Battle-Bonded, CB p.38).
 * - `damagedAlly`: the adversary that damaged an ally within `range` of the actor (Act of Reprisal, Q8: the ally is
 *   within Melee of the Guardian, CB p.36).
 */
export type CreatureKey =
  | { kind: "tagged"; tag: string }
  | { kind: "hexed" }
  | { kind: "inCompanionReach" }
  | { kind: "damagedAlly"; range: Range };

/** Which rolls a modifier or trigger concerns. */
export type RollFilter = "any" | "action" | "attack" | "weaponAttack" | "spellcast" | "reaction" | "damage" | TraitId;

// ---------------------------------------------------------------- targets

/** How many targets a use may pick. */
export type TargetCount =
  | { kind: "one" }
  | { kind: "upTo"; n: NumberSource }
  /** "all targets within Close range": every eligible creature, picked by the server (R9). */
  | { kind: "all" }
  /** "any targets", "a number of targets equal to the Hope spent": the player picks, at most `max`. */
  | { kind: "any"; max?: NumberSource };

/**
 * Who a use or a step can pick (CB p.104: "you can choose any that fall within the parameters of the effect").
 * Ranges are measured from the actor unless `area` says otherwise.
 */
export interface TargetSpec {
  /** `enemy`: adversaries for a PC (PCs for an adversary); `point` and `object` pick a map square or a thing (prompts). */
  side: "self" | "ally" | "selfOrAlly" | "enemy" | "any" | "point" | "object";
  /** `weapon`: "within your weapon's range"; `unlimited`: no range on the card. */
  range: Range | "weapon" | "unlimited";
  count: TargetCount;
  /**
   * The shape, when the card names one: `aroundSelf` / `aroundPoint` / `aroundTarget` (everything within
   * `areaRange` of it; Fireball: "the target and all creatures within Very Close range of them"), `front` ("in front
   * of you"), `line` ("a line of allies"), `path` (Deathrun), `between` ("all adversaries between you and the target").
   */
  area?: "aroundSelf" | "aroundPoint" | "aroundTarget" | "front" | "line" | "path" | "between";
  /** Radius of `aroundPoint` / `aroundTarget` (CB p.104 groups: Very Close of a point). */
  areaRange?: Range;
  /** "a target you can see": line of sight is required even where Q2 would only warn. */
  sight?: boolean;
  /** "willing creatures", "a willing ally". */
  willing?: boolean;
  /** "another", "other than yourself". */
  excludeSelf?: boolean;
  /** "who aren't flying" (Earthquake). */
  excludeFlying?: boolean;
  /** Disintegration Wave: "adversaries … that have a Difficulty of 18 or lower" (the server filters; players see no number, U1). */
  maxDifficulty?: number;
  /**
   * SD0 (NV13, widened): only the actor's companion fits (Q4: the Beastbound companion's ally token next to the ranger's
   * PC token). With `side: "ally"`: "your companion" (Loyal Friend, CB p.38). A recipient `picked` with this spec is the
   * companion recipient.
   */
  companion?: boolean;
  /**
   * SD0 (NV10, widened): "+1 range" steps on this spec's `range` for this use (Manipulate Magic, CB p.47: "Extend the
   * spell or attack's reach by one range"). The weapon's own range changes through a `range` mod instead.
   */
  rangeSteps?: number;
}

/** The use acts on the trigger's creature instead of picked targets (Encore: "against that same target"; Rapid Riposte: the attacker). */
export interface TriggerTargets {
  side: "trigger";
  who: "source" | "subject";
}

// ---------------------------------------------------------------- rolls

/** Against what a roll is compared. `evasion`: an adversary's roll against a PC (AR1). */
export type Difficulty =
  | { kind: "target" }
  | { kind: "fixed"; value: number }
  | { kind: "evasion" }
  /** No number on the card ("Make a Spellcast Roll" to command, levitate, interrupt): the GM sets it (CB p.157). */
  | { kind: "gm" };

/** The move's own roll, made once for all targets (R1, R9). */
export type RollSpec = (
  | { kind: "spellcast"; difficulty: Difficulty }
  /** "make a Presence Roll against them", "an Agility Roll against all targets". Several traits: the player picks. */
  | { kind: "trait"; trait: TraitId | readonly TraitId[]; difficulty: Difficulty }
  /** A weapon attack (uses the weapon's trait; CB p.96). */
  | { kind: "attack"; weapon: WeaponRef; difficulty: Difficulty }
  /** "a reaction roll using your Spellcast trait" (Counterspell, Hideous Retribution): no Hope or Fear (CB p.99). */
  | { kind: "reaction"; trait: TraitId | "spellcast"; difficulty: Difficulty }
  /** An adversary's d20 + Attack Modifier against Evasion (AR1; AA0). */
  | { kind: "adversaryAttack"; difficulty: Difficulty }
) & {
  advantage?: boolean;
  disadvantage?: boolean;
  /** A bonus or penalty to the roll ("gain a +3 bonus"). */
  modifier?: NumberSource;
};

/** The Difficulty of a reaction roll the recipients make (a `save` step). */
export type SaveDifficulty =
  | { kind: "fixed"; value: number }
  /** Chain Lightning: "a Difficulty equal to the result of your Spellcast Roll". */
  | { kind: "rollTotal" }
  /** Banish: "a Difficulty equal to your highest result" of the d20s rolled. */
  | { kind: "number"; value: NumberSource }
  /** An adversary feature with no number uses the adversary's own Difficulty (CB p.193). */
  | { kind: "actorDifficulty" };

/** How a `check` step reads its dice. */
export type CheckTest =
  | { kind: "anyAtLeast"; value: number }
  | { kind: "allAtMost"; value: number }
  | { kind: "totalAtLeast"; value: number }
  | { kind: "totalAtMost"; value: number };

// ---------------------------------------------------------------- costs, limits, requirements

/**
 * SD0 (NV1): the pool a `tokens` cost spends from. `card` (the default) is the tokens on this card or feature (sheet
 * `cardTokens`); `favor` is Warlock Favor ("spend a Favor", HF p.14); `focus` is the Martial Artist's Focus ("spend a
 * Focus", HF p.11-12); a held-die kind spends that many held dice of the kind (Prayer Dice, CB p.44; Rally Dice, CB p.28;
 * Slayer Dice, CB p.48), whose values a `spent` `heldDie` number reads.
 */
export type TokenPool = "card" | "favor" | "focus" | HeldDieKind;

/** A price. Upfront costs are paid before the roll (and refuse the use when unaffordable, CARD_COST_UNPAID). */
export type Cost =
  /** "spend a Hope", "spend any number of Hope" (amount `chosen`). Hope gained on the same roll may pay (R8, CB p.90). */
  | { kind: "hope"; amount: NumberSource }
  /** "mark a Stress". */
  | { kind: "stress"; amount: NumberSource }
  /** "mark a Hit Point" (Shared Trauma; adversary "Mark a HP"). */
  | { kind: "hp"; amount: NumberSource }
  /** "mark an Armor Slot" (Grace-Touched). */
  | { kind: "armor"; amount: NumberSource }
  /** "spend a token from this card". SD0 (NV1, widened): `pool` names another pool to spend from (`TokenPool`). */
  | { kind: "tokens"; amount: NumberSource; pool?: TokenPool }
  /** "Spend a Fear" (AA0: adversary features, CB p.194). */
  | { kind: "fear"; amount: NumberSource }
  /** "Spend 3 handfuls of gold" (AA0). */
  | { kind: "gold"; handfuls: number }
  /** "spend a Hope or mark a Stress": the payer picks one option (each option is a list of costs paid together). */
  | { kind: "either"; options: readonly (readonly Cost[])[] };

/**
 * A usage limit (CB p.101). The use is recorded in the sheet's `featureUses` under `card:<cardId>` (or
 * `card:<cardId>:<useId>` for a limit on one use or option) with `until` = `per` (Q3).
 */
export interface Limit {
  per: "rest" | "longRest" | "session" | "scene";
  /** Uses per period; default 1 ("Up to three times per scene"). */
  times?: number;
  /**
   * When the use counts: `use` (default), `success` ("Once per rest on a success", Q4: only a success uses it up), or
   * `failure` (Banish: "Once per rest on a failure, they are banished").
   */
  consumedOn?: "use" | "success" | "failure";
  /** Counted per target (Healing Hands: "You can't heal the same target again until your next long rest"). */
  perTarget?: boolean;
}

/** A state the use needs. `situation` covers what the engine cannot see; the player confirms it (shown as a check box). */
export type Requirement =
  /** The "-Touched" cards: "When 4 or more of the domain cards in your loadout are from the Arcana domain". */
  | { kind: "loadoutDomainCount"; domain: DomainId; min: number }
  /** "While you're wearing armor" (`worn: true`), "When you choose not to equip armor" (`worn: false`). */
  | { kind: "armor"; worn: boolean }
  /** On the Brink: "When you have 2 or fewer Hit Points unmarked". */
  | { kind: "hpUnmarkedAtMost"; value: number }
  /** Voice of Reason: "When all of your Stress slots are marked". */
  | { kind: "stressFull" }
  /** Swift Step: "If you can't clear a Stress" (`stress`, atMost 0). */
  | { kind: "trackMarked"; track: Track; atLeast?: number; atMost?: number }
  /** Midnight-Touched: "when you have 0 Hope". */
  | { kind: "hopeAtMost"; value: number }
  /** Arcane Door: "When you have no adversaries within Melee range". */
  | { kind: "noEnemyWithin"; range: Range }
  /** A sheet effect this card created is active (Force of Nature's form, Twilight Toll's target, Smite charged). */
  | { kind: "effectActive"; cardId: string }
  /**
   * "While you're shrouded in low light", "behind a creature who's about your size", "in a natural environment".
   * SD0 (NV7, widened): `check` is a state the engine can read itself (Vulnerable, flying, Channeling Fire, in
   * Beastform, at least 2 Hope, the roll used an Experience). A runner that reads `check` decides it and shows no check
   * box; one that does not yet falls back to the player's confirmation of `text` (Q13), so `text` always says it in words.
   */
  | { kind: "situation"; text: string; check?: StateCheck };

/**
 * SD0 (NV7): engine-readable states for a `situation` requirement (and so for a `requires` gate). "You" is the actor;
 * `subject` is the trigger's subject (Loyal Protector, CB p.36: "an ally within Close range has 2 or fewer Hit Points
 * unmarked").
 */
export type StateCheck =
  /** Adrenaline (CB p.42): "While you're Vulnerable". `who: "target"` for a per-target reading. */
  | { kind: "hasCondition"; condition: ConditionRef; who?: "self" | "target" | "subject" }
  /** "While flying" (Q16: the drawer's Flying toggle, a sheet effect with the `flying` flag). */
  | { kind: "flying" }
  /** A sheet effect a feature created is active, optionally with one of its options (Elemental Incarnation's "Channeling Fire"). */
  | { kind: "featureEffect"; featureId: string; option?: string }
  /** "While in Beastform" (Defender, CB p.31); `formId` narrows it to one form. */
  | { kind: "inBeastform"; formId?: string }
  /** Conjure Shield (CB p.51): "While you have at least 2 Hope". */
  | { kind: "hopeAtLeast"; value: number }
  /** Loyal Protector: the trigger's subject "has 2 or fewer Hit Points unmarked". */
  | { kind: "hpUnmarkedAtMost"; value: number; who: "self" | "subject" | "target" }
  /** Adaptability (CB p.65): "When you fail a roll that utilized one of your Experiences". */
  | { kind: "rollUsedExperience" }
  /** A martial stance is the active stance (Q5, HF p.12): the stance tables gate on it. */
  | { kind: "activeStance"; stance: string }
  /** Inside a live map area a feature drew (Q14: Circle of Power, Moonbeam; `owner: "self"` only the actor's own areas). */
  | { kind: "inArea"; featureId: string; owner?: "self" | "any" }
  /** No other creature within `range` of you or the target (the Isolating stance, HF p.12). */
  | { kind: "isolated"; range: Range; who: "self" | "selfOrTarget" };

// ---------------------------------------------------------------- triggers

/**
 * What sets off a reaction, a rider or an automatic effect. The reaction window of an adversary hit (Q13, Q17)
 * offers every loadout card whose trigger matches: `whenAllyWouldTakeDamage` (allies) and `whenYouWouldTakeDamage`
 * / `whenAttacked` (the target), before the damage resolves.
 */
export type Trigger =
  /** I Am Your Shield: "When an ally within Very Close range would take damage" (before it resolves). */
  /** `includeSelf`: Arcane Deflection's "an attack targeting you or an ally within Very Close range". */
  | { kind: "whenAllyWouldTakeDamage"; range: Range; includeSelf?: boolean }
  /** Hideous Retribution: "When an ally within Close range takes damage from a target you can see" (after it resolves). */
  | { kind: "whenAllyTakesDamage"; range: Range; sourceInSight?: boolean; sourceWithin?: Range | "weapon" }
  /** "When you would take magic damage" (Arcane Reflection), "When you take Severe damage" (Get Back Up), "When you take damage" (Thorn Skin). */
  | { kind: "whenYouWouldTakeDamage"; damageType?: DamageType; severity?: Severity; from?: "melee" | "beyondMelee" }
  /** After the damage is marked: Spellcharge ("When you take magic damage, place tokens equal to the number of Hit Points you marked"). */
  | { kind: "whenYouTakeDamage"; damageType?: DamageType; severity?: Severity }
  /**
   * An attack against you. `stage`: `targeted` (I See It Coming, before the roll), `rolled` (Umbral Veil: "After an
   * attack roll is made against you"), `succeeded` (Bone-Touched), `failed` (Rapid Riposte, Redirect, Swift Step,
   * Vanishing Dodge). `from` and `damageType` narrow it.
   */
  | {
      kind: "whenAttacked";
      stage: "targeted" | "rolled" | "succeeded" | "failed";
      from?: "melee" | "beyondMelee";
      damageType?: DamageType;
    }
  /** Reassurance, Support Tank, Lean on Me: "after an ally attempts an action roll"; `includeSelf` for "you or a willing ally". */
  | { kind: "afterAllyRolls"; range?: Range; result?: "any" | "failure" | "withFear"; includeSelf?: boolean }
  /** Your own finished roll: Inevitable ("When you fail an action roll"), Arcana-Touched (switch the Hope and Fear Dice), Premonition. */
  | { kind: "afterYouRoll"; roll: RollFilter; result?: "any" | "success" | "failure" | "withHope" | "withFear" | "critical" }
  /** Before your roll: Rage Up ("Before you make an attack"), Codex-Touched, Sage-Touched, Notorious. */
  | { kind: "beforeYouRoll"; roll: RollFilter }
  /**
   * Your attack resolved: Body Basher (success, melee weapon), Champion's Edge (critical), Glancing Blow (failure).
   * SD0 (NV6, widened): `successWithFear` (Face Your Fear, CB p.51: "When you succeed with Fear on an attack roll");
   * `firstInScene` ("The first time in a scene you succeed on an attack", First Strike, HF p.8; Q7).
   */
  | {
      kind: "whenYouAttack";
      result: "any" | "success" | "failure" | "critical" | "successWithHope" | "successWithFear";
      weapon?: boolean;
      weaponRange?: Range;
      firstInScene?: boolean;
    }
  /** Your move dealt damage: Healing Strike, Lead by Example, Jump Scare (magic), Natural Familiar (near the familiar). */
  | { kind: "whenYouDealDamage"; damageType?: DamageType; toEnemy?: boolean }
  /** Encore: "When an ally within Close range deals damage to an adversary". */
  | { kind: "whenAllyDealsDamage"; range: Range }
  /**
   * Ferocity, Dire Strike: "When a target marks any number of Hit Points from an attack you make".
   * SD0 (NV6, widened): `severity` narrows it to the damage's severity (Death Strike, HF p.8: "When you deal Severe damage").
   */
  | { kind: "whenTargetMarksHp"; severity?: Severity }
  /**
   * Never Upstaged, Rise Up (`fromAttack`), Valor-Touched (`withoutArmor`), Unbreakable (`last`: "When you mark your last Hit Point").
   * SD0 (NV6, widened): `sourceWithin` (Eye for an Eye, HF p.10: "an adversary within Melee range makes you mark Hit Points").
   */
  | { kind: "whenYouMarkHp"; fromAttack?: boolean; withoutArmor?: boolean; last?: boolean; sourceWithin?: Range }
  /** Brace, Unyielding Armor: "When you mark an Armor Slot to reduce incoming damage". `who: "ally"` for Forest Sprites. */
  | { kind: "whenArmorSlotMarked"; who: "self" | "ally" }
  /** Battle-Hardened ("when you would make a Death Move"), Life Ward (`ally`). */
  | { kind: "wouldMakeDeathMove"; who: "self" | "ally" }
  /**
   * Savor the Anguish: "When an adversary within Close range takes Severe damage".
   * SD0 (NV6, widened): `byYou` (only damage the actor dealt: Ruthless Predator, CB p.39: "when you deal Severe damage").
   */
  | { kind: "whenEnemyTakesDamage"; range?: Range; severity?: Severity; byYou?: boolean }
  /** Gore and Glory ("when you deal enough damage to defeat an enemy"), Invoke Torment (`fullStress`). */
  | { kind: "whenEnemyDefeated"; byYou: boolean; range?: Range; fullStress?: boolean }
  /** Bold Presence: "when you would gain a condition". */
  | { kind: "wouldGainCondition" }
  /** Midnight-Touched: "the GM would gain a Fear"; Dread-Touched prevents the gain. */
  | { kind: "gmWouldGainFear" }
  /** Avatar of Terror: "when the GM spends a Fear to spotlight an adversary within Very Close range". */
  | { kind: "gmSpendsFear"; purpose?: "spotlight"; range?: Range }
  /** Invigoration: "When you or an ally within Close range has used a feature that has an exhaustion limit". */
  | { kind: "featureExhausted"; range: Range }
  /** Counterspell, Repudiate: "interrupt a magical effect taking place". */
  | { kind: "magicalEffect" }
  /** Shared Clarity, Transcendent Union: "when a creature connected by this union would mark Stress or Hit Points". */
  | { kind: "linkedWouldMark"; track: "stress" | "hpOrStress" }
  /** Token set-up: "At the beginning of a session", "After a long rest", "When you take a rest". */
  | { kind: "timing"; at: "sessionStart" | "sessionEnd" | "afterRest" | "afterLongRest" | "sceneEnd" }
  // ---- SD0 (NV6): sheet-drawer triggers
  /**
   * "When you would mark a Stress" (Unshakable, CB p.59: roll a d6, on a 6 don't); `forced`: Brave Face (HF p.32: "when
   * you would be forced to mark a Stress").
   */
  | { kind: "wouldMarkStress"; forced?: boolean }
  /** After Stress is marked: `last` = "When you mark your last Stress" (Howling Rampage, HF p.40). */
  | { kind: "whenYouMarkStress"; last?: boolean }
  /**
   * An attack aimed at a creature: `subject` who is attacked (you, an ally, either), `subjectWithin` how close to you they
   * must be, `attackerWithin` how close the attacker must be to you. `stage` as `whenAttacked` (`targeted` is before the
   * roll, Q2). Harrowing Invocation (HF p.14): "When an adversary targets you or an ally within Very Close range with an
   * attack"; Not This Time (CB p.50, Q3): any adversary attack, the attacker within Far.
   */
  | {
      kind: "whenCreatureAttacked";
      subject: "self" | "ally" | "selfOrAlly";
      subjectWithin?: Range;
      attackerWithin?: Range;
      stage: "targeted" | "rolled" | "succeeded" | "failed";
    }
  /** An enemy's attack fails, whoever it targeted; `source` narrows the attacker (Ire of Pale Light, HF p.17: a Hexed creature within Very Far). */
  | { kind: "whenEnemyFailsAttack"; range?: Range; source?: CreatureKey }
  /** Attack of Opportunity (CB p.48): "If an adversary within Melee range attempts to leave that range". */
  | { kind: "whenEnemyLeavesRange"; range: Range }
  /** Honed Expertise (CB p.50): "When you use an Experience". */
  | { kind: "whenYouUseExperience" }
  /** Wolf Form (HF p.40): "When you gain a Hope while in Wolf Form". */
  | { kind: "whenYouGainHope" }
  /** Maestro (CB p.28): "When you give a Rally Die to an ally". */
  | { kind: "whenYouGiveDie"; die: HeldDieKind }
  /** An ally Helps you or you Help an ally (Enchanted Aid, CB p.47: "When you Help an Ally with a Spellcast Roll"; Q12). */
  | { kind: "whenHelping"; roll?: RollFilter };

/**
 * How a use is started.
 * - `action`: a Use button (on the Hand), used against the picked targets.
 * - `reaction`: a Use / Pass prompt when `trigger` happens (the reaction window, Q13).
 * - `rider`: an add-on offered inside the actor's own roll when `trigger` matches (a toggle in the attack dialog:
 *   Rage Up, Reckless, Champion's Edge). It changes that move instead of making a new one.
 * - `auto`: happens by itself when `trigger` happens (Swift Step, Rise Up's Stress); no prompt.
 * - `passive`: always on while the requirements hold; only `mods` (Untouchable, Fortified Armor).
 */
export type Activation =
  | { kind: "action" }
  | { kind: "reaction"; trigger: Trigger }
  | { kind: "rider"; trigger: Trigger }
  | { kind: "auto"; trigger: Trigger }
  | { kind: "passive" };

// ---------------------------------------------------------------- modifiers (sheet effects, adversary modifiers)

/** Stats an effect can move. The sheet stores `evasion`, `attack`, `damage` and traits as `mods` today; the rest show as text until the sheet reads them. */
export type ModStat =
  | "evasion"
  | "attack"
  | "damage"
  | "armorScore"
  | "majorThreshold"
  | "severeThreshold"
  | "proficiency"
  | "spellcast"
  | "difficulty"
  | "actionRoll"
  /** Chains of Affliction: "the target of their attack marks one fewer Hit Point" (delta −1 on the bearer's hits). */
  | "hpMarked"
  // ---- SD0 (NV10): ranges, as steps along the Defined Ranges (Melee 0, Very Close 1, Close 2, Far 3, Very Far 4; CB p.103)
  /** Menacing Reach (HF p.15): "increase the range of your primary weapon by one step" (`stat`, delta 1). */
  | "primaryRange"
  /**
   * Spirit Weapon (CB p.44): "When you have an equipped weapon with a range of Melee or Very Close, it can fly from your
   * hand to attack an adversary within Close range" (`set` to 2).
   */
  | "meleeWeaponRange"
  /**
   * Giant Reach (CB p.62): "Treat any weapon, ability, spell, or other feature that has a Melee range as though it has a
   * Very Close range instead" (`set` to 1).
   */
  | "meleeRange"
  // ---- SD0 (NV14): what a PC puts on an adversary's own rolls
  /** Draining Bane (HF p.14): "the target uses a d12 instead of a d20 for attack rolls" (`set` to 12). */
  | "attackDie"
  /** Arcane Charge (CB p.47): "a +3 bonus to the Difficulty of a reaction roll the spell causes the target to make" (`stat`, 3). */
  | "reactionDifficulty"
  // ---- SD0 (NV19): table moves
  /** Epic Poetry (CB p.29): "when you Help an Ally, … roll a d10 as your advantage die" (`set` to 10); Q12. */
  | "helpDie"
  /** Camaraderie (CB p.48): "You can initiate a Tag Team Roll one additional time per session" (`stat`, delta 1). */
  | "tagTeamUses"
  /** Camaraderie: "when an ally initiates a Tag Team Roll with you, they only need to spend 2 Hope" (`set` to 2). */
  | "tagTeamAllyCost"
  /** Herbal Remedies (HF p.16): a consumable's clear of Hit Points or Stress: "increase the number cleared by 1" (`stat`, 1). */
  | "consumableClear";

/**
 * SD0 (NV9): a modifier that holds only against one creature: `attacksByThem` (Elusive Predator, CB p.39: "When your
 * Focus makes an attack against you, you gain a +2 bonus to your Evasion against the attack") or `attacksAgainstThem`
 * (Vexing Malison, HF p.16: "You have advantage on attacks against Hexed creatures").
 */
export interface Versus {
  creature: CreatureKey;
  on: "attacksByThem" | "attacksAgainstThem";
}

/**
 * A modifier carried by an `effect` step or a passive use.
 * SD0 (widened): `versus` (NV9) on `stat`, `advantage` and `disadvantageAgainst` keys the modifier to one creature;
 * `choice` (NV15) on `trait` makes the trait the one the player picked in that `choices` / `choose` id ("choose one trait
 * to raise by +1", Evolution, CB p.30; `trait` is then the default shown before the pick).
 */
export type Mod =
  | { kind: "stat"; stat: ModStat; delta: NumberSource; versus?: Versus }
  | { kind: "trait"; trait: TraitId | "all"; delta: NumberSource; choice?: string }
  /** Overwhelming Aura: "make your Presence equal to your Spellcast trait"; Bare Bones' base Armor Score and thresholds. */
  | { kind: "set"; stat: ModStat | TraitId; to: NumberSource }
  /** "make attack rolls with advantage", "your allies gain advantage on attack rolls". */
  | { kind: "advantage"; on: RollFilter; versus?: Versus }
  /** "attack rolls against them are made with disadvantage" (Invisibility, Eclipse). */
  | { kind: "disadvantageAgainst"; on: RollFilter; versus?: Versus }
  /** "resistance to physical damage" (Rejuvenation Barrier), "immune to magic damage" (Book of Yarrow), CB p.99. */
  | { kind: "resistance"; type: DamageType | "both"; level: "resistant" | "immune" }
  /** Rules switches: Frenzy ("you can't use Armor Slots"), Force of Nature ("You can't be Restrained"), Wild Fortress, Stunned, Silenced. */
  | {
      kind: "flag";
      flag:
        | "noArmorSlots"
        | "cannotBeRestrained"
        | "cannotBeTargeted"
        | "cannotAttack"
        | "cannotReact"
        | "cannotAct"
        | "silenced"
        | "flying"
        /** Blighting Strike: "The target's next successful attack deals half damage" (with duration `hit`). */
        | "halfDamage"
        /** On the Brink: "you don't take Minor damage". */
        | "noMinorDamage"
        // ---- SD0 (NV7, NV14): sheet-drawer switches
        /** Retract (CB p.61): "you have disadvantage on action rolls"; Feed with no tokens (HF p.39). */
        | "actionDisadvantage"
        /** Midnight Vine (HF p.9): "The target has disadvantage on attack rolls". */
        | "attackDisadvantage"
        /** Corpse Thorn (HF p.9): "The target gains disadvantage on reaction rolls"; Feed with no tokens. */
        | "reactionDisadvantage"
        /** Night's Glamour (HF p.17): "adversaries within Close range must mark a Stress to attack you". */
        | "attackersMarkStress"
        /** Surefooted (CB p.63): "You ignore disadvantage on Agility Rolls". */
        | "ignoreAgilityDisadvantage"
        /** The Anchored stance (HF p.12): "you can't be moved against your will". */
        | "cannotBeMoved"
        /** Retract (CB p.61): "you can't move". */
        | "cannotMove"
        /** Beastform (CB p.30): "you can't use weapons or cast spells from domain cards" (Q10). */
        | "noWeaponsOrSpells"
        /** Ephemeral (HF p.36): the bearer takes double magic damage. */
        | "doubleMagicDamage";
    };

// ---------------------------------------------------------------- damage

/** Where a damage roll's dice come from (R2, CB p.98). */
export type DamageRoll =
  /** Card dice: "d8+2 magic damage using your Proficiency", "1d20+3", "2d6". */
  | { kind: "dice"; dice: DiceExpr }
  /**
   * The weapon's damage dice x Proficiency (CB p.98). `proficiency`: Deathrun "+1 bonus to your Proficiency" (`{delta: 1}`),
   * Glancing Blow "using half your Proficiency" (`"half"`).
   */
  | { kind: "weapon"; weapon: WeaponRef; proficiency?: "half" | { delta: number } }
  /** An adversary's printed standard attack damage (AA0; Horde X is applied by the engine). */
  | { kind: "standardAttack" }
  /** A number, not dice: Minion "deal X damage each", Night Terror (d6s per stolen Fear) through `dice`/`calc` sources. */
  | { kind: "flat"; amount: NumberSource }
  /** Encore: "you deal the same damage to the target that your ally dealt". */
  | { kind: "sameAsTrigger" }
  /** The damage this move already rolled (R9: rolled once): Whirlwind's other targets take it, halved by `scale`. */
  | { kind: "sameAsMove" };

/** A change to the damage of the move it rides on (riders and options). */
export type DamageChange =
  /**
   * "gain a bonus to your damage roll equal to your Strength", "add a d10 to the damage roll", "+10 bonus to your damage rolls".
   * SD0 (NV8, widened): `type` makes the added damage that type (Face Your Fear, CB p.51: "deal an extra 1d10 magic damage").
   */
  | { kind: "add"; amount: NumberSource; type?: DamageType }
  /** Smite: "double the result of your damage roll"; Invoke Torment: "double damage". */
  | { kind: "multiply"; factor: 2 }
  /** Whirlwind's additional targets, Blighting Strike's "next successful attack deals half damage". */
  | { kind: "halve" }
  /** Siphon Essence: "a +1 bonus to your Proficiency for this attack". */
  | { kind: "proficiency"; delta: number }
  /** Not Good Enough: "reroll any 1s or 2s". */
  | { kind: "reroll"; atMost: number }
  /** Versatile Fighter: "use the maximum result of one of your damage dice instead of rolling it". */
  | { kind: "maxDice"; count: number }
  /** Smite: "This attack deals magic damage regardless of the weapon's damage type". */
  | { kind: "type"; type: DamageType }
  /** Onslaught: "you never deal damage beneath a target's Major damage threshold". */
  | { kind: "minimumSeverity"; severity: Severity }
  /** Battle Monster: "force the target to mark a number of Hit Points … instead of rolling for damage". */
  | { kind: "replaceWithHp"; amount: NumberSource }
  // ---- SD0 (NV8): sheet-drawer damage changes
  /**
   * Reroll the damage dice the player picks (Volatile Magic, CB p.46: "reroll any number of your damage dice"); with
   * `below`, every die under that number (Deadly Raptor, CB p.35: "reroll all damage dice that rolled a result lower than
   * your Proficiency"). The new result stands (CB p.107).
   */
  | { kind: "rerollChosen"; below?: NumberSource }
  /**
   * `matching`: Sacred Resonance (CB p.44): "If any of the die results match, double the value of each matching die".
   * `chosen`: Manipulate Magic (CB p.47): "Double a damage die of your choice" (`count` dice, default 1).
   */
  | { kind: "doubleDice"; which: "matching" | "chosen"; count?: number }
  /** Weapon Specialist (CB p.48): "add one of the damage dice from your secondary weapon to the damage roll". */
  | { kind: "addWeaponDie"; weapon: "primary" | "secondary" }
  /** The Aggressive stance (HF p.12): "roll an additional damage die and discard the lowest result". */
  | { kind: "extraDie"; drop: "lowest" }
  /**
   * A damage die that rolled a 1: `asMax` (the Exacting stance, HF p.12: "treat it as the highest value on the die") or
   * `add` (Rampage, CB p.33: "roll a d10 and add the result to the damage roll").
   */
  | { kind: "ones"; asMax?: boolean; add?: DiceExpr }
  /** Mythic Beast (CB p.35): "Your damage die increases by one size (d6 becomes d8, d8 becomes d10, etc.)". */
  | { kind: "dieSize"; steps: number };

/** A change to a roll: the move's own roll (riders) or the trigger's roll (reactions). */
export type RollChange =
  /**
   * Reassurance ("your ally can reroll their dice"), Support Tank (`hopeOrFear`), Endless Charisma.
   * SD0 (NV8, widened): `ifAtMost` rerolls only a die at or under the number (Internal Compass, CB p.64: "When you roll a
   * 1 on your Hope Die, you can reroll it"); `advantage` rerolls with advantage (Patron's Boon, HF p.14: "reroll with
   * advantage").
   */
  | { kind: "reroll"; dice: "all" | "hope" | "fear" | "hopeOrFear"; ifAtMost?: number; advantage?: boolean }
  /** Arcana-Touched: "switch the results of your Hope and Fear Dice". */
  | { kind: "swapDuality" }
  /** Adjust Reality: "change the numerical result of that roll to a result of your choice" (plausible for the dice). */
  | { kind: "setResult" }
  /** A bonus or penalty: Umbral Veil "a −1 penalty per token spent", Codex-Touched "+Proficiency", Fane of the Wilds. */
  | { kind: "add"; amount: NumberSource }
  /** I See It Coming: "gain a bonus to your Evasion equal to the result against the attack". */
  | { kind: "evasion"; amount: NumberSource }
  /** Stealth Expertise: "roll with Hope instead". */
  | { kind: "withHope" }
  /** Bone-Touched: "cause an attack that succeeded against you to fail instead"; Confusing Aura. */
  | { kind: "fail" }
  /** Signature Move, Tactician: "roll a d20 as your Hope Die". */
  | { kind: "hopeDie"; sides: DieSides }
  /** Sage-Touched: "double your Agility or Instinct when making a roll that uses that trait". */
  | { kind: "doubleTrait"; trait: TraitId }
  /** Reckless: "gain advantage on an attack"; Inevitable: "your next action roll has advantage". */
  | { kind: "advantage" }
  /** Premonition: "rescind the move and consequences like they never happened". */
  | { kind: "rescind" }
  // ---- SD0 (NV8): sheet-drawer roll changes
  /**
   * The roll's result becomes this outcome: True Strike (HF p.8: "to make it a success instead"), Witch's Charm (HF p.16:
   * "to change it into a success with Fear instead").
   */
  | { kind: "setOutcome"; outcome: "success" | "successWithFear" | "successWithHope" }
  /**
   * Contacts Everywhere (CB p.43): "a +3 bonus to the result of your Hope or Fear Die" (`die` picked by the player when
   * `hopeOrFear`).
   */
  | { kind: "dieBonus"; die: "hope" | "fear" | "hopeOrFear"; amount: NumberSource }
  /** Feed (HF p.39): "make your Fear Die a d20". */
  | { kind: "fearDie"; sides: DieSides }
  /**
   * An Experience used on the roll: `payWithStress` (Adept, CB p.50: "mark a Stress instead of spending a Hope", with
   * `double`: "double its modifier"), `freeOnCheck` (Honed Expertise, CB p.50: "roll a d6. On a result of 5 or higher,
   * you can use it without spending Hope"), `borrowAlly` (Found Family, HF p.31: use an ally's Experience).
   */
  | {
      kind: "experience";
      change: "payWithStress" | "freeOnCheck" | "borrowAlly";
      double?: boolean;
      check?: { sides: DieSides; atLeast: number };
    };

// ---------------------------------------------------------------- steps

/**
 * Who an outcome lands on.
 * - `self`: the actor.
 * - `targets`: each target of the use that the step's gates let through (with `hit`: those the roll beat).
 * - `picked`: the step's own `pick` (Vicious Entangle: "another adversary within Very Close range of your target";
 *   Healing Strike: "an ally within Close range").
 * - `triggerSource`: whoever caused the trigger (the attacker; the creature that dealt damage).
 * - `triggerSubject`: whom the trigger happened to (the ally who would take damage; the ally who rolled).
 * - `allies`: the actor's allies in the step's `pick` area; `selfAndAllies`: the actor too ("you and all allies").
 */
export type Recipient = "self" | "targets" | "picked" | "triggerSource" | "triggerSubject" | "allies" | "selfAndAllies";

/**
 * A condition for a step. All gates of a step must hold. Per-target gates (`hit`, `targetMarkedHp`, …) filter the
 * recipients; move gates (`success`, `withFear`, …) test the move's roll. `critical` counts as a success with Hope (CB p.90).
 */
export type Gate =
  | "success"
  | "failure"
  | "critical"
  | "withHope"
  | "withFear"
  /** The roll met this target's Difficulty (or Evasion), or was critical (R1). */
  | "hit"
  | "miss"
  /** The target marked 1+ HP from this move (Summon Horror: "If the target marks any Hit Points from this attack"). */
  | "targetMarkedHp"
  /** Damnation: "If this attack defeats the target". */
  | "targetDefeated"
  /** Invoke Torment: "targets that have all their Stress marked". */
  | "targetStressFull"
  /** Rain of Blades: "If a target you hit is Vulnerable". */
  | { kind: "targetHas"; condition: ConditionRef }
  /** The player picked option `option` of choose step / choice `choice`. */
  | { kind: "chosen"; choice: string; option: string }
  | { kind: "requires"; requirement: Requirement };

interface StepBase {
  when?: readonly Gate[];
  /** A short reading of the card for the feed and the task docs. */
  note?: string;
}

interface OutcomeBase extends StepBase {
  to: Recipient;
  /** The targets of `to: "picked"` / `"allies"` / `"selfAndAllies"`. */
  pick?: TargetSpec;
}

/** The outcome steps: what happens to a creature or the table. AA0's adversary vocabulary reuses this union as is. */
export type OutcomeStep =
  /**
   * Damage (R2, R3): rolled once for the move, then applied per recipient (R9). `type: "weapon"` takes the weapon's
   * type. `direct`: Armor Slots can't reduce it (CB p.99). `scale` per recipient (a save's "half damage"). `distribution`:
   * `each` (default: every recipient takes the total), `split` ("distribute that damage however you wish", Splintering
   * Strike, CB p.332), `dropDiePerTarget` (Deathrun). `extraDiePerTarget`: "roll an additional damage die" per target.
   * `repeat`: "1d20+2 magic damage for each Stress marked" (the expression is rolled that many times and totalled).
   */
  | (OutcomeBase & {
      kind: "damage";
      roll: DamageRoll;
      type: DamageType | "weapon" | "both";
      direct?: boolean;
      scale?: "half" | "double";
      distribution?: "each" | "split" | "dropDiePerTarget";
      extraDiePerTarget?: boolean;
      repeat?: NumberSource;
    })
  /** A change to this move's damage roll (riders and options; `to` is the move's damage recipients). */
  | (OutcomeBase & { kind: "modifyDamage"; change: DamageChange })
  /** Forced HP with no damage roll or thresholds: Reaper's Strike "force them to mark 5 Hit Points". */
  | (OutcomeBase & { kind: "markHp"; amount: NumberSource })
  /** "must mark a Stress"; a full track marks 1 HP instead (R5, CB p.92). */
  | (OutcomeBase & { kind: "markStress"; amount: NumberSource })
  /** "must mark an Armor Slot without gaining its benefit" (AR4; `noBenefit`). */
  | (OutcomeBase & { kind: "markArmor"; amount: NumberSource; noBenefit?: boolean })
  /** "clear a Hit Point", "clear 2 Stress", "clear an Armor Slot". */
  /** `distribution: "split"`: Salvation Beam "divided among them however you'd like". */
  | (OutcomeBase & { kind: "clear"; track: Track; amount: NumberSource; distribution?: "each" | "split" })
  /** "gain a Hope", "lose a Hope". */
  | (OutcomeBase & { kind: "hope"; change: "gain" | "lose"; amount: NumberSource })
  /** The GM's Fear pool: Sigil of Retribution "The GM gains a Fear", Dire Strike "The GM loses a Fear" (`to: "self"` is ignored). */
  | (OutcomeBase & { kind: "fear"; change: "gain" | "lose"; amount: NumberSource })
  /** SD0 (NV5, widened): `endsOn` also ends it on those events (`EndEvent`). */
  | (OutcomeBase & { kind: "condition"; condition: ConditionRef; duration: Duration; endsWhen?: string; endsOn?: readonly EndEvent[] })
  | (OutcomeBase & { kind: "clearCondition"; condition: ConditionRef })
  /**
   * Movement, shown as a prompt (Q9): `knockBack` ("knocked back to Far range"), `pull` ("pull the target into Melee
   * range"), `teleport`, `move` ("move them anywhere within Far range"), `flee` ("flee one range away").
   */
  | (OutcomeBase & {
      kind: "move";
      mode: "knockBack" | "pull" | "teleport" | "move" | "flee";
      range?: Range;
      relativeTo?: "self" | "target" | "point" | "triggerSource";
    })
  /**
   * A lasting effect: a sheet effect on a PC (mods + until), or a modifier on an adversary instance.
   * SD0 (widened): `endsOn` (NV5) also ends it on those events; `option` (NV7) names the option it stands for, which a
   * `featureEffect` state check reads (Elemental Incarnation's "Fire": "Channeling Fire").
   */
  | (OutcomeBase & {
      kind: "effect";
      label: string;
      mods: readonly Mod[];
      duration: Duration;
      endsWhen?: string;
      endsOn?: readonly EndEvent[];
      option?: string;
    })
  /**
   * Tokens on this card (sheet `cardTokens`): `set` ("place a number of tokens equal to your Agility"), `add`, `spend`,
   * `clear`. `die`: the card holds dice, not tokens (Zone of Protection's d6, Sigil of Retribution's d8s; the count is
   * the die's value or the number of dice). `max`: "You can hold a number of d8s equal to your level".
   */
  | (OutcomeBase & {
      kind: "tokens";
      op: "set" | "add" | "spend" | "clear";
      amount?: NumberSource;
      max?: NumberSource;
      die?: DieSides;
    })
  /** "this card is placed in your vault" (Counterspell); `permanent`: "place this card in your vault permanently". */
  | (OutcomeBase & { kind: "toVault"; permanent?: boolean })
  /** A change to the move's own roll (riders) or the trigger's roll (reactions). */
  | (OutcomeBase & { kind: "modifyRoll"; change: RollChange })
  /**
   * The damage goes elsewhere: `self` ("make yourself the target of the attack instead", I Am Your Shield, CB p.341),
   * `triggerSource` ("the attack is reflected back to the caster", Arcane Reflection), `picked` ("redirect the attack to
   * damage an adversary within Very Close range", Redirect).
   */
  | (OutcomeBase & { kind: "redirectDamage"; target: "self" | "triggerSource" | "picked" })
  /**
   * More Armor Slots against this damage than the usual one (CB p.114): I Am Your Shield "you can mark any number of
   * Armor Slots" (`"any"`), Brace and Forest Sprites "an additional Armor Slot" (1).
   */
  | (OutcomeBase & { kind: "extraArmorSlots"; max: NumberSource | "any" })
  /** "reduce the severity by one threshold" (Get Back Up, Shrug It Off, Tekaira Armored Beetles, Shield Aura). */
  | (OutcomeBase & { kind: "reduceSeverity"; steps: number })
  /** "reduce incoming damage by 1d8" (Rune Ward), Thorn Skin, Zone of Protection, Dark Army. */
  | (OutcomeBase & { kind: "reduceDamage"; amount: NumberSource })
  /**
   * Arcane Deflection "negate the damage"; Bold Presence "avoid gaining the condition"; Counterspell "the effect stops"
   * (also the GM's Fear gain for Midnight-Touched and Dread-Touched); Life Ward "clear a Hit Point instead" of the death move.
   */
  | (OutcomeBase & { kind: "negate"; what: "damage" | "attack" | "condition" | "effect" | "deathMove" })
  /**
   * Marks taken on one track instead of another: Splendor-Touched "mark that much Stress or spend that much Hope instead"
   * of HP, Grace-Touched "force them to mark that number of Stress" instead of HP, or "mark an Armor Slot instead of
   * marking a Stress".
   */
  | (OutcomeBase & { kind: "convertMarks"; from: Track; into: Track | "hope" })
  /** "They are killed and can't come back to life by any means" (Disintegration Wave); a Minion group loses `amount` members. */
  | (OutcomeBase & { kind: "defeat"; amount?: NumberSource })
  /** Invigoration: "the feature can be used again" (drops the trigger feature's `featureUses` entry). */
  | (OutcomeBase & { kind: "refreshFeature" })
  /** What the engine leaves to the table: shown as the card's words plus a Done button that logs the use (Q9). */
  | (OutcomeBase & { kind: "manual"; text: string })
  // ---- SD0: sheet-drawer outcomes (NV1, NV2, NV4, NV11, NV17, NV18, NV19)
  /**
   * NV2: runs a D5 class feature (`FeatureMeta.use`, src/lib/domain/class-features) inside this use, so D5's
   * `classState`, held dice and prompts stay the one record (Rally, Prayer Dice, Unstoppable, Hex, Beastform, …).
   * `feature` is the `FeatureMeta.key`; `params` become its `FeatureParams`. `to` is `self` (or the picked ally the
   * feature's `target: "ally"` names). The entry's own map steps run after it.
   */
  | (OutcomeBase & { kind: "delegate"; feature: string; params?: DelegateParams })
  /**
   * NV4: "mark N fewer (or more) Hit Points" after the damage is compared to the thresholds, not a severity step (Scales,
   * CB p.54: "mark a Stress to mark 1 fewer Hit Points"). Applies to the hit the trigger carries.
   */
  | (OutcomeBase & { kind: "adjustHpMarked"; change: "fewer" | "more"; amount: NumberSource })
  /** NV1: a class resource: "gain a Favor", "gain Focus equal to the highest result" (HF p.12), "clear your Focus track". */
  | (OutcomeBase & { kind: "resource"; resource: "favor" | "focus"; change: "gain" | "lose" | "set"; amount: NumberSource })
  /** NV11: a live area on the map (Q14) that this use draws; members are read from token positions at each roll. */
  | (OutcomeBase & { kind: "area"; area: AreaSpec })
  /**
   * NV17: the Hope this roll would give is taken as something else: `favor` (Favor, HF p.14: "when you succeed on an
   * action roll with Hope, you can choose to gain a Favor instead of a Hope"), `removeFear` (Ethereal Visage, CB p.45:
   * "you can remove a Fear from the GM's Fear pool instead of gaining Hope").
   */
  | (OutcomeBase & { kind: "replaceHopeGain"; with: "favor" | "removeFear" })
  /**
   * NV18: the attack this rider rides on also targets more creatures with the same roll (Hold Them Off, CB p.38: "use
   * that same roll against two additional adversaries within range"). `damage: "half"` for a second target that takes
   * half (Cannonball, CB p.33).
   */
  | (OutcomeBase & { kind: "addTargets"; count: NumberSource; targets: TargetSpec; damage?: "same" | "half" })
  /**
   * NV19: a named Help an Ally (Q12, CB p.90: "spend a Hope to Help an Ally … roll a d6 advantage die"): the helper gives
   * the picked ally's next action roll a `die`-sided advantage die; `free` skips the Hope (Eloquent, CB p.29).
   */
  | (OutcomeBase & { kind: "help"; die: DieSides; free?: boolean });

/** NV2: what a `delegate` step passes to the D5 feature (`FeatureParams`): a fixed choice, a choice the player made, or a number. */
export interface DelegateParams {
  /** A fixed `FeatureParams.choice` ("fire", a Beastform id). */
  choice?: string;
  /** The `FeatureParams.choice` is the player's pick in this `choose` / `choices` id. */
  choiceFrom?: string;
  /** `FeatureParams.amount`. */
  amount?: NumberSource;
}

/**
 * NV11 (Q14): a circle on the map. `centre`: the caster's token (`self`, it follows them), a picked token (`target`) or a
 * square (`point`); `radius` a Defined Range. `side` says whose members gain `mods` while inside; `blocksSight` makes it a
 * vision blocker in and out (Dark Cloud, CB p.42: "Anyone in this cloud can't see outside of it, and anyone outside of it
 * can't see in"). `duration` / `endsOn` as an effect; the GM can remove it. Rows: the `combatAreas` table.
 */
export interface AreaSpec {
  label: string;
  centre: "self" | "target" | "point";
  radius: Range;
  side: "allies" | "selfAndAllies" | "enemies" | "all";
  mods?: readonly Mod[];
  blocksSight?: boolean;
  duration: Duration;
  endsOn?: readonly EndEvent[];
}

/** One option of a `choose` step. */
export interface ChooseOption {
  id: string;
  label: string;
  steps: readonly Step[];
}

/** The flow steps: payment, choices, reaction rolls, checks and follow-up rolls around the outcomes. */
export type FlowStep =
  /** A payment after the roll: Bolt Beacon "On a success, spend a Hope to …" (gated by `when`; R8 lets the same roll's Hope pay). */
  | (StepBase & { kind: "pay"; costs: readonly Cost[] })
  /**
   * An add-on the player may take: Forceful Push "Additionally, you can spend a Hope to make them temporarily
   * Vulnerable", Enrapture's once-per-rest Stress. Asked `beforeRoll` or `afterRoll` (default after, once gates are known).
   */
  | (StepBase & {
      kind: "optional";
      id: string;
      label: string;
      costs?: readonly Cost[];
      limit?: Limit;
      timing?: "beforeRoll" | "afterRoll";
      steps: readonly Step[];
    })
  /**
   * "choose one of the following options": Death Grip, Tempest, Champion's Edge (`count` = Hope spent, `distinct`:
   * "You can't choose the same option more than once"). The picked options' steps run in order.
   */
  | (StepBase & {
      kind: "choose";
      id: string;
      label: string;
      count?: NumberSource;
      distinct?: boolean;
      timing?: "beforeRoll" | "afterRoll";
      options: readonly ChooseOption[];
    })
  /**
   * The recipients make a reaction roll (R12, AR11): an adversary rolls a d20 (CB p.161, server-rolled, Q7), a PC rolls
   * the duality dice with `trait`. `onFail` / `onSuccess` run per recipient ("Targets who succeed take half damage").
   */
  | (StepBase & {
      kind: "save";
      to: Recipient;
      pick?: TargetSpec;
      trait?: TraitId | readonly TraitId[];
      difficulty: SaveDifficulty;
      onFail: readonly Step[];
      onSuccess: readonly Step[];
    })
  /** A plain dice check: Arcane Reflection "If any roll a 6", Shrug It Off "On a result of 3 or lower, place this card in your vault". */
  | (StepBase & {
      kind: "check";
      dice: DiceExpr;
      test: CheckTest;
      then: readonly Step[];
      otherwise: readonly Step[];
    })
  /**
   * A second roll or a second set of targets inside the same move: Telekinesis "make an additional Spellcast Roll
   * against the second target", Whirlwind "use the attack against all other targets within Very Close range" (no `roll`:
   * the move's roll is reused), Chain Lightning's chain.
   */
  | (StepBase & { kind: "followUp"; roll?: RollSpec; targets: TargetSpec; steps: readonly Step[] });

export type Step = FlowStep | OutcomeStep;

/** Every step kind, for exhaustive switches and coverage tests (checked against `Step` below). */
export const STEP_KINDS = [
  "pay",
  "optional",
  "choose",
  "save",
  "check",
  "followUp",
  "damage",
  "modifyDamage",
  "markHp",
  "markStress",
  "markArmor",
  "clear",
  "hope",
  "fear",
  "condition",
  "clearCondition",
  "move",
  "effect",
  "tokens",
  "toVault",
  "modifyRoll",
  "redirectDamage",
  "extraArmorSlots",
  "reduceSeverity",
  "reduceDamage",
  "negate",
  "convertMarks",
  "defeat",
  "refreshFeature",
  "manual",
  // SD0 (sheet-drawer)
  "delegate",
  "adjustHpMarked",
  "resource",
  "area",
  "replaceHopeGain",
  "addTargets",
  "help",
] as const;

export type StepKind = (typeof STEP_KINDS)[number];

// ---------------------------------------------------------------- choices, uses, effects

/** A number the player picks before the roll ("spend any number of Hope", "mark any number of Stress"). */
export interface NumberChoice {
  id: string;
  label: string;
  min: number;
  max?: NumberSource;
}

/**
 * One usable thing on a card: the card itself, one grimoire spell (Book of Ava: Power Push, Tava's Armor, Ice Spike),
 * or one part of a card with a second ability (Onslaught's passive floor and its reaction). The runner resolves it in
 * this order: requirements, limit, `choices`, upfront `costs`, `roll` (once for all `targets`), then `steps` in order.
 */
export interface CardUse {
  /** "main" for a single-use card, else a slug of the spell or part ("power-push"). Unique within the card. */
  id: string;
  /** As printed: the card or spell name. */
  name: string;
  activation: Activation;
  requires?: readonly Requirement[];
  limit?: Limit;
  choices?: readonly NumberChoice[];
  costs?: readonly Cost[];
  roll?: RollSpec;
  targets?: TargetSpec | TriggerTargets;
  /** `passive` uses: the always-on modifiers. */
  mods?: readonly Mod[];
  steps: readonly Step[];
  /** "You can only hold this spell on one creature at a time": a new cast ends the previous effect. */
  exclusive?: boolean;
  /**
   * SD0 (NV15): "up to N creatures at once" (Hex, HF p.16: Hexed targets up to your Spellcast trait): a cast past the
   * number ends the oldest. `exclusive` is the one-creature case.
   */
  holdLimit?: NumberSource;
  /**
   * SD0 (NV13): who makes the use. `companion`: the Beastbound companion acts from its own token (Q4, CB p.40: "When you
   * command your companion to attack, they gain any benefits that would normally only apply to you … their damage roll
   * uses your Proficiency and their damage die"). Absent: the actor.
   */
  actor?: "companion";
}

/**
 * SD0 (NV3): a later card, a level or another feature changes an earlier use's numbers ("Your Rally Die increases to a
 * d10", Epic Poetry, CB p.29; "uses d8s instead of d6s", Backstab, HF p.8). The runner applies every upgrade whose `when`
 * holds, in list order, before the use runs; `patch` replaces only what it names.
 */
export interface Upgrade {
  when: UpgradeWhen;
  /** The use it changes (`CardUse.id`); absent: every use of the entry. */
  useId?: string;
  patch: UpgradePatch;
  /** The upgrading feature in words, for the drawer's badge ("Virtuoso"). */
  note?: string;
}

/**
 * When an upgrade holds: the sheet holds that subclass card rank (`specialization`, `mastery`) or that feature
 * (`featureId`, see src/lib/domain/feature-effects/ids.ts), or the character is at least `level`.
 */
export type UpgradeWhen =
  | { kind: "rank"; rank: "specialization" | "mastery" }
  | { kind: "feature"; featureId: string }
  | { kind: "level"; atLeast: number };

/**
 * What an upgrade changes. `limitTimes`: "twice instead of once per long rest" (Virtuoso, CB p.28); `dieSides`: the die every dice
 * expression and held die of the use rolls (Rally d8 at level 5, CB p.28); `range`: the use's target range (Regenerative
 * Reach, CB p.31: "Very Close"); `extraSteps`: steps appended to the use (Reliable Backup's new Contacts Everywhere
 * options, CB p.43); `extraOptions`: options added to the use's `choose` step `chooseId` (Venomancer's poisons, HF p.9).
 */
export interface UpgradePatch {
  limitTimes?: number;
  dieSides?: DieSides;
  /** "2d10" instead of "1d10" (Fueled by Fear, CB p.51): the dice count of the use's damage and `add` changes. */
  diceCount?: NumberSource;
  range?: Range;
  extraSteps?: readonly Step[];
  chooseId?: string;
  extraOptions?: readonly ChooseOption[];
}

/** The effect entry of one card: every use it offers. Lives in src/lib/srd/card-effects/<domain>.ts. */
export interface CardEffect {
  cardId: string;
  uses: readonly CardUse[];
}

/** How a card is used, for the Hand and the guards (CA0 classification; CARD_NOT_COMBAT for `outOfCombat`). */
export type CardUsage = "combat" | "passive" | "outOfCombat";

// ---------------------------------------------------------------- drift check

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const stepKindsMatch: Same<StepKind, Step["kind"]> = true;
void stepKindsMatch;
