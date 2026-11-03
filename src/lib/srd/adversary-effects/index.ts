// The adversary-effect registry (plan combat-actions, tracer AA0): the eight tier / source tables merged into one map
// from adversary id to its feature effects. Pure data: no framework imports, relative imports only (bundled into Convex).

import type {
  AdversaryEffectGroup,
  AdversaryFeatureEffect,
} from "../../domain/adversary-effects/types";
import type { AdversaryDef } from "../types";
import { t1CoreEffects } from "./t1-core";
import { t1HfEffects } from "./t1-hf";
import { t2CoreEffects } from "./t2-core";
import { t2HfEffects } from "./t2-hf";
import { t3CoreEffects } from "./t3-core";
import { t3HfEffects } from "./t3-hf";
import { t4CoreEffects } from "./t4-core";
import { t4HfEffects } from "./t4-hf";

let tables: Readonly<Record<AdversaryEffectGroup, readonly AdversaryFeatureEffect[]>> | undefined;

/**
 * Each group's table, in `ADVERSARY_EFFECT_GROUPS` order. Built on the first read (dcm-uh6r): a Convex function that
 * loads this module but never reads an adversary's effects evaluates none of the tables.
 */
export function adversaryEffectTables(): Readonly<Record<AdversaryEffectGroup, readonly AdversaryFeatureEffect[]>> {
  tables ??= {
    "t1-core": t1CoreEffects(),
    "t1-hf": t1HfEffects(),
    "t2-core": t2CoreEffects(),
    "t2-hf": t2HfEffects(),
    "t3-core": t3CoreEffects(),
    "t3-hf": t3HfEffects(),
    "t4-core": t4CoreEffects(),
    "t4-hf": t4HfEffects(),
  };
  return tables;
}

/** Each group's table (tests); bundles that only call the functions below drop it. */
export const ADVERSARY_EFFECT_TABLES: Readonly<Record<AdversaryEffectGroup, readonly AdversaryFeatureEffect[]>> = /* @__PURE__ */ adversaryEffectTables();

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

let mergedEffects: ReadonlyMap<string, readonly AdversaryFeatureEffect[]> | undefined;

/** Every adversary's feature effects, by adversary id; merged on the first read (dcm-uh6r). */
export function allAdversaryEffects(): ReadonlyMap<string, readonly AdversaryFeatureEffect[]> {
  mergedEffects ??= mergeAdversaryEffectTables(Object.values(adversaryEffectTables()));
  return mergedEffects;
}

/** Every adversary's feature effects, by adversary id (tests); bundles that only call the functions drop it. */
export const ADVERSARY_EFFECTS: ReadonlyMap<string, readonly AdversaryFeatureEffect[]> = /* @__PURE__ */ allAdversaryEffects();

/** An adversary's feature effects; empty while its group's tracer has not written them (or for a custom adversary). */
export function adversaryEffects(adversaryId: string): readonly AdversaryFeatureEffect[] {
  return allAdversaryEffects().get(adversaryId) ?? [];
}

/** The effect entry of one feature (by its printed name), or undefined while it has none. */
export function adversaryFeatureEffect(adversaryId: string, feature: string): AdversaryFeatureEffect | undefined {
  return adversaryEffects(adversaryId).find((e) => e.feature === feature);
}
