/**
 * The rest moves a campaign's frame adds or forbids for a character (CB 104-105). Split out of `./restHooks` (which
 * re-exports it, dcm-uh6r) so the rest reads load without the rest hooks.
 */
import { classFeaturesAvailable } from "../../src/lib/domain/class-features/index";
import { feastForbiddenMoves } from "../../src/lib/domain/frames/beast-feast";
import { frameRestMoves } from "../../src/lib/domain/rest/frame-hooks/index";
import type { RestMove } from "../../src/lib/domain/rest/index";
import { canRaiseLoadout } from "../../src/lib/domain/transformations/index";
import { resolveOptions } from "../../src/lib/frames/options";
import type { CharacterSheet } from "../../src/lib/validation/characters";
import type { Doc } from "../_generated/dataModel";
import { ruleMode } from "./ruleModes";

/**
 * One PC's frame and class downtime moves (on either rest) and the core moves
 * the frame forbids (`frameRestMoves`): Make a Feast and the Beast Feast
 * restriction (CB 278), Keep Watch (CB 289), halting lycanthropy (HF 153,
 * transformations on), Raise loadout for a Reanimated PC below five (HF 153, transformations on), Tribute for a Warlock while its features are offered
 * (HF 14), and Martial Preparation for everyone while `party.martialPreparation`
 * (a resting PC holds the Call of the Slayer mastery card, CB 48; the caller
 * reads the party). `rests.choose` checks picks against it and `restsReads.current`
 * lists it. W4 Manual (house rule): Beast Feast forbids nothing, so every
 * core move is offered next to Make a Feast.
 */
export function restMovesFor(
  campaign: Doc<"campaigns">,
  sheet: Pick<CharacterSheet, "classId" | "multiclass" | "transformationId" | "loadoutMax">,
  party: { martialPreparation: boolean } = { martialPreparation: false },
): { extra: RestMove[]; forbidden: readonly RestMove[] } {
  const options = resolveOptions(campaign.frameId, campaign.options);
  const warlock = [sheet.classId, sheet.multiclass?.classId].includes("warlock") && classFeaturesAvailable("warlock", options.hopeAndFear);
  const moves = frameRestMoves({
    frameId: campaign.frameId,
    transformations: options.transformations,
    warlock,
    martialPreparation: party.martialPreparation,
    raiseLoadout: canRaiseLoadout(sheet),
  });
  return { extra: moves.extra, forbidden: feastForbiddenMoves(moves.forbidden, ruleMode(campaign, "beastFeastFeast")) };
}
