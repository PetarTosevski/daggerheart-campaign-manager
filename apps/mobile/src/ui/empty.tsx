import { StyleSheet, Text, View } from "react-native";

import { colors } from "../theme/colors";
import { type } from "../theme/fonts";
import { space } from "../theme/spacing";

export function Empty({ title, message }: { title: string; message?: string }) {
  return (
    <View style={styles.block}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: space[2],
    paddingVertical: space[6],
  },
  title: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 28,
    fontWeight: type.displayBold.fontWeight,
  },
  message: {
    color: colors.body,
    fontFamily: type.serif.fontFamily,
    fontSize: 18,
    fontStyle: type.serif.fontStyle,
    fontWeight: type.serif.fontWeight,
  },
});
