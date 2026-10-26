// Equipment rules (Core ch. 1 step 5, CB 109 tiers; Motherboard CB 301): the
// one source for the checks `characters.ts` (create, sheet edits) and the
// photo import (src/lib/import/sheet.ts) apply. Pure: relative imports only.
//
// ```ts
// assertEquipment(sheet, allowExpansion);                                  // INVALID
// assertEquipment(sheet, allowExpansion, { code: "PHOTO_IMPORT_RULE" });  // import review
// assertEquipment(sheet, allowExpansion, { ikonis: true });               // Motherboard
// ```

import { tierForLevel } from "./domain/characters/index";
import { RuleError, type AppErrorCode } from "./errors/app-error";
import { spellcastTraitOf } from "./domain/characters/spellcast";
import { getArmor, getWeapon, type Source } from "./srd/index";
import type { CharacterSheet } from "./validation/characters";

export const IKONIS_ONLY = "In a Motherboard campaign your Ikonis replaces weapons (CB 301).";

/** Hope & Fear content only when the campaign uses it. */
export function assertSource(source: Source, allowExpansion: boolean, what: string, code: AppErrorCode = "INVALID"): void {
  if (source === "hope-and-fear" && !allowExpansion) throw new RuleError(code, `${what} is Hope & Fear content, which this campaign doesn't use.`);
}

export type EquipmentSheet = {
  level: number;
  classId: string;
  subclassId: string;
  primaryWeaponId: string;
  secondaryWeaponId?: string | null;
  armorId?: string | null;
  /** A multiclass can bring a Spellcast trait (CB 111). */
  multiclass?: CharacterSheet["multiclass"];
};

export type EquipmentOptions = {
  /** A Motherboard campaign (CB 301): an empty primary is the two-handed Ikonis. */
  ikonis?: boolean;
  /** The RuleError code: INVALID on the server, PHOTO_IMPORT_RULE for the import. */
  code?: AppErrorCode;
};

/**
 * Equipment the character can use: known items, at or below their tier,
 * Hope & Fear items only when the campaign uses them, class-bound weapons only
 * for that class, no secondary with a two-handed or barehanded primary, and
 * magic weapons only with a Spellcast trait (Core ch. 1 step 5). With
 * `ikonis` an empty primary is the Ikonis, which is two-handed: no secondary
 * (CB 301). A weapon a Motherboard character got before T9 is still checked
 * as a weapon. Throws `RuleError(code)`.
 */
export function assertEquipment(sheet: EquipmentSheet, allowExpansion: boolean, { ikonis = false, code = "INVALID" }: EquipmentOptions = {}): void {
  const refuse = (message: string): never => {
    throw new RuleError(code, message);
  };
  if (ikonis && sheet.primaryWeaponId === "") {
    if (sheet.secondaryWeaponId) refuse(IKONIS_ONLY);
    assertArmor(sheet, allowExpansion, code);
    return;
  }
  const tier = tierForLevel(sheet.level);
  const spellcaster = spellcastTraitOf(sheet) !== null;
  const check = (weaponId: string, slot: "primary" | "secondary") => {
    const w = getWeapon(weaponId);
    if (!w || w.slot !== slot) return refuse(`Choose a ${slot} weapon.`);
    if (w.tier > tier) refuse(`${w.name} is Tier ${w.tier}; a level ${sheet.level} character is Tier ${tier}.`);
    assertSource(w.source, allowExpansion, w.name, code);
    if (w.classId && w.classId !== sheet.classId) refuse(`${w.name} belongs to another class.`);
    if (w.category === "magic" && !spellcaster) refuse("Magic weapons need a Spellcast trait from the subclass.");
    return w;
  };
  const primary = check(sheet.primaryWeaponId, "primary");
  if (sheet.secondaryWeaponId) {
    check(sheet.secondaryWeaponId, "secondary");
    if (primary.burden === "two-handed") refuse("A two-handed primary weapon leaves no hand for a secondary.");
    if (primary.burden === "barehanded") refuse(`${primary.name} can't be used with other weapons.`);
  }
  assertArmor(sheet, allowExpansion, code);
}

/** Armor, when worn: known, at or below the character's tier, Hope & Fear only when allowed. */
export function assertArmor(sheet: Pick<EquipmentSheet, "level" | "armorId">, allowExpansion: boolean, code: AppErrorCode = "INVALID"): void {
  if (!sheet.armorId) return;
  const tier = tierForLevel(sheet.level);
  const a = getArmor(sheet.armorId);
  if (!a) throw new RuleError(code, "Choose armor.");
  if (a.tier > tier) throw new RuleError(code, `${a.name} is Tier ${a.tier}; a level ${sheet.level} character is Tier ${tier}.`);
  assertSource(a.source, allowExpansion, a.name, code);
}
