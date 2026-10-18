import type { CharacterSlot } from "../slots";
import { FeatureBoundary } from "./boundary";
import { FeaturesBox } from "./panel";

// D5 Hope and class features (T8a). Contract: ../slots.ts.

/** The features panel on the sheet (page one): Hope feature, class actions, effects, conditions, held dice. */
export const FeaturesPanel: CharacterSlot = (props) => (
  <FeatureBoundary>
    <FeaturesBox {...props} />
  </FeatureBoundary>
);
