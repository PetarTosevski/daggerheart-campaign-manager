// Guardian (CB 36). Hope feature: Frontline Tank clears 2 Armor Slots. Class feature: Unstoppable.
//
// Unstoppable: once per long rest the Guardian gains an Unstoppable Die (d4, d6 from level 5) starting at 1
// (`classState.unstoppable`). Its value is added to every damage roll (an auto dice-box option). After a damage
// roll that deals 1 or more Hit Points the player presses "Dealt Hit Points" (+1); when the value would exceed
// the maximum, or the scene ends (End Unstoppable, or session end), the die is removed. Becoming Unstoppable
// clears Restrained and Vulnerable (it can't have them); the damage-severity reduction is a reminder.
import type { CharacterSheet } from "../../../validation/characters";
import type { ClassFeatures, FeatureMeta } from "../types";
import { HOPE_COST, refuse } from "./shared";

/** Unstoppable Die size by level (CB 36). */
export const unstoppableMax = (level: number): number => (level >= 5 ? 6 : 4);

function withoutDie(sheet: CharacterSheet): CharacterSheet {
  const classState = { ...sheet.classState };
  delete classState.unstoppable;
  return { ...sheet, classState };
}

const unstoppable: FeatureMeta = {
  key: "unstoppable",
  name: "Unstoppable",
  text: "Once per long rest: gain an Unstoppable Die at 1, added to your damage rolls. Reduce physical damage severity by one threshold; you can't be Restrained or Vulnerable.",
  cost: { use: { key: "unstoppable", until: "longRest" } },
  automation: "auto",
  target: "self",
  use: ({ sheet }) => {
    const max = unstoppableMax(sheet.level);
    return {
      sheet: {
        ...sheet,
        conditions: sheet.conditions.filter((c) => c !== "restrained" && c !== "vulnerable"),
        classState: { ...sheet.classState, unstoppable: { value: 1, max } },
      },
      summary: `became Unstoppable (d${max} at 1)`,
    };
  },
};

const unstoppableHit: FeatureMeta = {
  key: "unstoppableHit",
  name: "Unstoppable: dealt Hit Points",
  text: "After a damage roll that deals 1 or more Hit Points: raise the Unstoppable Die by 1; past its maximum you drop out of Unstoppable.",
  automation: "auto",
  target: "self",
  use: ({ sheet }) => {
    const die = sheet.classState.unstoppable;
    if (die === undefined) refuse("You are not Unstoppable.");
    if (die.value + 1 > die.max) return { sheet: withoutDie(sheet), summary: "dropped out of Unstoppable: the die passed its maximum" };
    return { sheet: { ...sheet, classState: { ...sheet.classState, unstoppable: { ...die, value: die.value + 1 } } }, summary: `raised the Unstoppable Die to ${die.value + 1}` };
  },
};

const endUnstoppable: FeatureMeta = {
  key: "endUnstoppable",
  name: "End Unstoppable",
  text: "The scene ends: remove the Unstoppable Die.",
  automation: "auto",
  target: "self",
  use: ({ sheet }) => {
    if (sheet.classState.unstoppable === undefined) refuse("You are not Unstoppable.");
    return { sheet: withoutDie(sheet), summary: "dropped out of Unstoppable" };
  },
};

export const guardian: ClassFeatures = {
  classId: "guardian",
  hopeFeature: {
    key: "frontlineTank",
    name: "Frontline Tank",
    text: "Clear 2 Armor Slots.",
    cost: HOPE_COST,
    automation: "auto",
    target: "self",
    use: ({ sheet }) => {
      if (sheet.armorMarked === 0) refuse("No Armor Slots are marked.");
      return { sheet: { ...sheet, armorMarked: Math.max(0, sheet.armorMarked - 2) }, summary: "used Frontline Tank: cleared 2 Armor Slots" };
    },
  },
  classActions: [unstoppable, unstoppableHit, endUnstoppable],
  rollOptions: (sheet, kind) => {
    const die = sheet.classState.unstoppable;
    return kind === "damage" && die !== undefined ? [{ key: "unstoppable", label: `Unstoppable +${die.value}`, effect: { kind: "modifier" as const, value: die.value }, auto: true }] : [];
  },
  // The scene ends with the session at the latest.
  onSessionEnd: (sheet) => (sheet.classState.unstoppable === undefined ? sheet : withoutDie(sheet)),
};
