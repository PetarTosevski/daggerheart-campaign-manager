// Reading and writing `sheet.sessionFeatures` (session-features F0). Pure: bundled into Convex.
import type { CharacterSheet, SessionFeatures } from "../../validation/characters";

type WithFeatures = Partial<Pick<CharacterSheet, "sessionFeatures">>;

/** The sheet's session-feature state; an old sheet without it reads as empty (no pool, no tokens, no die). */
export function featuresOf(sheet: WithFeatures): SessionFeatures {
  return sheet.sessionFeatures ?? {};
}

/**
 * The sheet with `patch` merged into `sessionFeatures`. A member set to `undefined` (or a pool set to 0) is
 * removed, and an empty object is dropped, so a sheet that never used a feature stores nothing.
 */
export function withFeatures<T extends WithFeatures>(sheet: T, patch: Partial<Record<keyof SessionFeatures, number | string | undefined>>): T {
  const merged: Record<string, unknown> = { ...featuresOf(sheet), ...patch };
  for (const [k, value] of Object.entries(merged)) {
    if (value === undefined || ((k === "slayerDice" || k === "tideTokens") && value === 0)) delete merged[k];
  }
  const next = { ...sheet };
  if (Object.keys(merged).length === 0) delete next.sessionFeatures;
  else next.sessionFeatures = merged as SessionFeatures;
  return next;
}
