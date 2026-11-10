// Hope & Fear transformations given or taken away by the GM (HF p.34-40, bead dcm-psg9), and the Dark Heart of
// Andaluria's Reanimated loadout rule (HF p.153). Pure module: bundled into Convex, relative imports only.
//
// HF p.34: "A PC can have only one transformation." Giving one replaces the current one; `null` removes it.
// HF p.153 (transformations frame option on): "The character gains the Reanimated transformation and their maximum
// loadout is reduced to one. During a rest, they can use a downtime move to raise their maximum loadout by one until they
// reach the normal maximum loadout of five."

import { RuleError } from "../../errors/app-error";
import { TRANSFORMATIONS } from "../../srd/heritage";
import type { CharacterSheet } from "../../validation/characters";

/** "Your loadout can hold up to 5 domain cards" (CB p.101): the normal maximum. */
export const LOADOUT_MAX = 5;
/** HF p.153: a Reanimated PC's "maximum loadout is reduced to one". */
export const REANIMATED_LOADOUT_START = 1;
export const REANIMATED = "reanimated";

type LoadoutSheet = Pick<CharacterSheet, "loadoutMax">;

/** The character's maximum loadout: the stored lowered maximum (Andaluria's Reanimated, HF p.153), else 5. */
export function loadoutMax(sheet: LoadoutSheet): number {
  return sheet.loadoutMax ?? LOADOUT_MAX;
}

/** True when a known transformation id. */
export function isTransformationId(id: string): boolean {
  return TRANSFORMATIONS.some((t) => t.id === id);
}

/** The transformation's name, or the id itself for an unknown one. */
export function transformationName(id: string): string {
  return TRANSFORMATIONS.find((t) => t.id === id)?.name ?? id;
}

export type TransformationChange = {
  sheet: CharacterSheet;
  /** Loadout cards moved to the vault because the maximum went down (in loadout order). */
  vaulted: string[];
};

/**
 * Gives `id` (or removes the transformation with `null`). With `andaluriaReanimated` (Dark Heart of Andaluria with the
 * transformations option on), gaining Reanimated lowers the maximum loadout to one and the loadout keeps its first card;
 * the rest go to the vault, as an import keeps the first five (src/lib/import/sheet.ts). Losing Reanimated, by
 * removal or replacement, restores the normal maximum; vaulted cards stay in the vault (the player recalls them).
 * A Shapeshifter ancestry (its form is the Shapeshifter transformation) keeps Shapeshifter: INVALID otherwise.
 */
export function changeTransformation(sheet: CharacterSheet, id: string | null, options: { andaluriaReanimated: boolean }): TransformationChange {
  if (id !== null && !isTransformationId(id)) throw new RuleError("INVALID", "Unknown transformation.");
  if (sheet.ancestry.kind === "shapeshifter" && id !== "shapeshifter") {
    throw new RuleError("INVALID", "A Shapeshifter's ancestry is a form of that transformation; it keeps Shapeshifter.");
  }
  const next: CharacterSheet = { ...sheet };
  if (id === null) delete next.transformationId;
  else next.transformationId = id;
  const wasReanimated = sheet.transformationId === REANIMATED;
  if (wasReanimated && id !== REANIMATED) delete next.loadoutMax;
  let vaulted: string[] = [];
  if (id === REANIMATED && !wasReanimated && options.andaluriaReanimated) {
    next.loadoutMax = REANIMATED_LOADOUT_START;
    const kept = sheet.domainCards.loadout.slice(0, REANIMATED_LOADOUT_START);
    vaulted = sheet.domainCards.loadout.slice(REANIMATED_LOADOUT_START);
    next.domainCards = { owned: sheet.domainCards.owned, loadout: kept };
  }
  return { sheet: next, vaulted };
}

/** True when the Raise loadout downtime move helps: a lowered maximum below five (HF p.153). */
export function canRaiseLoadout(sheet: Pick<CharacterSheet, "transformationId" | "loadoutMax">): boolean {
  return sheet.transformationId === REANIMATED && loadoutMax(sheet) < LOADOUT_MAX;
}

/** HF p.153's downtime move: the maximum loadout goes up by one, up to five (then the stored maximum is dropped). */
export function raiseLoadout(sheet: CharacterSheet): { sheet: CharacterSheet; from: number; to: number } {
  const from = loadoutMax(sheet);
  const to = Math.min(LOADOUT_MAX, from + 1);
  const next: CharacterSheet = { ...sheet };
  if (to >= LOADOUT_MAX) delete next.loadoutMax;
  else next.loadoutMax = to;
  return { sheet: next, from, to };
}

/**
 * The confirm question before a change that takes something away (bead dcm-psg9: "Granting a new one replaces it (ask
 * in the UI with a confirm)"), or null when nothing needs asking: a first transformation without a loadout cut, or no
 * change. `andaluriaReanimated`: gaining Reanimated also cuts the maximum loadout to one (HF p.153).
 */
export function transformationConfirm(name: string, current: string | null, next: string | null, andaluriaReanimated: boolean): string | null {
  if (current === next) return null;
  const loadout =
    next === REANIMATED && andaluriaReanimated
      ? ` Their maximum loadout drops to ${REANIMATED_LOADOUT_START}; every other loadout card goes to the vault (HF p.153).`
      : "";
  if (next === null) return `Remove ${name}'s ${transformationName(current!)} transformation?`;
  if (current === null) return loadout === "" ? null : `Give ${name} the ${transformationName(next)} transformation?${loadout}`;
  return `${name} is already ${transformationName(current)}. A PC can have only one transformation (HF p.34): replace it with ${transformationName(next)}?${loadout}`;
}
