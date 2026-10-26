// Know the Tide (Seaborne community, CB 77). Pure: bundled into Convex.
//
// "When you roll with Fear, place a token on your community card. You can hold a number of tokens equal to your
// level. Before you make an action roll, you can spend any number of these tokens to gain a +1 bonus to the roll
// for each token spent. At the end of each session, clear all unspent tokens."
//
// Q1 (answered by the user 2026-10-21): only ACTION rolls place a token, never reaction rolls ("they don't generate
// Hope, Fear, or additional GM moves", CB 99); a critical is never "with Fear"; for a Tag Team only the chosen roll
// counts, for both participants (the caller passes that roll's outcome for each). Only the roll as rolled counts.
import { RuleError } from "../../errors/app-error";
import type { RollKind, RollOutcome } from "../duality";
import type { CharacterSheet } from "../../validation/characters";
import { holdsTide } from "./holders";
import { featuresOf, withFeatures } from "./state";

/** The outcomes that are "a roll with Fear" (CB 18: the Fear Die rolled higher). A critical is never one. */
export const WITH_FEAR: readonly RollOutcome[] = ["successFear", "failFear"];

/** How many tokens the sheet may hold: its level (K3). */
export function tideCapacity(sheet: Pick<CharacterSheet, "level">): number {
  return sheet.level;
}

/** The tokens held now (0 for an old sheet). A lowered level trims nothing already held. */
export function tideTokens(sheet: Pick<CharacterSheet, "sessionFeatures">): number {
  return featuresOf(sheet).tideTokens ?? 0;
}

/**
 * After a roll (U4): places one token for a Know the Tide holder when the roll is an ACTION roll with Fear and
 * fewer than `level` tokens are held. Otherwise the sheet comes back unchanged with `placed: false`.
 */
export function placeTideToken<T extends CharacterSheet>(sheet: T, outcome: RollOutcome, kind: RollKind): { sheet: T; placed: boolean } {
  const held = tideTokens(sheet);
  if (!holdsTide(sheet) || kind !== "action" || !WITH_FEAR.includes(outcome) || held >= tideCapacity(sheet)) return { sheet, placed: false };
  return { sheet: withFeatures(sheet, { tideTokens: held + 1 }), placed: true };
}

/**
 * Spends `n` tokens before an action roll (U5): `modifier` is +n. 0 is always allowed and changes nothing.
 * Refuses with CLASS_FEATURE_RULE for a sheet without Know the Tide, DICE_RULE for a count that is not a whole
 * number from 0 to the tokens held.
 */
export function spendTideTokens<T extends CharacterSheet>(sheet: T, n: number): { sheet: T; modifier: number } {
  if (n === 0) return { sheet, modifier: 0 };
  if (!holdsTide(sheet)) throw new RuleError("CLASS_FEATURE_RULE", "Only a Seaborne character holds Know the Tide tokens.");
  const held = tideTokens(sheet);
  if (!Number.isInteger(n) || n < 0 || n > held) throw new RuleError("DICE_RULE", `You hold ${held} Tide ${held === 1 ? "token" : "tokens"}.`);
  return { sheet: withFeatures(sheet, { tideTokens: held - n }), modifier: n };
}

/** Session end (K3, U8): clears every unspent token. */
export function clearTideAtEnd<T extends CharacterSheet>(sheet: T): { sheet: T; cleared: number } {
  const cleared = tideTokens(sheet);
  if (cleared === 0) return { sheet, cleared };
  return { sheet: withFeatures(sheet, { tideTokens: undefined }), cleared };
}
