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

/**
 * Plan lanes, tracer V (widened): a keyword a damage carries besides its type, which resistances and weaknesses can name
 * (Made of Straw, HF p.79: "takes double damage from fire"; Fireproof, HF p.22: "immune to damage from magical or mundane
 * flame"; dcm-dv6). The type rules (CB p.99) still read only `DamageType`.
 */
export type DamageKeyword = "fire";

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
  /**
   * Plan lanes-2, V2 (widened): `markedHp`: the targets that marked 1+ HP from this feature, read after the reaction window
   * (Suppressing Blast, CB p.217: "a Fear for each target who marked HP from this attack"; Paralyzing Shock, CB p.222;
   * dcm-nsqo); with `severity`, only those whose damage reached it (Frenzied Feeding, HF p.91: "each creature who took
   * Severe damage from this attack"; dcm-k4x5).
   */
  | { kind: "targetCount"; which: "picked" | "hit" | "failedSave" | "markedHp"; severity?: Severity }
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
    }
  // ---- Plan lanes, tracer V (widened); docs/tasks/TASK-LN-V.md names the bead and the lane of each
  /**
   * Unmarked slots on a track ("mark any number of Stress" capped by the free slots, Confusing Aura, CB p.329; "mark all
   * HP", Tentacle Rays' Doom, HF p.75). dcm-8x8, dcm-702.
   */
  | { kind: "free"; who: "self" | "target"; track: Track }
  /**
   * The Hope or Fear Die of the host roll (a rider's) or of this move's roll: Midnight-Touched (CB p.337: "add the result of
   * your Fear Die to your damage roll"), Fear Leaf (HF p.9). dcm-d1b.
   */
  | { kind: "dualityDie"; die: "hope" | "fear" }
  /**
   * A creature's derived stat: Armored Shell (CB p.33: reduce by the Armor Score; dcm-bxp.99.19.4), Blade of the Forest
   * (CB p.231: "3d4 + the target's Major threshold"; dcm-a7o).
   */
  | { kind: "stat"; stat: "armorScore" | "majorThreshold" | "severeThreshold" | "evasion"; who: "self" | "target" }
  /**
   * Creatures counted on the map (dcm-ttz): Hive Mind (HF p.65, "+1 per other Mechanorb within Close"), Shallow Cuts (each
   * Skinner within Melee of the PC), Stolen Armor ("equal to the number of PCs"), Shield Wall (CB p.212). `side` is seen
   * from the actor; `within` is measured from `of` (default `self`); `name` narrows to one adversary name.
   */
  | {
      kind: "creatureCount";
      side: "allies" | "enemies" | "pcs" | "all";
      within?: Range;
      of?: "self" | "target";
      name?: string;
      excludeSelf?: boolean;
      /**
       * Plan lanes-2, V2 (widened): count a line: the creatures linked to `of` through steps of at most this range each
       * (Shield Wall, CB p.212: "If additional Bladed Guards are standing in a line alongside the first, and each is within
       * Melee range of another guard in the line, the Difficulty increases by the total number of guards in that line";
       * dcm-346).
       */
      chain?: Range;
    }
  /** Handfuls (or bags) of gold a creature carries (Catrin's The Weight of Opulence, HF p.81; dcm-0gh). */
  | { kind: "gold"; who: "self" | "target"; unit?: "handful" | "bag" }
  /** Tokens of a named kind on a creature (bramble tokens, Tangle Bramble Swarm, CB p.218; dcm-xp0). */
  | { kind: "creatureTokens"; who: "self" | "target"; name: string }
  /** The current value of the actor's class die (the Unstoppable Die, CB p.36; dcm-v17). */
  | { kind: "classDie"; die: HeldDieKind | "unstoppable" }
  /** The Know the Tide tokens the actor holds (sessionFeatures.tideTokens, CB p.77; dcm-78x). */
  | { kind: "tideTokens" }
  // ---- Plan lanes-2, tracer V2 (widened); docs/tasks/TASK-LN-V2.md
  /**
   * The number the condition step recorded when it was given (`condition.record`), read inside that condition's `mods`:
   * Banish's return (CB p.333: the reaction roll's Difficulty starts at "your highest result" of the cast's d20s; dcm-b77).
   */
  | { kind: "recorded" };

/** Dice such as "d8+2 using your Proficiency" ({count: proficiency, sides: 8, plus: 2}) or "2d6" ({count: 2, sides: 6}). */
export interface DiceExpr {
  count: NumberSource;
  sides: DieSides;
  plus?: NumberSource;
  /**
   * SD0 (NV1, widened): the dice are the actor's own class die, whose size the sheet holds (Patron Dice, HF p.14: "roll a
   * number of Patron Dice equal to the Favor spent"; the Rally, Combo and Unstoppable dice). `sides` is then the size at
   * level 1, used when the sheet has none.
   * Plan lanes, V (widened): `companion`: the Beastbound companion's damage die from its companion sheet (CB p.40; dcm-2z2).
   */
  sidesOf?: HeldDieKind | "unstoppable" | "companion";
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
 * - Plan drawer-answers, DA0 (widened): `stanceDrops`: the stance whose feature gave it drops (a shift, Severe damage, the
 *   last Hit Point, the scene's end; HF p.12: "When you drop out of a stance, you lose any ongoing benefits it
 *   provides."). Grappling's Restrain carries it (user answer 2026-10-29, dcm-bxp.99.19.10).
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
  | "majorDamage"
  | "stanceDrops"
  // ---- Plan lanes, tracer V (widened)
  /** The bearer takes any damage (Slumber, Transform, CB p.332-334; dcm-utu). */
  | "takeDamage"
  /** The GM spends Fear to end it (Slumber "or the GM spends a Fear"; Marked for Death, HF p.8; dcm-utu, dcm-8bv). */
  | "gmSpendsFear"
  /** The creature the effect was made about (the use's target, the tagged creature) is defeated (Marked for Death; dcm-8bv). */
  | "targetDefeated"
  /** The bearer makes an action roll (Spectral Mist, HF p.180, with duration `scene`; dcm-0ey). */
  | "actionRoll"
  /** The bearer makes an attack (Cloaked, CB p.42; Goad Them On's forced attack, CB p.341; Parallela; dcm-bhp, dcm-e75, dcm-y3e). */
  | "bearerAttacks"
  /** The bearer ends a move within an adversary's line of sight (Cloaked, CB p.42; dcm-bhp). */
  | "endsMoveInSight"
  /** The bearer moves (Hold the Line: "until you move", CB p.342, read on the caster through `endsOnCaster`; dcm-bpr). */
  | "moves"
  /** The bearer fails a roll with Fear (Hold the Line; dcm-bpr). */
  | "failWithFear"
  /** The card's or feature's tokens reach 0 (Invisibility, Flight, CB p.328-334; Circle of Power, HF p.16; dcm-7n7, dcm-ii4). */
  | "tokensGone"
  /** The area's owner leaves the area (Circle of Power: "or you exit the circle"; dcm-ii4). */
  | "ownerLeavesArea"
  /** The effect turned a hit on the bearer into no Hit Points marked (Shield Aura, CB p.341; dcm-sim). */
  | "reducedToNoHp"
  // ---- Plan lanes-2, tracer V2 (widened)
  /** The bearer (or, through `endsOnCaster`, the caster) casts another spell (Veil of Night, CB p.336: "The veil remains until you cast another spell"; dcm-o44e). */
  | "castsSpell"
  /** The area or effect granted its benefit once (Forest Sprites, CB p.339: "A sprite vanishes after granting a benefit"; dcm-5yew). */
  | "benefitGranted";

/**
 * Plan lanes, V: an end on the next roll of a kind (dcm-3ea, dcm-cwh, dcm-ffk, dcm-0ey). `by`: whose roll (default the
 * bearer; `caster`: the creature that made the effect, Timejammer, CB p.334: "the next time you make an action roll that
 * targets another creature"). `targetsCreature`: only a roll that targets another creature. `result` narrows the outcome;
 * `weapon` the weapon (Menacing Reach, HF p.15: "a successful attack with that weapon"). Reliable Backup (CB p.43): a
 * Presence Roll (`roll: "presence"`).
 */
export interface RollEnd {
  roll: RollFilter;
  by?: "bearer" | "caster";
  targetsCreature?: boolean;
  result?: RollResult;
  weapon?: "primary" | "secondary";
}

/**
 * Plan lanes, V: "Unless you mark a Stress to maintain your Glamour, it drops when …" (Night's Glamour, HF p.17; dcm-4qv).
 * When an `endsOn` event comes, the engine first offers the bearer these costs; paid, the effect stays.
 */
export interface Maintain {
  costs: readonly Cost[];
}

/**
 * Plan lanes-2, V2: how the bearer gets out of a condition, a creature's named tokens or an area (dcm-xobk, dcm-wuu, dcm-zi3k):
 * a roll (`trait`, against `difficulty`; unset: the GM sets it), a successful attack (`attack`), or paying `costs`.
 * "until they break free with a successful attack, Finesse Roll, or Strength Roll" (Detain, CB p.212); "removed by
 * succeeding on a Finesse Roll (12 + the number of bramble tokens)" (Encumber, CB p.218); "can clear the condition with a
 * successful Presence Roll (16)" (Scare, HF p.75); "until they spend 2 Hope" (Slow, HF p.75); "must succeed on a Finesse
 * Roll ... to leave the area" (Bramble Patch, CB p.230). Any one of the ways that is given frees the bearer.
 */
export interface Escape {
  trait?: TraitId | "spellcast" | readonly (TraitId | "spellcast")[];
  difficulty?: NumberSource;
  attack?: boolean;
  costs?: readonly Cost[];
}

/** Plan lanes-2, V2: one option of another feature's `choose` step (Seven-Headed, HF p.92; dcm-qw4f). */
export interface FeatureOptionRef {
  /** The feature's printed name (an adversary feature) or card / feature id. */
  feature: string;
  /** The `choose` step's id. */
  choose: string;
  /** The option's id. */
  option: string;
}

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

/**
 * Plan lanes, V: the outcome a roll trigger asks for (CB p.90: a critical success counts as a success with Hope): the
 * results `whenYouAttack` already had, now on every roll trigger. `successWithHope` (Favor, HF p.14; Ethereal Visage, CB
 * p.45; Eclipse, CB p.337; dcm-a9n, dcm-nhr, dcm-0gi), `successWithFear` (Dread-Touched, HF p.181; dcm-1o3). A failure
 * with Hope or Fear is `failure` plus the trigger's `duality` (Courage, CB p.48: "When you fail a roll with Fear"; dcm-5z3).
 */
export type RollResult =
  | "any"
  | "success"
  | "failure"
  | "withHope"
  | "withFear"
  | "critical"
  | "successWithHope"
  | "successWithFear";

/**
 * Plan lanes, V: narrows a roll trigger to the roll's target (dcm-0gi, dcm-94h, dcm-g6t): `enemy` (against an
 * adversary), `within` (the target within that range of the actor), `creature` (the tagged / hexed one: Twilight Toll,
 * CB p.337), `inArea` (the target inside a live area of that card or feature: Forest Sprites, CB p.339).
 */
export interface RollTarget {
  enemy?: boolean;
  within?: Range;
  creature?: CreatureKey;
  inArea?: string;
}

// ---------------------------------------------------------------- targets

/** How many targets a use may pick. */
export type TargetCount =
  | { kind: "one" }
  /**
   * DA0 (widened): `rolledFirst`: the count is rolled (on the server) before the player picks, and the use takes at most
   * that many (Warden's Protection, CB p.31: "clear 2 Hit Points on 1d4 allies within Close range"; user answer
   * 2026-10-29, dcm-d95). The runner reads the rolled count from `RunContext.rolledTargetCount` and never rolls it itself.
   */
  | { kind: "upTo"; n: NumberSource; rolledFirst?: boolean; min?: number }
  /**
   * "all targets within Close range": every eligible creature, picked by the server (R9).
   * Plan lanes, V (widened): `min` on `upTo` / `any`: "choose two willing creatures", "two or more" (Shared Clarity,
   * Transcendent Union, CB p.333-334; dcm-d7h).
   */
  | { kind: "all" }
  /** "any targets", "a number of targets equal to the Hope spent": the player picks, at most `max`. */
  | { kind: "any"; max?: NumberSource; min?: number };

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
  // ---- Plan lanes, tracer V (widened)
  /** Only among the use's targets (`targets`) or the ones its roll hit (`hit`): Stunning Sunlight, CB p.341 (dcm-y45). */
  among?: "hit" | "targets";
  /** Not the trigger's subject: "all other adversaries" (Elemental Incarnation, Water, CB p.30; dcm-ssf). */
  excludeSubject?: boolean;
  /** The range is the host move's (a rider's addTargets "within range", Manipulate Magic, CB p.47; dcm-x7p). */
  hostRange?: boolean;
  /**
   * Where the range is measured from (dcm-dgu): `actor` (default), `target` (the use's first target), `point` (a picked
   * square: Zone of Protection), `chain` (the previous link's creatures: Chain Lightning, CB p.328).
   */
  origin?: "actor" | "target" | "point" | "chain";
  /** The range is the Beastbound companion's range from its sheet (CB p.40; dcm-2z2). */
  companionRange?: boolean;
  /**
   * Plan lanes-2, V2 (widened): with `area: "aroundPoint"`, that many points are picked (each with `areaRange`), and a
   * creature in several of them is a target once (Unleash Hellfire, HF p.88: "1d4 bursts of hellfire within Far range";
   * dcm-va0f). A `damage` step's `perArea` repeats per point.
   */
  points?: NumberSource;
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
  /**
   * "make a Presence Roll against them", "an Agility Roll against all targets". Several traits: the player picks.
   * DA0 (widened): `attack: true` makes the trait roll an attack roll (a Beastform's form attack, CB p.30: "When you make
   * an attack while transformed, you use the creature's listed range, trait, and damage dice"; Cannonball's thrown attack),
   * so `rollMatches("attack")` holds for it (Rampage's "before you make an attack roll", CB p.33; dcm-bxp.99.19.6 (5)).
   * Plan lanes, V (widened): `asWeapon`: the feature is its own weapon, so the roll is a weapon attack too (implies
   * `attack`; Elemental Breath, CB p.54: "treating it as an Instinct weapon"; Long Tongue, CB p.69; dcm-gvr, dcm-bn1).
   */
  | { kind: "trait"; trait: TraitId | readonly TraitId[]; difficulty: Difficulty; attack?: boolean; asWeapon?: boolean }
  /** A weapon attack (uses the weapon's trait; CB p.96). */
  | { kind: "attack"; weapon: WeaponRef; difficulty: Difficulty }
  /**
   * "a reaction roll using your Spellcast trait" (Counterspell, Hideous Retribution): no Hope or Fear (CB p.99).
   * Plan lanes, V (widened): `anyTrait`: "a reaction roll using a trait of your choice" (Attack of Opportunity, CB p.48;
   * dcm-fjh); `trait` is then the default shown before the pick.
   */
  | { kind: "reaction"; trait: TraitId | "spellcast"; difficulty: Difficulty; anyTrait?: boolean }
  /** An adversary's d20 + Attack Modifier against Evasion (AR1; AA0). */
  | { kind: "adversaryAttack"; difficulty: Difficulty }
) & {
  advantage?: boolean;
  disadvantage?: boolean;
  /** A bonus or penalty to the roll ("gain a +3 bonus"). */
  modifier?: NumberSource;
  /** Plan lanes, V: a d20 roll crits on this natural result or higher (Eye of the Sage, HF p.70: "19-20"; dcm-mhn). */
  critRange?: number;
  /** Plan lanes, V: the target's Evasion is halved against this attack (Peerless Accuracy, CB p.224; dcm-xyw). */
  halveEvasion?: boolean;
};

/** The Difficulty of a reaction roll the recipients make (a `save` step). */
export type SaveDifficulty =
  | { kind: "fixed"; value: number }
  /** Chain Lightning: "a Difficulty equal to the result of your Spellcast Roll". */
  | { kind: "rollTotal" }
  /** Banish: "a Difficulty equal to your highest result" of the d20s rolled. */
  | { kind: "number"; value: NumberSource }
  /** An adversary feature with no number uses the adversary's own Difficulty (CB p.193). */
  | { kind: "actorDifficulty" }
  /**
   * Plan lanes, V: `base` raised by allies who pay (Enchanting Song, CB p.226: "Other Sirens within Close range of the
   * target can mark a Stress to each add a +1 bonus to the Difficulty"; dcm-q0a). `within` is measured from `of`.
   */
  | {
      kind: "raised";
      base: SaveDifficulty;
      allies: { within: Range; of?: "self" | "target"; name?: string };
      cost: Cost;
      each: number;
    }
  /**
   * Plan lanes, V: a repeated save whose Difficulty falls by `step` each time it is made again (Banish's return, CB p.333:
   * "the Difficulty gains a -1 penalty and the target makes another reaction roll"; dcm-b77).
   */
  | { kind: "falling"; start: NumberSource; step: number };

/** How a `check` step reads its dice. */
export type CheckTest =
  | { kind: "anyAtLeast"; value: number }
  | { kind: "allAtMost"; value: number }
  | { kind: "totalAtLeast"; value: number }
  | { kind: "totalAtMost"; value: number }
  /** Plan lanes, V: the total is even / odd (a fate roll, CB p.168; Stone of Omens, HF p.62; Blink Beast, HF p.71; dcm-27j). */
  | { kind: "even" }
  | { kind: "odd" }
  /**
   * Plan lanes-2, V2: every die shows an even / odd result (Elemental Archon 3, Lightning Bolt, HF p.96: "If all results
   * are even, make the same attack against a different target"; dcm-4yg4).
   */
  | { kind: "allEven" }
  | { kind: "allOdd" };

/** Plan lanes, V: one row of a check table (Broken Magic, HF p.68: "1-2 … 3-4 … 5-6"; Tentacle Rays' d8 beams; dcm-27j). */
export interface CheckRow {
  atLeast: number;
  atMost: number;
  label?: string;
  steps: readonly Step[];
}

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
  /**
   * Plan lanes, V (widened): a period `per` can't name; `per` then holds the nearest period a reader that doesn't know
   * `period` falls back to. `gmTurn` (Ravenous, HF p.97: "Once per GM turn"; `per: "scene"`; dcm-c5h), `day` (Summon
   * Tormentors, CB p.237: "Once per day"; `per: "session"`), `week` (Resurrection, CB p.341: "you can't cast Resurrection
   * again for a week"; `per: "session"`; dcm-aym).
   */
  period?: "gmTurn" | "day" | "week";
}

/**
 * Plan lanes, V: who pays a cost besides the actor (dcm-8yr Tactician, CB p.333: "they can spend a Hope"; dcm-uj0 Rune
 * Ward, CB p.328: "The ward's holder can spend a Hope"). `chooser`: the creature deciding a `by` optional / choose step.
 * An unaffordable payer refuses the use (or skips the step) as an unaffordable actor does.
 */
export type Payer = "self" | "triggerSubject" | "triggerSource" | "picked" | "chooser";

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
  /**
   * Inside a live map area a feature drew (Q14: Circle of Power, Moonbeam; `owner: "self"` only the actor's own areas).
   * Plan lanes, V (widened): `who` is the creature that must stand inside (default `self`; `subject`: the trigger's
   * roller or evader, Circle of Power, HF p.16; dcm-ii4).
   */
  | { kind: "inArea"; featureId: string; owner?: "self" | "any"; who?: "self" | "subject" | "target" }
  /** No other creature within `range` of you or the target (the Isolating stance, HF p.12). */
  | { kind: "isolated"; range: Range; who: "self" | "selfOrTarget" }
  // ---- Plan lanes, tracer V (widened); "target" is the recipient when read through a `targetCheck` gate
  /**
   * Marks, free slots or Hope of a creature: "If they can't mark an Armor Slot" (Spit Acid, CB p.210; `armor`, `free`,
   * atMost 0; dcm-18i), "If a target is not able to lose a Hope" (Dreadhowl, CB p.222; `hope`, `marked` = the Hope held,
   * atMost 0; dcm-5xi), "PCs with 0 Hope" (Depths of Despair, CB p.228).
   */
  | {
      kind: "track";
      who: "self" | "target" | "subject";
      track: Track | "hope";
      measure: "marked" | "free";
      atLeast?: number;
      atMost?: number;
    }
  /**
   * Tokens: on this card or feature (`name` unset; Feed, HF p.39: "While there are no tokens on this card"; Never
   * Upstaged, Invisibility, CB p.334-335; dcm-2g9, dcm-7n7), or named tokens on a creature (bramble tokens, CB p.218:
   * Crush needs 3 or more; dcm-xp0).
   */
  | { kind: "tokens"; who?: "self" | "target"; name?: string; atLeast?: number; atMost?: number }
  /** The target (or trigger subject) is within `range` of you (Kick, CB p.58; Tusks, CB p.68: "a target within Melee range"; dcm-9l4). */
  | { kind: "within"; range: Range; who: "target" | "subject" }
  /** An ally of yours is within `range` of the target (Sneak Attack, CB p.42: "an ally is within Melee range of your target"; dcm-85u). */
  | { kind: "allyNear"; range: Range; of: "target" | "self" }
  /**
   * The weapon's range is at most `atMost` (Spirit Weapon, CB p.44: "an equipped weapon with a range of Melee or Very
   * Close"; Surrounded, HF p.10: "an attack with a Melee weapon"; dcm-13s, dcm-wut). `attacking`: the weapon of this attack.
   */
  | { kind: "weaponRange"; weapon: "primary" | "secondary" | "either" | "attacking"; atMost: Range }
  /** The creature holds a named item (Enchanted Talisman, HF p.16: "the person holding the talisman"; dcm-3i4). */
  | { kind: "holdsItem"; item: string; who: "self" | "subject" | "target" }
  /**
   * This card or feature affected the target before (Words of Discord, CB p.335: "The next time you cast Words of Discord
   * on them"; dcm-c75); `since` bounds the memory (default: ever, until the target leaves play).
   */
  | { kind: "usedOnBefore"; since?: Limit["per"] }
  /** The target marked an Armor Slot against this hit in the reaction window (Rend and Crush, CB p.233: "doesn't mark an Armor Slot"; dcm-sos). */
  | { kind: "usedArmor"; used: boolean }
  /** The Lunar Phases moon die shows `phase` (1 New … 6, HF p.17; sessionFeatures.moonDie; dcm-lk8). */
  | { kind: "moonPhase"; phase: number }
  /** The check does not hold (Magical Weakness, CB p.231: "can't use their Regeneration action" while Dazed; dcm-2f3). */
  | { kind: "not"; check: StateCheck }
  /** Any of the checks holds (Sneak Attack: "while Cloaked or while an ally is within Melee range of your target"; dcm-85u). */
  | { kind: "anyOf"; checks: readonly StateCheck[] }
  /** Plan lanes-2, V2: the option was removed for good (Seven-Headed, HF p.92: "if the corresponding option has already been removed"; dcm-qw4f). */
  | { kind: "optionRemoved"; option: FeatureOptionRef };

// ---------------------------------------------------------------- triggers

/**
 * What sets off a reaction, a rider or an automatic effect. The reaction window of an adversary hit (Q13, Q17)
 * offers every loadout card whose trigger matches: `whenAllyWouldTakeDamage` (allies) and `whenYouWouldTakeDamage`
 * / `whenAttacked` (the target), before the damage resolves.
 */
export type Trigger =
  /** I Am Your Shield: "When an ally within Very Close range would take damage" (before it resolves). */
  /** `includeSelf`: Arcane Deflection's "an attack targeting you or an ally within Very Close range". */
  /**
   * Plan lanes, V (widened): `unlimited`: any range, `range` is then ignored (Enchanted Talisman, HF p.16; Rune Ward held by
   * an ally, CB p.328; dcm-3i4, dcm-uj0).
   */
  | { kind: "whenAllyWouldTakeDamage"; range: Range; includeSelf?: boolean; unlimited?: boolean }
  /** Hideous Retribution: "When an ally within Close range takes damage from a target you can see" (after it resolves). */
  | { kind: "whenAllyTakesDamage"; range: Range; sourceInSight?: boolean; sourceWithin?: Range | "weapon" }
  /** "When you would take magic damage" (Arcane Reflection), "When you take Severe damage" (Get Back Up), "When you take damage" (Thorn Skin). */
  /** Plan lanes, V (widened): `keyword` (Fireproof, HF p.22: "damage from magical or mundane flame"; dcm-dv6). */
  | {
      kind: "whenYouWouldTakeDamage";
      damageType?: DamageType;
      severity?: Severity;
      from?: "melee" | "beyondMelee";
      keyword?: DamageKeyword;
    }
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
  /**
   * Reassurance, Support Tank, Lean on Me: "after an ally attempts an action roll"; `includeSelf` for "you or a willing ally".
   * Plan lanes, V (widened): `result` takes every `RollResult` (Eclipse, CB p.337: "succeeds with Hope"; dcm-0gi);
   * `roll` narrows the roll (default `action`; `any` with damage and reaction rolls too, Adjust Reality, CB p.329: "any
   * roll"; `attack`, Forest Sprites, CB p.339; dcm-3ft, dcm-g6t); `against` narrows the roll's target (`RollTarget`);
   * `duality` as on `afterYouRoll`.
   */
  | {
      kind: "afterAllyRolls";
      range?: Range;
      result?: RollResult;
      includeSelf?: boolean;
      roll?: RollFilter;
      against?: RollTarget;
      duality?: "hope" | "fear";
    }
  /**
   * Your own finished roll: Inevitable ("When you fail an action roll"), Arcana-Touched (switch the Hope and Fear Dice), Premonition.
   * Plan lanes, V (widened): `result` takes every `RollResult` (dcm-a9n, dcm-nhr, dcm-1o3); `duality` narrows to a roll
   * with Hope / with Fear on top of `result` (Courage: `failure` + `fear`; dcm-5z3); `against` (dcm-94h);
   * `noDamageRoll`: the roll led to no damage roll (Twilight Toll, CB p.337; dcm-94h); `cardDomain`: the roll casts a
   * spell of that domain (Fane of the Wilds, CB p.339: "a Sage domain spell"; dcm-z1a); `fromUse`: see `whenYouAttack`.
   */
  | {
      kind: "afterYouRoll";
      roll: RollFilter;
      result?: RollResult;
      duality?: "hope" | "fear";
      against?: RollTarget;
      noDamageRoll?: boolean;
      cardDomain?: DomainId;
      fromUse?: string;
    }
  /**
   * Before your roll: Rage Up ("Before you make an attack"), Codex-Touched, Sage-Touched, Notorious.
   * Plan lanes, V (widened): `weaponRange` (the attacking weapon's range is at most this: Surrounded, HF p.10: "an attack
   * with a Melee weapon"; dcm-wut), `weaponSlot` and `fromUse` as on `whenYouAttack`.
   */
  | { kind: "beforeYouRoll"; roll: RollFilter; weaponRange?: Range; weaponSlot?: "primary" | "secondary"; fromUse?: string }
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
      /** Plan lanes, V (widened): the attack is with this weapon (Ignition, HF p.22: "damage rolls with that weapon"; dcm-ab5). */
      weaponSlot?: "primary" | "secondary";
      /**
       * Plan lanes, V (widened): the host move is a use of this card or feature id (`<id>` or `<id>:<useId>`): Feed (HF
       * p.39: "On a successful Fangs attack"), Sacred Resonance (CB p.44: "damage for your Spirit Weapon feature"); dcm-bn1,
       * dcm-13s.
       */
      fromUse?: string;
    }
  /**
   * Your move dealt damage: Healing Strike, Lead by Example, Jump Scare (magic), Natural Familiar (near the familiar).
   * Plan lanes, V (widened): `within`: the damaged creature is within this range of you (Dark Army, HF p.181; Elemental
   * Incarnation Water, CB p.30; dcm-ofy, dcm-ssf); `fromUse` as on `whenYouAttack`.
   */
  | { kind: "whenYouDealDamage"; damageType?: DamageType; toEnemy?: boolean; within?: Range; fromUse?: string }
  /** Encore: "When an ally within Close range deals damage to an adversary". */
  | { kind: "whenAllyDealsDamage"; range: Range }
  /**
   * Ferocity, Dire Strike: "When a target marks any number of Hit Points from an attack you make".
   * SD0 (NV6, widened): `severity` narrows it to the damage's severity (Death Strike, HF p.8: "When you deal Severe damage").
   */
  /**
   * Plan lanes, V (widened): `stage: "would"`: before the marks are written, so the rider can change them (Grace-Touched,
   * CB p.335: "When you would force a target to mark a number of Hit Points"; dcm-raa); `source: "any"`: forced marks
   * (`markHp` steps) too, not only attacks; `fromUse` as on `whenYouAttack` (Feed; dcm-bn1).
   */
  | { kind: "whenTargetMarksHp"; severity?: Severity; stage?: "would" | "did"; source?: "attack" | "any"; fromUse?: string }
  /**
   * Never Upstaged, Rise Up (`fromAttack`), Valor-Touched (`withoutArmor`), Unbreakable (`last`: "When you mark your last Hit Point").
   * SD0 (NV6, widened): `sourceWithin` (Eye for an Eye, HF p.10: "an adversary within Melee range makes you mark Hit Points").
   */
  | { kind: "whenYouMarkHp"; fromAttack?: boolean; withoutArmor?: boolean; last?: boolean; sourceWithin?: Range }
  /** Brace, Unyielding Armor: "When you mark an Armor Slot to reduce incoming damage". `who: "ally"` for Forest Sprites. */
  /** Plan lanes, V (widened): `stage: "would"` (Unyielding Armor, CB p.342: "When you would mark an Armor Slot"; dcm-98d). */
  | { kind: "whenArmorSlotMarked"; who: "self" | "ally"; stage?: "would" | "did" }
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
  /**
   * Midnight-Touched: "the GM would gain a Fear"; Dread-Touched prevents the gain.
   * Plan lanes, V (widened): `byYou` + `result`: the Fear comes from your own roll with that result (Dread-Touched, HF
   * p.181: "When you succeed with Fear"; dcm-1o3).
   */
  | { kind: "gmWouldGainFear"; byYou?: boolean; result?: RollResult }
  /** Avatar of Terror: "when the GM spends a Fear to spotlight an adversary within Very Close range". */
  | { kind: "gmSpendsFear"; purpose?: "spotlight"; range?: Range }
  /** Invigoration: "When you or an ally within Close range has used a feature that has an exhaustion limit". */
  | { kind: "featureExhausted"; range: Range }
  /** Counterspell, Repudiate: "interrupt a magical effect taking place". */
  | { kind: "magicalEffect" }
  /** Shared Clarity, Transcendent Union: "when a creature connected by this union would mark Stress or Hit Points". */
  | { kind: "linkedWouldMark"; track: "stress" | "hpOrStress" }
  /**
   * Token set-up: "At the beginning of a session", "After a long rest", "When you take a rest".
   * Plan lanes, V (widened): `restType` narrows `afterRest` to a short or long rest; `during`: during the rest, while its
   * downtime moves are picked (Efficient, CB p.53; Celestial Trance, CB p.56; Oasis, HF p.27; dcm-2a1).
   */
  | {
      kind: "timing";
      at: "sessionStart" | "sessionEnd" | "afterRest" | "afterLongRest" | "sceneEnd";
      restType?: "short" | "long";
      during?: boolean;
    }
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
  /**
   * An ally Helps you or you Help an ally (Enchanted Aid, CB p.47: "When you Help an Ally with a Spellcast Roll"; Q12).
   * Plan lanes, V (widened): `helper: "self"` only when you help (Tactician, CB p.333: "When you Help an Ally"; dcm-iu4),
   * `"ally"` only when you are helped.
   */
  | { kind: "whenHelping"; roll?: RollFilter; helper?: "self" | "ally" }
  // ---- Plan lanes, tracer V (widened)
  /** You recall a domain card from your vault (Perfect Recall, CB p.50; dcm-bxp.99.19.1); a rider on the Hand's recall. */
  | { kind: "whenYouRecall" }
  /** An enemy moves within `range` of you (Hold the Line, CB p.342: "If an adversary moves within Very Close range"; dcm-bpr). */
  | { kind: "whenEnemyEntersRange"; range: Range }
  // ---- Plan lanes-2, tracer V2 (widened)
  /**
   * Once, when the card is chosen (taken at level up; Vitality, CB p.330: "When you choose this card, permanently gain two
   * of the following benefits ... Then place this card in your vault permanently"; dcm-40mj). Used with an `auto` activation.
   */
  | { kind: "whenYouChooseThisCard" };

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
  | "consumableClear"
  // ---- Plan lanes, tracer V (widened)
  /** Hit Point slots (Vitality, CB p.330: "one Hit Point slot"; dcm-u6z). */
  | "hpMax"
  /** Stress slots (Vitality; At Ease, CB p.36: "+1 Stress slot"; dcm-u6z, dcm-fjh). */
  | "stressMax"
  /** The Beastbound companion's training picks (Expert / Advanced Training, CB p.38; dcm-2z2). */
  | "companionTraining";

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
  /**
   * "make attack rolls with advantage", "your allies gain advantage on attack rolls".
   * Plan lanes, V (widened): `situation`: only on rolls the player marks as this (Patron's Mantle, HF p.14: "action rolls to
   * intimidate a target"; the roll dialog offers it as a check box, Q13; dcm-733).
   */
  | { kind: "advantage"; on: RollFilter; versus?: Versus; situation?: string }
  /**
   * "attack rolls against them are made with disadvantage" (Invisibility, Eclipse).
   * Plan lanes, V (widened): `from`: only attackers in / beyond Melee; `buyOff`: the attacker can pay these to drop it (the
   * Defensive stance, HF p.12: "unless the attacker marks a Stress to negate the disadvantage"; dcm-eut); `situation`: only
   * when the GM confirms it (Shapeshifter, HF p.64; dcm-51s).
   */
  | {
      kind: "disadvantageAgainst";
      on: RollFilter;
      versus?: Versus;
      from?: "melee" | "beyondMelee";
      buyOff?: readonly Cost[];
      situation?: string;
    }
  /**
   * "resistance to physical damage" (Rejuvenation Barrier), "immune to magic damage" (Book of Yarrow), CB p.99.
   * Plan lanes, V (widened): `from: "outsideArea"`: only damage from outside the area the mod belongs to (Rejuvenation
   * Barrier, CB p.339: "from outside the barrier"; dcm-nt4); `keyword` (Fireproof, HF p.22; dcm-dv6).
   */
  | {
      kind: "resistance";
      type: DamageType | "both";
      level: "resistant" | "immune";
      from?: "outsideArea" | "melee" | "beyondMelee";
      keyword?: DamageKeyword;
    }
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
        | "doubleMagicDamage"
        // ---- Plan lanes, tracer V (widened)
        /** Sunsear Arrows (CB p.224): "can't become Hidden" (dcm-xyw). */
        | "cannotBeHidden"
        /** Unstoppable (CB p.36): "you can't be made Vulnerable" (dcm-v17). */
        | "cannotBeVulnerable"
        /** Fearsome Presence (CB p.239): "PCs can't spend Hope to use features against" the bearer (dcm-zos). */
        | "noHopeFeaturesAgainst"
        /** Tireless (HF p.68): can't be forced to mark Stress (dcm-yea). */
        | "noForcedStress"
        /** No Vital Organs (HF p.69): no extra damage from critical successes against it (dcm-yea). */
        | "noCritDamage"
        /** Psychic Strongbox (HF p.69): immune to abilities that affect its thoughts or emotions (dcm-yea). */
        | "mindImmune"
        /** Terrified (Wyvern, HF p.89): no Hope from rolls with Hope (dcm-kti). */
        | "noHopeFromRolls"
        /** Paranoid (Cryptimoth, HF p.82): can't Help an Ally or join a Tag Team Roll (dcm-kti). */
        | "cannotHelp"
        // ---- Plan lanes-2, tracer V2 (widened)
        /** Scared (Tentacle Rays, HF p.75): "can't take actions other than fleeing the battle or trying to shake off their terror" (dcm-zi3k). */
        | "onlyFlee"
        /** Ravenous (Hunger Pangs, HF p.94): "a PC can't spend Hope" (dcm-5kxg). */
        | "cannotSpendHope"
        /** Afflicted (Nightmare Stare, HF p.95): "the target can't clear HP or Stress" (two flags; dcm-5kxg). */
        | "cannotClearHp"
        | "cannotClearStress"
        /** Never Misses (Adult Flickerfly, CB p.228): "When the Flickerfly makes an attack, the target's Evasion is halved" on every attack (dcm-4c9m). */
        | "attacksHalveEvasion";
    }
  // ---- Plan lanes, tracer V (widened)
  /**
   * What attacks against the bearer get (dcm-9gw, dcm-7zb, dcm-346, dcm-51s, dcm-xyw). Breaking Blow (CB p.330: "the
   * next successful attack against that same target deal an extra 2d12 damage"), Chokehold (CB p.336), Lead by Example
   * (CB p.342: "The next PC to make an attack against that adversary can clear a Stress or gain a Hope"), I've Got 'Em (CB
   * p.213: double damage from attacks by other adversaries), Tag Team (HF p.65), Drag and Bag (HF p.62), Sunsear Arrows /
   * Deathlock / Mark Target (CB p.224-225).
   */
  | { kind: "attackedRider"; rider: AttackedRider }
  /**
   * A rider on the bearer's own actions while the effect or condition lasts (dcm-kti, dcm-f0m, dcm-bxp.99.19.3, dcm-b77,
   * dcm-1jg): Poisoned (CB p.211, p.32-33), Envelop, Ignite (CB p.215-216), On Fire (Cinder Grasp, CB p.328), Shadow
   * Shackles (CB p.222: "must spend a Hope to make an action roll"), Banish's return (CB p.333), Deadly Drop (CB p.223).
   */
  | { kind: "bearerRider"; rider: BearerRider }
  /**
   * Disadvantage on the bearer's own rolls (dcm-4dc, dcm-kti, dcm-346): Sandstorm (CB p.339: "Attacks made from beyond Melee
   * range have disadvantage"; `beyond: "melee"`), Taunted / In Your Face (CB p.218: against anyone but the caster;
   * `unlessTarget: "caster"`), Light and Shadow (HF p.83: "while in bright light"; `situation`).
   */
  | { kind: "disadvantage"; on: RollFilter; beyond?: Range; unlessTarget?: "caster"; situation?: string }
  /** The bearer's next attack must target the caster (Goad Them On, CB p.341; Lock Up, CB p.228; dcm-e75). */
  | { kind: "mustAttack"; target: "caster" }
  /** The bearer uses another trait for a weapon (Versatile Fighter, CB p.330; `choice` as on `trait`; dcm-5dg). */
  | { kind: "weaponTrait"; weapon: WeaponRef; trait: TraitId; choice?: string }
  /** The bearer's attacks hit more targets their roll beats (Parallela, CB p.332: "an additional target within range"; dcm-y3e). */
  | { kind: "extraTargets"; on: RollFilter; count: NumberSource }
  /** Forced movement of the bearer is `steps` ranges shorter (Immovable Object, CB p.230: "two fewer ranges"; dcm-1yo). */
  | { kind: "forcedMoveReduce"; steps: number }
  /**
   * The bearer's movement is limited (dcm-3oe, dcm-wuu): `maxRange` (Creeping Fire, CB p.216: "can only move within Very
   * Close range"), `direction` (Hurricane, CB p.339: "Targets can't move against the wind"; the direction is the use's
   * choice `choice`).
   */
  | { kind: "moveLimit"; maxRange?: Range; direction?: { choice: string }; text?: string }
  /** "Any time you would be Hidden, you are instead Cloaked" (CB p.42; dcm-bhp). */
  | { kind: "replaceCondition"; from: StandardCondition; to: StandardCondition }
  /** A duality die of the bearer's rolls changes size (Your Struggle Is Pointless: d8 Hope Die; Battle Lust: d20 Fear Die; dcm-kti). */
  | { kind: "dualityDie"; die: "hope" | "fear"; sides: DieSides }
  /**
   * The GM controls the bearer (Enthralled, HF p.92: "spotlight them … as if they were an adversary … using a d20";
   * Weredrake Curse, HF p.143: `asAdversary` names the adversary stat block; dcm-idz).
   */
  | { kind: "gmControl"; asAdversary?: string; d20?: boolean }
  /** An adversary's standard attack is replaced (Evolution, HF p.61; Claw Swipe: Very Close, 1d10+3 phy; dcm-gx3). */
  | { kind: "standardAttack"; name: string; range: Range; damage: DiceExpr; type: DamageType }
  /** An adversary's feature list changes, by printed feature name (Enraged Mountain Troll, HF p.65; dcm-gx3). */
  /**
   * Plan lanes-2, V2 (widened): `removeOptions`: single options of another feature's `choose` step, gone for good
   * (Seven-Headed, HF p.92: "Permanently remove the Elemental Breath option that corresponds to the result"; dcm-qw4f).
   */
  | { kind: "features"; remove?: readonly string[]; add?: readonly string[]; removeOptions?: readonly FeatureOptionRef[] }
  /** The bearer takes double damage of a type or keyword (Made of Straw, HF p.79: "double damage from fire"; dcm-dv6). */
  | { kind: "weakness"; type?: DamageType; keyword?: DamageKeyword }
  // ---- Plan lanes-2, tracer V2 (widened)
  /** The bearer can't attack the creature that gave it (Beguiled, Tentacle Rays, HF p.75: "sees the Gobstalker as a friend and can't attack it"; dcm-zi3k). */
  | { kind: "cannotAttackTarget"; target: "caster" }
  /** The bearer's own move reaches this range (Unleash the Beast, HF p.75-76: "they can move up to Far range instead of Close range before taking an action"; dcm-z5a6). */
  | { kind: "moveRange"; range: Range }
  /**
   * Every damage the bearer takes changes (Burrowing Leechpoles, HF p.90: "any damage the target takes gains a +1 bonus
   * for each leechpole under their skin": `add` `creatureTokens` of `self`, the bearer; dcm-kvx4). Not only attacks
   * (`attackedRider` covers those).
   */
  | { kind: "damageTaken"; change: DamageChange }
  /**
   * The bearer's spends and marks are multiplied (Unstuck, Reality Quake, CB p.237: "When an Unstuck target spends Hope or
   * marks Armor Slots, HP, or Stress, they must double the amount spent or marked"; dcm-fbsr).
   */
  | { kind: "marksMultiplier"; factor: number; of: readonly ("hope" | Track)[] };

/**
 * Plan lanes, V: what an attack against the bearer of an `attackedRider` gets. `by`: whose attacks (`caster`: the creature
 * that made the effect; `others`: anyone else; `pcs`). `onSuccess`: only attacks that succeed. `attackerSteps` run for the
 * attacker after the attack (`self` = the attacker, `triggerSubject` = the bearer); gates read the attack.
 */
export interface AttackedRider {
  by: "anyone" | "caster" | "others" | "pcs";
  onSuccess?: boolean;
  advantage?: boolean;
  damage?: DamageChange;
  direct?: boolean;
  halveEvasion?: boolean;
  attackerSteps?: readonly Step[];
  situation?: string;
}

/**
 * Plan lanes, V: a rider on the bearer of a lasting effect or condition. `on`: `acts` (each time the bearer acts: On
 * Fire, Poisoned), `actionRoll` (Envelop), `attack`, `spotlight` (Panicked), `moves`, `pcRollsWithFear` (any PC rolls with
 * Fear: Banish's return), `afterPcsNextAction` (once, after the PCs' next action: Deadly Drop), `casterSpotlit` (the
 * caster is spotlighted: Smothering Grapple, HF p.69). `timing`: before or after (default after). `costs`: the bearer must
 * pay them to do it (Shadow Shackles). In `steps` `self` is the bearer and `triggerSource` the creature that made it.
 */
export interface BearerRider {
  on:
    | "acts"
    | "actionRoll"
    | "attack"
    | "spotlight"
    | "moves"
    | "pcRollsWithFear"
    | "afterPcsNextAction"
    | "casterSpotlit"
    // ---- Plan lanes-2, tracer V2 (widened)
    /** The GM spends a Fear (Scared, Tentacle Rays, HF p.75: "must mark a Stress whenever you spend a Fear"; dcm-zi3k). */
    | "gmSpendsFear"
    /** The caster moves (Pin, HF p.71: "The Hut drags the Restrained target when it moves"; Wings of Light's carry, CB p.45; dcm-z5a6, dcm-lvgm). */
    | "casterMoves"
    /**
     * Any creature makes an action roll against the condition (Thorny Cage, CB p.218: "When a creature makes an action roll
     * against the cage, they must mark a Stress"; dcm-xobk); in `steps` `triggerSubject` is that roller.
     */
    | "rolledAgainst"
    /**
     * The bearer marks their last Stress (Comatize, HF p.90: "If a PC marks their last Stress while the Hatchling is latched
     * on, the PC must make a death move"; the latched condition carries it; dcm-wqgs).
     */
    | "marksLastStress";
  roll?: RollFilter;
  timing?: "before" | "after";
  costs?: readonly Cost[];
  steps: readonly Step[];
}

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
  | { kind: "sameAsMove" }
  /** Plan lanes, V: the Beastbound companion's damage die x Proficiency, type from its sheet (CB p.40; dcm-2z2; the step's type `weapon`). */
  | { kind: "companion" };

/** A change to the damage of the move it rides on (riders and options). */
export type DamageChange =
  /**
   * "gain a bonus to your damage roll equal to your Strength", "add a d10 to the damage roll", "+10 bonus to your damage rolls".
   * SD0 (NV8, widened): `type` makes the added damage that type (Face Your Fear, CB p.51: "deal an extra 1d10 magic damage").
   */
  | { kind: "add"; amount: NumberSource; type?: DamageType; keyword?: DamageKeyword }
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
  | { kind: "dieSize"; steps: number }
  /** Plan lanes, V: "roll damage twice and take the better result" (Screeching Caterwaul, HF p.72; dcm-51s). */
  | { kind: "best"; of: 2 };

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
    }
  // ---- Plan lanes, tracer V (widened)
  /** The host move reaches `steps` ranges farther (Manipulate Magic, CB p.47: "Extend the spell or attack's reach by one range"; dcm-x7p). */
  | { kind: "reach"; steps: number }
  /** Reroll the held dice of a kind just rolled that show `atMost` or less (Weapon Specialist, CB p.48: "reroll any 1s" of the Slayer Dice; dcm-sa2). */
  | { kind: "rerollHeld"; die: HeldDieKind; atMost: number }
  // ---- Plan lanes-2, tracer V2 (widened)
  /**
   * The target's Evasion is halved against the roll this rides on (an `onAttack` `before` use's check: Peerless Accuracy,
   * CB p.224: "Before the Flickerfly makes an attack, roll a d6. On a result of 4 or higher, the target's Evasion is halved
   * against this attack"; Skillful Strike, HF p.79; dcm-5jyp).
   */
  | { kind: "halveEvasion" };

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
 * - Plan lanes, V (widened): `chooser`: inside a `choose` / `optional` with `by`, the creature making that pick (Critical
 *   Inspiration, CB p.341: each ally picks; dcm-bz8, dcm-6ju).
 */
export type Recipient = "self" | "targets" | "picked" | "triggerSource" | "triggerSubject" | "allies" | "selfAndAllies" | "chooser";

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
  | { kind: "requires"; requirement: Requirement }
  /**
   * Plan lanes, V (widened): a per-target state, read for each recipient (`who: "target"` is the recipient): "If they can't
   * mark an Armor Slot" (dcm-18i), "not able to lose a Hope" (dcm-5xi), bramble tokens (dcm-xp0), "doesn't mark an Armor
   * Slot" (dcm-sos), Depths of Despair's 0 Hope.
   */
  | { kind: "targetCheck"; check: StateCheck };

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
      /** Plan lanes, V (widened): a keyword besides the type (fire; dcm-dv6). */
      keyword?: DamageKeyword;
      /**
       * Plan lanes-2, V2 (widened): each recipient takes the damage once per `TargetSpec.points` area it stands in, combined
       * (Unleash Hellfire, HF p.88: "If a target takes damage from multiple bursts, combine the damage"; dcm-va0f).
       */
      perArea?: boolean;
    })
  /** A change to this move's damage roll (riders and options; `to` is the move's damage recipients). */
  | (OutcomeBase & { kind: "modifyDamage"; change: DamageChange })
  /**
   * Forced HP with no damage roll or thresholds: Reaper's Strike "force them to mark 5 Hit Points".
   * Plan lanes, V (widened): `distribution: "split"`: `amount` marks spread over the recipients as the actor picks, at
   * most `maxPer` on one (Force Salvo, HF p.81: "The same creature can be targeted by up to three force bolts"; dcm-zhc).
   */
  /**
   * Plan lanes-2, V2 (widened): `reduceWith: "hope"`: before the marks, each recipient can spend any number of Hope to mark
   * that many fewer (Doom, Tentacle Rays, HF p.75: "must mark all HP, but they can spend any number of Hope to reduce the
   * number of HP marked this way by an equal amount"; dcm-zi3k).
   */
  | (OutcomeBase & {
      kind: "markHp";
      amount: NumberSource;
      distribution?: "each" | "split";
      maxPer?: number;
      reduceWith?: "hope";
    })
  /**
   * "must mark a Stress"; a full track marks 1 HP instead (R5, CB p.92).
   * Plan lanes, V (widened): `distribution: "split"` (Mind Meld, HF p.74: "distributed among allies as it chooses"; dcm-63j).
   */
  | (OutcomeBase & { kind: "markStress"; amount: NumberSource; distribution?: "each" | "split" })
  /**
   * "must mark an Armor Slot without gaining its benefit" (AR4; `noBenefit`).
   * Plan lanes, V (widened): `ifUnable`: steps for a recipient with no free Armor Slot (Spit Acid, CB p.210: "If they
   * can't mark an Armor Slot, they must mark an additional HP"; dcm-18i). In them `to: "targets"` is that recipient.
   */
  | (OutcomeBase & { kind: "markArmor"; amount: NumberSource; noBenefit?: boolean; ifUnable?: readonly Step[] })
  /** "clear a Hit Point", "clear 2 Stress", "clear an Armor Slot". */
  /** `distribution: "split"`: Salvation Beam "divided among them however you'd like". */
  | (OutcomeBase & { kind: "clear"; track: Track; amount: NumberSource; distribution?: "each" | "split" })
  /**
   * "gain a Hope", "lose a Hope".
   * Plan lanes, V (widened): `ifUnable` (with `lose`): steps for a recipient who can't lose the Hope (Dreadhowl, CB p.222:
   * "If a target is not able to lose a Hope, they must instead mark 2 Stress"; dcm-5xi).
   */
  /**
   * Plan lanes-2, V2 (widened): `distribution: "split"` (with `gain`): `amount` Hope spread over the recipients as the
   * chooser picks (Stone of Omens, HF p.62: "gains Hope equal to half the result, which they can distribute among the PCs
   * however they wish"; dcm-nh44).
   */
  | (OutcomeBase & {
      kind: "hope";
      change: "gain" | "lose";
      amount: NumberSource;
      ifUnable?: readonly Step[];
      distribution?: "each" | "split";
    })
  /** The GM's Fear pool: Sigil of Retribution "The GM gains a Fear", Dire Strike "The GM loses a Fear" (`to: "self"` is ignored). */
  | (OutcomeBase & { kind: "fear"; change: "gain" | "lose"; amount: NumberSource })
  /**
   * SD0 (NV5, widened): `endsOn` also ends it on those events (`EndEvent`).
   * Plan lanes, V (widened): `mods`: what the condition does to its bearer while it lasts (a `bearerRider`, a
   * `disadvantage`: Poisoned, Taunted, Shaky; dcm-kti); `endsOnCaster`: events of the creature that gave it (Hold the
   * Line, CB p.342: "until you move or fail a roll with Fear"; Smothering Grapple: the caster takes Major damage; dcm-bpr,
   * dcm-51s); `endsOnRoll` (`RollEnd`).
   */
  | (OutcomeBase & {
      kind: "condition";
      condition: ConditionRef;
      duration: Duration;
      endsWhen?: string;
      endsOn?: readonly EndEvent[];
      mods?: readonly Mod[];
      endsOnCaster?: readonly EndEvent[];
      endsOnRoll?: RollEnd;
      /**
       * Plan lanes-2, V2 (widened): `escape`: how the bearer clears it (`Escape`; Scare, HF p.75: "a successful Presence Roll
       * (16)"; dcm-zi3k, dcm-xobk); `record`: a number kept with the condition, which a `recorded` number in its `mods` reads
       * (Banish, CB p.333: the return roll's starting Difficulty; dcm-b77).
       */
      escape?: Escape;
      record?: NumberSource;
      /** Plan lanes-2, V2 (widened): the Fear a `gmSpendsFear` end costs (default 1; dcm-8bv), as on `effect`. */
      endFear?: NumberSource;
    })
  /**
   * Plan lanes, V (widened): `all`: clear every condition and tag on the recipient (`condition` is then only the one named
   * first in the feed; Purifying Aura, HF p.86: "and all conditions"; dcm-730).
   */
  | (OutcomeBase & { kind: "clearCondition"; condition: ConditionRef; all?: boolean })
  /**
   * Movement, shown as a prompt (Q9): `knockBack` ("knocked back to Far range"), `pull` ("pull the target into Melee
   * range"), `teleport`, `move` ("move them anywhere within Far range"), `flee` ("flee one range away").
   * DA0 (widened): `intoMelee`: the SERVER moves the recipient's token into Melee range of the use's first target when
   * the step's gates hold; no prompt for the player (Charge, CB p.59: "When you succeed on an Agility Roll to move from
   * Far or Very Far range into Melee range"; user answer 2026-10-29, dcm-bxp.99.19.16: roll first, on a success the
   * server moves the token). The plan's move prompt carries `server: true` and `anchorId`.
   * Plan lanes, V (widened): `ground`: a flying recipient lands (Mystic Tether, CB p.333: "grounds"; dcm-yzr);
   * `leaveScene`: the recipient leaves the scene without being defeated (Survival Instinct, Bolt, Cowardly, HF p.62-64;
   * dcm-icd).
   * Plan lanes-2, V2 (widened): `withCaster`: the recipient's token moves along with the caster's (Pin, HF p.71: "drags the
   * Restrained target when it moves"; Wings of Light, CB p.45: "carry another willing creature"; dcm-z5a6, dcm-lvgm);
   * `relativeTo: "area"` with `area`: to the centre of the actor's live area of that label (Phantom Retreat, CB p.336:
   * "reappear where you were standing when you activated Phantom Retreat"; dcm-5yew); `leaveAs`: how a `leaveScene` is
   * logged (`combined`: Minions merged into a Horde, Drain and Multiply, CB p.218; dcm-xobk; default `fled`).
   */
  | (OutcomeBase & {
      kind: "move";
      mode: "knockBack" | "pull" | "teleport" | "move" | "flee" | "intoMelee" | "ground" | "leaveScene" | "withCaster";
      range?: Range;
      relativeTo?: "self" | "target" | "point" | "triggerSource" | "area";
      area?: string;
      leaveAs?: "fled" | "combined";
    })
  /**
   * A lasting effect: a sheet effect on a PC (mods + until), or a modifier on an adversary instance.
   * SD0 (widened): `endsOn` (NV5) also ends it on those events; `option` (NV7) names the option it stands for, which a
   * `featureEffect` state check reads (Elemental Incarnation's "Fire": "Channeling Fire").
   * Plan lanes, V (widened): `stacking` (Blight Seed, HF p.9: "This effect can't stack": `refuse`; `replace`: a new copy
   * ends the old; default `stack`; dcm-kkx); `endsOnCaster` (Eye of the Storm, HF p.23: "until you take Severe damage"
   * on an ally's effect; dcm-wjv), `endsOnRoll` (dcm-3ea, dcm-cwh, dcm-ffk) and `maintain` (dcm-4qv).
   */
  | (OutcomeBase & {
      kind: "effect";
      label: string;
      mods: readonly Mod[];
      duration: Duration;
      endsWhen?: string;
      endsOn?: readonly EndEvent[];
      option?: string;
      stacking?: "stack" | "replace" | "refuse";
      endsOnCaster?: readonly EndEvent[];
      endsOnRoll?: RollEnd;
      maintain?: Maintain;
      /**
       * Plan lanes-2, V2 (widened): one grant shared by every recipient of this use: when it ends on one of them (its
       * duration or an event), it ends on all (Bird's-Eye View, CB p.33: "The first time a character makes a roll to act on
       * this information, they gain advantage on the roll"; `nextRoll` on `selfAndAllies`; dcm-rao5).
       */
      sharedGrant?: boolean;
      /**
       * Plan lanes-2, V2 (widened): the Fear the GM spends for a `gmSpendsFear` end (default 1: Slumber, CB p.332: "the GM
       * spends a Fear"; Marked for Death, HF p.8: "a number of Fear equal to your tier", `byTier` 1/2/3/4; dcm-8bv).
       */
      endFear?: NumberSource;
    })
  /**
   * Tokens on this card (sheet `cardTokens`): `set` ("place a number of tokens equal to your Agility"), `add`, `spend`,
   * `clear`. `die`: the card holds dice, not tokens (Zone of Protection's d6, Sigil of Retribution's d8s; the count is
   * the die's value or the number of dice). `max`: "You can hold a number of d8s equal to your level".
   */
  /**
   * Plan lanes, V (widened): `holder: "recipient"`: named tokens (`name`) on the recipient creature instead of this card
   * (bramble tokens, Encumber, CB p.218; dcm-xp0); a `creatureTokens` number and a `tokens` state check read them.
   */
  | (OutcomeBase & {
      kind: "tokens";
      op: "set" | "add" | "spend" | "clear";
      amount?: NumberSource;
      max?: NumberSource;
      die?: DieSides;
      holder?: "card" | "recipient";
      name?: string;
      /**
       * Plan lanes-2, V2 (widened): how the holder clears every token of `name` (Encumber, CB p.218: "All bramble tokens can be
       * removed by succeeding on a Finesse Roll (12 + the number of bramble tokens)"; dcm-xobk). The adversary trigger
       * `pcEscapes` answers it.
       */
      escape?: Escape;
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
  /**
   * "reduce the severity by one threshold" (Get Back Up, Shrug It Off, Tekaira Armored Beetles, Shield Aura).
   * DA0 (widened): `insteadOfArmorSlot`: the step IS the hit's one armor reduction, paid with something else (Stable, HF
   * p.12: "spend a Focus instead of an Armor Slot to reduce damage"; user answer 2026-10-29, dcm-bxp.99.19.9). No Armor
   * Slot is marked with it and the two never add up past one step ("You can only mark 1 Armor Slot", CB p.114); it needs
   * no armor worn. The reaction window (DA8) applies it.
   */
  | (OutcomeBase & { kind: "reduceSeverity"; steps: number; insteadOfArmorSlot?: boolean })
  /** "reduce incoming damage by 1d8" (Rune Ward), Thorn Skin, Zone of Protection, Dark Army. */
  | (OutcomeBase & { kind: "reduceDamage"; amount: NumberSource })
  /**
   * Arcane Deflection "negate the damage"; Bold Presence "avoid gaining the condition"; Counterspell "the effect stops"
   * (also the GM's Fear gain for Midnight-Touched and Dread-Touched); Life Ward "clear a Hit Point instead" of the death move.
   * DA0 (widened):
   * - `what: "stress"`: the Stress about to be marked is not marked (Unshakable, CB p.59: "When you would mark a Stress,
   *   roll a d6. On a result of 6, don't mark it."; one Stress per use: the server rolls each Stress separately).
   * - `ignoreOnHitHp` (with `what: "damage"`): the damage becomes zero, so the hit has no severity (no Minor, Major or
   *   Severe), and any extra "mark HP" from the attack's on-hit effects is ignored too; its other on-hit effects
   *   (conditions) still apply (Dark Aegis, HF p.14: "spend a Favor instead of marking Hit Points"; user answer
   *   2026-10-29, dcm-bxp.99.19.13).
   */
  /**
   * Plan lanes-2, V2 (widened): `what: "move"`: the move that set it off doesn't happen (Shield Wall, CB p.212: "A creature
   * who tries to move within Very Close range of the Guard must succeed on an Agility Roll"; dcm-xobk).
   */
  | (OutcomeBase & {
      kind: "negate";
      what: "damage" | "attack" | "condition" | "effect" | "deathMove" | "stress" | "move";
      ignoreOnHitHp?: boolean;
    })
  /**
   * Marks taken on one track instead of another: Splendor-Touched "mark that much Stress or spend that much Hope instead"
   * of HP, Grace-Touched "force them to mark that number of Stress" instead of HP, or "mark an Armor Slot instead of
   * marking a Stress".
   * DA0 (widened): `insteadOfArmorSlot` as on `reduceSeverity`: the conversion stands for the hit's one Armor Slot.
   * Plan lanes, V (widened): `into: "gold"`: handfuls of gold instead (Money Talks, CB p.228: "spend a handful of gold
   * instead of marking HP (1 handful per HP)"; dcm-6ju).
   */
  | (OutcomeBase & { kind: "convertMarks"; from: Track; into: Track | "hope" | "gold"; insteadOfArmorSlot?: boolean })
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
  | (OutcomeBase & { kind: "help"; die: DieSides; free?: boolean })
  // ---- Plan lanes, tracer V: new outcome steps (docs/tasks/TASK-LN-V.md)
  /**
   * The actor's loadout: `swapWithVault` (Codex-Touched, CB p.333: "replace this card with any card from your vault without
   * paying its Recall Cost"; dcm-p1r), `reduceRecallCost` by `amount` on the recall this rider rides on (Perfect Recall, CB
   * p.50; dcm-bxp.99.19.1).
   */
  | (OutcomeBase & { kind: "loadout"; op: "swapWithVault" | "reduceRecallCost"; amount?: NumberSource })
  /**
   * A PC's inventory (dcm-0gh): `take` an item (Quick Hands, CB p.225; What's Yours Is Mine, CB p.229; Trophy Hunter, HF
   * p.84: `mostValuable`), `takeGold` `amount` handfuls (Expensive Failure, HF p.81), `damageWeapon` (Rust Touch, HF p.78:
   * the damage die one step down, destroyed below d4).
   * Plan lanes-2, V2 (widened): `giveGold` `amount` handfuls and `giveItem` (`text` names it; the GM's pick when unset) to
   * the recipient (Contacts Everywhere, CB p.43: "1 handful of gold, a unique tool, or a mundane object that the situation
   * requires"; dcm-vf7i).
   */
  | (OutcomeBase & {
      kind: "inventory";
      op: "take" | "takeGold" | "damageWeapon" | "giveGold" | "giveItem";
      item?: "any" | "consumable" | "mostValuable" | "metalWeapon";
      amount?: NumberSource;
      text?: string;
    })
  /**
   * End a lasting effect, condition or area on the recipient: this card's or feature's own (`of` unset; Confusing Aura, CB
   * p.329: "this spell ends"; dcm-8x8) or another feature's (`of` = its id; Howling Rampage, HF p.40: "drop out of Wolf
   * Form"; dcm-5fc). `option` narrows to one option of it.
   */
  | (OutcomeBase & { kind: "endEffect"; of?: string; option?: string })
  /** Set the active martial stance (Stance Fighter, HF p.12: "shift into a martial stance"; `stance` or the pick in `choice`; dcm-awh). */
  | (OutcomeBase & { kind: "setStance"; stance?: string; choice?: string })
  /**
   * This use (or `useId`) is spent until `per` (Rune Ward, CB p.328: "If the Ward Die result is 8, the ward's power ends …
   * It can be recharged for free on your next rest"; dcm-war). The opposite of `refreshFeature`.
   */
  | (OutcomeBase & { kind: "exhaust"; per: Limit["per"]; useId?: string })
  /**
   * A defeated creature comes back (Won't Stay Dead, CB p.217: "re-forms with no marked HP"; Corpse Whisperer, HF p.80:
   * "half its HP cleared"; Phoenix, Midnight Heart, HF p.86-88: HP and Stress cleared; dcm-145).
   */
  | (OutcomeBase & { kind: "revive"; clearHp: "all" | "half"; clearStress?: boolean })
  /** The recipient makes a death move (CRONCH!, HF p.70; Petrifying Slash, HF p.75; Doom Countdown; dcm-702). */
  | (OutcomeBase & { kind: "deathMove" })
  /**
   * The rest flow (dcm-2a1, dcm-bxp.99.19.2): `extraMove` (Eloquent, CB p.29: "an additional downtime move during their
   * next rest"; Celestial Trance, CB p.56), `longMoveOnShort` (Efficient, CB p.53: "choose a long rest move instead of a
   * short rest move"), `rerollDie` (Oasis, HF p.27: "reroll a die used for a downtime move and take the higher result").
   * `at`: this rest (default) or the recipient's next one.
   */
  | (OutcomeBase & { kind: "downtime"; op: "extraMove" | "longMoveOnShort" | "rerollDie"; at?: "thisRest" | "nextRest" })
  /**
   * The hit's Armor Slots cost more (dcm-s77): `slotsPerStep` slots per severity step (Armor Eater, HF p.71; Tormenting
   * Lash, CB p.235; Rending Jaws, HF p.81: 2), `alsoMark` per slot used (Boiling Blast, CB p.236: "they must also mark a
   * Stress"). Applies to the hit the reaction window holds.
   */
  | (OutcomeBase & { kind: "armorCost"; slotsPerStep?: number; alsoMark?: { track: "stress" | "hp"; amount: number } })
  // ---- Plan lanes-2, tracer V2: new outcome steps (docs/tasks/TASK-LN-V2.md)
  /**
   * The recipients (the attackers) make an attack against a creature picked by `against` (`side` from the actor's view,
   * ranges measured from the attacker; never the attacker itself): Words of Discord (CB p.335: "make an attack against
   * another adversary instead of against you or your allies"; dcm-c8h3), Beguiled (Tentacle Rays, HF p.75: "attack a target
   * chosen by the Gobstalker"; dcm-zi3k). An adversary attacker makes its standard attack; a PC is prompted.
   */
  | (OutcomeBase & { kind: "forcedAttack"; against: TargetSpec })
  /**
   * The adversary instance now uses another stat block (`adversaryId`), keeping its HP and Stress marked (Transform,
   * Forlorne Lykona, HF p.142-143: "shift between her Dragon Form and Faun Form. While she embodies a form, she uses its
   * statistics and features"; dcm-3ag5).
   */
  | (OutcomeBase & { kind: "changeForm"; adversaryId: string });

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
  // ---- Plan lanes, tracer V (widened)
  /** `wall`: a line the creatures cross (Wall of Flame, CB p.332; Wall of Hunger, HF p.181); default `circle` (dcm-cma). */
  shape?: "circle" | "wall";
  /**
   * Steps for a creature that enters the area (Rune Circle, CB p.332: "who enter Melee range"), crosses a wall (Wall of
   * Flame: "passes through the wall"), moves through it (Acid Bath, CB p.210; Suppressing Fire, CB p.220) or acts inside
   * it (Bramble Patch, CB p.230). `to: "triggerSubject"` is that creature (dcm-cma, dcm-wuu).
   */
  onEnter?: readonly Step[];
  onCross?: readonly Step[];
  onActInside?: readonly Step[];
  /** The area moves with its centre token (Hush, CB p.336: "follows them as they move"; `centre: "target"`; dcm-cma, dcm-nt4). */
  follows?: boolean;
  /** The owner is not a member (Acid Bath: "all creatures other than the Burrower"; dcm-wuu). */
  excludeOwner?: boolean;
  /** The area is a thing with thresholds and Hit Points that can be attacked (Wild Fortress, CB p.339: 15/30, 3 HP; dcm-cj8). */
  damageable?: { major: number; severe: number; hp: number; attacksAutoSucceed?: boolean };
  /** A `point` centre is picked within this range of the owner (Dark Cloud, CB p.42: "any area within Close range"; dcm-bxp.99.19.39). */
  placeWithin?: Range;
  /**
   * Members have this condition toward any observer whose line of sight the area blocks (Dark Cloud: "Cloaked from any
   * adversary for whom the cloud blocks line of sight"; dcm-bhp).
   */
  perObserver?: StandardCondition;
  // ---- Plan lanes-2, tracer V2 (widened)
  /** The area also ends on its owner's events (Hush, CB p.336: "or you take Major damage"; dcm-rx1k; Veil of Night: `castsSpell`, dcm-o44e). */
  endsOnCaster?: readonly EndEvent[];
  /**
   * `blocksSight` blocks everyone but these (Eclipse, CB p.337: "complete darkness only you and your allies can see
   * through"; Veil of Night, CB p.336: "Only you can see through this darkness"; dcm-o44e).
   */
  seeThrough?: "owner" | "ownerAndAllies";
  /** The owner has this condition toward observers whose sight the area blocks (Veil of Night: "You're considered Hidden to adversaries on the other side of the veil"; dcm-o44e). */
  ownerPerObserver?: StandardCondition;
  /**
   * Members have this condition while inside (Shadow Swarm, HF p.82: "Creatures that aren't Cryptimoths are Vulnerable while
   * inside that area"; dcm-wuu).
   */
  memberCondition?: ConditionRef;
  /** A member must do this to leave (Bramble Patch, CB p.230: "must succeed on a Finesse Roll or deal more than 20 damage to the Dryad with an attack to leave the area"; dcm-wuu). */
  leave?: Escape;
  /** A creature can end the area this way (Shadow Swarm: "A PC can dispel the swarm with a successful Spellcast Roll (12)"; dcm-wuu). */
  dispel?: Escape;
  /** That many areas are placed, each its own (Forest Sprites, CB p.339: "an equal number of small forest sprites who appear at points you choose"; dcm-5yew). */
  count?: NumberSource;
  /**
   * A `self` / `target` centre stays on the square it was placed on instead of following the token (Phantom Retreat, CB
   * p.336: "activate Phantom Retreat where you're currently standing"; a `move` `relativeTo: "area"` returns there; dcm-5yew).
   */
  anchored?: boolean;
}

/** Plan lanes, V: "each ally picks for themselves" on a `choose` / `optional` step (dcm-bz8, dcm-6ju): who decides, one pick each. */
export interface ChooserSpec {
  to: Recipient;
  pick?: TargetSpec;
}

/**
 * Plan lanes, V: a `followUp` that repeats (dcm-rou, dcm-7az): until a `miss` (Rip & Tear, HF p.76: "until the Alebrujo
 * fails an attack roll") or `noTargets` (Chain Lightning, CB p.328: "until there are no more adversaries within range");
 * `costEach` paid before each repeat (Rip & Tear: a Stress); `max` caps it.
 */
export interface FollowUpRepeat {
  until: "miss" | "noTargets" | "checkFails";
  costEach?: readonly Cost[];
  max?: number;
  /**
   * Plan lanes-2, V2 (widened): with `until: "checkFails"`, the chain goes on while this check holds after each link:
   * `dice` rolled fresh (Lightning Strike, HF p.91: "roll a d6. On a result of 4 or higher, the lightning bounces"), or with
   * no `dice` the link's own damage dice (Lightning Bolt, HF p.96: "If all results are even ... until you roll an odd
   * result or run out of targets"; dcm-4yg4). It stops too when no target is left.
   */
  check?: { dice?: DiceExpr; test: CheckTest };
  /** Plan lanes-2, V2: a damage change added once per link so far ("Each time the lightning bounces, decrease the damage it deals by 1d10"; dcm-4yg4). */
  perLink?: DamageChange;
}

/** One option of a `choose` step. */
export interface ChooseOption {
  id: string;
  label: string;
  steps: readonly Step[];
}

/** The flow steps: payment, choices, reaction rolls, checks and follow-up rolls around the outcomes. */
export type FlowStep =
  /**
   * A payment after the roll: Bolt Beacon "On a success, spend a Hope to …" (gated by `when`; R8 lets the same roll's Hope pay).
   * Plan lanes, V (widened): `paidBy` (`Payer`; dcm-8yr, dcm-uj0).
   */
  | (StepBase & { kind: "pay"; costs: readonly Cost[]; paidBy?: Payer })
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
      /**
       * DA0 (widened): the add-on is taken unless the player turns it off (Draining Bane, HF p.14: "you can clear a
       * Stress"; user answer 2026-10-29, dcm-bxp.99.19.15: an optional tick that is ON by default). The runner takes it
       * when `RunContext.optionals` omits it and skips it only when `RunContext.optionalsOff` names it.
       */
      defaultOn?: boolean;
      /** Plan lanes, V (widened): each of these recipients decides (and pays) for themselves (Money Talks, Double or Nothing, CB p.228-229; dcm-6ju). */
      by?: ChooserSpec;
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
      /** Plan lanes, V (widened): each of these recipients picks their own option (Critical Inspiration, Rousing Strike, CB p.341-342; dcm-bz8). */
      by?: ChooserSpec;
      /** Plan lanes, V (widened): not the option picked in that other choose step (Twin Fang, HF p.9; Attack of Opportunity; dcm-40m, dcm-fjh). */
      distinctFrom?: string;
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
      /**
       * Plan lanes, V (widened): `advantage` / `disadvantage` on the recipients' rolls, only while `modsWhen` holds when it
       * is set (Entice, HF p.85; dcm-rb0); `autoFail`: recipients with one of these conditions fail without rolling
       * (Bee-Ruption, HF p.77: "Restrained targets automatically fail"; dcm-fev).
       */
      advantage?: boolean;
      disadvantage?: boolean;
      modsWhen?: readonly Gate[];
      autoFail?: readonly ConditionRef[];
    })
  /**
   * A plain dice check: Arcane Reflection "If any roll a 6", Shrug It Off "On a result of 3 or lower, place this card in your vault".
   * Plan lanes, V (widened): `table`: the row whose range holds the total runs instead of `then` / `otherwise` (which run
   * when no row matches; dcm-27j).
   */
  | (StepBase & {
      kind: "check";
      dice: DiceExpr;
      test: CheckTest;
      then: readonly Step[];
      otherwise: readonly Step[];
      table?: readonly CheckRow[];
    })
  /**
   * A second roll or a second set of targets inside the same move: Telekinesis "make an additional Spellcast Roll
   * against the second target", Whirlwind "use the attack against all other targets within Very Close range" (no `roll`:
   * the move's roll is reused), Chain Lightning's chain.
   */
  | (StepBase & { kind: "followUp"; roll?: RollSpec; targets: TargetSpec; steps: readonly Step[]; repeat?: FollowUpRepeat });

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
  // Plan lanes, tracer V
  "loadout",
  "inventory",
  "endEffect",
  "setStance",
  "exhaust",
  "revive",
  "deathMove",
  "downtime",
  "armorCost",
  // Plan lanes-2, tracer V2
  "forcedAttack",
  "changeForm",
] as const;

export type StepKind = (typeof STEP_KINDS)[number];

// ---------------------------------------------------------------- choices, uses, effects

/** A number the player picks before the roll ("spend any number of Hope", "mark any number of Stress"). */
export interface NumberChoice {
  id: string;
  label: string;
  min: number;
  max?: NumberSource;
  /** Plan lanes, V (widened): only these values (Teleport, CB p.333: +3 / +1 / 0 / -2; dcm-uyc). */
  values?: readonly number[];
  /**
   * Plan lanes, V (widened): asked after the targets are picked, so `max` can read the target (Share the Burden, CB p.335:
   * "any number of their marked Stress"; Shared Trauma, HF p.180; dcm-fnq).
   */
  afterTargets?: boolean;
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
  /**
   * DA0 (widened): another creature makes this use's roll (Cannonball, CB p.33: "the ally makes an attack roll using
   * Agility or Strength (their choice) against a target within Close range. On a success, the adversary takes d12+2
   * physical damage using the thrower's Proficiency"; user answer 2026-10-29, dcm-bxp.99.19.21: the ally gets a prompt
   * and rolls from their own drawer). The actor's run pays the costs and the limit and sends the picked ally an
   * `allyRoll` prompt; the roller's run (`RunContext.roller`) makes `roll` with the roller's traits against
   * `rolledBy.targets` and runs `steps`. `proficiency` says whose Proficiency the damage uses (QUESTIONS, TASK-DA-DA0.md).
   */
  rolledBy?: RolledBy;
  /** Plan lanes, V (widened): the use's `costs` are paid by this creature instead of the actor (Rune Ward's holder, CB p.328; dcm-uj0). */
  paidBy?: Payer;
}

/** DA0: who rolls a `rolledBy` use, whose Proficiency its damage uses, and what the roller picks. */
export interface RolledBy {
  who: "ally";
  proficiency: "actor" | "roller";
  /** The roller's targets (Cannonball: "a target within Close range"), measured from the roller. */
  targets: TargetSpec;
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
