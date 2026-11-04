/**
 * The features a sheet holds in a campaign and the Flying effect id. Split out of `./featureRunner` (dcm-uh6r) so the
 * feature drawer (the HUD sheet) does not load the feature runner, the card runner and the vision engine;
 * `./featureRunner` re-exports both.
 */
import { owned, type OwnedFeature } from "../../src/lib/domain/feature-effects/owned";
import { resolveOptions } from "../../src/lib/frames/options";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc } from "../_generated/dataModel";

/** The sheet effect the Flying toggle writes (Q16): "a sheet effect until turned off". */
export const FLYING_EFFECT_ID = "flying";

/** The features the sheet holds in this campaign (the Hope & Fear option decides H&F content). */
export function ownedHere(sheet: CharacterSheet, campaign: Pick<Doc<"campaigns">, "frameId" | "options">): OwnedFeature[] {
  return owned(sheet, { hopeAndFear: resolveOptions(campaign.frameId, campaign.options).hopeAndFear });
}
