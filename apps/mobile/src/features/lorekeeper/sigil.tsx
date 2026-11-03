import { Text, View } from "react-native";

import { colors } from "../../theme/colors";
import { type } from "../../theme/fonts";
import { radius, space } from "../../theme/spacing";

export function Sigil() {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        alignItems: "center",
        backgroundColor: colors.brand,
        borderRadius: radius.pill,
        height: 44,
        justifyContent: "center",
        width: 44,
      }}
    >
      <Text style={{ color: colors.brandInk, fontFamily: type.displayBold.fontFamily, fontSize: 20 }}>✦</Text>
    </View>
  );
}

export function MiniSigil() {
  return (
    <View
      accessibilityElementsHidden
      style={{
        alignItems: "center",
        backgroundColor: colors.brand,
        borderRadius: radius.pill,
        height: 28,
        justifyContent: "center",
        marginTop: space[1],
        width: 28,
      }}
    >
      <Text style={{ color: colors.brandInk, fontSize: 14 }}>✦</Text>
    </View>
  );
}
