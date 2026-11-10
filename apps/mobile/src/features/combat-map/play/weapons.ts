import { weaponDice } from "../../../../../../src/lib/domain/dice";
import { getWeapon } from "../../../../../../src/lib/srd/index";
import type { Weapon } from "../../../../../../src/lib/srd/types";

export type WeaponSlot = "primary" | "secondary";

export function damageLabel(weapon: Pick<Weapon, "damage">, proficiency: number): string {
  const dmgType = weapon.damage.trim().split(/\s+/)[1] ?? "";
  try {
    const { dice, flat } = weaponDice(weapon.damage, proficiency);
    return `${dice.map((d) => `${d.count}d${d.sides}`).join("+")}${flat ? `+${flat}` : ""}${dmgType ? ` ${dmgType}` : ""}`;
  } catch {
    return weapon.damage;
  }
}

/**
 * The weapons the character can attack with, primary first. The server resolves the slot's id with the same SRD
 * lookup (`weaponIn` in convex/lib/combatActions.ts: `getWeapon`), so an id it doesn't know is no weapon there either.
 */
export function attackWeapons(sheet: { primaryWeaponId?: string | null; secondaryWeaponId?: string | null }): { slot: WeaponSlot; weapon: Weapon }[] {
  const slots: [WeaponSlot, string | null | undefined][] = [
    ["primary", sheet.primaryWeaponId],
    ["secondary", sheet.secondaryWeaponId],
  ];
  return slots.flatMap(([slot, id]) => {
    const weapon = id ? getWeapon(id) : undefined;
    return weapon ? [{ slot, weapon }] : [];
  });
}
