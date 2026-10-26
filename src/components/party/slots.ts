// Mount points for the D5 features (T0). Each feature tracer owns one folder
// under src/components/party/<feature>/ and fills the slot components exported
// from its index.tsx; the pages that mount them (sheet.tsx, page-one.tsx, the
// dashboard, the party card, the roster) never change again for D5.
//
// Contract:
// - A character slot gets `SlotProps`; a campaign-wide slot (dashboard, roster
//   header) gets `CampaignSlotProps`. Read everything else with your own
//   `useQuery`, and wrap that subtree in an error boundary (CL1).
// - A slot renders nothing (`null`) when it has nothing to show, so it costs no
//   layout. Keep the exported name and props; add files inside your folder freely.
// - Hide or disable controls the viewer can't use: `canEdit` (owner or GM),
//   `isGm`; the server still checks every call.
//
// ```tsx
// // src/components/party/dice/index.tsx (T1)
// export const SheetDiceBox: CharacterSlot = ({ character, canEdit }) =>
//   canEdit ? <DiceBox characterId={character._id} /> : null;
// // a mount (already done by T0):  <SheetDiceBox {...slot} />
// ```

import type { ReactNode } from "react";

import type { Id } from "../../../convex/_generated/dataModel";
import type { CharacterView, PartyMember } from "../../../convex/characters";

/** What every campaign-wide slot knows. */
export type CampaignSlotProps = {
  campaignId: Id<"campaigns">;
  /** The viewer is the campaign's GM. */
  isGm: boolean;
  /** The campaign uses Hope & Fear content (`options.hopeAndFear`). */
  hopeAndFear: boolean;
};

/** What every character slot knows: the campaign's, plus the character as `characters.get` / `listByCampaign` return it. */
export type SlotProps = CampaignSlotProps & {
  character: CharacterView;
  /** The viewer is the character's owner or the GM. */
  canEdit: boolean;
};

export type CharacterSlot = (props: SlotProps) => ReactNode;
export type CampaignSlot = (props: CampaignSlotProps) => ReactNode;

/**
 * What a party card knows of a character: a `characters.partySummary` row (PF9: name, class line, portrait, tiles,
 * status and the badges' fields). A full `CharacterView` is one too, so card slots also mount on the roster and sheet.
 */
export type CardCharacter = PartyMember;

/** What a party-card slot knows: `SlotProps` with the card's slice of the character. */
export type CardSlotProps = CampaignSlotProps & {
  character: CardCharacter;
  /** The viewer is the character's owner or the GM. */
  canEdit: boolean;
};

export type CardSlot = (props: CardSlotProps) => ReactNode;
