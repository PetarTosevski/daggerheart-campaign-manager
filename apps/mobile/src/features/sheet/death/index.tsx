import { Text, View } from "react-native";

import type { SheetSlotProps } from "../contract";

/** Stub. The death tracer replaces this folder. */
export function DeathSlot({ character }: SheetSlotProps) {
  return (
    <View accessibilityLabel={`Death slot for ${character.sheet.name}`}>
      <Text>Death</Text>
    </View>
  );
}
