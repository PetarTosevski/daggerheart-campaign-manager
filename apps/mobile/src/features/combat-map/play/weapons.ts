import { weaponDice } from "../../../../../../src/lib/domain/dice";
import { WEAPONS } from "../../../../../../src/lib/srd/equipment";
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

export function equippedWeapons(sheet: {
  primaryWeaponId: string | null | undefined;
  secondaryWeaponId?: string | null;
}): { slot: WeaponSlot; weapon: Weapon }[] {
  const out: { slot: WeaponSlot; weapon: Weapon }[] = [];
  for (const [slot, id] of [
    ["primary", sheet.primaryWeaponId],
    ["secondary", sheet.secondaryWeaponId],
  ] as const) {
    const weapon = id ? WEAPONS.find((w) => w.id === id) : undefined;
    if (weapon) out.push({ slot, weapon });
  }
  return out;
}
