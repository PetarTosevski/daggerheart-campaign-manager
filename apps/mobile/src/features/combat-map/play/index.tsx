import { View } from "react-native";

/** Token moves, cards and reactions ship in C5-combat-play. */
export function CombatPlaySlot(_props: import("../contract").CombatSlotProps) {
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" testID="combat-play-slot" />;
}
