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

/**
 * The current sheet (version 2): inventory items and Experiences carry stable
 * ids. Stored on `characters.sheet` as `{ schemaVersion: 2, ...sheet }` and
 * read through `readSheet` (convex/characters.ts), which upgrades older
 * versions; this schema itself has no `schemaVersion`, so domain code never
 * sees it.
 *
 * To extend it (D5 and later), add fields as `.optional()` or with a
 * `.default(...)` so stored version 2 sheets keep parsing without a migration,
 * and add the same field to `sheetValidator` (convex/lib/validators/characters.ts).
 * Changing or removing a field bumps `SHEET_VERSION` with an upgrade step
 * instead (widen, migrate, narrow).
 */
export const characterSheetSchema = characterSheetV1Schema.extend({
  inventory: z.array(inventoryItemSchema).max(60),
  experiences: z.array(experienceSchema).max(12),
});

/** The stored sheet's current `schemaVersion`. */
export const SHEET_VERSION = 2;

export type CharacterSheetV1 = z.infer<typeof characterSheetV1Schema>;
export type CharacterSheet = z.infer<typeof characterSheetSchema>;
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
    description: z.string().max(TEXT),
    primaryWeaponId: z.string().min(1, "Choose a primary weapon."),
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
