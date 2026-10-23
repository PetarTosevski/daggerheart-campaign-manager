// The feature-effect registry (plan sheet-drawer, tracer SD0): the twelve group tables merged into one map by feature id.
// Pure data: no framework imports, relative imports only (bundled into Convex).

import type { FeatureEffect } from "../../domain/feature-effects/types";
import { ANCESTRY_CORE_EFFECTS } from "./ancestry-core";
import { ASSASSIN_BRAWLER_EFFECTS } from "./assassin-brawler";
import { BARD_WIZARD_EFFECTS } from "./bard-wizard";
import { BEASTFORM_EFFECTS } from "./beastforms";
import { DRUID_SORCERER_EFFECTS } from "./druid-sorcerer";
import { GUARDIAN_WARRIOR_EFFECTS } from "./guardian-warrior";
import { HERITAGE_HF_EFFECTS } from "./heritage-hf";
import { RANGER_ROGUE_EFFECTS } from "./ranger-rogue";
import { SERAPH_WITCH_EFFECTS } from "./seraph-witch";
import { STANCE_EFFECTS } from "./stances";
import { TRANSFORMATION_EFFECTS } from "./transformations";
import { WARLOCK_EFFECTS } from "./warlock";

export { FEATURE_CLASSIFICATION, MARTIAL_STANCE_SLUGS, featureClass, featureUsage } from "./classification";
export type { FeatureClass, FeatureHow } from "./classification";

/** Each group's table, by the FE tracer that fills it. */
export const FEATURE_EFFECT_TABLES: Readonly<Record<string, readonly FeatureEffect[]>> = {
  "bard-wizard": BARD_WIZARD_EFFECTS,
  "druid-sorcerer": DRUID_SORCERER_EFFECTS,
  "guardian-warrior": GUARDIAN_WARRIOR_EFFECTS,
  "ranger-rogue": RANGER_ROGUE_EFFECTS,
  "seraph-witch": SERAPH_WITCH_EFFECTS,
  "assassin-brawler": ASSASSIN_BRAWLER_EFFECTS,
  warlock: WARLOCK_EFFECTS,
  "ancestry-core": ANCESTRY_CORE_EFFECTS,
  "heritage-hf": HERITAGE_HF_EFFECTS,
  beastforms: BEASTFORM_EFFECTS,
  transformations: TRANSFORMATION_EFFECTS,
  stances: STANCE_EFFECTS,
};

/** Merges tables into one map; a feature id listed twice is a bug in a table, so it throws. */
export function mergeFeatureTables(tables: readonly (readonly FeatureEffect[])[]): ReadonlyMap<string, FeatureEffect> {
  const merged = new Map<string, FeatureEffect>();
  for (const table of tables) {
    for (const effect of table) {
      if (merged.has(effect.featureId)) throw new Error(`Feature ${effect.featureId} has two effect entries.`);
      merged.set(effect.featureId, effect);
    }
  }
  return merged;
}

/** Every feature's effect entry, by feature id. */
export const FEATURE_EFFECTS: ReadonlyMap<string, FeatureEffect> = mergeFeatureTables(Object.values(FEATURE_EFFECT_TABLES));

/** The effect entry of a feature, or undefined while its FE tracer has not written it. */
export function featureEffect(featureId: string): FeatureEffect | undefined {
  return FEATURE_EFFECTS.get(featureId);
}
