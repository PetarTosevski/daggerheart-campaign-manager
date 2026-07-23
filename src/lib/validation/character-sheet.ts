import { z } from "zod";

// Field values are serialized as text; the server function validates them per
// field type. An empty `value` clears the field. `expectedUpdatedAt` carries the
// optimistic-concurrency snapshot ("" for a first write).

export const saveCharacterSheetValueSchema = z.object({
  characterId: z.uuid("Select a valid character."),
  templateFieldId: z.uuid("Select a valid field."),
  value: z.string().max(10000, "Value is too long."),
  expectedUpdatedAt: z.string(),
});

export const pinCharacterSheetVersionSchema = z.object({
  characterId: z.uuid("Select a valid character."),
});

export type SaveCharacterSheetValueInput = z.infer<
  typeof saveCharacterSheetValueSchema
>;
