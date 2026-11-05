/**
 * The rule registry (plan rule-switches RS0, epic dcm-jh6d part A; bead dcm-bxp.134): every general rule the app
 * applies by itself, with its book pages and, where the GM may change it, its modes. Source list:
 * `.omc/plans/rule-registry-list.md` (61 rules) plus the optional rules the user decided on 2026-10-30 (10).
 * User answers that shape it: `.omc/plans/rule-switches-briefs.md` ("User answers 2026-11-05").
 *
 * Kinds:
 * - `switch`: the GM picks a mode. Modes in order: `book`, the variants, `manual`. Manual = the app stops applying the
 *   rule and posts a GM-only feed note instead (`postRuleNote`, convex/lib/ruleModes.ts).
 * - `appRule`: as `switch`, but the default is the app's own rule, not a book rule (M2), so its `book` mode is labelled
 *   "App rule" and marked not in the books.
 * - `bookOnly`: the app always does it; House rules shows a read-only row with its page.
 * - `optional`: an optional rule from the books, on or off (`default`), or a choice (`choices`, Shared domain cards).
 *
 * A rule with `frames` exists only in those frames: elsewhere it is hidden and resolves to `book` / off.
 *
 * Pure module, bundled into Convex: no framework imports. Stored shape: `campaigns.ruleModes`
 * (convex/lib/validators/ruleModes.ts); a drift test (tests/unit/rules/registry.test.ts) ties the two together.
 * Adding a rule or a mode: docs/tasks/TASK-RULES-RS0.md.
 */
import type { FrameId } from "../frames/index";

export type Book = "CB" | "HF";
/** A printed page: CB = Core Book, HF = Hope & Fear. */
export type BookRef = { readonly book: Book; readonly page: number };

export type RuleArea =
  | "rolls"
  | "hopeFear"
  | "damage"
  | "armor"
  | "conditions"
  | "rests"
  | "death"
  | "spotlight"
  | "map"
  | "levelUp"
  | "countdowns"
  | "adversaries"
  | "frame"
  | "optional";

/** One mode of a switch rule, or one choice of an optional choice rule. */
export type ModeDef = {
  readonly id: string;
  readonly label: string;
  /** A variant the books don't print (user 2026-11-05: allowed, labelled "not in the books"). */
  readonly notInBooks: boolean;
  /** Where the books print it, when the rule's own refs don't cover it. */
  readonly ref?: BookRef;
};

/** A number the GM sets in the rule's row (Spotlight Tracker tokens, the darkness Difficulty). */
export type RuleParamDef = {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly default: number;
};

type RuleBase = {
  /** The stored key (camelCase); never renamed once shipped. */
  readonly id: string;
  /** The code of the registry list (R3, F2, ...); optional rules have none. */
  readonly code?: string;
  readonly area: RuleArea;
  readonly title: string;
  /** One line: what the app does in Book mode (or when the optional rule is on). */
  readonly does: string;
  readonly refs: readonly BookRef[];
  /** Frames that have the rule; unset = every frame. */
  readonly frames?: readonly FrameId[];
};

export type SwitchRuleDef = RuleBase & {
  readonly kind: "switch" | "appRule";
  /** `book` first, `manual` last, the variants between. */
  readonly modes: readonly ModeDef[];
  readonly param?: RuleParamDef;
  /**
   * X2 (Q8 a): read-only, and resolved to `manual`, while this other rule is `manual` (the death move prompt: without
   * it there is nothing to resolve).
   */
  readonly needs?: string;
};

export type BookOnlyRuleDef = RuleBase & { readonly kind: "bookOnly" };

export type OptionalRuleDef = RuleBase & {
  readonly kind: "optional";
  readonly default: boolean;
  readonly param?: RuleParamDef;
};

export type OptionalChoiceRuleDef = RuleBase & {
  readonly kind: "optional";
  readonly choices: readonly ModeDef[];
  readonly default: string;
};

export type RuleDef = SwitchRuleDef | BookOnlyRuleDef | OptionalRuleDef | OptionalChoiceRuleDef;

const CB = (page: number): BookRef => ({ book: "CB", page });
const HF = (page: number): BookRef => ({ book: "HF", page });

const BOOK = { id: "book", label: "Book", notInBooks: false } as const;
const MANUAL = { id: "manual", label: "Manual", notInBooks: false } as const;
const BOOK_MANUAL = [BOOK, MANUAL] as const;

/** The registry, in House rules order. Ids are stored keys: add, never rename or remove (widen only). */
export const RULES = [
  // ------------------------------------------------------------ 1. Rolls & dice
  { id: "rollOutcome", code: "R1", area: "rolls", kind: "bookOnly", title: "Who won the roll", does: "The higher of the Hope and Fear dice decides with Hope or with Fear; the total against the Difficulty decides success.", refs: [CB(90)] },
  { id: "criticalSuccess", code: "R2", area: "rolls", kind: "bookOnly", title: "Matching dice = critical", does: "Doubles always succeed; the player also gains 1 Hope and clears 1 Stress.", refs: [CB(90)] },
  { id: "hopeFearFromRolls", code: "R3", area: "rolls", kind: "switch", title: "Hope and Fear from rolls", does: "A roll with Hope gives the player 1 Hope; a roll with Fear gives the GM 1 Fear.", refs: [CB(90), CB(154)], modes: BOOK_MANUAL },
  { id: "reactionRolls", code: "R4", area: "rolls", kind: "bookOnly", title: "Reaction rolls give nothing", does: "A reaction roll gives no Hope or Fear, and nobody can help.", refs: [CB(99)] },
  { id: "advantage", code: "R5", area: "rolls", kind: "bookOnly", title: "Advantage and disadvantage", does: "Advantage adds a d6, disadvantage takes one away; they cancel one for one; of the helpers' dice only the highest counts.", refs: [CB(100)] },
  { id: "experienceCost", code: "R6", area: "rolls", kind: "bookOnly", title: "Experiences cost Hope", does: "Adding an Experience to a roll costs 1 Hope per Experience.", refs: [CB(90)] },
  { id: "helpAnAlly", code: "R7", area: "rolls", kind: "bookOnly", title: "Help an Ally", does: "A helper spends 1 Hope and adds a d6 to a friend's roll.", refs: [CB(90)] },
  { id: "tagTeam", code: "R8", area: "rolls", kind: "bookOnly", title: "Tag Team roll", does: "3 Hope, once per session per player; both roll and the starter picks which roll counts for both.", refs: [CB(90), CB(97)] },
  { id: "hopeCap", code: "R9", area: "rolls", kind: "bookOnly", title: "Hope cap", does: "A character holds at most 6 Hope, one less per scar; extra Hope is lost.", refs: [CB(90)] },
  { id: "criticalDamage", code: "R10", area: "rolls", kind: "bookOnly", title: "Critical damage", does: "A critical attack starts from the dice's maximum and rolls the dice again on top.", refs: [CB(98), CB(148)] },
  { id: "adversaryAttackRoll", code: "R11", area: "rolls", kind: "bookOnly", title: "Adversary attack roll", does: "One d20 plus the attack bonus against Evasion; a natural 20 always hits and crits.", refs: [CB(160), CB(148)] },

  // ------------------------------------------------------------ 2. Hope & Fear
  { id: "fearCap", code: "F1", area: "hopeFear", kind: "bookOnly", title: "Fear cap", does: "The GM's Fear pool stops at 12.", refs: [CB(154)] },
  {
    id: "fearFromRests",
    code: "F2",
    area: "hopeFear",
    kind: "switch",
    title: "Fear from rests",
    does: "Finishing a rest rolls the GM's Fear: 1d4 on a short rest, 1d4 + the PCs present on a long rest.",
    refs: [CB(105)],
    // Q7 a: an extra choice on the GM's long rest (several days pass: 1d6 Fear per PC); other rests follow the book.
    modes: [BOOK, { id: "extendedDowntime", label: "Extended downtime (several days)", notInBooks: false, ref: CB(181) }, MANUAL],
  },
  { id: "extraSpotlightFear", code: "F3", area: "hopeFear", kind: "switch", title: "Extra adversary spotlight costs Fear", does: "In the encounter tracker, each adversary after the first in a GM turn takes 1 Fear.", refs: [CB(153)], modes: BOOK_MANUAL },
  { id: "adversaryExperienceFear", code: "F4", area: "hopeFear", kind: "bookOnly", title: "Adversary Experience costs Fear", does: "Adding an adversary's Experience to its roll takes 1 Fear.", refs: [CB(154)] },
  { id: "fearFeatures", code: "F5", area: "hopeFear", kind: "bookOnly", title: "Fear features cost Fear", does: "Using an adversary's or environment's Fear feature takes the Fear from the pool.", refs: [CB(154)] },

  // ------------------------------------------------------------ 3. Damage & thresholds
  { id: "damageThresholds", code: "D1", area: "damage", kind: "bookOnly", title: "Damage to Hit Points", does: "Damage against the two thresholds marks 1, 2 or 3 HP (PCs and adversaries).", refs: [CB(91)] },
  { id: "resistance", code: "D2", area: "damage", kind: "switch", title: "Resistance and immunity", does: "A resistant target takes half the damage (rounded up) before the thresholds; an immune one takes none.", refs: [CB(99), CB(107)], modes: BOOK_MANUAL },
  { id: "directDamage", code: "D3", area: "damage", kind: "bookOnly", title: "Direct damage", does: "Direct damage can't be reduced with Armor Slots; the armor prompt doesn't appear.", refs: [CB(99)] },
  { id: "stressOverflow", code: "D4", area: "damage", kind: "switch", title: "Stress overflow", does: "Marking Stress with a full Stress track marks 1 Hit Point instead.", refs: [CB(92)], modes: BOOK_MANUAL },
  { id: "fullStressVulnerable", code: "D5", area: "damage", kind: "switch", title: "Full Stress = Vulnerable", does: "A full Stress track makes the character or adversary Vulnerable until it clears a Stress.", refs: [CB(92), CB(178)], modes: BOOK_MANUAL },
  {
    id: "minions",
    code: "D6",
    area: "damage",
    kind: "switch",
    title: "Minions",
    does: "Any damage defeats a Minion; every X damage defeats one more, and the attacker picks which.",
    refs: [CB(201)],
    // Q5 a: the picker opens on the GM's screen and the attack waits (the book doesn't say who picks).
    modes: [BOOK, { id: "gmPicks", label: "GM picks the extra Minions", notInBooks: true }, MANUAL],
  },
  { id: "hordes", code: "D7", area: "damage", kind: "bookOnly", title: "Hordes", does: "A Horde with half or more of its HP marked deals its lower Horde damage.", refs: [CB(199)] },
  { id: "adversaryDefeated", code: "D8", area: "damage", kind: "switch", title: "Adversary defeated at last HP", does: "An adversary whose last HP is marked is shown defeated and loses its turn in the tracker.", refs: [CB(208)], modes: BOOK_MANUAL },

  // ------------------------------------------------------------ 4. Armor
  { id: "armorSlots", code: "A1", area: "armor", kind: "switch", title: "Armor Slots soften a hit", does: "A hit PC is asked to mark one Armor Slot to drop the damage one step; at most one per attack.", refs: [CB(114), CB(19)], modes: BOOK_MANUAL },
  { id: "armorThresholds", code: "A2", area: "armor", kind: "bookOnly", title: "Thresholds from armor + level", does: "A PC's thresholds are the armor's numbers plus their level.", refs: [CB(111)] },
  { id: "unarmored", code: "A3", area: "armor", kind: "bookOnly", title: "Unarmored", does: "With no armor: Armor Score 0, Major = level, Severe = twice the level.", refs: [CB(114)] },

  // ------------------------------------------------------------ 5. Conditions
  { id: "conditionDice", code: "C1", area: "conditions", kind: "switch", title: "Conditions change the dice", does: "Attacking a Vulnerable target gets advantage; attacking a Hidden or Cloaked target gets disadvantage.", refs: [CB(102)], modes: BOOK_MANUAL },
  { id: "hiddenEnds", code: "C2", area: "conditions", kind: "switch", title: "Hidden / Cloaked end on the map", does: "A Hidden or Cloaked PC who attacks, or ends a move in an enemy's sight, loses it.", refs: [CB(102)], modes: BOOK_MANUAL },
  { id: "conditionsDontStack", code: "C3", area: "conditions", kind: "bookOnly", title: "Conditions don't stack", does: "Turning a condition on twice does nothing.", refs: [CB(102)] },
  { id: "unconscious", code: "C4", area: "conditions", kind: "bookOnly", title: "Unconscious", does: "An unconscious PC can't act or be attacked; they wake when an ally clears their HP or on a long rest.", refs: [CB(106)] },

  // ------------------------------------------------------------ 6. Rests & downtime
  { id: "twoDowntimeMoves", code: "T1", area: "rests", kind: "bookOnly", title: "Two moves per rest", does: "Each PC picks two downtime moves (the same one twice is fine).", refs: [CB(105)] },
  { id: "shortRestLimit", code: "T2", area: "rests", kind: "switch", title: "Short-rest limit", does: "A fourth short rest in a row is refused; the party must take a long rest.", refs: [CB(105)], modes: BOOK_MANUAL },
  { id: "downtimeMoveEffects", code: "T3", area: "rests", kind: "bookOnly", title: "What each move does", does: "The app rolls and applies each downtime move.", refs: [CB(105)] },
  { id: "interruptedRest", code: "T4", area: "rests", kind: "switch", title: "Interrupted rest", does: "An interrupted short rest gives nothing; an interrupted long rest gives short-rest moves.", refs: [CB(105)], modes: BOOK_MANUAL },
  { id: "restRefreshes", code: "T5", area: "rests", kind: "bookOnly", title: "Rest refreshes features", does: "Finishing a rest ends 'until your next rest' effects and resets per-rest uses.", refs: [CB(105)] },

  // ------------------------------------------------------------ 7. Death & revival
  { id: "deathMovePrompt", code: "X1", area: "death", kind: "switch", title: "Death move prompt", does: "When a PC marks their last Hit Point, their player is asked to choose a death move.", refs: [CB(106)], modes: BOOK_MANUAL },
  {
    id: "deathMoveResolve",
    code: "X2",
    area: "death",
    kind: "switch",
    title: "Death moves resolve themselves",
    does: "Avoid Death and Risk It All roll and apply their results by themselves.",
    refs: [CB(106)],
    modes: BOOK_MANUAL,
    // Q8 a: two rows; X2 is read-only ("Needs the death move prompt") while X1 is Manual.
    needs: "deathMovePrompt",
  },
  { id: "scars", code: "X3", area: "death", kind: "bookOnly", title: "Scars", does: "A scar crosses out a Hope slot; a PC with no Hope slots left is listed at session end.", refs: [CB(106), CB(182)] },

  // ------------------------------------------------------------ 8. Spotlight & turns
  { id: "spotlightToGm", code: "S1", area: "spotlight", kind: "switch", title: "Spotlight goes to the GM on a failure or Fear", does: "A PC's failed roll or roll with Fear hands the spotlight to the GM.", refs: [CB(100), CB(149)], modes: BOOK_MANUAL },
  { id: "playersWait", code: "S2", area: "spotlight", kind: "switch", title: "Players wait while the GM has it", does: "While the GM holds the spotlight, a player's action or token move is refused; reaction rolls still work.", refs: [CB(100)], modes: BOOK_MANUAL },
  { id: "adversarySpotlightLimit", code: "S3", area: "spotlight", kind: "bookOnly", title: "One spotlight per adversary per GM turn", does: "The tracker counts each adversary's spotlights and warns past one (more with Relentless).", refs: [CB(153), CB(195)] },

  // ------------------------------------------------------------ 9. Range, sight & movement
  { id: "lineOfSight", code: "M1", area: "map", kind: "switch", title: "Line of sight and cover", does: "An attack on a target nobody can see is refused; a target behind cover is attacked with disadvantage.", refs: [CB(104)], modes: BOOK_MANUAL },
  {
    id: "wallsBlock",
    code: "M2",
    area: "map",
    kind: "appRule",
    title: "Walls and doors stop tokens",
    does: "A player can't drag a token through a wall or closed door; the GM can, with a warning.",
    refs: [CB(104)],
    modes: [{ id: "book", label: "App rule", notInBooks: true }, MANUAL],
  },
  {
    id: "darkness",
    code: "M3",
    area: "map",
    kind: "switch",
    title: "Darkness",
    does: "Dim light shows a badge; nothing is added to the roll.",
    refs: [CB(104)],
    // Q6 (user 2026-11-05): the GM picks disadvantage, +N Difficulty (N set in the row, default 2) or both.
    modes: [
      BOOK,
      { id: "disadvantage", label: "Dim light: disadvantage", notInBooks: false, ref: CB(104) },
      { id: "difficulty", label: "Dim light: raise the Difficulty", notInBooks: false, ref: CB(104) },
      { id: "both", label: "Dim light: both", notInBooks: true },
      MANUAL,
    ],
    param: { key: "darknessDifficulty", label: "Difficulty raised by", min: 1, max: 4, default: 2 },
  },
  { id: "outOfRange", code: "M4", area: "map", kind: "bookOnly", title: "Out-of-range targets", does: "A table setting: an out-of-range attack asks the GM or is refused.", refs: [CB(103)] },

  // ------------------------------------------------------------ 10. Level-up & advancement
  { id: "levelAchievements", code: "L1", area: "levelUp", kind: "bookOnly", title: "Achievements at levels 2, 5, 8", does: "Level-up adds a +2 Experience and +1 Proficiency; at 5 and 8 trait marks clear.", refs: [CB(109)] },
  { id: "levelUpPicks", code: "L2", area: "levelUp", kind: "bookOnly", title: "Two picks per level from the tier list", does: "Each level offers two picks with per-tier slot limits.", refs: [CB(110)] },
  { id: "domainCardLevels", code: "L3", area: "levelUp", kind: "bookOnly", title: "Domain card levels", does: "New domain cards are limited to the character's level (multiclass domain: half).", refs: [CB(111)] },

  // ------------------------------------------------------------ 11. Countdowns
  { id: "countdownTicks", code: "K1", area: "countdowns", kind: "switch", title: "Countdowns tick on action rolls", does: "An armed countdown ticks down after every PC action roll and fires at 0.", refs: [CB(162), CB(97)], modes: BOOK_MANUAL },
  { id: "dynamicCountdowns", code: "K2", area: "countdowns", kind: "bookOnly", title: "Dynamic countdowns", does: "A dynamic countdown ticks by the roll's result.", refs: [CB(163)] },
  { id: "chases", code: "K3", area: "countdowns", kind: "bookOnly", title: "Chases", does: "Two linked countdowns; when both reach 0 on one roll, the GM decides.", refs: [CB(163)] },

  // ------------------------------------------------------------ 12. Adversaries & environments
  { id: "battlePoints", code: "E1", area: "adversaries", kind: "bookOnly", title: "Battle Points budget", does: "The encounter builder shows the budget and the points spent; it never blocks.", refs: [CB(197)] },

  // ------------------------------------------------------------ 13. Frame-specific
  { id: "witherTokens", code: "W1", area: "frame", kind: "switch", title: "Wither tokens", does: "Severe damage from a Withered enemy gives a Wither token, and the Fear Die roll for a scar.", refs: [CB(261)], frames: ["witherwild"], modes: BOOK_MANUAL },
  { id: "horizonSanctuaryRest", code: "W2", area: "frame", kind: "switch", title: "Long rest only in a sanctuary", does: "A long rest outside a sanctuary is refused.", refs: [HF(176)], frames: ["journey-to-horizon"], modes: BOOK_MANUAL },
  { id: "doomTrack", code: "W3", area: "frame", kind: "bookOnly", title: "Doom Track", does: "At session end the GM is reminded to mark a Doom Track box.", refs: [HF(177)], frames: ["journey-to-horizon"] },
  { id: "beastFeastFeast", code: "W4", area: "frame", kind: "switch", title: "Make a Feast", does: "Clear Stress, Tend to Wounds and Prepare are not offered; Make a Feast is.", refs: [CB(278)], frames: ["beast-feast"], modes: BOOK_MANUAL },
  { id: "colossusSiphoning", code: "W5", area: "frame", kind: "switch", title: "Siphoning on rests", does: "In the hunt phase a short rest marks the Siphoning Track once, a long rest twice.", refs: [CB(327)], frames: ["colossus-of-the-drylands"], modes: BOOK_MANUAL },
  { id: "umbraLurkingDarkness", code: "W6", area: "frame", kind: "switch", title: "Lurking Darkness", does: "A rest away from a Sacred Pyre rolls a d12 on the Lurking Darkness list for the GM.", refs: [CB(289)], frames: ["age-of-umbra"], modes: BOOK_MANUAL },
  { id: "andaluriaLycanthropy", code: "W7", area: "frame", kind: "switch", title: "Lycanthropy countdown", does: "The countdown ticks on each rest unless the PC takes the halt-lycanthropy move.", refs: [HF(153)], frames: ["dark-heart-of-andaluria"], modes: BOOK_MANUAL },
  { id: "motherboardIkonis", code: "W8", area: "frame", kind: "bookOnly", title: "Ikonis and quantum", does: "No normal weapons (the Ikonis instead) and no gold (scrap and quantum instead).", refs: [CB(301), CB(302)], frames: ["motherboard"] },

  // ------------------------------------------------------------ Optional rules (user 2026-10-30): off except Defined Ranges
  { id: "massiveDamage", area: "optional", kind: "optional", title: "Massive Damage", does: "Damage of at least twice the Severe threshold marks 4 HP (PCs and adversaries).", refs: [CB(91)], default: false },
  {
    id: "spotlightTracker",
    area: "optional",
    kind: "optional",
    title: "Spotlight Tracker",
    does: "Each PC has action tokens; an action roll spends one, and all refill when every PC is out.",
    refs: [CB(89)],
    default: false,
    // Q9 a: the GM sets the tokens per PC (the book suggests 3).
    param: { key: "spotlightTrackerTokens", label: "Tokens per PC", min: 1, max: 6, default: 3 },
  },
  { id: "fallingDamage", area: "optional", kind: "optional", title: "Falling and collision", does: "A GM button rolls falling or collision damage and applies it through the normal hit.", refs: [CB(168)], default: false },
  { id: "underwater", area: "optional", kind: "optional", title: "Underwater", does: "Attacks underwater get disadvantage; a breath countdown ticks and, at 0, every action marks a Stress.", refs: [CB(168)], default: false },
  { id: "goldCoins", area: "optional", kind: "optional", title: "Gold coins", does: "A Coins row on the sheet's gold; 10 coins roll into 1 handful.", refs: [CB(104)], default: false },
  { id: "fateRolls", area: "optional", kind: "optional", title: "Fate rolls", does: "A Fate roll button in every player's dice box rolls the Hope or Fear Die alone; no Hope or Fear.", refs: [CB(168)], default: false },
  { id: "pcConflict", area: "optional", kind: "optional", title: "Conflict between PCs", does: "A PC can attack another PC against Evasion, and the GM can call a Contest.", refs: [CB(168)], default: false },
  {
    id: "horizonEncounterBonuses",
    area: "optional",
    kind: "optional",
    title: "Horizon encounter bonuses",
    does: "The app rolls the Encounter table; a setback gives the GM 1 Fear per PC, good fortune gives each PC 1 Hope.",
    refs: [HF(171)],
    frames: ["journey-to-horizon"],
    default: false,
  },
  {
    id: "sharedDomainCards",
    area: "optional",
    kind: "optional",
    title: "Shared domain cards",
    does: "Whether two PCs may hold the same domain card.",
    refs: [CB(21)],
    // Q16 (user 2026-11-05): a three-way setting; new campaigns default to Warn.
    choices: [
      { id: "allow", label: "Allow", notInBooks: false },
      { id: "warn", label: "Warn", notInBooks: false },
      { id: "refuse", label: "Refuse", notInBooks: true },
    ],
    default: "warn",
  },
  { id: "definedRanges", area: "optional", kind: "optional", title: "Defined Ranges", does: "The map counts squares for ranges, shows range hints and checks ranges.", refs: [CB(103)], default: true },
] as const satisfies readonly RuleDef[];

type Registry = (typeof RULES)[number];

/** Every rule id. */
export type RuleId = Registry["id"];
/** Rules with modes (`switch` and `appRule`). */
export type SwitchRuleId = Extract<Registry, { modes: readonly unknown[] }>["id"];
/** Optional rules switched on or off. */
export type ToggleRuleId = Extract<Registry, { kind: "optional"; default: boolean }>["id"];
/** Optional rules with a choice (Shared domain cards). */
export type ChoiceRuleId = Extract<Registry, { choices: readonly unknown[] }>["id"];
/** Rules the GM can set: everything but the Book-only rows. */
export type SettableRuleId = SwitchRuleId | ToggleRuleId | ChoiceRuleId;
/** The numbers set in a rule's row. */
export type RuleParamKey = Extract<Registry, { param: RuleParamDef }>["param"]["key"];

/** The modes of a switch rule (`ModeOf<"fearFromRests">` = "book" | "extendedDowntime" | "manual"). */
export type ModeOf<R extends SwitchRuleId> = Extract<Registry, { id: R }> extends { modes: readonly (infer M)[] } ? (M extends { id: infer I } ? I : never) : never;
/** The choices of a choice rule. */
export type ChoiceOf<R extends ChoiceRuleId> = Extract<Registry, { id: R }> extends { choices: readonly (infer M)[] } ? (M extends { id: infer I } ? I : never) : never;

/** Every rule's resolved mode, as `ruleModesOf` returns it. */
export type RuleModes = { readonly [R in SwitchRuleId]: ModeOf<R> } & { readonly [R in ToggleRuleId]: boolean } & {
  readonly [R in ChoiceRuleId]: ChoiceOf<R>;
} & { readonly [K in RuleParamKey]: number };

/** What a campaign stores (`campaigns.ruleModes`): any field may be unset. */
export type StoredRuleModes = { -readonly [K in keyof RuleModes]?: RuleModes[K] };

/** The key of a stored field: a settable rule or a rule's number. */
export type RuleModeKey = keyof RuleModes;

const BY_ID = new Map<string, RuleDef>(RULES.map((r) => [r.id, r]));

/** The registry entry of a rule id, or undefined for an unknown id. */
export function ruleDef(id: string): RuleDef | undefined {
  return BY_ID.get(id);
}

/** Whether the rule exists in a campaign of this frame (no `frames` = every frame). */
export function ruleInFrame(rule: Pick<RuleDef, "frames">, frameId: FrameId): boolean {
  return rule.frames === undefined || rule.frames.includes(frameId);
}

/** The rules House rules lists for a frame, in registry order (frame rules of other frames are hidden). */
export function rulesFor(frameId: FrameId): readonly RuleDef[] {
  return (RULES as readonly RuleDef[]).filter((r) => ruleInFrame(r, frameId));
}

/** Whether a rule has modes (`switch` / `appRule`). */
export function isSwitchRule(rule: RuleDef): rule is SwitchRuleDef {
  return rule.kind === "switch" || rule.kind === "appRule";
}

/** Whether a rule is an optional choice rule. */
export function isChoiceRule(rule: RuleDef): rule is OptionalChoiceRuleDef {
  return rule.kind === "optional" && "choices" in rule;
}

/** Whether a rule is an optional on/off rule. */
export function isToggleRule(rule: RuleDef): rule is OptionalRuleDef {
  return rule.kind === "optional" && !("choices" in rule);
}

/** The rule whose row sets a number (`spotlightTrackerTokens` → Spotlight Tracker), or undefined. */
export function ruleOfParam(key: string): (SwitchRuleDef | OptionalRuleDef) | undefined {
  for (const r of RULES as readonly RuleDef[]) {
    if ((isSwitchRule(r) || isToggleRule(r)) && r.param?.key === key) return r;
  }
  return undefined;
}

/** "CB p.90" */
export function formatRef(ref: BookRef): string {
  return `${ref.book} p.${ref.page}`;
}
