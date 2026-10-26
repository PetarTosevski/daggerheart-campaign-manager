import type { FeatureScope } from "../../src/lib/domain/class-features/types";
import { FRAME_OF } from "../../src/lib/frames/extras/common";
import { resolveOptions } from "../../src/lib/frames/options";
import type { Doc } from "../_generated/dataModel";

/**
 * What the campaign lets class and session features offer: Hope & Fear classes and features (Lunar Phases, K4)
 * only with the Hope & Fear option on, the Ikonis (and no Combat Training) only in Motherboard. The one copy of
 * this rule (dcm-bxp.68): rolls, sessions, session features and characters use it.
 */
export function featureScope(campaign: Doc<"campaigns">): FeatureScope {
  return { hopeAndFear: resolveOptions(campaign.frameId, campaign.options).hopeAndFear, ikonis: campaign.frameId === FRAME_OF.motherboard };
}
