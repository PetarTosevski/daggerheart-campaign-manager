// Held dice any class can spend (D5 TI-a). Pure: bundled into Convex.
//
// A Rally Die (Bard, CB 28) is held by whoever received it, whatever their class (Hope & Fear classes
// too), so `hooks.ts` offers it on every sheet instead of each class module wiring it in: the dice box
// option (`heldDiceOptions`) and the "Rally Die: clear Stress" class action (`rallyDieStress`, added to
// every module by the registry in `index.ts`).
import { applyResourceDelta } from "../characters/index";
import type { CharacterSheet } from "../../validation/characters";
import type { FeatureMeta, RollOption } from "./types";
import { refuse } from "./classes/shared";

/** The sheet's Rally Dice as dice-box options, on action, reaction and damage rolls. */
export function heldDiceOptions(sheet: Pick<CharacterSheet, "heldDice">): RollOption[] {
  return sheet.heldDice
    .filter((d) => d.kind === "rally")
    .map((d) => ({ key: `rally:${d.id}`, label: `Rally Die d${d.sides}`, effect: { kind: "heldDie", heldDieId: d.id } }));
}

/** Spends the first held Rally Die: roll it and clear that much Stress (CB 28). */
export const rallyDieStress: FeatureMeta = {
  key: "rallyDieStress",
  name: "Rally Die: clear Stress",
  text: "Spend a held Rally Die: roll it and clear that much Stress.",
  automation: "auto",
  target: "self",
  use: ({ sheet, rng }) => {
    const die = sheet.heldDice.find((d) => d.kind === "rally");
    if (die === undefined) refuse("You hold no Rally Die.");
    if (sheet.stress === 0) refuse("No Stress is marked.");
    const value = die.value ?? rng(die.sides);
    const spent = { ...sheet, heldDice: sheet.heldDice.filter((d) => d.id !== die.id) };
    return { sheet: applyResourceDelta(spent, "stress", -value), summary: `spent a Rally Die (d${die.sides}: ${value}) to clear Stress` };
  },
};
