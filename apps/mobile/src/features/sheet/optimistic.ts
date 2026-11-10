import { useQuery } from "convex/react";

import { applyResourceDelta, type PcDamageRules } from "../../../../../src/lib/domain/characters/index";
import type { TraitId } from "../../../../../src/lib/srd/types";
import { api, type Id } from "../../convex";
import type { Resource, SheetCharacter } from "./types";

/** The trait range `characters.setTrait` keeps (-5..+10). */
const TRAIT_MIN = -5;
const TRAIT_MAX = 10;

/**
 * The campaign's D4 `stressOverflow` and D5 `fullStressVulnerable` modes from `ruleSettings.get` (every member reads
 * it). Unloaded reads as the Book (`{}`), which is also every campaign's default.
 */
export function useStressRules(campaignId: Id<"campaigns">): PcDamageRules {
  const settings = useQuery(api.ruleSettings.get, { campaignId });
  if (!settings) return {};
  return { stressOverflow: settings.modes.stressOverflow, fullStressVulnerable: settings.modes.fullStressVulnerable };
}

/**
 * The character after one `characters.adjustResource` step, for the optimistic update (dcm-gdzi.22): HP, Stress, Hope
 * and scars through the website's `applyResourceDelta` (Stress past full marks a Hit Point under D4 Book, CB p.106;
 * Manual drops it, CB p.92), Armor Slots within the armor score.
 */
export function stepResource(
  character: SheetCharacter,
  resource: Resource,
  delta: number,
  rules: PcDamageRules,
  armorMax: number,
): SheetCharacter {
  const sheet = character.sheet;
  if (resource === "armor") {
    return { ...character, sheet: { ...sheet, armorMarked: Math.max(0, Math.min(armorMax, sheet.armorMarked + delta)) } };
  }
  return { ...character, sheet: applyResourceDelta(sheet, resource, delta, rules) };
}

/** The character after `characters.setTrait` moves one trait by `delta`. */
export function stepTrait(character: SheetCharacter, trait: TraitId, delta: number): SheetCharacter {
  const traits = character.sheet.traits;
  const next = Math.max(TRAIT_MIN, Math.min(TRAIT_MAX, traits[trait] + delta));
  return { ...character, sheet: { ...character.sheet, traits: { ...traits, [trait]: next } } };
}

/**
 * Whether one more Stress can be marked: below full always; at full only when D4 is the Book's (the extra mark lands
 * on a Hit Point), and only while a Hit Point is free.
 */
export function canMarkStress(sheet: SheetCharacter["sheet"], rules: PcDamageRules): boolean {
  if (sheet.stress < sheet.stressMax) return true;
  return rules.stressOverflow !== "manual" && sheet.hp < sheet.hpMax;
}
