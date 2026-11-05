import { StyleSheet, Text, View } from "react-native";

import { colors } from "../theme/colors";
import { type } from "../theme/fonts";
import { space } from "../theme/spacing";

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <View
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      accessible
      style={styles.row}
    >
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: space[4],
  },
  label: {
    color: colors.mutedText,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    fontWeight: type.sans.fontWeight,
  },
});
