// Wizard (CB 50). Hope feature: Not This Time (assist).
import type { ClassFeatures } from "../types";
import { assistFeature } from "./shared";

export const wizard: ClassFeatures = {
  classId: "wizard",
  hopeFeature: assistFeature("notThisTime", "Not This Time", "Force an adversary within Far range to reroll an attack or damage roll."),
};
