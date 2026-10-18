// Brawler (HF 10). Hope feature: Square Up (assist).
//
// Class features:
// - I Am the Weapon: with no other Active Weapon (the primary is Brawler's Strike, no secondary), Brawler's Strike
//   deals Proficiency × d8 + Proficiency × d6 physical damage, Melee, and gives +1 Evasion. A critical deals the
//   dice's maximum (14 × Proficiency) plus a normal roll (CB 98, settled rule): `critBase`.
// - Combo Strike: after rolling damage on a successful Melee attack, mark a Stress: roll the Combo Die (d4, raised by
//   level-up advancements in `classState.comboDie`) and keep rolling until a result is lower than the one before it;
//   every result is added to that damage roll (role `extra`, so a roll is comboed once).
import { getWeapon } from "../../../srd/index";
import type { CharacterSheet } from "../../../validation/characters";
import type { RolledDie } from "../../duality";
import type { ClassFeatures, Rng, WeaponOverride } from "../types";
import { assistFeature, refuse } from "./shared";

export const BRAWLERS_STRIKE = "brawler-s-strike";
/** A safety stop for the combo chain; with a d4 a chain this long is vanishingly rare. */
export const COMBO_MAX = 20;

/** No Active Weapon other than Brawler's Strike (HF 10, I Am the Weapon). */
function barehanded(sheet: CharacterSheet): boolean {
  if (sheet.secondaryWeaponId !== undefined) return false;
  return sheet.primaryWeaponId === BRAWLERS_STRIKE || getWeapon(sheet.primaryWeaponId) === undefined;
}

/** Brawler's Strike at the sheet's Proficiency. */
export function brawlersStrike(proficiency: number): WeaponOverride {
  return {
    key: "brawlersStrike",
    label: "Brawler’s Strike (I Am the Weapon)",
    dice: [
      { count: proficiency, sides: 8 },
      { count: proficiency, sides: 6 },
    ],
    flat: 0,
    critBase: 14 * proficiency,
    evasionBonus: 1,
  };
}

/** Rolls the Combo Die until a result is lower than the one before it (HF 10); the lower one counts too. */
export function comboChain(sides: number, rng: Rng): number[] {
  const results = [rng(sides)];
  while (results.length < COMBO_MAX) {
    const next = rng(sides);
    const previous = results[results.length - 1]!;
    results.push(next);
    if (next < previous) break;
  }
  return results;
}

export const brawler: ClassFeatures = {
  classId: "brawler",
  hopeFeature: assistFeature("squareUp", "Square Up", "Intimidate a target within Close range: they are temporarily Vulnerable."),
  classActions: [
    {
      key: "comboStrike",
      name: "Combo Strike",
      text: "After rolling damage on a successful Melee attack: roll your Combo Die until a result is lower than the one before; add every result to the damage.",
      cost: { stress: 1 },
      automation: "auto",
      target: "none",
      use: ({ sheet, rng, roll }) => {
        if (roll?.kind !== "damage") refuse("Roll the attack’s damage first: your latest roll is not a damage roll.");
        if (roll.dice.some((d) => d.role === "extra")) refuse("This damage roll already has a combo strike.");
        const sides = sheet.classState.comboDie ?? 4;
        const results = comboChain(sides, rng);
        const extra = results.reduce((s, n) => s + n, 0);
        const dice: RolledDie[] = [...roll.dice, ...results.map((value) => ({ sides, value, role: "extra" as const }))];
        const total = roll.total + extra;
        return {
          sheet,
          roll: { ...roll, dice, total },
          summary: `used Combo Strike: d${sides} ${results.join(", ")} → +${extra} damage, ${roll.total} → ${total}`,
        };
      },
    },
  ],
  weaponOverrides: (sheet) => (barehanded(sheet) ? [brawlersStrike(sheet.proficiency)] : []),
};
