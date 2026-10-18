import type { CharacterSlot } from "../slots";
import { FeatureBoundary } from "./boundary";
import { FeaturesBox } from "./panel";

// D5 Hope and class features (T8a). Contract: ../slots.ts.

/** The class Hope feature block inside the sheet's Hope box. Mount point; S6 fills it (until then the Hope feature is in FeaturesPanel). */
export const HopeFeatureSlot: CharacterSlot = () => null;

/** The features panel inside the sheet's Class Features box: Hope feature, class actions, effects, conditions, held dice. */
export const FeaturesPanel: CharacterSlot = (props) => (
  <FeatureBoundary>
    <FeaturesBox {...props} />
  </FeatureBoundary>
);
