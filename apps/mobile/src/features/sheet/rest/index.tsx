import type { FunctionReturnType } from "convex/server";
import { View } from "react-native";

import { api, type Id } from "../../../convex";
import type { SheetSlotProps } from "../contract";
import { RestPicker } from "./picker";

export type RestSheetState = FunctionReturnType<typeof api.restsReads.current>;

/**
 * Downtime move picker while a party rest is open (CB 105). The sheet body
 * already subscribes to `rests.current` for the downtime reference; pass that
 * value as `restState` so this slot does not subscribe twice.
 */
export function RestSlot({
  restState,
  ...slot
}: SheetSlotProps & {
  restState?: RestSheetState | undefined;
}) {
  const open = restState?.open ?? null;
  return (
    <View accessibilityLabel={`Rest slot for ${slot.character.sheet.name}`}>
      {open ? (
        <RestPicker
          campaignId={slot.campaignId as Id<"campaigns">}
          canEdit={slot.canEdit}
          character={slot.character}
          open={open}
        />
      ) : null}
    </View>
  );
}
