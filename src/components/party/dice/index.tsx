import type { CampaignSlot, CharacterSlot } from "../slots";
import { DiceBoundary } from "./boundary";
import { DiceBox } from "./dice-box";
import { RollFeedPanel } from "./roll-feed";

// D5 dice (T1). Contract: ../slots.ts.

/** The dice box on the character sheet (page one), for the owner and the GM. */
export const SheetDiceBox: CharacterSlot = ({ campaignId, character, canEdit }) =>
  canEdit && !character.corrupt ? (
    <DiceBoundary label="The dice box">
      <DiceBox campaignId={campaignId} character={character} />
    </DiceBoundary>
  ) : null;

/** The roll feed on the dashboard. */
export const RollFeed: CampaignSlot = ({ campaignId, isGm }) => (
  <DiceBoundary label="The roll feed">
    <RollFeedPanel campaignId={campaignId} isGm={isGm} />
  </DiceBoundary>
);
