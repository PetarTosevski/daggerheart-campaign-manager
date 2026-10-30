import { getArmor, getWeapon } from "../../srd/index";
import { augmentDefense } from "../../frames/extras/motherboard";
import { overrideEvasion } from "../class-features/hooks";
import type { FeatureScope } from "../class-features/types";
import { lunarBonuses } from "../session-features/lunar";
import type { CharacterSheet } from "../../validation/characters";
import type { TraitId } from "../../srd/types";
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
 * HF 17; `scope` as in `holdsLunarPhases`, default: allowed); `evasion` on the sheet is the base. A Beastform's
 * Evasion bonus is a passive of the drawer's table (DA9, B1: CB p.30 "add their Evasion bonus to your Evasion").
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
 * The traits with the passive features' trait bonuses (DA9, B1: user 2026-10-29, dcm-bxp.99.19.19): a Beastform's
 * statistics (CB p.30: "use the trait specified in their statistics"; CB p.32: "While transformed, you gain a bonus to the
 * listed trait") and Evolved's "+1 [+2] bonus to the trait used by this form" (CB p.34-35) come from the drawer's table
 * through `passiveMods`, no longer from D5's Beastform effect. Pass the sheet after `withEffects` (Evolution's +1 and
 * other effects stay effects); an older sheet whose Beastform effect still carries the mods is not counted twice.
 *
 * ```ts
 * derivedTraits(withEffects(sheet)).agility;   // Agile Scout: + 1
 * ```
 */
export function derivedTraits<T extends Pick<CharacterSheet, "traits"> & SubclassFields>(sheet: T, scope?: FeatureScope, state: PassiveState = {}): CharacterSheet["traits"] {
  const bonus = passiveMods(sheet, state, ownedScope(scope)).traits;
  const traits = { ...sheet.traits };
  for (const [id, delta] of Object.entries(bonus) as [TraitId, number][]) traits[id] += delta;
  return traits;
}

/** The sheet with `derivedTraits` in place of its traits (for the callers that read `withEffects(sheet).traits`). */
export function withPassiveTraits<T extends Pick<CharacterSheet, "traits"> & SubclassFields>(sheet: T, scope?: FeatureScope, state: PassiveState = {}): T {
  return { ...sheet, traits: derivedTraits(sheet, scope, state) };
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
