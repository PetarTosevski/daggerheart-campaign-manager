import { z } from "zod";

import { CHARACTER_STATUSES } from "@/lib/domain/characters";

export const CHARACTER_NAME_MAX_LENGTH = 100;
export const CHARACTER_NOTES_MAX_LENGTH = 4000;

export const characterStatusSchema = z.enum(CHARACTER_STATUSES);

const characterNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a character name.")
  .max(
    CHARACTER_NAME_MAX_LENGTH,
    `Character names cannot exceed ${CHARACTER_NAME_MAX_LENGTH} characters.`,
  );

const characterNotesSchema = z
  .string()
  .trim()
  .max(
    CHARACTER_NOTES_MAX_LENGTH,
    `Notes cannot exceed ${CHARACTER_NOTES_MAX_LENGTH} characters.`,
  );

export const createCharacterSchema = z.object({
  campaignId: z.uuid("Select a valid campaign."),
  name: characterNameSchema,
  classId: z.uuid("Select a class for the character."),
  // Empty string means "no template" (a campaign may have none yet); a present
  // value must be a valid template id.
  sheetTemplateId: z
    .union([z.literal(""), z.uuid("Select a valid sheet template.")])
    .transform((value) => (value === "" ? null : value)),
  notes: characterNotesSchema,
});

export const updateCharacterSchema = z.object({
  characterId: z.uuid("Select a valid character."),
  name: characterNameSchema,
  status: characterStatusSchema,
  notes: characterNotesSchema,
});

export type CreateCharacterInput = z.infer<typeof createCharacterSchema>;
export type UpdateCharacterInput = z.infer<typeof updateCharacterSchema>;
