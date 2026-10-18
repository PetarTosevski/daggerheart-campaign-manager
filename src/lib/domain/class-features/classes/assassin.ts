// Assassin (HF 8). Hope feature: Deadly Determination clears 2 Stress.
import { applyResourceDelta } from "../../characters/index";
import type { ClassFeatures } from "../types";
import { HOPE_COST, refuse } from "./shared";

export const assassin: ClassFeatures = {
  classId: "assassin",
  hopeFeature: {
    key: "deadlyDetermination",
    name: "Deadly Determination",
    text: "Clear 2 Stress.",
    cost: HOPE_COST,
    automation: "auto",
    target: "self",
    use: ({ sheet }) => {
      if (sheet.stress === 0) refuse("No Stress is marked.");
      return { sheet: applyResourceDelta(sheet, "stress", -2), summary: "used Deadly Determination: cleared 2 Stress" };
    },
  },
};
