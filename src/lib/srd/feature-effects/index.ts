// The feature-effect registry (plan sheet-drawer, tracer SD0): the twelve group tables merged into one map by feature id.
// Pure data: no framework imports, relative imports only (bundled into Convex).

import type { FeatureEffect } from "../../domain/feature-effects/types";
import { ancestryCoreEffects } from "./ancestry-core";
import { assassinBrawlerEffects } from "./assassin-brawler";
import { bardWizardEffects } from "./bard-wizard";
import { beastformEffects } from "./beastforms";
import { druidSorcererEffects } from "./druid-sorcerer";
import { guardianWarriorEffects } from "./guardian-warrior";
import { heritageHfEffects } from "./heritage-hf";
import { rangerRogueEffects } from "./ranger-rogue";
import { seraphWitchEffects } from "./seraph-witch";
import { stanceEffects } from "./stances";
import { transformationEffects } from "./transformations";
import { warlockEffects } from "./warlock";

export { FEATURE_CLASSIFICATION, MARTIAL_STANCE_SLUGS, featureClass, featureUsage } from "./classification";
export type { FeatureClass, FeatureHow } from "./classification";

let tables: Readonly<Record<string, readonly FeatureEffect[]>> | undefined;

/**
 * Each group's table, by the FE tracer that fills it. Built on the first read (dcm-uh6r): a Convex function that loads
 * this module but never reads a feature's effect evaluates none of the tables.
 */
export function featureEffectTables(): Readonly<Record<string, readonly FeatureEffect[]>> {
  tables ??= {
    "bard-wizard": bardWizardEffects(),
    "druid-sorcerer": druidSorcererEffects(),
    "guardian-warrior": guardianWarriorEffects(),
    "ranger-rogue": rangerRogueEffects(),
    "seraph-witch": seraphWitchEffects(),
    "assassin-brawler": assassinBrawlerEffects(),
    warlock: warlockEffects(),
    "ancestry-core": ancestryCoreEffects(),
    "heritage-hf": heritageHfEffects(),
    beastforms: beastformEffects(),
    transformations: transformationEffects(),
    stances: stanceEffects(),
  };
  return tables;
}

/** Each group's table (tests); bundles that only call the functions below drop it. */
export const FEATURE_EFFECT_TABLES: Readonly<Record<string, readonly FeatureEffect[]>> = /* @__PURE__ */ featureEffectTables();

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

let mergedEffects: ReadonlyMap<string, FeatureEffect> | undefined;

/** Every feature's effect entry, by feature id; merged on the first read (dcm-uh6r). */
export function allFeatureEffects(): ReadonlyMap<string, FeatureEffect> {
  mergedEffects ??= mergeFeatureTables(Object.values(featureEffectTables()));
  return mergedEffects;
}

/** Every feature's effect entry, by feature id (tests, the dice situations list); bundles that only call the functions drop it. */
export const FEATURE_EFFECTS: ReadonlyMap<string, FeatureEffect> = /* @__PURE__ */ allFeatureEffects();

/** The effect entry of a feature, or undefined while its FE tracer has not written it. */
export function featureEffect(featureId: string): FeatureEffect | undefined {
  return allFeatureEffects().get(featureId);
}
