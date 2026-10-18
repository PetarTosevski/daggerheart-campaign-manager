// Brawler (HF 10). Hope feature: Square Up (assist).
import type { ClassFeatures } from "../types";
import { assistFeature } from "./shared";

export const brawler: ClassFeatures = {
  classId: "brawler",
  hopeFeature: assistFeature("squareUp", "Square Up", "Intimidate a target within Close range: they are temporarily Vulnerable."),
};
