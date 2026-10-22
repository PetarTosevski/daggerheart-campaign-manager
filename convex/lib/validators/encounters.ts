import { v, type Infer } from "convex/values";

/**
 * Validators of the adversary and encounter tables (D8, `convex/tables/encounters.ts`), defined once (CD19).
 * All typed, no blob, so no `schemaVersion`. Length and count caps the validators cannot express are checked by
 * the helpers in `convex/lib/encounters.ts`.
 */

/** An encounter's life: prepared, being played, finished. At most one `running` per campaign. */
export const ENCOUNTER_STATUSES = ["draft", "running", "ended"] as const;
export const encounterStatusValidator = v.union(...ENCOUNTER_STATUSES.map((s) => v.literal(s)));
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];

/**
 * Battle Points adjustments (CB p.197): easy −1 (less difficult or shorter), twoSolo −2 (2 or more Solos),
 * dmg −2 (+1d4 or +2 to all adversary damage), lowTier +1 (an adversary from a lower tier), noBig +1 (no
 * Bruisers, Hordes, Leaders or Solos), hard +2 (more dangerous or longer).
 */
export const BP_ADJUSTMENTS = ["easy", "twoSolo", "dmg", "lowTier", "noBig", "hard"] as const;
export const bpAdjustmentValidator = v.union(...BP_ADJUSTMENTS.map((a) => v.literal(a)));
export type BpAdjustment = (typeof BP_ADJUSTMENTS)[number];

/** Conditions the tracker toggles on an instance (CB p.102, plus Distracted from the Bard's Make a Scene). */
export const ENCOUNTER_CONDITIONS = ["hidden", "restrained", "vulnerable", "distracted"] as const;
export const encounterConditionValidator = v.union(...ENCOUNTER_CONDITIONS.map((c) => v.literal(c)));
export type EncounterCondition = (typeof ENCOUNTER_CONDITIONS)[number];

/** Adversary types (CB p.194). A Horde's "(N/HP)" is stored apart, as `hordePerHp`. */
export const ADVERSARY_TYPES = [
  "Bruiser",
  "Horde",
  "Leader",
  "Minion",
  "Ranged",
  "Skulk",
  "Social",
  "Solo",
  "Standard",
  "Support",
] as const;
export const adversaryTypeValidator = v.union(...ADVERSARY_TYPES.map((t) => v.literal(t)));

/** Feature kinds (CB p.194, plus Evolution from HF p.61). */
export const FEATURE_KINDS = ["passive", "action", "reaction", "evolution"] as const;
export const featureKindValidator = v.union(...FEATURE_KINDS.map((k) => v.literal(k)));

/** How a creature takes one damage type (CB p.99): halve it, take none, or take it as is. Same values as CA2's table. */
export const RESISTANCE_LEVELS = ["none", "resistant", "immune"] as const;
export const resistanceLevelValidator = v.union(...RESISTANCE_LEVELS.map((l) => v.literal(l)));
export type ResistanceLevel = (typeof RESISTANCE_LEVELS)[number];

/**
 * Resistance and immunity per damage type (plan combat-actions CA0, Q8; CB p.99). `conditional`: the resistance holds
 * only in a state the engine cannot see ("While underground"); the text names it, and the instance's
 * `resistanceActive` switches it on (a GM toggle). Absent = always on. Shape of `AdversaryResistance`
 * (src/lib/srd/adversary-resistance.ts) without its display fields.
 */
export const resistanceValidator = v.object({
  physical: resistanceLevelValidator,
  magic: resistanceLevelValidator,
  conditional: v.optional(v.string()),
});
export type Resistance = Infer<typeof resistanceValidator>;

/** How long an instance modifier lasts: until the GM clears it, the instance's next attack, the end of the scene, or for good. */
export const INSTANCE_EFFECT_UNTIL = ["temporary", "hit", "scene", "permanent"] as const;

/**
 * A modifier on one adversary instance from a card or a feature (plan combat-actions CA0): Glyph of Nightfall "reducing
 * the target's Difficulty", Corrosive Projectile's Corroded, a feature's attack or damage bonus. The engine adds the
 * deltas; the GM ends it from the tracker. The fields mirror the card vocabulary's `Mod`s an adversary can carry
 * (src/lib/domain/card-effects/types.ts).
 */
export const instanceEffectValidator = v.object({
  id: v.string(),
  /** What made it, e.g. "Glyph of Nightfall". */
  source: v.string(),
  label: v.string(),
  difficulty: v.optional(v.number()),
  attack: v.optional(v.number()),
  damage: v.optional(v.number()),
  /** Chains of Affliction: the targets of its hits mark this many more (negative: fewer) HP. */
  hpMarked: v.optional(v.number()),
  /** Blighting Strike: its next successful attack deals half damage. */
  halfDamage: v.optional(v.boolean()),
  /** Goad Them On: its next attack is made with disadvantage. */
  disadvantage: v.optional(v.boolean()),
  until: v.union(...INSTANCE_EFFECT_UNTIL.map((u) => v.literal(u))),
});
export type InstanceEffect = Infer<typeof instanceEffectValidator>;

/** Where an instance's stat block comes from: an SRD entry by its slug, or one of the campaign's custom adversaries. */
export const adversarySourceValidator = v.union(
  v.object({ kind: v.literal("srd"), adversaryId: v.string() }),
  v.object({ kind: v.literal("custom"), customId: v.id("customAdversaries") }),
);
export type AdversarySource = Infer<typeof adversarySourceValidator>;

/** An instance's numbers, copied from its stat block when added; later edits to the block do not move live pips. null = "None". */
export const instanceStatsValidator = v.object({
  difficulty: v.number(),
  major: v.union(v.number(), v.null()),
  severe: v.union(v.number(), v.null()),
  hpMax: v.number(),
  stressMax: v.number(),
});
export type InstanceStats = Infer<typeof instanceStatsValidator>;

export const encounterFields = {
  campaignId: v.id("campaigns"),
  name: v.string(),
  status: encounterStatusValidator,
  /** Party size for the Battle Points budget, 1..12 (CB p.197 "the number of PCs in combat"). */
  pcs: v.number(),
  /** Unique, at most one of each. */
  adjustments: v.array(bpAdjustmentValidator),
  /** The GM turn number, from 1; spotlight counts reset when it moves on. */
  gmTurn: v.number(),
  notes: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  startedAt: v.optional(v.number()),
  endedAt: v.optional(v.number()),
};

export const encounterAdversaryFields = {
  campaignId: v.id("campaigns"),
  encounterId: v.id("encounters"),
  source: adversarySourceValidator,
  /** "Bear 2". */
  label: v.string(),
  order: v.number(),
  /** Summoned adversaries cost no Battle Points (CB p.197). */
  summoned: v.boolean(),
  /** A Minion group's size, 1..30 (one row per group). */
  minionCount: v.optional(v.number()),
  stats: instanceStatsValidator,
  /** Marked HP and Stress. */
  hp: v.number(),
  stress: v.number(),
  defeated: v.boolean(),
  conditions: v.array(encounterConditionValidator),
  /** The GM's own condition labels (Cursed, Glowing, …). */
  tags: v.array(v.string()),
  /** Times spotlighted in GM turn `spotlightTurn`. */
  spotlights: v.number(),
  spotlightTurn: v.number(),
  note: v.optional(v.string()),
  updatedAt: v.number(),
  /** Copied from the stat block when added (CA2's table or the custom block) or set by the GM (Q8). Absent = none. */
  resistance: v.optional(resistanceValidator),
  /** The GM's toggle for a `conditional` resistance (Q8). Absent = off. */
  resistanceActive: v.optional(v.boolean()),
  /** Card and feature modifiers on this instance (CA0). Absent = none. */
  effects: v.optional(v.array(instanceEffectValidator)),
  /**
   * Tokens on this instance's stat block (plan combat-actions AA1): the Zombie's "a token on their stat block", the
   * Candlemaker's five, a Pool. Read by `tokens` requirements and the `tokens` outcome of adversary features. Absent = 0.
   */
  tokens: v.optional(v.number()),
  /**
   * Limited feature uses of this instance (plan combat-actions AA2b; widened, absent = none): "Once per scene" and the
   * like (TASK-CA-AA1 Q4). `key` is `adversaryFeatureUseKey`, `until` the limit's period as the runner records it, `scene`
   * the encounter's `startedAt` when it was used: an entry from an earlier run of the encounter no longer counts, so
   * per-scene limits reset when the encounter ends (a restart is a new scene). At most `MAX_INSTANCE_FEATURE_USES`.
   */
  featureUses: v.optional(v.array(v.object({ key: v.string(), until: v.union(v.literal("rest"), v.literal("longRest"), v.literal("session")), scene: v.number() }))),
};

/** The most `featureUses` entries one instance keeps (oldest dropped first). */
export const MAX_INSTANCE_FEATURE_USES = 40;

const thresholdsValidator = v.object({ major: v.union(v.number(), v.null()), severe: v.union(v.number(), v.null()) });
const attackValidator = v.object({ modifier: v.number(), name: v.string(), range: v.string(), damage: v.string() });
const experienceValidator = v.object({ name: v.string(), value: v.number() });
const featureValidator = v.object({
  name: v.string(),
  kind: featureKindValidator,
  text: v.string(),
  fearCost: v.optional(v.number()),
  countdown: v.optional(v.number()),
});

/** A campaign's own stat block (open question 6: yes; "Duplicate & edit" or blank, tracer A5). */
export const customAdversaryFields = {
  campaignId: v.id("campaigns"),
  name: v.string(),
  tier: v.number(),
  type: adversaryTypeValidator,
  hordePerHp: v.optional(v.number()),
  description: v.string(),
  motives: v.string(),
  difficulty: v.number(),
  thresholds: thresholdsValidator,
  hp: v.number(),
  stress: v.number(),
  attack: attackValidator,
  experiences: v.array(experienceValidator),
  features: v.array(featureValidator),
  /** The SRD entry it was duplicated from. */
  basedOn: v.optional(v.string()),
  /** Resistance and immunity from the custom adversary form's picker (Q8, CA0). Absent = none. */
  resistance: v.optional(resistanceValidator),
  createdAt: v.number(),
  updatedAt: v.number(),
};
