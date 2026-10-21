// Who holds each session-bound feature (plan session-features K7). Pure: bundled into Convex, shared with the sheet.
import { SUBCLASSES } from "../../srd/subclasses";
import type { FeatureScope } from "../class-features/types";
import type { CharacterSheet, SubclassRank } from "../../validation/characters";

// CL9: the subclasses leaf module, not the srd/index barrel (it closes over every SRD list).
const getSubclass = (id: string) => SUBCLASSES.find((s) => s.id === id);

/** No campaign known: every feature answers (the same default as class-features/hooks.ts). */
export const EVERYTHING: FeatureScope = { hopeAndFear: true, ikonis: false };

export const HALFLING = "halfling";
/** The Halfling's first ancestry feature (CB 64); a Shapeshifter stores the chosen form feature by this name. */
export const LUCKBRINGER = "Luckbringer";
export const CALL_OF_THE_SLAYER = "call-of-the-slayer";
export const SEABORNE = "seaborne";
export const MOON = "moon";

type Heritage = Pick<CharacterSheet, "ancestry">;
type Subclassed = Pick<CharacterSheet, "subclassId"> & Partial<Pick<CharacterSheet, "multiclass">> & { subclassRank?: SubclassRank };

/**
 * Luckbringer (Halfling, CB 64): a single Halfling ancestry; a mixed ancestry whose FIRST ancestry is Halfling
 * (the first ancestry gives its first feature, slots.ts); or a Shapeshifter (HF) whose current form is Halfling
 * and whose kept form feature is Luckbringer (the wizard stores the feature's name).
 */
export function holdsLuckbringer(sheet: Heritage): boolean {
  const a = sheet.ancestry;
  if (a.kind === "single") return a.id === HALFLING;
  if (a.kind === "mixed") return a.first === HALFLING;
  return a.form === HALFLING && a.feature === LUCKBRINGER;
}

/** Slayer (Call of the Slayer foundation, CB 48): the subclass at any rank, or as a multiclass foundation card (CB 111). */
export function holdsSlayer(sheet: Subclassed): boolean {
  return sheet.subclassId === CALL_OF_THE_SLAYER || sheet.multiclass?.subclassId === CALL_OF_THE_SLAYER;
}

/** Know the Tide (Seaborne community, CB 77). */
export function holdsTide(sheet: Pick<CharacterSheet, "communityId">): boolean {
  return sheet.communityId === SEABORNE;
}

/**
 * Lunar Phases (Moon Witch mastery, HF 17): the Moon subclass at mastery rank, never through a multiclass (which
 * only gives a foundation card). Moon is a Hope & Fear subclass, so it answers only with the campaign's
 * `hopeAndFear` option (callers without a campaign pass nothing: allowed).
 */
export function holdsLunarPhases(sheet: Subclassed, scope: FeatureScope = EVERYTHING): boolean {
  if (sheet.subclassId !== MOON || sheet.subclassRank !== "mastery") return false;
  return scope.hopeAndFear || getSubclass(MOON)?.source !== "hope-and-fear";
}
