/**
 * What a client submits to create or edit a character: the creation wizard's draft and a sheet edit. Split out of
 * `./characters` (dcm-uh6r) so the many functions that only read sheets do not build these schemas on every call.
 */
import * as z from "../zod";

import { isValidTraitSpread } from "../domain/characters/index";
import {
  ancestryChoiceSchema,
  characterSheetSchema,
  experienceV1Schema,
  inventoryItemSchema,
  listId,
  NAME,
  PRONOUNS_LABELS,
  portraitSchema,
  TEXT,
  traitsSchema,
} from "./characters";

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
    /**
     * Purposeful Design (CB p.53, DA11): which of the two Experiences gets the permanent +1. Optional: only a sheet that
     * holds the feature may send it, and a Clank created without it picks it once on the sheet.
     */
    purposefulExperience: z.union([z.literal(0), z.literal(1)]).optional(),
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
    // `purposefulDesign` is accepted so a list read from the sheet can be sent back; the server keeps the stored choice (DA11).
    experiences: z.array(experienceV1Schema.extend({ id: listId.optional(), purposefulDesign: z.literal(true).optional() })).max(12).optional(),
  })
  .strict();

export type SheetPatch = z.infer<typeof sheetPatchSchema>;
