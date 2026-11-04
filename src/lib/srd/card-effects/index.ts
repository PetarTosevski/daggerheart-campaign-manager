// The card-effect registry (plan combat-actions, tracer CA0): the ten per-domain tables merged into one map by card id.
// Pure data: no framework imports, relative imports only (bundled into Convex).

import type { CardEffect } from "../../domain/card-effects/types";
import { arcanaEffects } from "./arcana";
import { bladeEffects } from "./blade";
import { boneEffects } from "./bone";
import { codexEffects } from "./codex";
import { dreadEffects } from "./dread";
import { graceEffects } from "./grace";
import { midnightEffects } from "./midnight";
import { sageEffects } from "./sage";
import { splendorEffects } from "./splendor";
import { valorEffects } from "./valor";

export { CARD_CLASSIFICATION, cardClass, cardUsage } from "./classification";
export type { CardClass, CardHow } from "./classification";

let tables: Readonly<Record<string, readonly CardEffect[]>> | undefined;

/**
 * Each domain's table, in `DOMAINS` order. Built on the first read (dcm-uh6r): a Convex function that loads this module
 * but never reads a card's effect evaluates none of the tables.
 */
export function domainEffectTables(): Readonly<Record<string, readonly CardEffect[]>> {
  tables ??= {
    arcana: arcanaEffects(),
    blade: bladeEffects(),
    bone: boneEffects(),
    codex: codexEffects(),
    grace: graceEffects(),
    midnight: midnightEffects(),
    sage: sageEffects(),
    splendor: splendorEffects(),
    valor: valorEffects(),
    dread: dreadEffects(),
  };
  return tables;
}

/** Each domain's table (tests); bundles that only call the functions below drop it. */
export const DOMAIN_EFFECT_TABLES: Readonly<Record<string, readonly CardEffect[]>> = /* @__PURE__ */ domainEffectTables();

/** Merges tables into one map; a card id listed twice is a bug in a table, so it throws. */
export function mergeEffectTables(tables: readonly (readonly CardEffect[])[]): ReadonlyMap<string, CardEffect> {
  const merged = new Map<string, CardEffect>();
  for (const table of tables) {
    for (const effect of table) {
      if (merged.has(effect.cardId)) throw new Error(`Card ${effect.cardId} has two effect entries.`);
      merged.set(effect.cardId, effect);
    }
  }
  return merged;
}

let mergedEffects: ReadonlyMap<string, CardEffect> | undefined;

/** Every card's effect entry, by card id; merged on the first read (dcm-uh6r). */
export function allCardEffects(): ReadonlyMap<string, CardEffect> {
  mergedEffects ??= mergeEffectTables(Object.values(domainEffectTables()));
  return mergedEffects;
}

/** Every card's effect entry, by card id (tests, the dice situations list); bundles that only call the functions drop it. */
export const CARD_EFFECTS: ReadonlyMap<string, CardEffect> = /* @__PURE__ */ allCardEffects();

/** The effect entry of a card, or undefined while its domain tracer has not written it. */
export function cardEffect(cardId: string): CardEffect | undefined {
  return allCardEffects().get(cardId);
}
