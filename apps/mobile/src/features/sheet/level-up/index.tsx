import { Text, View } from "react-native";

import type { SheetSlotProps } from "../contract";

/** Stub. The level-up tracer replaces this folder. */
export function LevelUpSlot({ character }: SheetSlotProps) {
  return (
    <View accessibilityLabel={`Level-up slot for ${character.sheet.name}`}>
      <Text>Level up</Text>
    </View>
  );
}
