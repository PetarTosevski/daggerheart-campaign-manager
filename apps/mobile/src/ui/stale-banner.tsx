import { StyleSheet, Text, View } from "react-native";

import { colors } from "../theme/colors";
import { type } from "../theme/fonts";
import { radius, space } from "../theme/spacing";

export function StaleBanner({
  message = "Showing the last update.",
}: {
  message?: string;
}) {
  return (
    <View style={styles.banner}>
      <Text accessibilityLiveRegion="polite" style={styles.message}>
        {message}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: colors.raised,
    borderColor: colors.line2,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
  },
  message: {
    color: colors.parchment,
    fontFamily: type.sansMedium.fontFamily,
    fontSize: 14,
    fontWeight: type.sansMedium.fontWeight,
  },
});
