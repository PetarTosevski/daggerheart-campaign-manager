// Ranger (CB 38). Hope feature: Hold Them Off (assist).
import type { ClassFeatures } from "../types";
import { assistFeature } from "./shared";

export const ranger: ClassFeatures = {
  classId: "ranger",
  hopeFeature: assistFeature("holdThemOff", "Hold Them Off", "After a successful weapon attack, use the same roll against two more adversaries within range."),
};
