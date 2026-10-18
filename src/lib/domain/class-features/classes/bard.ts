// Bard (CB 28). Hope feature: Make a Scene (assist). Class feature: Rally.
//
// Rally (settled rule): once per session the Bard gives themself and every other active PC a Rally Die
// (d6, d8 from level 5), held until session end (`expire(sheet, "session")` clears unspent dice). The
// holder spends it on an action, reaction or damage roll in the dice box, or rolls it to clear Stress.
// Any class may hold a Rally Die, so the spend is offered for every sheet by `hooks.ts` (held-dice.ts).
import type { CharacterSheet } from "../../../validation/characters";
import type { ClassFeatures, FeatureMeta } from "../types";
import { assistFeature } from "./shared";

/** The most dice a sheet holds (`heldDice` max). */
const HELD_MAX = 20;

/** Rally Die size by the Bard's level (CB 28). */
export const rallyDieSides = (level: number): number => (level >= 5 ? 8 : 6);

function giveRallyDie(sheet: CharacterSheet, sides: number): CharacterSheet {
  if (sheet.heldDice.length >= HELD_MAX) return sheet;
  let n = 1;
  while (sheet.heldDice.some((d) => d.id === `rally-${n}`)) n += 1;
  return { ...sheet, heldDice: [...sheet.heldDice, { id: `rally-${n}`, kind: "rally", sides, until: "session" }] };
}

const rally: FeatureMeta = {
  key: "rally",
  name: "Rally",
  text: "Once per session: you and each ally get a Rally Die (d6, d8 from level 5) for a roll, damage or clearing Stress. Unspent dice clear at session end.",
  cost: { use: { key: "rally", until: "session" } },
  automation: "auto",
  target: "party",
  use: ({ sheet, others }) => {
    const sides = rallyDieSides(sheet.level);
    return {
      sheet: giveRallyDie(sheet, sides),
      others: others.map((o) => ({ characterId: o.characterId, sheet: giveRallyDie(o.sheet, sides) })),
      summary: `rallied the party: ${others.length + 1} Rally ${others.length === 0 ? "Die" : "Dice"} (d${sides})`,
    };
  },
};

export const bard: ClassFeatures = {
  classId: "bard",
  hopeFeature: assistFeature("makeAScene", "Make a Scene", "Distract a target within Close range: −2 to their Difficulty for now."),
  classActions: [rally],
};
