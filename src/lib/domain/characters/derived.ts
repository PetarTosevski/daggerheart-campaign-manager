import { getArmor, getWeapon } from "../../srd/index";
import { augmentDefense } from "../../frames/extras/motherboard";
import { overrideEvasion } from "../class-features/hooks";
import type { CharacterSheet, SubclassRank } from "../../validation/characters";
import { damageThresholds, equipmentModifiers, type Thresholds } from "./index";

type SubclassBonus = { thresholds?: number; severe?: number; evasion?: number };

/**
 * Always-on numeric subclass features (decision 11; other subclass features stay text).
 * Cards are kept as the subclass is upgraded (CB 110, "Take the next card"), so ranks add up.
 */
const SUBCLASS_BONUSES: Readonly<Record<string, Partial<Record<SubclassRank, SubclassBonus>>>> = {
  // CB 36: Unwavering +1, Unrelenting +2, Undaunted +3 "to your damage thresholds".
  stalwart: { foundation: { thresholds: 1 }, specialization: { thresholds: 2 }, mastery: { thresholds: 3 } },
  // CB 42, Fleeting Shadow: "Gain a permanent +1 bonus to your Evasion."
  nightwalker: { mastery: { evasion: 1 } },
  // CB 45, Ascendant: "Gain a permanent +4 bonus to your Severe damage threshold."
  "winged-sentinel": { mastery: { severe: 4 } },
  // HF 10, Rugged: "Gain a permanent +3 bonus to your Severe damage threshold."
  juggernaut: { foundation: { severe: 3 } },
};

const HELD: Record<SubclassRank, readonly SubclassRank[]> = {
  foundation: ["foundation"],
  specialization: ["foundation", "specialization"],
  mastery: ["foundation", "specialization", "mastery"],
};

type SubclassFields = Partial<Pick<CharacterSheet, "subclassId" | "subclassRank" | "multiclass">>;

/** Summed always-on bonuses of the subclass cards held, plus a multiclass foundation card (CB 111). */
export function subclassBonuses(sheet: SubclassFields): Required<SubclassBonus> {
  const total = { thresholds: 0, severe: 0, evasion: 0 };
  const cards: [string | undefined, readonly SubclassRank[]][] = [
    [sheet.subclassId, HELD[sheet.subclassRank ?? "foundation"]],
    [sheet.multiclass?.subclassId, HELD.foundation],
  ];
  for (const [id, ranks] of cards) {
    const table = id ? SUBCLASS_BONUSES[id] : undefined;
    for (const rank of ranks) {
      const b = table?.[rank];
      total.thresholds += b?.thresholds ?? 0;
      total.severe += b?.severe ?? 0;
      total.evasion += b?.evasion ?? 0;
    }
  }
  return total;
}

/**
 * Evasion and Armor Score after equipped items' modifiers, subclass bonuses,
 * the active weapon override's Evasion (Brawler's Strike +1, HF 10; needs
 * `classId` and `proficiency`) and installed Ikonis augments (Motherboard:
 * Guard, Deny, Block, CB 301-303); `evasion` on the sheet is the base.
 */
export function derivedDefense(
  sheet: Pick<CharacterSheet, "evasion" | "primaryWeaponId" | "secondaryWeaponId" | "armorId"> & SubclassFields & Partial<Pick<CharacterSheet, "classId" | "proficiency">>,
  installedAugments: readonly string[] = [],
) {
  const items = [getWeapon(sheet.primaryWeaponId), sheet.secondaryWeaponId ? getWeapon(sheet.secondaryWeaponId) : undefined];
  const armor = sheet.armorId ? getArmor(sheet.armorId) : undefined;
  const mods = equipmentModifiers([...items.map((w) => w?.feature?.text), armor?.feature?.text]);
  const subclassEvasion = subclassBonuses(sheet).evasion;
  const augments = augmentDefense(installedAugments);
  const { classId, proficiency } = sheet;
  const weaponEvasion =
    classId !== undefined && proficiency !== undefined
      ? overrideEvasion({ classId, proficiency, primaryWeaponId: sheet.primaryWeaponId, secondaryWeaponId: sheet.secondaryWeaponId, multiclass: sheet.multiclass })
      : 0;
  return {
    evasion: sheet.evasion + mods.evasion + subclassEvasion + weaponEvasion + augments.evasion,
    evasionModifier: mods.evasion + augments.evasion,
    subclassEvasion,
    armorScore: Math.max(0, (armor?.baseScore ?? 0) + mods.armorScore + augments.armorScore),
  };
}

/** Damage thresholds: armor base + level (CB 18, 111) + always-on subclass bonuses. */
export function derivedThresholds(sheet: Pick<CharacterSheet, "level" | "armorId"> & SubclassFields): Thresholds {
  const armor = sheet.armorId ? getArmor(sheet.armorId) : undefined;
  const bonus = subclassBonuses(sheet);
  const t = damageThresholds(sheet.level, armor?.baseThresholds ?? null, bonus.thresholds);
  return { major: t.major, severe: t.severe + bonus.severe };
}
