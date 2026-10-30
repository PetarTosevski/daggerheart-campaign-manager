import { getArmor, getWeapon } from "../../srd/index";
import { augmentDefense } from "../../frames/extras/motherboard";
import { overrideEvasion } from "../class-features/hooks";
import type { FeatureScope } from "../class-features/types";
import { lunarBonuses } from "../session-features/lunar";
import type { CharacterSheet } from "../../validation/characters";
import { passiveMods, type PassiveSheet, type PassiveState } from "../feature-effects/passives";
import { damageThresholds, equipmentModifiers, type Thresholds } from "./index";

type SubclassBonus = { thresholds?: number; severe?: number; evasion?: number };

/** What the passive feature tables read from the sheet (all optional: partial sheets hold what they name). */
type SubclassFields = Partial<Pick<CharacterSheet, "subclassId" | "subclassRank" | "multiclass">> & PassiveSheet;

/** The Lunar Phases die (session-features): a Moon Witch's Waning adds Evasion, Full adds to both thresholds (HF 17). */
type MoonFields = Partial<Pick<CharacterSheet, "sessionFeatures">>;

/** The moon die's bonuses; all 0 without a mastery Moon Witch holding a die (E6: such sheets are unchanged). */
function moon(sheet: SubclassFields & MoonFields, scope: FeatureScope | undefined) {
  return sheet.subclassId === undefined ? { evasion: 0, thresholds: 0 } : lunarBonuses({ ...sheet, subclassId: sheet.subclassId }, scope);
}

/**
 * Summed always-on bonuses of the subclass cards held, plus a multiclass foundation card (CB 111), read from the feature
 * tables (Unwavering, Fleeting Shadow, Ascendant, Rugged, ...). `thresholds` is the bonus to both thresholds, `severe` the
 * part that only the Severe threshold gets.
 */
export function subclassBonuses(sheet: SubclassFields, scope?: FeatureScope): Required<SubclassBonus> {
  const m = passiveMods(sheet, {}, ownedScope(scope), (f) => f.source === "subclass");
  return { thresholds: m.majorThreshold, severe: m.severeThreshold - m.majorThreshold, evasion: m.evasion };
}

const ownedScope = (scope: FeatureScope | undefined) => (scope === undefined ? {} : { hopeAndFear: scope.hopeAndFear });

/**
 * Evasion and Armor Score after equipped items' modifiers, subclass bonuses,
 * the active weapon override's Evasion (Brawler's Strike +1, HF 10; needs
 * `classId` and `proficiency`), installed Ikonis augments (Motherboard:
 * Guard, Deny, Block, CB 301-303) and a Waning moon die (+1, Lunar Phases,
 * HF 17; `scope` as in `holdsLunarPhases`, default: allowed); `evasion` on the sheet is the base.
 */
export function derivedDefense(
  sheet: Pick<CharacterSheet, "evasion" | "primaryWeaponId" | "secondaryWeaponId" | "armorId"> & SubclassFields & MoonFields & Partial<Pick<CharacterSheet, "classId" | "proficiency">>,
  installedAugments: readonly string[] = [],
  scope?: FeatureScope,
  state: PassiveState = {},
) {
  const items = [getWeapon(sheet.primaryWeaponId), sheet.secondaryWeaponId ? getWeapon(sheet.secondaryWeaponId) : undefined];
  const armor = sheet.armorId ? getArmor(sheet.armorId) : undefined;
  const mods = equipmentModifiers([...items.map((w) => w?.feature?.text), armor?.feature?.text]);
  const subclassEvasion = subclassBonuses(sheet, scope).evasion;
  const passives = passiveMods(sheet, state, ownedScope(scope));
  const augments = augmentDefense(installedAugments);
  const { classId, proficiency } = sheet;
  const weaponEvasion =
    classId !== undefined && proficiency !== undefined
      ? overrideEvasion({ classId, proficiency, primaryWeaponId: sheet.primaryWeaponId, secondaryWeaponId: sheet.secondaryWeaponId, multiclass: sheet.multiclass })
      : 0;
  return {
    evasion: sheet.evasion + mods.evasion + passives.evasion + weaponEvasion + augments.evasion + moon(sheet, scope).evasion,
    evasionModifier: mods.evasion + augments.evasion,
    subclassEvasion,
    armorScore: Math.max(0, (armor?.baseScore ?? 0) + mods.armorScore + augments.armorScore + passives.armorScore),
  };
}

/**
 * Damage thresholds: armor base + level (CB 18, 111) + the passive features' bonuses (Unwavering, Shell, Stoneskin, Rugged,
 * ...; the Severe threshold alone for Ascendant and Rugged) + a Full moon die (+3 to both, HF 17).
 */
export function derivedThresholds(sheet: Pick<CharacterSheet, "level" | "armorId"> & SubclassFields & MoonFields, scope?: FeatureScope, state: PassiveState = {}): Thresholds {
  const armor = sheet.armorId ? getArmor(sheet.armorId) : undefined;
  const passives = passiveMods(sheet, state, ownedScope(scope));
  const t = damageThresholds(sheet.level, armor?.baseThresholds ?? null, passives.majorThreshold + moon(sheet, scope).thresholds);
  return { major: t.major, severe: t.severe + (passives.severeThreshold - passives.majorThreshold) };
}
