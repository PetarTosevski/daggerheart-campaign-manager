import { characterSheetSchema, type CharacterSheet } from "../../../../../../src/lib/validation/characters";

import type { SheetData } from "../types";

/** Parse the sheet for class features; accepts extra optional fields on the stored sheet. */
export function parseFeatureSheet(sheet: SheetData & Record<string, unknown>): CharacterSheet | null {
  const parsed = characterSheetSchema.safeParse(sheet);
  return parsed.success ? parsed.data : null;
}
