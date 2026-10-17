import { getArmor, getWeapon } from "../../srd/index";
import type { CharacterSheet } from "../../validation/characters";
import { equipmentModifiers } from "./index";

/** Evasion and Armor Score after equipped items' modifiers; `evasion` on the sheet is the base. */
export function derivedDefense(sheet: Pick<CharacterSheet, "evasion" | "primaryWeaponId" | "secondaryWeaponId" | "armorId">) {
  const items = [getWeapon(sheet.primaryWeaponId), sheet.secondaryWeaponId ? getWeapon(sheet.secondaryWeaponId) : undefined];
  const armor = sheet.armorId ? getArmor(sheet.armorId) : undefined;
  const mods = equipmentModifiers([...items.map((w) => w?.feature?.text), armor?.feature?.text]);
  return {
    evasion: sheet.evasion + mods.evasion,
    evasionModifier: mods.evasion,
    armorScore: Math.max(0, (armor?.baseScore ?? 0) + mods.armorScore),
  };
}
