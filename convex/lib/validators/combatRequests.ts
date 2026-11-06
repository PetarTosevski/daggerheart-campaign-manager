import { v, type Infer } from "convex/values";

import type { DamageKeyword } from "../../../src/lib/domain/card-effects/types";
import { rollValidator } from "./actionLog";
import { conditionValidator, effectValidator, traitIdValidator } from "./characters";

/**
 * Validators of `combatRequests` (plan combat-actions, tracer AA0; table: convex/tables/combatRequests.ts). One row is
 * one thing waiting for someone at the table:
 * - `sanction` (Q1): a player's attack or card use on a target outside its range. Nothing is rolled or charged until
 *   the GM approves (CA3 / CA4 replay the stored action) or declines.
 * - `incomingHit` (Q13, Q17): one PC hit by an adversary, waiting in the reaction window. The target chooses armor,
 *   allies with an eligible reaction card answer Use / Pass, then the hit resolves (AA2).
 *
 * The payload is a typed union keyed by `kind` (no `v.any()`, rule 4) and carries `schemaVersion` (rule 7, CD3): a
 * new shape widens the union with a new version, a migration moves old rows, then the old member is dropped.
 * Arrays here are bounded by the party (at most 12 PCs) or by the targets of one action (at most 20); the writing
 * mutations enforce the caps (CD8).
 */

/**
 * `minionOffer` (CA3, widened; Q6, CB p.201): the extra Minions a PC's attack may defeat, waiting for the attacker's
 * pick (`combatActions.pickMinions`). Resolved by the pick, declined when the attack is undone or the encounter ends.
 */
/**
 * `preRoll` (plan sheet-drawer SD0, widened; Q2, HF p.14): an adversary's attack on a PC, held before its roll for the PCs
 * holding a ready before-roll defence (Harrowing Invocation, Draining Bane, Keen Defenses, Vigilant). Resolved when every
 * responder answered (or the GM pressed Resolve now), then the attack rolls; declined when the attack is withdrawn.
 */
/**
 * `afterRoll` (plan sheet-drawer SD5, widened; Q1, CB p.107): a player's own map attack held after its roll because the
 * attacker holds a ready, affordable after-roll feature (Patron's Boon, True Strike, …). Resolved by Use or Pass (the
 * player, or the GM's Resolve now); declined when the encounter ends.
 */
/**
 * `riderPick` (plan drawer-answers DA2, widened; HF p.8 Death Strike, user 2026-10-30): after a PC's attack dealt Severe
 * damage, a damage-phase rider ("you can mark a Stress to force them to mark an additional Hit Point") waits for the
 * attacker's Use (on the ONE creature they pick) or Pass. Never applied without this prompt. Resolved by the answer
 * (`combatActions.riderPick`, the player or the GM); declined when the encounter ends.
 */
/**
 * `targetCount` (plan drawer-answers DA12, widened; CB p.31 Warden's Protection, user 2026-10-29, dcm-d95): a target count
 * the server rolled before the player picks (the 1d4 allies). It holds until it is used or the scene ends (user
 * 2026-10-30, dcm-bxp.99.19.55 (1)): a scene mark on the roller's sheet ties it to the scene (convex/lib/featurePrompts.ts).
 * Resolved by the use that takes it (`resolveFeatureUse`); declined by the next roll once its scene mark is gone.
 */
/**
 * `serverMove` (plan drawer-answers DA12, widened; CB p.59 Charge, user 2026-10-30): the square a token left when the
 * server moved it for a feature (Charge's run into Melee range). Open while the move can be undone: undoing the use's
 * actionLog group puts the token back and declines it (`declineGroupOffers`); the character's next server move resolves
 * the older one, and the encounter's end declines it.
 */
/**
 * `difficulty` (plan lanes B2, widened; CB p.104 "The GM sets this Difficulty"; user 2026-10-30): a roll that waits for the
 * GM's Difficulty. `ask.kind` `charge` (dcm-bxp.99.19.61): a player's Charge (CB p.59), with the target, square, Stress and
 * roll options the player picked; `cloak` (dcm-bxp.99.19.62 (1)): a Cloaked rogue who ended a move seen only dimly by enemies
 * none of which has a Difficulty (a custom token, an enemy-side PC or companion). The GM answers with a Difficulty
 * (`featurePrompts.answerDifficulty`: the server rolls) or declines. Superseded by the character's next request of the same
 * `ask.kind`, declined when the encounter ends or the move's actionLog group is undone.
 */
/**
 * `allyRoll` (plan drawer-answers DA13, widened; CB p.33 Cannonball, user 2026-10-29 / 2026-10-30, dcm-bxp.99.19.21): a
 * use whose roll another PC makes. The druid's use pays the Stress and opens it; the throwing ally answers it from their
 * own drawer (`featurePrompts.allyRoll`), or the GM cancels it (`featurePrompts.cancelAllyRoll`). Closed once the druid's
 * use is undone (`entryId`), superseded by the druid's next throw, and declined once it expires (`ALLY_ROLL_TTL_MS`).
 */
export const combatRequestKindValidator = v.union(
  v.literal("sanction"),
  v.literal("incomingHit"),
  v.literal("minionOffer"),
  v.literal("preRoll"),
  v.literal("afterRoll"),
  v.literal("riderPick"),
  v.literal("targetCount"),
  v.literal("serverMove"),
  v.literal("allyRoll"),
  v.literal("difficulty"),
  v.literal("cloakPrompt"),
  v.literal("forcedAttack"),
  v.literal("gmPrompt"),
  v.literal("allyPick"),
);

/**
 * `open` until answered; `resolved` (approved / hit applied), `declined` (the GM refused a sanction, or the request was
 * closed with its encounter or undo) or `withdrawn` (dcm-bxp.99.32.17: the player took back their own sanction or
 * Charge before the GM answered, `combatWithdraw.withdraw`; older withdrawals were stored `declined`, see
 * `migrations/combatRequestWithdrawn`).
 */
export const combatRequestStatusValidator = v.union(v.literal("open"), v.literal("resolved"), v.literal("declined"), v.literal("withdrawn"));

/** A Defined Range band on the map (CB p.103), as `rangeCheck` reports it (CA1). */
export const rangeBandValidator = v.union(
  v.literal("melee"),
  v.literal("veryClose"),
  v.literal("close"),
  v.literal("far"),
  v.literal("veryFar"),
);

/**
 * The duality options of the stored action, as the player sent them (mirrors `dualityFields` in convex/rolls.ts,
 * every field optional so CA3 / CA4 keep only what their mutation takes). Replayed unchanged on approval.
 */
export const sanctionRollOptionsValidator = v.object({
  trait: v.optional(traitIdValidator),
  modifier: v.optional(v.number()),
  difficulty: v.optional(v.number()),
  experienceIds: v.optional(v.array(v.string())),
  advantage: v.optional(v.number()),
  disadvantage: v.optional(v.number()),
  help: v.optional(v.number()),
  options: v.optional(v.array(v.string())),
  ikonis: v.optional(v.boolean()),
  slayerDice: v.optional(v.number()),
  tideTokens: v.optional(v.number()),
  /** The damage roll's chosen `rollOptions` keys (a weapon attack, CA3; widened). Auto options apply anyway. */
  damageOptions: v.optional(v.array(v.string())),
  /**
   * DA2 (widened; CB p.48 Rise to the Challenge, user 2026-10-30): `false` turns off a d20 Hope Die that is on by default
   * while it applies (the player fishing for a critical). Unset or `true`: on.
   */
  riseToTheChallenge: v.optional(v.boolean()),
  /**
   * Plan lanes-2, V4 (widened; dcm-1sk4, dcm-xbtw): the attack's ticked Spirit Weapon box (`attackRollFields.spiritWeapon`,
   * convex/lib/combatActions.ts), so a held attack keeps it. Unset: not ticked.
   */
  spiritWeapon: v.optional(v.boolean()),
});

/** A player's pick for a card use (`NumberChoice` amounts, `choose` / `optional` option ids; card-effects/types.ts). */
export const cardChoiceValidator = v.object({
  id: v.string(),
  value: v.union(v.number(), v.string(), v.array(v.string()), v.boolean()),
});

/**
 * A rider on an attack or a card use (plan sheet-drawer SD5): a loadout card's or an owned feature's use whose activation
 * is `rider`, taken with the attack ("With an attack" on the Hand and the drawer). `choices` as a card use's
 * (`n:<choice>`, `opt:<step>`, `situations`, `picked` for the extra targets of Hold Them Off or Surrounded).
 */
export const riderValidator = v.object({
  source: v.union(v.literal("card"), v.literal("feature")),
  /** The card id, or the feature id (`<source>:<owner>:<slug>`). */
  id: v.string(),
  /** The `CardUse.id`; default the entry's first rider use. */
  useId: v.optional(v.string()),
  choices: v.array(cardChoiceValidator),
});
export type Rider = Infer<typeof riderValidator>;

/** The most riders one attack takes (a character holds few: CB p.107 lets each apply once per roll). */
export const MAX_RIDERS_PER_ATTACK = 8;

/** Plan lanes-2, E2.3 (dcm-6y00 (3)): a map square a held use places its point area on. */
export const sanctionPointValidator = v.object({ x: v.number(), y: v.number() });

/**
 * The action a sanction holds: a weapon attack (CA3), a domain card use (CA4) or, widened by the sheet drawer (SD0), a
 * Hope / class / subclass / heritage / Beastform / transformation / stance feature use (`combatFeatures.useFeature`, SD3).
 */
export const sanctionActionValidator = v.union(
  v.object({
    kind: v.literal("attack"),
    slot: v.union(v.literal("primary"), v.literal("secondary")),
    targetTokenIds: v.array(v.id("combatTokens")),
    roll: sanctionRollOptionsValidator,
    /** SD5 (widened): the riders taken with the attack, replayed on approval. */
    riders: v.optional(v.array(riderValidator)),
  }),
  v.object({
    kind: v.literal("card"),
    cardId: v.string(),
    /** The `CardUse.id` ("main", or a grimoire spell's slug). */
    useId: v.string(),
    targetTokenIds: v.array(v.id("combatTokens")),
    choices: v.array(cardChoiceValidator),
    roll: v.optional(sanctionRollOptionsValidator),
    /** SD5 (widened): the riders taken with the card's attack, replayed on approval. */
    riders: v.optional(v.array(riderValidator)),
    /** Plan lanes-2, E2.3 (widened; dcm-6y00 (3)): the square a point area is placed on, replayed on approval. */
    point: v.optional(sanctionPointValidator),
  }),
  v.object({
    kind: v.literal("feature"),
    /** The feature id (`<source>:<owner>:<slug>`, src/lib/domain/feature-effects/ids.ts). */
    featureId: v.string(),
    /** The `CardUse.id` of the feature's use ("main", or an option's slug). */
    useId: v.string(),
    targetTokenIds: v.array(v.id("combatTokens")),
    choices: v.array(cardChoiceValidator),
    roll: v.optional(sanctionRollOptionsValidator),
    /**
     * Plan lanes-2, V4 (widened; dcm-mcgj): the riders taken with the feature's roll (`useFeature`'s `riders`), replayed on
     * approval as the card action's. At most `MAX_RIDERS_PER_ATTACK`. Absent: none sent (only automatic riders run).
     */
    riders: v.optional(v.array(riderValidator)),
    /**
     * Plan lanes-2, E2.3 (widened; dcm-6y00 (3)): the square a point area is placed on (`useFeature`'s `point`), so an
     * approved out-of-range use can place it. Absent: none picked (as before).
     */
    point: v.optional(sanctionPointValidator),
  }),
);

/** A target outside the action's range, with the band it is in (for the GM's prompt; CB p.103). */
export const outOfRangeTargetValidator = v.object({
  tokenId: v.id("combatTokens"),
  band: rangeBandValidator,
});

/** Q1: a player's out-of-range action waiting for the GM. */
export const sanctionPayloadValidator = v.object({
  schemaVersion: v.literal(1),
  kind: v.literal("sanction"),
  characterId: v.id("characters"),
  action: sanctionActionValidator,
  outOfRange: v.array(outOfRangeTargetValidator),
  /**
   * DA2 (widened; combat-actions Q1, user 2026-10-30): the tokens of `outOfRange` that a rider added (Hold Them Off, CB
   * p.38; Surrounded, HF p.10). Approving waives their range; declining drops only them when the attack's own target is in
   * range.
   */
  added: v.optional(v.array(v.id("combatTokens"))),
});

/** Who must or may answer a hit: the target (armor) or an ally holding an eligible reaction card (Q13). */
export const hitResponderValidator = v.object({
  characterId: v.id("characters"),
  role: v.union(v.literal("target"), v.literal("ally")),
  /** The reaction cards in this character's loadout whose trigger and range match (may be empty for the target). */
  cardIds: v.array(v.string()),
});

/**
 * Q13: one PC hit by an adversary, before the damage resolves. The attack roll is not stored here (it lives on the
 * GM's actionLog row; players never see it, Q14). `damage` is the rolled total before armor; the server derives the
 * severity against the character's own thresholds when it answers `pending`.
 */
/** The adversary instance that made the hit (AA0's attacker shape, unchanged). */
export const adversaryAttackerValidator = v.object({
  instanceId: v.id("encounterAdversaries"),
  /** The instance label at the time of the hit ("Bandit 2"), for "Bandit hit Mira". */
  label: v.string(),
  /** The feature used, as printed; unset for the standard attack. The server re-reads its effect from the registry. */
  feature: v.optional(v.string()),
});

/**
 * A PC whose domain card damaged another PC (AA2b, widened; user answer 2026-10-22: "card damage to another PC opens the
 * same incoming-hit prompt as an adversary attack"). Told apart from the adversary shape by `kind`.
 */
export const pcAttackerValidator = v.object({
  kind: v.literal("pc"),
  characterId: v.id("characters"),
  /** The character's name at the time of the hit ("Ash"), for "Ash hit Mira". */
  label: v.string(),
  /** The card used. */
  cardId: v.string(),
  /** The card's printed name. */
  feature: v.optional(v.string()),
});

/**
 * What an attack does to whoever takes its hit besides the damage (AA2b; user answer 2026-10-22: "the attack's rider
 * (e.g. Bite's Restrained) MOVES WITH THE DAMAGE to that ally"). Applied when the hit resolves, to the PC who took it,
 * unless the hit was avoided. `fromCondition` marks a card tag's effect (Bold Presence avoids it with the condition).
 */
export const hitRiderValidator = v.union(
  v.object({ kind: v.literal("condition"), condition: conditionValidator }),
  v.object({ kind: v.literal("effect"), effect: effectValidator, fromCondition: v.optional(v.boolean()) }),
  v.object({ kind: v.literal("stress"), amount: v.number() }),
  /**
   * Plan lanes-2, E2.3 (widened; dcm-nnbl): `reduceWithHope`: the PC may spend Hope to mark fewer of these HP, one for one
   * (Doom / Tentacle Rays, HF p.75: "they can spend any number of Hope to reduce the number of HP marked this way by an
   * equal amount"); the window offers it as the `hope` grant. Absent: the HP are forced.
   */
  v.object({ kind: v.literal("hp"), amount: v.number(), reduceWithHope: v.optional(v.boolean()) }),
  v.object({ kind: v.literal("hope"), delta: v.number() }),
);

/**
 * After the hit resolved (AA2b, CE-valor "For AA2"): the PC who took it may still answer a card its marks set off
 * (Unbreakable "When you mark your last Hit Point, instead of making a death move", CB p.342). While set and the row is
 * open, the row waits only for that character's `card` or `pass`; the damage is already on the sheet.
 */
export const afterHitValidator = v.object({
  characterId: v.id("characters"),
  cardIds: v.array(v.string()),
  severity: v.union(v.literal("none"), v.literal("minor"), v.literal("major"), v.literal("severe")),
  hpMarked: v.number(),
  deathMove: v.boolean(),
});

/**
 * Plan lanes-2, V4: a damage keyword (`DamageKeyword`, src/lib/domain/card-effects/types.ts: "fire"). Keep in step with
 * the type (checked below).
 */
export const damageKeywordValidator = v.literal("fire");
const damageKeywordInStep: [Infer<typeof damageKeywordValidator>] extends [DamageKeyword] ? ([DamageKeyword] extends [Infer<typeof damageKeywordValidator>] ? true : false) : false = true;
void damageKeywordInStep;

/**
 * Plan lanes-2, V4 (widened; dcm-sk4r, user 2026-10-31): a hit with no known type or keyword on a PC whose resistance names
 * a keyword (Fireproof, HF p.22: "immune to damage from magical or mundane flame") waits for the GM: "Was this hit
 * fire?". `characterId` holds the resistance, `feature` is its printed name; `answer` is the GM's (`keywordAnswerValidator`):
 * unset until answered, `true` the hit carries the keyword, `false` it doesn't. Stored here, not in `responses` (a GM
 * answer, not a responder's choice).
 */
export const keywordAskValidator = v.object({
  keyword: damageKeywordValidator,
  characterId: v.id("characters"),
  feature: v.string(),
  answer: v.optional(v.boolean()),
  /** The user who answered (the GM). */
  answeredBy: v.optional(v.id("users")),
});

/** Plan lanes-2, V4 (dcm-sk4r): the GM's answer to a hit's `keywordAsk`: `carries` true, the hit carries `keyword`. */
export const keywordAnswerValidator = v.object({ keyword: damageKeywordValidator, carries: v.boolean() });

export const incomingHitPayloadValidator = v.object({
  schemaVersion: v.literal(1),
  kind: v.literal("incomingHit"),
  attacker: v.union(adversaryAttackerValidator, pcAttackerValidator),
  targetCharacterId: v.id("characters"),
  /** The target's PC token on the live map, when there is one. */
  targetTokenId: v.optional(v.id("combatTokens")),
  damage: v.number(),
  damageType: v.union(v.literal("physical"), v.literal("magic"), v.literal("both")),
  /** Armor Slots can't reduce it (CB p.99). */
  direct: v.boolean(),
  /** "must mark an Armor Slot without gaining its benefit" (CB p.195): slots marked with no step-down. */
  forcedArmor: v.optional(v.number()),
  critical: v.boolean(),
  /** Rows of one adversary action (several targets) share it, so they resolve into one actionLog group. */
  groupId: v.string(),
  responders: v.array(hitResponderValidator),
  /** AA2b (widened): the attack's riders, landing on whoever takes the hit. At most `MAX_RIDERS`. */
  riders: v.optional(v.array(hitRiderValidator)),
  /** AA2b (widened): set when the hit resolved and its target still has an after-hit card to answer. */
  afterHit: v.optional(afterHitValidator),
  /**
   * DA8 (widened): this target's own attack total (DA1: a target with its own disadvantage keeps its own die), so a
   * window rebuilt later compares Evasion answers with it. GM-only: never in a player's view (Q14).
   */
  attackTotal: v.optional(v.number()),
  /** DA8 (widened): disadvantage this target puts on the roll beyond the whole roll's (DA1), for its forced rerolls. */
  attackDisadvantage: v.optional(v.number()),
  /** Plan lanes-2, V4 (widened; dcm-sk4r): the GM's keyword question on this hit (`keywordAskValidator`). */
  keywordAsk: v.optional(keywordAskValidator),
});

/** The most riders one hit carries. */
export const MAX_RIDERS = 20;

/** A Minion group (or single Minion) the attacker may pick from: still standing, within range, its Difficulty beaten. */
export const minionCandidateValidator = v.object({
  instanceId: v.id("encounterAdversaries"),
  tokenId: v.id("combatTokens"),
  /** Minions of this instance that may be picked: its unmarked HP (one HP per Minion), capped at the offer's `extra`. */
  available: v.number(),
});

/**
 * Q6 (CB p.201, "Minion (X)"): "For every X damage a PC deals to this adversary, defeat an additional Minion within range
 * the attack would succeed against. … let them choose which Minions they defeat." Written by CA3's attack (widened).
 */
export const minionOfferPayloadValidator = v.object({
  schemaVersion: v.literal(1),
  kind: v.literal("minionOffer"),
  characterId: v.id("characters"),
  /** The attack's actionLog group; the pick logs into it, so undoing the attack undoes the pick too. */
  groupId: v.string(),
  /** The attack's public actionLog row (the id the attacker passes to `pickMinions`). */
  entryId: v.id("actionLog"),
  /** How many extra Minions the attacker may defeat in all. */
  extra: v.number(),
  candidates: v.array(minionCandidateValidator),
  /**
   * Rule switches RC1 (widened), D6 variant "GM picks the extra Minions" (not in the books, Q5 a): the GM picks, not the
   * attacker (`pickMinions` refuses a player with FORBIDDEN). Absent: the attacker picks (the Book).
   */
  picker: v.optional(v.literal("gm")),
});

/**
 * The adversary attack a `preRoll` row holds (Q2): what `adversaryActions.attack` / `useFeature` took, replayed when the
 * window closes. `feature` / `useId` unset: the standard attack. Bounded by the party (at most 12 targets).
 */
export const heldAttackValidator = v.object({
  instanceId: v.id("encounterAdversaries"),
  feature: v.optional(v.string()),
  useId: v.optional(v.string()),
  /** The attack's targets: PC character ids (the targets of `sharedArgs` resolved). */
  targetCharacterIds: v.array(v.id("characters")),
  advantage: v.optional(v.number()),
  disadvantage: v.optional(v.number()),
  experience: v.optional(v.string()),
  spendFear: v.optional(v.number()),
  reactions: v.optional(v.array(v.string())),
});

/** Who may answer a before-roll prompt: a PC with a ready, affordable before-roll defence (feature ids, SD0 ids). */
export const preRollResponderValidator = v.object({
  characterId: v.id("characters"),
  featureIds: v.array(v.string()),
});

/**
 * Q2 (plan sheet-drawer, widened by SD0): an adversary attack held before its roll ("Bandit attacks you / Mira"). Only PCs
 * in `responders` see it, with Use / Pass; the GM can Resolve now. No roll is stored: nothing is rolled yet.
 */
export const preRollPayloadValidator = v.object({
  schemaVersion: v.literal(1),
  kind: v.literal("preRoll"),
  attacker: adversaryAttackerValidator,
  attack: heldAttackValidator,
  /** Rows of one adversary action share it with its later `incomingHit` rows, so they resolve into one actionLog group. */
  groupId: v.string(),
  responders: v.array(preRollResponderValidator),
});

/** A before-roll feature used on a `preRoll` prompt (Q2), with its `useFeature` choices. */
export const preRollFeatureChoiceValidator = v.object({
  kind: v.literal("feature"),
  featureId: v.string(),
  useId: v.optional(v.string()),
  choices: v.array(cardChoiceValidator),
});

/** One answer to a `preRoll` prompt: a before-roll feature use or a pass. */
export const preRollChoiceValidator = v.union(preRollFeatureChoiceValidator, v.object({ kind: v.literal("pass") }));

/**
 * What an after-roll feature does to the held roll (SD5, Q1): `reroll` the Duality Dice (`advantage`: with one more
 * advantage die, Patron's Boon; `hopeAtMost`: only a Hope Die at or under it, Internal Compass), `withHope` (Fearless,
 * Unbound), `outcome` (True Strike's success, Witch's Charm's success with Fear), `add` a number to the total (Prayer Dice).
 */
export const afterRollChangeValidator = v.union(
  v.object({ kind: v.literal("reroll"), advantage: v.optional(v.boolean()), hopeAtMost: v.optional(v.number()) }),
  v.object({ kind: v.literal("withHope") }),
  v.object({ kind: v.literal("outcome"), outcome: v.union(v.literal("success"), v.literal("successWithFear"), v.literal("successWithHope")) }),
  v.object({ kind: v.literal("add"), amount: v.number() }),
);
export type AfterRollChange = Infer<typeof afterRollChangeValidator>;

/** An after-roll feature the attacker may use on the held roll (the feature id and use; their names are re-read). */
export const afterRollOptionValidator = v.object({ featureId: v.string(), useId: v.string() });

/**
 * Q1 (plan sheet-drawer SD5, widened): a player's own weapon attack held after its Duality roll, before any damage is
 * rolled, because the attacker holds a ready, affordable after-roll feature. Nothing is paid or written yet: `dice` are
 * every die the attack drew so far, in order, so Use and Pass resolve the attack with the same dice (a reroll draws
 * fresh ones from `dualityAt`). `roll` and `hits` are what the player already saw (their own dice, Hit / Miss, U1).
 */
export const afterRollPayloadValidator = v.object({
  schemaVersion: v.literal(1),
  kind: v.literal("afterRoll"),
  characterId: v.id("characters"),
  action: v.object({
    kind: v.literal("attack"),
    slot: v.union(v.literal("primary"), v.literal("secondary")),
    targetTokenIds: v.array(v.id("combatTokens")),
    roll: sanctionRollOptionsValidator,
    riders: v.optional(v.array(riderValidator)),
    /** DA2 (widened): rider-added targets whose range the GM waived (an approved sanction held after its roll). */
    waived: v.optional(v.array(v.id("combatTokens"))),
  }),
  /** At most 60 dice (a Duality roll with its advantage, help and riders' dice). */
  dice: v.array(v.number()),
  /** Where the Duality Dice (Hope, Fear, then advantage dice) start in `dice`. */
  dualityAt: v.number(),
  roll: rollValidator,
  hits: v.array(v.object({ tokenId: v.id("combatTokens"), hit: v.boolean() })),
  options: v.array(afterRollOptionValidator),
});

/** One answer to an `afterRoll` row: use one of its features (with `useFeature`-style choices), or pass. */
export const afterRollChoiceValidator = v.union(
  v.object({ kind: v.literal("use"), featureId: v.string(), useId: v.optional(v.string()), choices: v.array(cardChoiceValidator) }),
  v.object({ kind: v.literal("pass") }),
);

/** The roll a rider rides on, as its result filters read it (a critical counts as a success with Hope, CB p.90). */
export const hostRollValidator = v.object({ success: v.boolean(), critical: v.boolean(), withHope: v.boolean(), withFear: v.boolean() });

/**
 * DA2 (widened; HF p.8 Death Strike, user 2026-10-30): a damage-phase rider waiting for the attacker after the damage is
 * written: Use on ONE of `candidates` (the creatures that took the damage it needs, Severe for Death Strike), or Pass.
 * The answer logs into the attack's actionLog group (`groupId`), so undoing the attack undoes it. At most 20 candidates.
 */
export const riderPickPayloadValidator = v.object({
  schemaVersion: v.literal(1),
  kind: v.literal("riderPick"),
  characterId: v.id("characters"),
  groupId: v.string(),
  /** The attack's (or card's) public actionLog row; once it is undone the prompt is closed. */
  entryId: v.id("actionLog"),
  rider: v.object({ source: v.union(v.literal("card"), v.literal("feature")), id: v.string(), useId: v.string(), name: v.string() }),
  candidates: v.array(v.id("combatTokens")),
  hostRoll: hostRollValidator,
});

/** One answer to a `riderPick` row: use the rider on one candidate, or pass (nothing paid). */
export const riderPickChoiceValidator = v.union(v.object({ kind: v.literal("use"), tokenId: v.id("combatTokens") }), v.object({ kind: v.literal("pass") }));

/** DA12: a target count rolled on the server before the pick (Warden's Protection's 1d4). */
export const targetCountPayloadValidator = v.object({
  schemaVersion: v.literal(1),
  kind: v.literal("targetCount"),
  characterId: v.id("characters"),
  /** The feature id (`<source>:<owner>:<slug>`) and the `CardUse.id` the count is for. */
  featureId: v.string(),
  useId: v.string(),
  /** The rolled count: the most targets the use may take. */
  count: v.number(),
  /**
   * Retired (dcm-bxp.99.19.60): the count lasts until it is used or the scene ends, so nothing writes or reads this.
   * Widened to optional; a migration clears it from old rows, then the field is dropped (rule 7).
   */
  expiresAt: v.optional(v.number()),
});

/** A token's square and facing (combatTokens `x`, `y`, `face`). */
export const tokenSquareValidator = v.object({ x: v.number(), y: v.number(), face: v.number() });

/** DA12: a token the server moved for a feature use, with the square it left (undo puts it back). */
export const serverMovePayloadValidator = v.object({
  schemaVersion: v.literal(1),
  kind: v.literal("serverMove"),
  characterId: v.id("characters"),
  /** The use's actionLog group: undoing it undoes the move. */
  groupId: v.string(),
  tokenId: v.id("combatTokens"),
  from: tokenSquareValidator,
  to: tokenSquareValidator,
});

/** DA13: a use rolled by an ally (Cannonball's throw), waiting for the ally's roll. */
export const allyRollPayloadValidator = v.object({
  schemaVersion: v.literal(1),
  kind: v.literal("allyRoll"),
  /** The character whose use it is (the druid who is thrown) and that use. */
  characterId: v.id("characters"),
  featureId: v.string(),
  useId: v.string(),
  /** The ally who makes the roll, and their token on the map. */
  rollerCharacterId: v.id("characters"),
  rollerTokenId: v.id("combatTokens"),
  /** The use's actionLog group and public row; once that row is undone the prompt is closed. */
  groupId: v.string(),
  entryId: v.id("actionLog"),
  expiresAt: v.number(),
});

/** B2: what a `difficulty` request rolls once the GM sets the Difficulty. */
export const difficultyAskValidator = v.union(
  v.object({
    kind: v.literal("charge"),
    /** The Charge target (an enemy token at Far or Very Far range) and the square in Melee range of it. */
    targetTokenId: v.id("combatTokens"),
    square: v.object({ x: v.number(), y: v.number() }),
    /** Mark a Stress for the 1d12 (on a success). */
    stress: v.boolean(),
    /** The player's roll options (Experiences, advantage, modifier); never a Difficulty. */
    roll: sanctionRollOptionsValidator,
  }),
  v.object({
    kind: v.literal("cloak"),
    /** The rogue's token and the square the move ended on: a token that moved on since makes the request stale. */
    tokenId: v.id("combatTokens"),
    at: v.object({ x: v.number(), y: v.number() }),
    /** The enemies that saw it dimly (at most the map's tokens; names for the GM). */
    seers: v.array(v.id("combatTokens")),
    /** The move's actionLog group: the roll joins it, and undoing it declines the request. */
    groupId: v.string(),
  }),
);

export const difficultyPayloadValidator = v.object({
  schemaVersion: v.literal(1),
  kind: v.literal("difficulty"),
  characterId: v.id("characters"),
  ask: difficultyAskValidator,
});

/**
 * `cloakPrompt` (plan lanes-2, V4; dcm-vx5n, user 2026-10-31; CB p.42 Cloaked, CB p.99): a Cloaked PC's action roll that
 * targets an enemy but is not an attack, waiting for the GM's "Does <name>'s Cloaked end?". Yes ends Cloaked in the use's
 * undo group (`groupId`), no declines. `label` is the use's name ("Words of Discord"); `targetTokenIds` the enemies the
 * use targets (at most 20). Closed when the use is undone.
 */
export const cloakPromptPayloadValidator = v.object({
  schemaVersion: v.literal(1),
  kind: v.literal("cloakPrompt"),
  characterId: v.id("characters"),
  /** The Cloaked PC's token on the map. */
  tokenId: v.id("combatTokens"),
  label: v.string(),
  groupId: v.string(),
  targetTokenIds: v.array(v.id("combatTokens")),
});

/**
 * `forcedAttack` (plan lanes-2, V4; dcm-uxsd, user 2026-10-31): an adversary feature forces a PC to attack (Beguiled,
 * HF p.75; Tentacle Rays). The player's request opens their Attack bar with `targetTokenIds` locked; the attack resolves
 * the request in the forcing use's actionLog group (`groupId`). `instanceId` / `instanceLabel` are the forcing adversary
 * ("Gobstalker"), `feature` the printed feature name. At most 20 targets.
 */
export const forcedAttackPayloadValidator = v.object({
  schemaVersion: v.literal(1),
  kind: v.literal("forcedAttack"),
  characterId: v.id("characters"),
  instanceId: v.id("encounterAdversaries"),
  instanceLabel: v.string(),
  feature: v.string(),
  targetTokenIds: v.array(v.id("combatTokens")),
  groupId: v.string(),
});

/** What a `gmPrompt` asks the GM to do (convex/lib/adversaryFeatures.ts `Prompt`). */
export const gmPromptKindValidator = v.union(
  v.literal("manual"),
  v.literal("move"),
  v.literal("pcSave"),
  v.literal("summon"),
  v.literal("countdown"),
  v.literal("spotlight"),
  v.literal("choice"),
);

/** The most GM prompts one adversary use stores (CD8); a use rarely has more than three. */
export const MAX_GM_PROMPTS_PER_USE = 12;

/**
 * `gmPrompt` (dcm-bxp.99.32.27, widened; plan combat-hud H5.1, board CmpPromptsGM "More Where That Came From: Choose for
 * the feature"): one GM prompt of an adversary feature use (summon, countdown, manual, a PC's save, ...), the step the GM
 * applies by hand. Stored open so a reload or a second GM tab keeps it and the HUD queue lists it
 * (`adversaryPromptsReads.pending`); the GM marks it done or dismisses it (`adversaryPrompts.answer`). Closed (declined)
 * when the use is undone (its `groupId`) or the encounter ends. `instanceLabel` / `feature` name the adversary and the
 * printed feature; `text` is the prompt as `useFeature` returns it. GM only: never read by a player.
 */
export const gmPromptPayloadValidator = v.object({
  schemaVersion: v.literal(1),
  kind: v.literal("gmPrompt"),
  instanceId: v.id("encounterAdversaries"),
  instanceLabel: v.string(),
  feature: v.string(),
  prompt: gmPromptKindValidator,
  text: v.string(),
  groupId: v.string(),
});

/**
 * `allyPick` (plan finish-hud-lk FH-AP, widened; dcm-bxp.99.32.24, user 2026-11-05): a card, feature or adversary feature
 * whose `choose` step has each chooser pick their own option (`by`: Rousing Strike, CB p.342; Critical Inspiration,
 * CB p.341; Locust Swarm, Awesome Size, Elemental Breath's Fire, HF p.92-93). Each chooser answers on their own screen
 * (`allyPicks.answer`: that character's player, or the GM for anyone, a no-show included); nothing of the use applies
 * until every chooser answered, then the server runs it with the picks (`source`). Declined when the use's actionLog group
 * is undone or its encounter ends (as a reaction window). At most `MAX_ALLY_PICK_CHOOSERS` choosers.
 */
export const allyPickChooserValidator = v.object({
  stepId: v.string(),
  /** The runner's id of the chooser (`by:<stepId>:<chooserId>`): a PC card's token id, an adversary feature's character id. */
  chooserId: v.string(),
  /** The chooser's character (its player answers); unset: only the GM answers. */
  characterId: v.optional(v.id("characters")),
  name: v.string(),
  label: v.string(),
  options: v.array(v.object({ id: v.string(), label: v.string() })),
});

/** One chooser's answer: the option picked, who sent it (the character's player or the GM) and when. */
export const allyPickAnswerValidator = v.object({ stepId: v.string(), chooserId: v.string(), options: v.array(v.string()), by: v.id("users"), at: v.number() });

/** A PC's rider (Rousing Strike on a critical attack), held after the attack: it runs whole on the stored roll once all picked. */
export const allyPickRiderSourceValidator = v.object({
  kind: v.literal("rider"),
  characterId: v.id("characters"),
  rider: v.object({ source: v.union(v.literal("card"), v.literal("feature")), id: v.string(), useId: v.string(), name: v.string() }),
  /** The rider's own choices as the player sent them with the attack. */
  choices: v.array(cardChoiceValidator),
  hostRoll: hostRollValidator,
  /** The attack's public actionLog row; once it is undone the picks are closed. */
  entryId: v.id("actionLog"),
});

/** `adversaryActions.useFeature`'s arguments, kept to run the feature once all picked. */
export const heldFeatureArgsValidator = v.object({
  instanceId: v.string(),
  feature: v.optional(v.string()),
  useId: v.optional(v.string()),
  targets: v.array(v.string()),
  picked: v.optional(v.array(v.string())),
  allies: v.optional(v.array(v.string())),
  followUp: v.optional(v.array(v.string())),
  chain: v.optional(v.array(v.array(v.string()))),
  raisers: v.optional(v.array(v.string())),
  trigger: v.optional(v.object({ sourceId: v.optional(v.string()), subjectId: v.optional(v.string()), amount: v.optional(v.number()) })),
  options: v.optional(v.array(v.object({ id: v.string(), values: v.array(v.string()) }))),
  optionals: v.optional(v.array(v.string())),
  situations: v.optional(v.array(v.string())),
  eitherCosts: v.optional(v.array(v.number())),
  splits: v.optional(v.array(v.object({ id: v.string(), amount: v.number() }))),
  advantage: v.optional(v.number()),
  disadvantage: v.optional(v.number()),
  experience: v.optional(v.string()),
  spendFear: v.optional(v.number()),
  reactions: v.optional(v.array(v.string())),
  buyOffs: v.optional(v.array(v.string())),
});

/** An adversary feature use held before anything applied, with the die values its first run rolled (replayed first). */
export const allyPickAdversarySourceValidator = v.object({
  kind: v.literal("adversary"),
  instanceId: v.id("encounterAdversaries"),
  args: heldFeatureArgsValidator,
  dice: v.array(v.number()),
});

export const allyPickPayloadValidator = v.object({
  schemaVersion: v.literal(1),
  kind: v.literal("allyPick"),
  /** The card or feature ("Rousing Strike", "Locust Swarm") and who used it ("Brannoc", "Harbinger"). */
  name: v.string(),
  actorName: v.string(),
  /** The use's actionLog group: the run joins it, and undoing it closes the picks. */
  groupId: v.string(),
  source: v.union(allyPickRiderSourceValidator, allyPickAdversarySourceValidator),
  choosers: v.array(allyPickChooserValidator),
  answers: v.array(allyPickAnswerValidator),
});

/** The most choosers one `allyPick` row holds (a party of 12 and the actor). */
export const MAX_ALLY_PICK_CHOOSERS = 13;

/** The payload of a `combatRequests` row; `kind` matches the row's `kind`. */
export const combatRequestPayloadValidator = v.union(
  sanctionPayloadValidator,
  incomingHitPayloadValidator,
  minionOfferPayloadValidator,
  preRollPayloadValidator,
  afterRollPayloadValidator,
  riderPickPayloadValidator,
  targetCountPayloadValidator,
  serverMovePayloadValidator,
  allyRollPayloadValidator,
  difficultyPayloadValidator,
  cloakPromptPayloadValidator,
  forcedAttackPayloadValidator,
  gmPromptPayloadValidator,
  allyPickPayloadValidator,
);

/**
 * One answer in a reaction window (Q13): `armor` (mark Armor Slots; `slots` above 1 only where a card allows it,
 * I Am Your Shield, CB p.341), `noArmor`, a reaction `card`, or `pass`. Plan lanes-2, E2.3 (widened): `grant`, the hit
 * PC takes what the attacker lets them pay instead of Hit Points (`pending`'s `grants`): `id` `hope` spends `amount` Hope
 * on the forced HP of `reduceWithHope` riders (dcm-nnbl, HF p.75), `gold` pays up to `amount` handfuls of gold instead of
 * the HP the standard attack marks (dcm-5cn5, Money Talks, CB p.228).
 */
export const hitChoiceValidator = v.union(
  v.object({ kind: v.literal("armor"), slots: v.optional(v.number()) }),
  v.object({ kind: v.literal("noArmor") }),
  v.object({ kind: v.literal("card"), cardId: v.string(), useId: v.optional(v.string()) }),
  v.object({ kind: v.literal("pass") }),
  v.object({ kind: v.literal("grant"), id: v.string(), amount: v.number() }),
);

export const combatResponseValidator = v.object({
  characterId: v.id("characters"),
  /** An `incomingHit` answer, or (widened, sheet drawer SD0) a `preRoll` feature answer (Q2). */
  choice: v.union(hitChoiceValidator, preRollFeatureChoiceValidator),
  /** The user who answered (the character's player, or the GM acting for them). */
  by: v.id("users"),
  at: v.number(),
});

/** The stored fields of one `combatRequests` row (see convex/tables/combatRequests.ts). */
export const combatRequestFields = {
  campaignId: v.id("campaigns"),
  encounterId: v.optional(v.id("encounters")),
  mapId: v.optional(v.id("combatMaps")),
  kind: combatRequestKindValidator,
  status: combatRequestStatusValidator,
  createdBy: v.id("users"),
  createdAt: v.number(),
  payload: combatRequestPayloadValidator,
  /** Answers so far (incomingHit; a sanction has none, its answer is `status`). At most one per responder. */
  responses: v.array(combatResponseValidator),
  /** Set whenever `status` leaves `open`; the retention cron reads it (convex/cleanup.ts `expireCombatRequests`). */
  resolvedAt: v.optional(v.number()),
  resolvedBy: v.optional(v.id("users")),
};

export const combatRequestRowValidator = v.object({
  _id: v.id("combatRequests"),
  _creationTime: v.number(),
  ...combatRequestFields,
});

export type CombatRequestKind = Infer<typeof combatRequestKindValidator>;
export type CombatRequestStatus = Infer<typeof combatRequestStatusValidator>;
export type SanctionPayload = Infer<typeof sanctionPayloadValidator>;
export type SanctionAction = Infer<typeof sanctionActionValidator>;
export type IncomingHitPayload = Infer<typeof incomingHitPayloadValidator>;
export type HitRider = Infer<typeof hitRiderValidator>;
export type AfterHit = Infer<typeof afterHitValidator>;
export type AdversaryAttacker = Infer<typeof adversaryAttackerValidator>;
export type PcAttacker = Infer<typeof pcAttackerValidator>;
export type CombatRequestPayload = Infer<typeof combatRequestPayloadValidator>;
export type HitResponder = Infer<typeof hitResponderValidator>;
export type HitChoice = Infer<typeof hitChoiceValidator>;
export type CombatResponse = Infer<typeof combatResponseValidator>;
export type MinionOfferPayload = Infer<typeof minionOfferPayloadValidator>;
export type PreRollPayload = Infer<typeof preRollPayloadValidator>;
export type HeldAttack = Infer<typeof heldAttackValidator>;
export type PreRollChoice = Infer<typeof preRollChoiceValidator>;
export type AfterRollPayload = Infer<typeof afterRollPayloadValidator>;
export type AfterRollChoice = Infer<typeof afterRollChoiceValidator>;
export type RiderPickPayload = Infer<typeof riderPickPayloadValidator>;
export type RiderPickChoice = Infer<typeof riderPickChoiceValidator>;
export type TargetCountPayload = Infer<typeof targetCountPayloadValidator>;
export type ServerMovePayload = Infer<typeof serverMovePayloadValidator>;
export type AllyRollPayload = Infer<typeof allyRollPayloadValidator>;
export type DifficultyPayload = Infer<typeof difficultyPayloadValidator>;
export type DifficultyAsk = Infer<typeof difficultyAskValidator>;
export type KeywordAsk = Infer<typeof keywordAskValidator>;
export type KeywordAnswer = Infer<typeof keywordAnswerValidator>;
export type CloakPromptPayload = Infer<typeof cloakPromptPayloadValidator>;
export type ForcedAttackPayload = Infer<typeof forcedAttackPayloadValidator>;
export type AllyPickPayload = Infer<typeof allyPickPayloadValidator>;
export type AllyPickChooser = Infer<typeof allyPickChooserValidator>;
export type HeldFeatureArgs = Infer<typeof heldFeatureArgsValidator>;
