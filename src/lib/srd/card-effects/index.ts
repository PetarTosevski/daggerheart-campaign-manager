// The card-effect registry (plan combat-actions, tracer CA0): the ten per-domain tables merged into one map by card id.
// Pure data: no framework imports, relative imports only (bundled into Convex).

import type { CardEffect } from "../../domain/card-effects/types";
import { ARCANA_EFFECTS } from "./arcana";
import { BLADE_EFFECTS } from "./blade";
import { BONE_EFFECTS } from "./bone";
import { CODEX_EFFECTS } from "./codex";
import { DREAD_EFFECTS } from "./dread";
import { GRACE_EFFECTS } from "./grace";
import { MIDNIGHT_EFFECTS } from "./midnight";
import { SAGE_EFFECTS } from "./sage";
import { SPLENDOR_EFFECTS } from "./splendor";
import { VALOR_EFFECTS } from "./valor";

export { CARD_CLASSIFICATION, cardClass, cardUsage } from "./classification";
export type { CardClass, CardHow } from "./classification";

/** Each domain's table, in `DOMAINS` order. */
export const DOMAIN_EFFECT_TABLES: Readonly<Record<string, readonly CardEffect[]>> = {
  arcana: ARCANA_EFFECTS,
  blade: BLADE_EFFECTS,
  bone: BONE_EFFECTS,
  codex: CODEX_EFFECTS,
  grace: GRACE_EFFECTS,
  midnight: MIDNIGHT_EFFECTS,
  sage: SAGE_EFFECTS,
  splendor: SPLENDOR_EFFECTS,
  valor: VALOR_EFFECTS,
  dread: DREAD_EFFECTS,
};

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

/** Every card's effect entry, by card id. */
export const CARD_EFFECTS: ReadonlyMap<string, CardEffect> = mergeEffectTables(Object.values(DOMAIN_EFFECT_TABLES));

/** The effect entry of a card, or undefined while its domain tracer has not written it. */
export function cardEffect(cardId: string): CardEffect | undefined {
  return CARD_EFFECTS.get(cardId);
}
