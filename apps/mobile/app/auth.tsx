import { StyleSheet, Text, View } from "react-native";

const styles = StyleSheet.create({
  screen: { alignItems: "center", flex: 1, justifyContent: "center", padding: 24 },
  text: { fontSize: 16 },
});

/**
 * Google returns here (`dualityheart://auth` or `dualityheart-dev://auth`).
 * `openAuthSessionAsync` hands that URL back to the sign-in button, which exchanges the code.
 */
export default function AuthCallbackScreen() {
  return (
    <View style={styles.screen}>
      <Text style={styles.text}>Signing in…</Text>
    </View>
  );
}
