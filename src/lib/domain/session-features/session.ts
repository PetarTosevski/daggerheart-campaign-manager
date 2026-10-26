// The session boundary transforms (U1, U6, U8). Pure and deterministic with a fixed rng: bundled into Convex.
import type { FeatureScope, Rng } from "../class-features/types";
import type { CharacterSheet } from "../../validation/characters";
import { EVERYTHING, holdsLunarPhases } from "./holders";
import { applyLuckbringer } from "./luckbringer";
import { endMoon, moonDie, moonDieLabel, rollMoonDie } from "./lunar";
import { clearSlayerAtEnd } from "./slayer";
import { clearTideAtEnd } from "./tide";

/**
 * Session start for the ACTIVE PCs (pass only them): Luckbringer for the party (U1, capped at each Hope maximum),
 * then a moon die for each Lunar Phases holder in `scope` (U6). Returns the sheets in input order and the report
 * and log notes in order, e.g. "Luckbringer (Pip): everyone gains 1 Hope", "Mira's moon die: 4 (Full: +3 to
 * damage thresholds)". A sheet nothing applied to comes back as it came.
 */
export function sessionStartFeatures<T extends CharacterSheet>(activeSheets: readonly T[], rng: Rng, scope: FeatureScope = EVERYTHING): { sheets: T[]; notes: string[] } {
  const luck = applyLuckbringer(activeSheets);
  const notes = [...luck.notes];
  const sheets = luck.sheets.map((sheet) => {
    if (!holdsLunarPhases(sheet, scope)) return sheet;
    const next = rollMoonDie(sheet, rng);
    notes.push(`${sheet.name}'s moon die: ${moonDieLabel(moonDie(next)!)}`);
    return next;
  });
  return { sheets, notes };
}

/**
 * Session end for ONE PC (run it for every PC, after `expire(sheet, "session")` and `onSessionEnd`): clears the
 * Slayer Dice for a Hope each (capped), clears the Tide tokens and removes the moon die (U8). Returns the next
 * sheet and its notes, e.g. "Bryn cleared 2 Slayer Dice: +2 Hope", "Kai cleared 3 Tide tokens", "Mira's moon die
 * ends". Applies to whatever the sheet holds, whoever holds the feature now.
 */
export function sessionEndFeatures<T extends CharacterSheet>(sheet: T): { sheet: T; notes: string[] } {
  const notes: string[] = [];
  const slayer = clearSlayerAtEnd(sheet);
  if (slayer.cleared > 0) notes.push(`${sheet.name} cleared ${slayer.cleared} Slayer ${slayer.cleared === 1 ? "Die" : "Dice"}: +${slayer.hopeGained} Hope`);
  const tide = clearTideAtEnd(slayer.sheet);
  if (tide.cleared > 0) notes.push(`${sheet.name} cleared ${tide.cleared} Tide ${tide.cleared === 1 ? "token" : "tokens"}`);
  const hadMoon = moonDie(tide.sheet) !== undefined;
  const next = endMoon(tide.sheet);
  if (hadMoon) notes.push(`${sheet.name}'s moon die ends`);
  return { sheet: next, notes };
}
