import { StyleSheet, Text, View } from "react-native";

import { colors } from "../src/theme/colors";

export { RouteErrorBoundary as ErrorBoundary } from "../src/shell/route-error";

export default function SignedOutScreen() {
  return (
    <View style={styles.screen}>
      <Text accessibilityRole="header" style={styles.title}>
        Signed out
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.ink, flex: 1, padding: 24 },
  title: { color: colors.parchment, fontSize: 22 },
});
