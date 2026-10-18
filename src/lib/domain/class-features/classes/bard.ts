// Bard (CB 28). Hope feature: Make a Scene (assist).
import type { ClassFeatures } from "../types";
import { assistFeature } from "./shared";

export const bard: ClassFeatures = {
  classId: "bard",
  hopeFeature: assistFeature("makeAScene", "Make a Scene", "Distract a target within Close range: −2 to their Difficulty for now."),
};
