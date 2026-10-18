import { v, type Infer } from "convex/values";

import { TRAIT_IDS, type TraitId } from "../../../src/lib/srd/types";
import {
  ADVANCEMENT_OPTIONS,
  CONDITIONS,
  EFFECT_UNTIL,
  FEATURE_USE_UNTIL,
  HELD_DIE_KINDS,
  HELD_DIE_UNTIL,
  SUBCLASS_RANKS,
} from "../../../src/lib/validation/characters";

/**
 * Convex validators for characters (CD19). They describe shapes only; the zod
 * schemas in `src/lib/validation/characters.ts` keep the ranges and
 * cross-field rules and run in the handlers.
 */

export const traitIdValidator = v.union(...TRAIT_IDS.map((t) => v.literal(t)));

export const traitsValidator = v.object(Object.fromEntries(TRAIT_IDS.map((t) => [t, v.number()])) as Record<TraitId, ReturnType<typeof v.number>>);

export const portraitValidator = v.union(
  v.object({ kind: v.literal("asset"), asset: v.string() }),
  v.object({ kind: v.literal("upload"), storageId: v.string() }),
);

export const goldValidator = v.object({ handfuls: v.number(), bags: v.number(), chest: v.boolean() });

const ancestryValidator = v.union(
  v.object({ kind: v.literal("single"), id: v.string() }),
  v.object({ kind: v.literal("mixed"), first: v.string(), second: v.string(), name: v.string() }),
  v.object({ kind: v.literal("shapeshifter"), form: v.string(), feature: v.string() }),
);

/**
 * The wizard draft (`characterDraftSchema`). `ancestry.kind` is a plain string
 * here so callers that build the draft without literal types still compile;
 * `ancestryChoiceSchema` narrows it in the handler.
 */
export const characterDraftValidator = v.object({
  classId: v.string(),
  subclassId: v.string(),
  ancestry: v.union(
    v.object({ kind: v.string(), id: v.string() }),
    v.object({ kind: v.string(), first: v.string(), second: v.string(), name: v.string() }),
    v.object({ kind: v.string(), form: v.string(), feature: v.string() }),
  ),
  communityId: v.string(),
  traits: traitsValidator,
  name: v.string(),
  pronouns: v.string(),
  description: v.string(),
  primaryWeaponId: v.string(),
  secondaryWeaponId: v.optional(v.string()),
  armorId: v.string(),
  potion: v.string(),
  classItem: v.string(),
  background: v.array(v.string()),
  experiences: v.array(v.string()),
  domainCards: v.array(v.string()),
  connections: v.array(v.string()),
  portrait: v.optional(portraitValidator),
});

export const inventoryItemValidator = v.object({ id: v.string(), name: v.string() });

export const experienceValidator = v.object({ id: v.string(), name: v.string(), value: v.number() });

/** A sheet edit (`sheetPatchSchema`): every field optional; `null` unequips. */
export const sheetPatchValidator = v.object({
  name: v.optional(v.string()),
  pronouns: v.optional(v.string()),
  description: v.optional(v.string()),
  traits: v.optional(traitsValidator),
  evasion: v.optional(v.number()),
  primaryWeaponId: v.optional(v.string()),
  secondaryWeaponId: v.optional(v.union(v.string(), v.null())),
  armorId: v.optional(v.union(v.string(), v.null())),
  inventory: v.optional(v.array(v.union(v.string(), inventoryItemValidator))),
  gold: v.optional(goldValidator),
  experiences: v.optional(v.array(v.object({ id: v.optional(v.string()), name: v.string(), value: v.number() }))),
  background: v.optional(v.array(v.string())),
  connections: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
  portrait: v.optional(portraitValidator),
  hpMax: v.optional(v.number()),
  stressMax: v.optional(v.number()),
});

const literals = <T extends string>(values: readonly T[]) => v.union(...values.map((value) => v.literal(value)));

/** D5 sheet parts (T0), mirroring the zod schemas in src/lib/validation/characters.ts. */
export const conditionValidator = literals(CONDITIONS);

const advancementValidator = v.object({
  level: v.number(),
  picks: v.array(v.object({ option: literals(ADVANCEMENT_OPTIONS), tier: v.number(), slot: v.number(), targets: v.optional(v.array(v.string())) })),
  cardId: v.string(),
  tradeOut: v.optional(v.string()),
  tradeIn: v.optional(v.string()),
  experienceId: v.optional(v.string()),
});

export const effectValidator = v.object({
  id: v.string(),
  source: v.string(),
  text: v.string(),
  until: literals(EFFECT_UNTIL),
  mods: v.optional(
    v.object({
      evasion: v.optional(v.number()),
      attack: v.optional(v.number()),
      damage: v.optional(v.number()),
      trait: v.optional(v.object({ id: traitIdValidator, delta: v.number() })),
    }),
  ),
});

export const heldDieValidator = v.object({
  id: v.string(),
  kind: literals(HELD_DIE_KINDS),
  sides: v.number(),
  value: v.optional(v.number()),
  until: literals(HELD_DIE_UNTIL),
  fromCharacterId: v.optional(v.string()),
});

const classStateValidator = v.object({
  unstoppable: v.optional(v.object({ value: v.number(), max: v.number() })),
  focus: v.optional(v.string()),
  strangeNumber: v.optional(v.number()),
  marked: v.optional(v.string()),
  getInGetOut: v.optional(v.boolean()),
  comboDie: v.optional(v.number()),
  favor: v.optional(v.number()),
  hexes: v.optional(v.array(v.string())),
});

/**
 * The D5 fields. Optional here although `readSheet` always fills them: a view
 * built without them (older fixtures, a placeholder) stays valid.
 */
const d5SheetFields = {
  hopeSlotBonus: v.optional(v.number()),
  subclassRank: v.optional(literals(SUBCLASS_RANKS)),
  multiclass: v.optional(v.object({ classId: v.string(), domainId: v.string(), subclassId: v.string() })),
  advancements: v.optional(v.array(advancementValidator)),
  levelUpPending: v.optional(v.boolean()),
  conditions: v.optional(v.array(conditionValidator)),
  effects: v.optional(v.array(effectValidator)),
  heldDice: v.optional(v.array(heldDieValidator)),
  featureUses: v.optional(v.array(v.object({ key: v.string(), until: literals(FEATURE_USE_UNTIL) }))),
  classState: v.optional(classStateValidator),
  wither: v.optional(v.number()),
  journeyEnds: v.optional(v.boolean()),
};

/** The current sheet (`characterSheetSchema`, version 2) as queries return it. Keep in step with the zod schema. */
export const sheetValidator = v.object({
  name: v.string(),
  pronouns: v.string(),
  description: v.string(),
  level: v.number(),
  classId: v.string(),
  subclassId: v.string(),
  ancestry: ancestryValidator,
  communityId: v.string(),
  transformationId: v.optional(v.string()),
  traits: traitsValidator,
  traitMarks: v.record(v.string(), v.number()),
  evasion: v.number(),
  hpMax: v.number(),
  hp: v.number(),
  stressMax: v.number(),
  stress: v.number(),
  hope: v.number(),
  scars: v.number(),
  armorMarked: v.number(),
  proficiency: v.number(),
  primaryWeaponId: v.string(),
  secondaryWeaponId: v.optional(v.string()),
  armorId: v.optional(v.string()),
  inventory: v.array(inventoryItemValidator),
  gold: goldValidator,
  experiences: v.array(experienceValidator),
  domainCards: v.object({ owned: v.array(v.string()), loadout: v.array(v.string()) }),
  background: v.array(v.string()),
  connections: v.array(v.string()),
  notes: v.string(),
  portrait: v.optional(portraitValidator),
  ...d5SheetFields,
});

/** The statuses `characters.setStatus` sets by hand. */
export const characterStatusValidator = v.union(v.literal("active"), v.literal("dead"), v.literal("retired"));

/**
 * Every stored status: `away` (Castle High less-lethal, HF 127) is set only by
 * death moves and cleared by the GM, never through `setStatus`.
 */
export const storedCharacterStatusValidator = v.union(v.literal("active"), v.literal("dead"), v.literal("retired"), v.literal("away"));

/** Why an `away` character is gone (HF 127). */
export const awayValidator = v.object({ reason: v.union(v.literal("infirmary"), v.literal("sentHome")), note: v.optional(v.string()) });

/**
 * One character as `get` and `listByCampaign` return it. Only editors get an
 * uploaded portrait's storage id (others see `"hidden"` and use `portraitUrl`).
 * `corrupt: true` marks a sheet that failed to read: `listByCampaign` returns
 * it with a placeholder sheet and `canEdit: false` instead of failing the list.
 */
export const characterViewValidator = v.object({
  _id: v.id("characters"),
  ownerId: v.id("users"),
  status: storedCharacterStatusValidator,
  /** Set while `status` is `away`. */
  away: v.optional(awayValidator),
  sheet: sheetValidator,
  /** Resolved URL of an uploaded portrait, or null. */
  portraitUrl: v.union(v.string(), v.null()),
  canEdit: v.boolean(),
  mine: v.boolean(),
  updatedAt: v.number(),
  corrupt: v.optional(v.literal(true)),
});

export type CharacterView = Infer<typeof characterViewValidator>;
