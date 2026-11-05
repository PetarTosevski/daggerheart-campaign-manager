import { View } from "react-native";

import type { SheetSlotProps } from "../contract";
import type { Id } from "../../../convex";

import { HitBoundary } from "./boundary";
import { PendingHits } from "./pending";

/**
 * Incoming-hit prompt on the character sheet (AA4): `adversaryActions.pending` and
 * `adversaryActions.respond` for a viewer who can edit this character.
 */
export function IncomingSlot({ campaignId, character, canEdit }: SheetSlotProps) {
  const show = canEdit && character.corrupt !== true;
  return (
    <View accessibilityLabel={`Incoming hit slot for ${character.sheet.name}`}>
      {show ? (
        <HitBoundary>
          <PendingHits
            campaignId={campaignId as Id<"campaigns">}
            characterId={character._id}
            characterName={character.sheet.name}
          />
        </HitBoundary>
      ) : null}
    </View>
  );
}
