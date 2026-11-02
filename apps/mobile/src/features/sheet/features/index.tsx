import { Text, View } from "react-native";

import type { SheetSlotProps } from "../contract";

/** Stub. The features tracer replaces this folder. */
export function FeaturesSlot({ character }: SheetSlotProps) {
  return (
    <View accessibilityLabel={`Features slot for ${character.sheet.name}`}>
      <Text>Features</Text>
    </View>
  );
}
