// The Ikonis as an attack and damage source (Motherboard, D5 TI-a). Pure: bundled into Convex, used by the dice box.
//
// Book references (Core Book, re-checked):
// - CB 301: characters use an Ikonis instead of primary and secondary weapons; it is recorded in the Primary
//   Weapon slot, uses the trait chosen on the module sheet, and starts with "Bonded: Gain a bonus to your damage
//   rolls equal to your level." Installed augments "are treated as additional features for that weapon."
// - Module sheet (CB p.354 of the PDF, `IKONIS_RANGES`, `AUGMENTS`): range sets the damage dice; Force +1 damage,
//   Sear +2 damage, Bury +3 damage; Converge +1 and Target +2 to attack rolls; Override: attack rolls have advantage.
//   Other augments stay text (the Motherboard panel lists them).
// - CB 98: weapon damage rolls Proficiency-many of its leading die plus the modifier.
//
// ```ts
// const ikonis = ikonisWeapon(state.ikonis, state.installed, sheet.level, sheet.proficiency);
// if (ikonis) rollDamage({ dice: ikonis.dice, flat: ikonis.flat, critical }, rng);
// ```

import { IKONIS_RANGES, type Ikonis } from "../../frames/extras/motherboard";
import type { TraitId } from "../../srd/types";
import { weaponDice, type DicePool } from "./index";

const DAMAGE: Readonly<Record<string, number>> = { force: 1, sear: 2, bury: 3 };
const ATTACK: Readonly<Record<string, number>> = { converge: 1, target: 2 };
const ADVANTAGE = "override";

export type IkonisWeapon = {
  label: string;
  trait: TraitId | null;
  /** Damage dice at the Proficiency and the flat bonus: the range's, Bonded (level) and damage augments. */
  dice: DicePool;
  flat: number;
  /** Attack roll bonus from Converge and Target. */
  attack: number;
  /** Override: attack rolls have advantage. */
  advantage: boolean;
  /** Feed text for the augments that changed the roll. */
  augments: string[];
};

/** The Ikonis's attack and damage, or null while its range (and so its damage dice) is not chosen. */
export function ikonisWeapon(ikonis: Ikonis, installed: readonly string[], level: number, proficiency: number): IkonisWeapon | null {
  const row = IKONIS_RANGES.find((r) => r.range === ikonis.range);
  if (row === undefined) return null;
  const { dice, flat } = weaponDice(row.damage, proficiency);
  const damageAugments = installed.reduce((s, id) => s + (DAMAGE[id] ?? 0), 0);
  return {
    label: ikonis.name.trim() || "Ikonis",
    trait: ikonis.trait,
    dice,
    flat: flat + level + damageAugments,
    attack: installed.reduce((s, id) => s + (ATTACK[id] ?? 0), 0),
    advantage: installed.includes(ADVANTAGE),
    augments: installed.filter((id) => id in DAMAGE || id in ATTACK || id === ADVANTAGE).map((id) => id.charAt(0).toUpperCase() + id.slice(1)),
  };
}
