import type { CharacterSlot } from "../slots";
import { FeatureBoundary } from "./boundary";
import { FeaturesBox, HopeFeatureBlock } from "./panel";

// D5 Hope and class features (T8a), in the board's Hope and Class Features boxes (sheet redesign S6). Contract: ../slots.ts.

/** The class Hope feature block inside the sheet's Hope box: pickers, the "✦ Use … · 3 Hope" pill, its status and the active effects. */
export const HopeFeatureSlot: CharacterSlot = (props) => (
  <FeatureBoundary>
    <HopeFeatureBlock {...props} />
  </FeatureBoundary>
);

/** The class feature rows inside the sheet's Class Features box: class actions, conditions, held dice and class counters. */
export const FeaturesPanel: CharacterSlot = (props) => (
  <FeatureBoundary>
    <FeaturesBox {...props} />
  </FeatureBoundary>
);
