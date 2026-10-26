// The adversary-effect registry (plan combat-actions, tracer AA0): the eight tier / source tables merged into one map
// from adversary id to its feature effects. Pure data: no framework imports, relative imports only (bundled into Convex).

import type {
  AdversaryEffectGroup,
  AdversaryFeatureEffect,
} from "../../domain/adversary-effects/types";
import type { AdversaryDef } from "../types";
import { T1_CORE_EFFECTS } from "./t1-core";
import { T1_HF_EFFECTS } from "./t1-hf";
import { T2_CORE_EFFECTS } from "./t2-core";
import { T2_HF_EFFECTS } from "./t2-hf";
import { T3_CORE_EFFECTS } from "./t3-core";
import { T3_HF_EFFECTS } from "./t3-hf";
import { T4_CORE_EFFECTS } from "./t4-core";
import { T4_HF_EFFECTS } from "./t4-hf";

/** Each group's table, in `ADVERSARY_EFFECT_GROUPS` order. */
export const ADVERSARY_EFFECT_TABLES: Readonly<Record<AdversaryEffectGroup, readonly AdversaryFeatureEffect[]>> = {
  "t1-core": T1_CORE_EFFECTS,
  "t1-hf": T1_HF_EFFECTS,
  "t2-core": T2_CORE_EFFECTS,
  "t2-hf": T2_HF_EFFECTS,
  "t3-core": T3_CORE_EFFECTS,
  "t3-hf": T3_HF_EFFECTS,
  "t4-core": T4_CORE_EFFECTS,
  "t4-hf": T4_HF_EFFECTS,
};

/**
 * The group whose table holds an SRD adversary's features: its tier and its book. Hope & Fear frame adversaries
 * (Reign of the Weredragon) go with their tier's Hope & Fear group.
 */
export function adversaryGroup(adversary: Pick<AdversaryDef, "tier" | "source">): AdversaryEffectGroup {
  return `t${adversary.tier}-${adversary.source === "core" ? "core" : "hf"}`;
}

/**
 * Merges tables into one map by adversary id, keeping each adversary's entries in table order. A feature listed
 * twice for the same adversary is a bug in a table, so it throws.
 */
export function mergeAdversaryEffectTables(
  tables: readonly (readonly AdversaryFeatureEffect[])[],
): ReadonlyMap<string, readonly AdversaryFeatureEffect[]> {
  const merged = new Map<string, AdversaryFeatureEffect[]>();
  for (const table of tables) {
    for (const effect of table) {
      const list = merged.get(effect.adversaryId) ?? [];
      if (list.some((e) => e.feature === effect.feature)) {
        throw new Error(`Feature ${effect.adversaryId}/${effect.feature} has two effect entries.`);
      }
      list.push(effect);
      merged.set(effect.adversaryId, list);
    }
  }
  return merged;
}

/** Every adversary's feature effects, by adversary id. */
export const ADVERSARY_EFFECTS: ReadonlyMap<string, readonly AdversaryFeatureEffect[]> = mergeAdversaryEffectTables(
  Object.values(ADVERSARY_EFFECT_TABLES),
);

/** An adversary's feature effects; empty while its group's tracer has not written them (or for a custom adversary). */
export function adversaryEffects(adversaryId: string): readonly AdversaryFeatureEffect[] {
  return ADVERSARY_EFFECTS.get(adversaryId) ?? [];
}

/** The effect entry of one feature (by its printed name), or undefined while it has none. */
export function adversaryFeatureEffect(adversaryId: string, feature: string): AdversaryFeatureEffect | undefined {
  return adversaryEffects(adversaryId).find((e) => e.feature === feature);
}
