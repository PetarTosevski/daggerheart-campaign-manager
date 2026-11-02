import { Text, View } from "react-native";

import type { SheetSlotProps } from "../contract";

/** Stub. The rest tracer replaces this folder. */
export function RestSlot({ character }: SheetSlotProps) {
  return (
    <View accessibilityLabel={`Rest slot for ${character.sheet.name}`}>
      <Text>Rest</Text>
    </View>
  );
}
