import { z } from "zod";

import { isValidTraitSpread, MAX_LEVEL } from "../domain/characters/index";
import { TRAIT_IDS, type TraitId } from "../srd/types";

const TEXT = 2000;
const NAME = 80;

const trait = z.number().int().min(-5).max(10);
export const traitsSchema = z.object(
  Object.fromEntries(TRAIT_IDS.map((t) => [t, trait])) as Record<TraitId, typeof trait>,
);

export const ancestryChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("single"), id: z.string().min(1) }),
  z.object({ kind: z.literal("mixed"), first: z.string().min(1), second: z.string().min(1), name: z.string().trim().max(NAME) }),
  // Shapeshifter (Hope & Fear transformation): a current form ancestry and a chosen form feature.
  z.object({ kind: z.literal("shapeshifter"), form: z.string().min(1), feature: z.string().trim().min(1).max(200) }),
]);

/** An Experience as version 1 sheets stored it (no id). */
const experienceV1Schema = z.object({ name: z.string().trim().min(1).max(NAME), value: z.number().int().min(-5).max(10) });

/** A stable list id (CD8: list edits address items by id, never by index). */
const listId = z.string().min(1).max(40);

export const experienceSchema = experienceV1Schema.extend({ id: listId });

export const inventoryItemSchema = z.object({ id: listId, name: z.string().trim().min(1).max(200) });

const portraitSchema = z.union([
  z.object({ kind: z.literal("asset"), asset: z.string().regex(/^[0-9a-f]{32}$/) }),
  z.object({ kind: z.literal("upload"), storageId: z.string().min(1) }),
]);

/** Version 1 of the sheet (stored without `schemaVersion`): plain-string inventory, Experiences without ids. Frozen. */
export const characterSheetV1Schema = z.object({
  name: z.string().trim().min(1).max(NAME),
  pronouns: z.string().trim().max(NAME),
  description: z.string().max(TEXT),
  level: z.number().int().min(1).max(MAX_LEVEL),
  classId: z.string().min(1),
  subclassId: z.string().min(1),
  ancestry: ancestryChoiceSchema,
  communityId: z.string().min(1),
  transformationId: z.string().optional(),
  traits: traitsSchema,
  /** Trait marks from level-up advancements (D5): trait → tier epoch, 0 = unmarked. */
  traitMarks: z.record(z.string(), z.number().int().min(0).max(4)),
  evasion: z.number().int().min(0).max(40),
  hpMax: z.number().int().min(1).max(12),
  hp: z.number().int().min(0).max(12),
  stressMax: z.number().int().min(1).max(12),
  stress: z.number().int().min(0).max(12),
  hope: z.number().int().min(0).max(6),
  scars: z.number().int().min(0).max(6),
  armorMarked: z.number().int().min(0).max(12),
  proficiency: z.number().int().min(1).max(10),
  primaryWeaponId: z.string().min(1),
  secondaryWeaponId: z.string().optional(),
  armorId: z.string().optional(),
  inventory: z.array(z.string().trim().min(1).max(200)).max(60),
  gold: z.object({ handfuls: z.number().int().min(0).max(99), bags: z.number().int().min(0).max(99), chest: z.boolean() }),
  experiences: z.array(experienceV1Schema).max(12),
  domainCards: z.object({ owned: z.array(z.string()).max(40), loadout: z.array(z.string()).max(5) }),
  background: z.array(z.string().max(TEXT)).max(12),
  connections: z.array(z.string().max(TEXT)).max(12),
  notes: z.string().max(10000),
  portrait: portraitSchema.optional(),
});

// ---------------------------------------------------------------- D5 sheet parts

/** Conditions a character can have (CB 102-103, plus Unconscious from Avoid Death, CB 106). */
export const CONDITIONS = ["vulnerable", "restrained", "hidden", "cloaked", "unconscious", "distracted"] as const;
export type Condition = (typeof CONDITIONS)[number];

export const SUBCLASS_RANKS = ["foundation", "specialization", "mastery"] as const;
export type SubclassRank = (typeof SUBCLASS_RANKS)[number];

/**
 * When an effect ends: `expire(sheet, event)` (src/lib/domain/characters/expiry.ts) removes it.
 * `scene` ends at session end; `manual` only through its End button.
 */
export const EFFECT_UNTIL = ["rest", "longRest", "session", "hit", "scene", "manual"] as const;
export const HELD_DIE_UNTIL = ["session", "longRest", "manual"] as const;
export const FEATURE_USE_UNTIL = ["rest", "longRest", "session"] as const;
/** Labels for the `pronouns` field (dcm-bxp.35): "gender" is the default. */
export const PRONOUNS_LABELS = ["gender", "pronouns"] as const;
export type PronounsLabel = (typeof PRONOUNS_LABELS)[number];

/** The `pronouns` field's label: "Gender" unless the character chose "Pronouns" (dcm-bxp.35). */
export function pronounsFieldLabel(flag: PronounsLabel | undefined): "Gender" | "Pronouns" {
  return flag === "pronouns" ? "Pronouns" : "Gender";
}
export const HELD_DIE_KINDS = ["rally", "prayer", "patron", "combo"] as const;

/** The level-up options (CB 110; `comboDie`: Brawler only, HF 10). Proficiency and multiclass take both picks of a level. */
export const ADVANCEMENT_OPTIONS = ["traits", "hp", "stress", "experiences", "domainCard", "evasion", "subclass", "proficiency", "multiclass", "comboDie"] as const;
export type AdvancementOption = (typeof ADVANCEMENT_OPTIONS)[number];

const shortText = z.string().trim().min(1).max(80);

/** One level-up pick: the option, the tier it was taken from, its slot in that tier, and what it chose (traits, Experience ids, a card id). */
export const advancementPickSchema = z.object({
  option: z.enum(ADVANCEMENT_OPTIONS),
  tier: z.number().int().min(2).max(4),
  slot: z.number().int().min(0).max(2),
  targets: z.array(z.string().min(1).max(80)).max(2).optional(),
});

/** One level gained: its picks, the level's domain card, an optional card trade, and the achievement Experience (levels 2, 5, 8). */
export const advancementSchema = z.object({
  level: z.number().int().min(2).max(MAX_LEVEL),
  picks: z.array(advancementPickSchema).min(1).max(2),
  cardId: z.string().min(1),
  tradeOut: z.string().min(1).optional(),
  tradeIn: z.string().min(1).optional(),
  experienceId: listId.optional(),
  /** When it was taken (ms since epoch; SS3, decision 33): a player may undo it only within that session. Older entries lack it. */
  at: z.number().int().nonnegative().optional(),
});

const modifier = z.number().int().min(-10).max(10);

export const effectSchema = z.object({
  id: listId,
  /** What made it, e.g. "Rogue's Dodge". */
  source: shortText,
  text: z.string().max(300),
  until: z.enum(EFFECT_UNTIL),
  mods: z
    .object({
      evasion: modifier.optional(),
      attack: modifier.optional(),
      damage: modifier.optional(),
      trait: z.object({ id: z.enum(TRAIT_IDS), delta: modifier }).optional(),
    })
    .optional(),
});

export const heldDieSchema = z.object({
  id: listId,
  kind: z.enum(HELD_DIE_KINDS),
  sides: z.number().int().min(2).max(20),
  /** Rolled value, when the die was rolled on receipt (Prayer Dice); unset until rolled. */
  value: z.number().int().min(1).max(20).optional(),
  until: z.enum(HELD_DIE_UNTIL),
  /** The character who gave it (Rally), as a plain id string. */
  fromCharacterId: z.string().min(1).max(40).optional(),
});

/**
 * One used "once per X" feature. Keys: class features (`rally`, `tagTeam`, …) and domain cards (`card:<cardId>` or
 * `card:<cardId>:<useId>`, plan combat-actions). The key cap was widened from 40 to 80 for the card keys (CA0; widen
 * only, stored sheets still parse).
 */
export const featureUseSchema = z.object({ key: z.string().min(1).max(80), until: z.enum(FEATURE_USE_UNTIL) });

/** Most tokens or dice one card holds (Dark Army places 8; Sigil of Retribution holds up to your level in d8s). */
export const CARD_TOKENS_MAX = 99;

/**
 * Tokens (or dice) kept on one domain card (CB p.101: "If you still have tokens on your card at the end of a session
 * and aren't told to clear them, ensure you track the number you have left"). Plan combat-actions, CA0. A card with
 * no entry holds no tokens; for a card holding a die (Zone of Protection) `count` is the die's value.
 */
export const cardTokensSchema = z.object({ cardId: z.string().min(1).max(60), count: z.number().int().min(0).max(CARD_TOKENS_MAX) });

/** Flat per-class counters (spec section C). All optional; a class reads only its own. */
export const classStateSchema = z.object({
  /** Guardian Unstoppable: the die's current value and its maximum (d4, d6 from level 5). */
  unstoppable: z.object({ value: z.number().int().min(1).max(6), max: z.number().int().min(4).max(6) }).optional(),
  /** Ranger's Focus: the current focus. */
  focus: shortText.optional(),
  /** Wizard Strange Patterns: the chosen number. */
  strangeNumber: z.number().int().min(1).max(12).optional(),
  /** Assassin Marked for Death: the marked target. */
  marked: shortText.optional(),
  /** Assassin Get In & Get Out: the next roll has advantage. */
  getInGetOut: z.boolean().optional(),
  /** Brawler Combo Strike: the current combo die size. */
  comboDie: z.number().int().min(4).max(20).optional(),
  /** Warlock Favor (starts at 3). */
  favor: z.number().int().min(0).max(99).optional(),
  /** Witch Hex: hexed targets. */
  hexes: z.array(shortText).max(10).optional(),
});

/** The most Slayer Dice or Know the Tide tokens a sheet can hold: Proficiency and level both stop at 10. */
export const SESSION_POOL_MAX = 10;

/**
 * Session-bound feature state (plan session-features, F0; widened, no version bump). Every member is optional and
 * an absent object reads as "no pool, no tokens, no die". The pure rules live in src/lib/domain/session-features.
 * - `slayerDice`: Call of the Slayer's pool of unrolled d6s (CB 48), capped at Proficiency when a die is stored.
 * - `slayerClaim`: the actionLog id of the roll whose Slayer choice was answered (one answer per roll).
 * - `tideTokens`: Know the Tide tokens (Seaborne, CB 77), capped at the level when one is placed.
 * - `moonDie`: the Lunar Phases die (Moon Witch mastery, HF 17); absent = no phase.
 */
export const sessionFeaturesSchema = z.object({
  slayerDice: z.number().int().min(0).max(SESSION_POOL_MAX).optional(),
  slayerClaim: z.string().min(1).max(40).optional(),
  tideTokens: z.number().int().min(0).max(SESSION_POOL_MAX).optional(),
  moonDie: z.number().int().min(1).max(6).optional(),
});

export type Advancement = z.infer<typeof advancementSchema>;
export type AdvancementPick = z.infer<typeof advancementPickSchema>;
export type Effect = z.infer<typeof effectSchema>;
export type HeldDie = z.infer<typeof heldDieSchema>;
export type FeatureUse = z.infer<typeof featureUseSchema>;
export type CardTokens = z.infer<typeof cardTokensSchema>;
export type ClassState = z.infer<typeof classStateSchema>;
export type SessionFeatures = z.infer<typeof sessionFeaturesSchema>;

/**
 * The current sheet (version 2): inventory items and Experiences carry stable
 * ids. Stored on `characters.sheet` as `{ schemaVersion: 2, ...sheet }` and
 * read through `readSheet` (convex/characters.ts), which upgrades older
 * versions; this schema itself has no `schemaVersion`, so domain code never
 * sees it.
 *
 * To extend it (D5 and later), add fields as `.optional()` or with a
 * `.default(...)` so stored version 2 sheets keep parsing without a migration,
 * and add the same field to `sheetValidator` (convex/lib/validators/characters.ts)
 * as `v.optional(...)`, so views built before the field existed stay valid.
 * Only T0 (wave 1) and T9 (wave 3) edit this file in D5.
 * Changing or removing a field bumps `SHEET_VERSION` with an upgrade step
 * instead (widen, migrate, narrow).
 */
export const characterSheetSchema = characterSheetV1Schema.extend({
  inventory: z.array(inventoryItemSchema).max(60),
  experiences: z.array(experienceSchema).max(12),
  // ---- D5 fields (T0). Every one is defaulted or optional, so stored version 2 sheets parse unchanged.
  /** Light in the Dark (companion, dcm-bxp.14): a seventh Hope slot. Hope max = 6 + bonus − scars (`hopeMax`). */
  hope: z.number().int().min(0).max(7),
  /** Seven slots with Light in the Dark, so a seventh scar is possible (T9; widened from 6, stored sheets still parse). */
  scars: z.number().int().min(0).max(7),
  hopeSlotBonus: z.number().int().min(0).max(1).default(0),
  /**
   * Empty when the character fights with an Ikonis instead of weapons
   * (Motherboard, CB 301: "Characters don't have access to Daggerheart's normal
   * selection of primary and secondary weapons"). Widened from `min(1)` (T9).
   */
  primaryWeaponId: z.string().max(100),
  /** Upgraded subclass advancements move it up (CB 110). */
  subclassRank: z.enum(SUBCLASS_RANKS).default("foundation"),
  /**
   * Multiclass (CB 110-111): the second class's class features, one of its domains and its foundation card.
   * `spellcastTrait` (widened, SS2): the Spellcast trait chosen for Spellcast Rolls (`spellcastTraitOf`).
   */
  multiclass: z
    .object({ classId: z.string().min(1), domainId: z.string().min(1), subclassId: z.string().min(1), spellcastTrait: z.enum(TRAIT_IDS).optional() })
    .optional(),
  /** One entry per level gained (at most 9); level undo inverts the latest one (dcm-mf7). */
  advancements: z.array(advancementSchema).max(9).default([]),
  /** Set by the GM's "Party levels up" (CB 109); cleared when the owner levels up. */
  levelUpPending: z.boolean().default(false),
  conditions: z.array(z.enum(CONDITIONS)).max(CONDITIONS.length).default([]),
  /** Temporary effects; derived values add their `mods` (`withEffects`), base stats never change. */
  effects: z.array(effectSchema).max(20).default([]),
  /** Dice held for later (Rally, Prayer, patron, combo). */
  heldDice: z.array(heldDieSchema).max(20).default([]),
  /**
   * "Once per rest/long rest/session" features already used, class features and domain cards alike (one shared record:
   * a card used on the map is exhausted on the sheet too, Q3). Widened from 20 to 40 entries for the cards (CA0).
   */
  featureUses: z.array(featureUseSchema).max(40).default([]),
  /** Small per-class counters (spec section C); lists with an `until` live in the three arrays above. */
  classState: classStateSchema.default({}),
  /** Wither tokens (Witherwild, CB 261): no per-character cap. */
  wither: z.number().int().min(0).max(99).default(0),
  /** The last Hope slot was scarred (CB 106): the GM ends the character's journey. */
  journeyEnds: z.boolean().default(false),
  /**
   * Feature slot bonuses already added to `hpMax`/`stressMax` (keys of `FEATURE_SLOTS`,
   * src/lib/domain/characters/slots.ts), so none is applied twice. Optional (SS1, widened, no version bump):
   * missing on sheets stored before it, which `migrations/slotBonuses:applySlotBonuses` backfills.
   */
  slotBonuses: z.array(z.string().min(1).max(60)).max(20).optional(),
  /** Slayer Dice, Know the Tide tokens and the Lunar Phases die (session-features F0; optional, widened, no version bump). */
  sessionFeatures: sessionFeaturesSchema.optional(),
  /** Tokens on domain cards, one entry per card holding any (plan combat-actions, CA0; optional, widened, no version bump). */
  cardTokens: z.array(cardTokensSchema).max(20).optional(),
  /**
   * How the `pronouns` field is labelled for this character (dcm-bxp.35, F9): "Gender" when missing or "gender",
   * "Pronouns" when "pronouns". Label only; the text stays in `pronouns`. Optional (widened, no version bump).
   */
  pronounsLabel: z.enum(PRONOUNS_LABELS).optional(),
});

/** The stored sheet's current `schemaVersion`. */
export const SHEET_VERSION = 2;

export type CharacterSheetV1 = z.infer<typeof characterSheetV1Schema>;
/** A parsed sheet: every D5 field is present (defaults filled in by `readSheet`). */
export type CharacterSheet = z.infer<typeof characterSheetSchema>;
/** A sheet before defaults: the D5 fields may be missing (what callers may build and `storedSheet` accepts). */
export type CharacterSheetInput = z.input<typeof characterSheetSchema>;
export type InventoryItem = z.infer<typeof inventoryItemSchema>;
export type Experience = z.infer<typeof experienceSchema>;

/** What the creation wizard submits; the server derives the rest from the class. */
export const characterDraftSchema = z
  .object({
    classId: z.string().min(1, "Choose a class."),
    subclassId: z.string().min(1, "Choose a subclass."),
    ancestry: ancestryChoiceSchema,
    communityId: z.string().min(1, "Choose a community."),
    traits: traitsSchema,
    name: z.string().trim().min(1, "Give your character a name.").max(NAME),
    pronouns: z.string().trim().max(NAME),
    pronounsLabel: z.enum(PRONOUNS_LABELS).optional(),
    description: z.string().max(TEXT),
    /** Empty in a Motherboard campaign, where an Ikonis replaces weapons (CB 301); the server requires it elsewhere. */
    primaryWeaponId: z.string().max(100),
    secondaryWeaponId: z.string().optional(),
    armorId: z.string().min(1, "Choose armor."),
    potion: z.string().trim().min(1, "Choose a potion.").max(100),
    classItem: z.string().trim().max(100),
    background: z.array(z.string().max(TEXT)).max(12),
    experiences: z.tuple([z.string().trim().min(1, "Write a first Experience.").max(NAME), z.string().trim().min(1, "Write a second Experience.").max(NAME)]),
    domainCards: z.array(z.string().min(1)).length(2, "Choose two domain cards."),
    connections: z.array(z.string().max(TEXT)).max(12),
    portrait: portraitSchema.optional(),
  })
  .refine((d) => isValidTraitSpread(d.traits), {
    message: "Assign each trait modifier from +2, +1, +1, 0, 0, −1 exactly once.",
    path: ["traits"],
  });

export type CharacterDraft = z.infer<typeof characterDraftSchema>;

/** Fields a sheet edit may change directly (resources use their own mutation). */
export const sheetPatchSchema = characterSheetSchema
  .pick({
    name: true,
    pronouns: true,
    pronounsLabel: true,
    description: true,
    traits: true,
    evasion: true,
    primaryWeaponId: true,
    secondaryWeaponId: true,
    armorId: true,
    inventory: true,
    gold: true,
    experiences: true,
    background: true,
    connections: true,
    notes: true,
    portrait: true,
    hpMax: true,
    stressMax: true,
  })
  .partial()
  .extend({
    // null unequips (an undefined value would be dropped in transit).
    secondaryWeaponId: z.string().nullable().optional(),
    armorId: z.string().nullable().optional(),
    // Whole-list writes stay accepted until the sheet UI sends intents (H19); entries without an id get a new one.
    inventory: z.array(z.union([z.string().trim().min(1).max(200), inventoryItemSchema])).max(60).optional(),
    experiences: z.array(experienceV1Schema.extend({ id: listId.optional() })).max(12).optional(),
  })
  .strict();

export type SheetPatch = z.infer<typeof sheetPatchSchema>;
