// Guardian (CB 36). Hope feature: Frontline Tank clears 2 Armor Slots.
import type { ClassFeatures } from "../types";
import { HOPE_COST, refuse } from "./shared";

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
};
