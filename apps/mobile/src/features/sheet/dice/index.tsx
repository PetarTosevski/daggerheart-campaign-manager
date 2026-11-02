import { Text, View } from "react-native";

import type { SheetSlotProps } from "../contract";

/** Stub. The dice tracer replaces this folder. */
export function DiceSlot({ character }: SheetSlotProps) {
  return (
    <View accessibilityLabel={`Dice slot for ${character.sheet.name}`}>
      <Text>Dice</Text>
    </View>
  );
}
