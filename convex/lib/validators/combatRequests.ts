import { v, type Infer } from "convex/values";

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
export const combatRequestKindValidator = v.union(v.literal("sanction"), v.literal("incomingHit"), v.literal("minionOffer"), v.literal("preRoll"));

/** `open` until answered; `resolved` (approved / hit applied) or `declined` (the GM refused a sanction). */
export const combatRequestStatusValidator = v.union(v.literal("open"), v.literal("resolved"), v.literal("declined"));

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
});

/** A player's pick for a card use (`NumberChoice` amounts, `choose` / `optional` option ids; card-effects/types.ts). */
export const cardChoiceValidator = v.object({
  id: v.string(),
  value: v.union(v.number(), v.string(), v.array(v.string()), v.boolean()),
});

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
  }),
  v.object({
    kind: v.literal("card"),
    cardId: v.string(),
    /** The `CardUse.id` ("main", or a grimoire spell's slug). */
    useId: v.string(),
    targetTokenIds: v.array(v.id("combatTokens")),
    choices: v.array(cardChoiceValidator),
    roll: v.optional(sanctionRollOptionsValidator),
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
  v.object({ kind: v.literal("hp"), amount: v.number() }),
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

/** The payload of a `combatRequests` row; `kind` matches the row's `kind`. */
export const combatRequestPayloadValidator = v.union(sanctionPayloadValidator, incomingHitPayloadValidator, minionOfferPayloadValidator, preRollPayloadValidator);

/**
 * One answer in a reaction window (Q13): `armor` (mark Armor Slots; `slots` above 1 only where a card allows it,
 * I Am Your Shield, CB p.341), `noArmor`, a reaction `card`, or `pass`.
 */
export const hitChoiceValidator = v.union(
  v.object({ kind: v.literal("armor"), slots: v.optional(v.number()) }),
  v.object({ kind: v.literal("noArmor") }),
  v.object({ kind: v.literal("card"), cardId: v.string(), useId: v.optional(v.string()) }),
  v.object({ kind: v.literal("pass") }),
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
