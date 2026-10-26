// Effect modifiers (D5 T0). Pure module: bundled into Convex.
//
// Contract: an effect's `mods` never change the stored base stats. Anything
// that shows or rolls a stat reads it through `withEffects(sheet)`, which
// returns a copy with Evasion and traits raised by the active effects, plus the
// attack and damage bonuses for the dice box (T1).
//
// ```ts
// const live = withEffects(sheet);
// derivedDefense(live).evasion;   // base Evasion + gear + effects (Rogue's Dodge +2)
// live.traits.agility;            // trait + any trait effect
// live.attackBonus;               // No Mercy +1 → add to action rolls that attack
// live.damageBonus;               // flat damage from effects
// ```

import type { TraitId } from "../../srd/types";
import type { Effect } from "../../validation/characters";

export type EffectBonuses = { attackBonus: number; damageBonus: number };

type Affected = { evasion: number; traits: Record<TraitId, number>; effects?: readonly Effect[] };

/** The sheet with every active effect's modifiers applied; base stats on the original are untouched. */
export function withEffects<T extends Affected>(sheet: T): T & EffectBonuses {
  let evasion = sheet.evasion;
  let attackBonus = 0;
  let damageBonus = 0;
  const traits = { ...sheet.traits };
  for (const { mods } of sheet.effects ?? []) {
    if (!mods) continue;
    evasion += mods.evasion ?? 0;
    attackBonus += mods.attack ?? 0;
    damageBonus += mods.damage ?? 0;
    if (mods.trait) traits[mods.trait.id] += mods.trait.delta;
  }
  return { ...sheet, evasion, traits, attackBonus, damageBonus };
}
