// Wither tokens (Witherwild, D5 T5). Pure module: bundled into Convex.
//
// CB 261, "Corruption from the Witherwild": "Any time a PC takes Severe damage
// from a Withered adversary or environment, gain a Wither token ... the PC must
// roll their Fear Die. If they roll equal to or below the number of Wither
// tokens on their sheet, they immediately gain a scar and clear all tokens."
// "At the end of each session, clear all Wither tokens from the PCs' sheets and
// gain an equal amount of Fear." CB 106, Scars: a scar crosses out a Hope slot;
// crossing out the last one ends the character's journey.
//
// ```ts
// const gain = gainWither(sheet, rollDie(FEAR_DIE_SIDES)); // { sheet, tokens, fearDie, scarred }
// ```

import { hopeMax, scarsMax } from "../characters/index";

/** The Fear Die of the Duality Dice. */
export const FEAR_DIE_SIDES = 12;
/** The book's pool of "about 20 Wither tokens": shown for reference, never a cap (decision). */
export const WITHER_POOL = 20;
/** The sheet's bounds (src/lib/validation/characters.ts). */
export const WITHER_MAX = 99;

type WitherSheet = { wither: number; scars: number; hope: number; hopeSlotBonus?: number; journeyEnds?: boolean };

/** The Fear Die scars the character when it rolls at or below their tokens (CB 261). */
export function fearDieScars(fearDie: number, tokens: number): boolean {
  return fearDie <= tokens;
}

/**
 * Crosses out one Hope slot (CB 106): one more scar, Hope cut to the slots
 * left, and the journey ends when no slot is left. Scars stop at one per
 * Hope slot: 6, or 7 with Light in the Dark (`hopeSlotBonus`, CB 40).
 */
export function addScar<T extends WitherSheet>(sheet: T): T {
  const scars = Math.min(scarsMax(sheet.hopeSlotBonus ?? 0), sheet.scars + 1);
  const slots = hopeMax(scars, sheet.hopeSlotBonus ?? 0);
  return { ...sheet, scars, hope: Math.min(sheet.hope, slots), journeyEnds: Boolean(sheet.journeyEnds) || slots === 0 };
}

export type WitherGain<T> = {
  sheet: T;
  /** Tokens on the sheet after the gain and before any clearing: what the Fear Die was compared with. */
  tokens: number;
  fearDie: number;
  scarred: boolean;
};

/** One Wither token, then the Fear Die: at or below the tokens → a scar and the tokens cleared (CB 261). */
export function gainWither<T extends WitherSheet>(sheet: T, fearDie: number): WitherGain<T> {
  const tokens = Math.min(WITHER_MAX, sheet.wither + 1);
  if (fearDieScars(fearDie, tokens)) return { sheet: addScar({ ...sheet, wither: 0 }), tokens, fearDie, scarred: true };
  return { sheet: { ...sheet, wither: tokens }, tokens, fearDie, scarred: false };
}

/** The GM's correction: tokens moved by `delta`, kept within 0..99; no Fear Die. */
export function adjustWither<T extends { wither: number }>(sheet: T, delta: number): T {
  return { ...sheet, wither: Math.max(0, Math.min(WITHER_MAX, sheet.wither + delta)) };
}
