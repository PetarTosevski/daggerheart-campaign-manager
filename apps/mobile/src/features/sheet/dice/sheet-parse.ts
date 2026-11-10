import { characterSheetSchema, type CharacterSheet } from "../../../../../../src/lib/validation/characters";
import type { SheetCharacter } from "../types";

/** Parse the sheet for dice hooks; fills list defaults the phone reader may omit. */
export function diceSheet(character: SheetCharacter): CharacterSheet | null {
  const raw = character.sheet as CharacterSheet & Record<string, unknown>;
  const parsed = characterSheetSchema.safeParse({
    ...raw,
    secondaryWeaponId: raw.secondaryWeaponId ?? "",
    conditions: raw.conditions ?? [],
    featureUses: raw.featureUses ?? [],
    classState: raw.classState ?? {},
    sessionFeatures: raw.sessionFeatures ?? {},
  });
  return parsed.success ? parsed.data : null;
}

export function isUnavailable(character: SheetCharacter): boolean {
  const conditions = (character.sheet as { conditions?: string[] }).conditions ?? [];
  return character.status === "dead" || character.status === "away" || conditions.includes("unconscious");
}
