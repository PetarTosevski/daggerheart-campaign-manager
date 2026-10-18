// Warrior (CB 48). Hope feature: No Mercy, +1 to attack rolls until your next rest.
// Class features: Combat Training adds the Warrior's level to damage rolls (an auto dice-box option): "When you
// deal physical damage" (CB 48), so it is `physicalOnly` and `convex/rolls.ts` drops it for a magic damage
// source (a magic weapon, a magic override), and Attack of Opportunity is an
// assisted reaction roll: the reminder, then the player rolls a reaction roll in the dice box.
// Motherboard Warriors don't get Combat Training: "replaced with ... Ikonis Training" (CB 295).
import type { ClassFeatures, FeatureMeta } from "../types";
import { HOPE_COST, withEffect } from "./shared";

const attackOfOpportunity: FeatureMeta = {
  key: "attackOfOpportunity",
  name: "Attack of Opportunity",
  text: "An adversary in Melee range tries to leave it: make a reaction roll with a trait of your choice against their Difficulty. On a success choose one, on a critical two: they can't move; deal your primary weapon's damage; you move with them.",
  automation: "assist",
  target: "none",
  use: ({ sheet }) => ({ sheet, summary: "makes an Attack of Opportunity: reaction roll next" }),
};

export const warrior: ClassFeatures = {
  classId: "warrior",
  hopeFeature: {
    key: "noMercy",
    name: "No Mercy",
    text: "+1 to attack rolls until your next rest.",
    cost: HOPE_COST,
    automation: "auto",
    target: "self",
    use: ({ sheet }) => ({
      sheet: withEffect(sheet, { id: "no-mercy", source: "No Mercy", text: "+1 to attack rolls until your next rest.", until: "rest", mods: { attack: 1 } }),
      summary: "used No Mercy: +1 to attack rolls",
    }),
  },
  classActions: [attackOfOpportunity],
  // In Motherboard, Ikonis Training replaces Combat Training (CB 295).
  rollOptions: (sheet, kind, scope) =>
    kind === "damage" && !scope.ikonis ? [{ key: "combatTraining", label: `Combat Training +${sheet.level}`, effect: { kind: "modifier", value: sheet.level }, auto: true, physicalOnly: true }] : [],
};
