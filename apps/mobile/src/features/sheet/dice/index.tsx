import { View } from "react-native";

import type { Id } from "../../../convex";
import type { SheetSlotProps } from "../contract";
import { Section } from "../chrome";
import { DiceBox } from "./dice-box";

/** Sheet dice: server rolls only, with Tag Team, Slayer, and pending choices. */
export function DiceSlot({ campaignId, hopeAndFear, character, canEdit }: SheetSlotProps) {
  return (
    <View accessibilityLabel={`Dice slot for ${character.sheet.name}`}>
      {canEdit ? (
        <Section title="Dice">
          <DiceBox campaignId={campaignId as Id<"campaigns">} character={character} hopeAndFear={hopeAndFear} />
        </Section>
      ) : null}
    </View>
  );
}
