// Bard (CB 28). Hope feature: Make a Scene (assist). Class feature: Rally.
//
// Rally (settled rule): once per session the Bard gives themself and every other active PC a Rally Die
// (d6, d8 from level 5), held until session end (`expire(sheet, "session")` clears unspent dice). The
// holder spends it on an action, reaction or damage roll in the dice box, or rolls it to clear Stress.
// Any class may hold a Rally Die, so every Core Book class module offers the spend through
// `rallyDieOptions` and `rallyDieStress`, exported from here.
import { applyResourceDelta } from "../../characters/index";
import type { CharacterSheet } from "../../../validation/characters";
import type { ClassFeatures, FeatureMeta, RollOption } from "../types";
import { assistFeature, refuse } from "./shared";

/** The Core Book class modules (T8b); each offers held Rally Dice. */
const CORE_CLASSES: readonly string[] = ["bard", "druid", "guardian", "ranger", "rogue", "seraph", "sorcerer", "warrior", "wizard"];

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

/**
 * The sheet's Rally Dice as dice-box options. Exactly one module answers per sheet, so a multiclass
 * never offers a die twice: the primary class's, or a Core multiclass's when the primary class is not a Core class.
 */
export function rallyDieOptions(sheet: CharacterSheet, classId: string): RollOption[] {
  const answers = sheet.classId === classId || (sheet.multiclass?.classId === classId && !CORE_CLASSES.includes(sheet.classId));
  if (!answers) return [];
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
  classActions: [rally, rallyDieStress],
  rollOptions: (sheet) => rallyDieOptions(sheet, "bard"),
};
