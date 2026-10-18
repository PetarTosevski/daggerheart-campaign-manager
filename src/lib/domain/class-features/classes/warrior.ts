// Warrior (CB 48). Hope feature: No Mercy, +1 to attack rolls until your next rest.
import type { ClassFeatures } from "../types";
import { HOPE_COST, withEffect } from "./shared";

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
};
