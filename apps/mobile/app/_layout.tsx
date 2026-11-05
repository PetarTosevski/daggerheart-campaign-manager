import { useConvexAuth } from "@convex-dev/auth/react";
import { Redirect, Slot, useSegments } from "expo-router";
import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AppAuthProvider } from "../src/auth/provider";
import { useBrandFonts } from "../src/theme/fonts";
import { colors } from "../src/theme/colors";

export { RouteErrorBoundary as ErrorBoundary } from "../src/shell/route-error";

export default function RootLayout() {
  useBrandFonts();
  return (
    <GestureHandlerRootView style={styles.root}>
      <AppAuthProvider>
        <SessionGate />
      </AppAuthProvider>
    </GestureHandlerRootView>
  );
}

function routeName(segments: readonly string[]): string {
  const parts = segments.filter((segment) => segment.length > 0 && !segment.startsWith("("));
  const leaf = parts[parts.length - 1];
  if (!leaf || leaf === "index") return "index";
  return leaf;
}

function signedOutAllowed(segments: readonly string[]): boolean {
  const root = segments[0];
  return root === "sign-in" || root === "(auth)" || root === "auth";
}

function SessionGate() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const segments = useSegments();
  const route = routeName(segments);
  const href = isLoading
    ? null
    : !isAuthenticated && !signedOutAllowed(segments)
      ? "/sign-in"
      : isAuthenticated && route === "sign-in"
        ? "/home"
        : isAuthenticated && route === "index"
          ? "/home"
          : null;
  return (
    <>
      <View style={styles.slot}>
        <Slot />
      </View>
      {href ? <Redirect href={href} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  slot: { backgroundColor: colors.ink, flex: 1 },
});
