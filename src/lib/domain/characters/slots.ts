// Features that grant a Hit Point or Stress slot (user decision 8, 2026-10-18: "yes, raise max").
// Pure module: bundled into Convex.
//
// A bonus raises the stored maximum once, when the feature is gained, and its key goes into
// `sheet.slotBonuses` so it is never applied twice (creation, multiclass level-up, the
// `migrations/slotBonuses:applySlotBonuses` backfill); undoing the multiclass takes it back.

import { getAncestry } from "../../srd/index";
import type { CharacterSheet } from "../../validation/characters";
import type { Mod } from "../card-effects/types";

export type SlotBonus = { hp: 1 } | { stress: 1 };

/**
 * Feature key -> the slot it grants. Subclass foundations by subclass id, ancestry features by
 * `ancestry:<ancestry id>:<feature index>` (index 0: the first feature, which a mixed ancestry takes from its first ancestry).
 */
export const FEATURE_SLOTS: Readonly<Record<string, SlotBonus>> = {
  /** Vengeance foundation, At Ease: "Gain an additional Stress slot." (CB 36) */
  "subclass:vengeance": { stress: 1 },
  /** School of War foundation, Battlemage: "... Gain an additional Hit Point slot." (CB 51) */
  "subclass:school-of-war": { hp: 1 },
  /** Giant, Endurance: "Gain an additional Hit Point slot at character creation." */
  "ancestry:giant:0": { hp: 1 },
  /** Human, High Stamina: "Gain an additional Stress slot at character creation." */
  "ancestry:human:0": { stress: 1 },
};

/** The key of a subclass's foundation slot bonus (whether or not the table lists it). */
export const subclassSlotKey = (subclassId: string): string => `subclass:${subclassId}`;

type Sources = Pick<CharacterSheet, "ancestry" | "subclassId" | "multiclass">;

/**
 * The table keys a sheet's features grant: its subclass and multiclass foundations, and its
 * ancestry features (a single ancestry has both; a mixed one the first feature of `first` and the
 * second of `second`, as the heritage card shows). A Shapeshifter's form feature is left out:
 * the form changes and the book ties these slots to character creation.
 */
export function slotBonusKeys(sheet: Sources): string[] {
  const keys = [subclassSlotKey(sheet.subclassId)];
  if (sheet.multiclass) keys.push(subclassSlotKey(sheet.multiclass.subclassId));
  const a = sheet.ancestry;
  if (a.kind === "single") {
    const count = getAncestry(a.id)?.features.length ?? 0;
    for (let i = 0; i < count; i++) keys.push(`ancestry:${a.id}:${i}`);
  } else if (a.kind === "mixed") {
    keys.push(`ancestry:${a.first}:0`, `ancestry:${a.second}:1`);
  }
  return keys.filter((k) => k in FEATURE_SLOTS);
}

type Slots = { hp: number; hpMax: number; stress: number; stressMax: number; slotBonuses?: string[] };

/** Adds the slot of `key` to the maximum and records it; unchanged when the key is unknown or already applied. */
export function gainSlotBonus<T extends Slots>(sheet: T, key: string): T {
  const bonus = FEATURE_SLOTS[key];
  return bonus ? gainSlots(sheet, key, slotCounts(bonus)) : sheet;
}

/** Takes back the slot of `key` when it was applied; marked Hit Points and Stress stay within the new maximum. */
export function loseSlotBonus<T extends Slots>(sheet: T, key: string): T {
  const bonus = FEATURE_SLOTS[key];
  return bonus ? loseSlots(sheet, key, slotCounts(bonus)) : sheet;
}

/** Hit Point and Stress slots a bonus adds. */
export type SlotCounts = { hp: number; stress: number };

const slotCounts = (bonus: SlotBonus): SlotCounts => ({ hp: "hp" in bonus ? bonus.hp : 0, stress: "stress" in bonus ? bonus.stress : 0 });

/**
 * Plan lanes, E5 (dcm-u6z, dcm-fjh): the slots an effect's `hpMax` / `stressMax` mods add (Vitality, CB p.330: "one Stress
 * slot, one Hit Point slot"; At Ease, CB p.36: "Gain an additional Stress slot"). Only fixed amounts: a slot count read
 * from the sheet would change as the sheet does, and a maximum is raised once.
 */
export function slotsFromMods(mods: readonly Mod[]): SlotCounts {
  const out: SlotCounts = { hp: 0, stress: 0 };
  for (const mod of mods) {
    if (mod.kind !== "stat" || mod.delta.kind !== "fixed") continue;
    if (mod.stat === "hpMax") out.hp += mod.delta.value;
    else if (mod.stat === "stressMax") out.stress += mod.delta.value;
  }
  return out;
}

/**
 * Raises the maxima by `counts` once under `key` (a `FEATURE_SLOTS` key, or a card pick such as `card:vitality:hp`) and
 * records the key; unchanged when the key is already applied or the counts are zero.
 */
export function gainSlots<T extends Slots>(sheet: T, key: string, counts: SlotCounts): T {
  const applied = sheet.slotBonuses ?? [];
  if (applied.includes(key) || (counts.hp === 0 && counts.stress === 0)) return sheet;
  return { ...sheet, hpMax: sheet.hpMax + counts.hp, stressMax: sheet.stressMax + counts.stress, slotBonuses: [...applied, key] };
}

/** Takes back `counts` recorded under `key`; marked Hit Points and Stress stay within the new maximum. */
export function loseSlots<T extends Slots>(sheet: T, key: string, counts: SlotCounts): T {
  const applied = sheet.slotBonuses ?? [];
  if (!applied.includes(key)) return sheet;
  const hpMax = sheet.hpMax - counts.hp;
  const stressMax = sheet.stressMax - counts.stress;
  return {
    ...sheet,
    hpMax,
    stressMax,
    hp: Math.min(sheet.hp, hpMax),
    stress: Math.min(sheet.stress, stressMax),
    slotBonuses: applied.filter((k) => k !== key),
  };
}

/** Applies every slot bonus the sheet's features grant that it doesn't have yet (creation and the backfill). */
export function applySlotBonuses<T extends Slots & Sources>(sheet: T): T {
  return slotBonusKeys(sheet).reduce((next, key) => gainSlotBonus(next, key), sheet);
}
