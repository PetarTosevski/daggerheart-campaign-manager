import { StyleSheet, Text, View } from "react-native";

import { colors } from "../theme/colors";
import { type } from "../theme/fonts";
import { radius, space } from "../theme/spacing";
import { Button } from "./button";

export function ErrorState({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.block}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <View style={styles.panel}>
        <Text accessibilityRole="alert" style={styles.message}>
          {message}
        </Text>
      </View>
      {onRetry ? (
        <Button onPress={onRetry} variant="solid">
          Try again
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: space[4],
    paddingVertical: space[6],
  },
  title: {
    color: colors.parchment,
    fontFamily: type.displayBold.fontFamily,
    fontSize: 28,
    fontWeight: type.displayBold.fontWeight,
  },
  panel: {
    backgroundColor: colors.dangerBg,
    borderColor: colors.dangerLine,
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space[4],
  },
  message: {
    color: colors.danger,
    fontFamily: type.sans.fontFamily,
    fontSize: 16,
    fontWeight: type.sans.fontWeight,
  },
});
