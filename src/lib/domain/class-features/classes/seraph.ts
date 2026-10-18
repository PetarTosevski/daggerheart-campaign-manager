// Seraph (CB 44). Hope feature: Life Support clears a Hit Point on an ally (decision 7: written only through the feature).
import { applyResourceDelta } from "../../characters/index";
import type { ClassFeatures } from "../types";
import { HOPE_COST, refuse } from "./shared";

export const seraph: ClassFeatures = {
  classId: "seraph",
  hopeFeature: {
    key: "lifeSupport",
    name: "Life Support",
    text: "Clear a Hit Point on an ally within Close range.",
    cost: HOPE_COST,
    automation: "auto",
    target: "ally",
    use: ({ sheet, others }) => {
      const ally = others[0];
      if (ally === undefined) refuse("Choose an ally.");
      if (ally.sheet.hp === 0) refuse(`${ally.sheet.name} has no marked Hit Points.`);
      return {
        sheet,
        others: [{ characterId: ally.characterId, sheet: applyResourceDelta(ally.sheet, "hp", -1) }],
        summary: `used Life Support: ${ally.sheet.name} clears a Hit Point`,
      };
    },
  },
};
