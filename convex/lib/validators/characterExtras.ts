import { v, type Infer } from "convex/values";

import { FLAVORS, type Flavor } from "../../../src/lib/domain/frames/beast-feast";
import { EXTRAS, RANGES } from "../../../src/lib/frames/extras/common";
import { traitIdValidator } from "./characters";

/**
 * Convex validators for the character extras (CD19). They describe shapes
 * only; the zod schemas in `src/lib/frames/extras/*` keep the ranges and
 * refinements and run in the handlers.
 */

export const extraValidator = v.union(...EXTRAS.map((e) => v.literal(e)));

const rangeValidator = v.union(...RANGES.map((r) => v.literal(r)));

// ---- Druid Beastform

export const beastformStateValidator = v.object({
  formId: v.union(v.string(), v.null()),
  baseFormId: v.optional(v.string()),
  hybrid: v.optional(v.object({ sources: v.array(v.string()), advantages: v.array(v.string()), features: v.array(v.string()) })),
  evolutionTrait: v.optional(traitIdValidator),
});

// ---- Beastbound companion

export const companionStateValidator = v.object({
  name: v.string(),
  kind: v.string(),
  experiences: v.array(v.object({ name: v.string(), value: v.number() })),
  attack: v.object({ name: v.string(), damageType: v.union(v.literal("phy"), v.literal("mag")) }),
  stress: v.number(),
  training: v.record(v.string(), v.number()),
  vicious: v.array(v.union(v.literal("die"), v.literal("range"))),
  bonusTraining: v.number(),
  gifts: v.string(),
  inventory: v.string(),
});

// ---- Motherboard

export const ikonisValidator = v.object({
  name: v.string(),
  description: v.string(),
  trait: v.union(traitIdValidator, v.null()),
  range: v.union(rangeValidator, v.null()),
  damageType: v.union(v.literal("physical"), v.literal("tech"), v.null()),
});

const relicValidator = v.object({ id: v.string(), name: v.string() });

export const motherboardStateValidator = v.object({
  quantum: v.number(),
  scrap: v.record(v.string(), v.number()),
  relics: v.array(relicValidator),
  ikonis: ikonisValidator,
  built: v.array(v.object({ id: v.string(), relics: v.array(relicValidator) })),
  installed: v.array(v.string()),
});

/** One die of `gatherScrap`: its category, roll and the scrap it found. */
export const gatheredScrapValidator = v.object({
  category: v.union(v.literal("shards"), v.literal("metals"), v.literal("components")),
  roll: v.number(),
  item: v.object({ name: v.string(), value: v.number() }),
});

export const walletCorrectionValidator = v.object({
  quantum: v.optional(v.number()),
  scrap: v.optional(v.record(v.string(), v.number())),
});

// ---- Beast Feast

const flavorValidator = v.union(...FLAVORS.map((f) => v.literal(f)));

export const ingredientInputValidator = v.object({
  name: v.string(),
  flavors: v.array(v.object({ flavor: flavorValidator, strength: v.number() })),
  feature: v.optional(v.string()),
});

export const beastFeastStateValidator = v.object({
  ingredients: v.array(v.object({ ...ingredientInputValidator.fields, id: v.string() })),
});

const dice = v.optional(v.number());
const flavorProfileValidator = v.object({ sweet: dice, salty: dice, bitter: dice, sour: dice, savory: dice, weird: dice } satisfies Record<Flavor, typeof dice>);

export const cookbookEntryInputValidator = v.object({
  name: v.string(),
  description: v.string(),
  ingredients: v.array(v.string()),
  profile: flavorProfileValidator,
  mealRating: v.union(v.number(), v.null()),
});

// ---- Castle High

export const skyshardValidator = v.object({ name: v.string(), description: v.string() });

export const castleHighStateValidator = v.object({ skyshard: skyshardValidator });

// ---- the stored row and the view

/** The common fields of a `characterExtras` row; `extraRow` adds the extra's literal and its state. */
const rowFields = {
  campaignId: v.id("campaigns"),
  characterId: v.id("characters"),
  schemaVersion: v.number(),
  updatedAt: v.number(),
};

/** One stored extra: `data` is the state validator of that `extra`. */
export const characterExtraValidator = v.union(
  v.object({ ...rowFields, extra: v.literal("beastform"), data: beastformStateValidator }),
  v.object({ ...rowFields, extra: v.literal("companion"), data: companionStateValidator }),
  v.object({ ...rowFields, extra: v.literal("motherboard"), data: motherboardStateValidator }),
  v.object({ ...rowFields, extra: v.literal("beastFeast"), data: beastFeastStateValidator }),
  v.object({ ...rowFields, extra: v.literal("castleHigh"), data: castleHighStateValidator }),
);

/** A `characterExtras` row without its system fields. */
export type CharacterExtraRow = Infer<typeof characterExtraValidator>;

/** `characterExtras.get`: each extra that applies, or null. */
export const extrasViewValidator = v.object({
  canEdit: v.boolean(),
  level: v.number(),
  tier: v.number(),
  ingredientCapacity: v.number(),
  beastform: v.union(beastformStateValidator, v.null()),
  companion: v.union(companionStateValidator, v.null()),
  motherboard: v.union(motherboardStateValidator, v.null()),
  beastFeast: v.union(beastFeastStateValidator, v.null()),
  castleHigh: v.union(castleHighStateValidator, v.null()),
  cookbook: v.union(
    v.array(v.object({ ...cookbookEntryInputValidator.fields, id: v.string(), addedBy: v.string(), at: v.number(), canRemove: v.boolean() })),
    v.null(),
  ),
});
export type ExtrasView = Infer<typeof extrasViewValidator>;
