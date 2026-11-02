import { View } from "react-native";

/**
 * GM palette, terrain paint, token panel and map uploads ship in C5-world-edit.
 * The view tracer mounts this stub so later work has a stable import site.
 */
export function WorldEditSlot({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="world-edit-slot" />;
}

/** Place-on-map palette (C5). Not used in the view tracer. */
export function WorldPaletteStub() {
  return <View testID="world-palette" />;
}
