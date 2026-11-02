import { Text, View } from "react-native";

import type { SheetSlotProps } from "../contract";

/** Stub. The incoming-hit tracer replaces this folder. */
export function IncomingSlot({ character }: SheetSlotProps) {
  return (
    <View accessibilityLabel={`Incoming hit slot for ${character.sheet.name}`}>
      <Text>Incoming hit</Text>
    </View>
  );
}
