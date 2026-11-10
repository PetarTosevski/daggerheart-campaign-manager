import { useConvexAuth } from "@convex-dev/auth/react";
import { Redirect, Slot } from "expo-router";
import { StyleSheet, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { AppAuthProvider } from "../src/auth/provider";
import { useSessionRedirect } from "../src/shell/session-gate";
import { useSplashUntil } from "../src/shell/splash-gate";
import { useBrandFonts } from "../src/theme/fonts";
import { colors } from "../src/theme/colors";

export { RouteErrorBoundary as ErrorBoundary } from "../src/shell/route-error";

export default function RootLayout() {
  const [fontsLoaded, fontError] = useBrandFonts();
  const ready = fontsLoaded || fontError !== null;
  useSplashUntil(ready);
  // The native splash stays up until the fonts are in (src/shell/splash-gate.ts), so nothing paints in the wrong face.
  if (!ready) return null;
  return (
    <GestureHandlerRootView style={styles.root}>
      <AppAuthProvider>
        <SessionGate />
      </AppAuthProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Slot stays mounted so the navigator exists before a redirect; `useSessionRedirect` decides where a visitor may be
 * (signed out: only sign-in and `/auth`). `app/campaign/_layout.tsx` also refuses to render a campaign signed out.
 */
function SessionGate() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const href = useSessionRedirect({ isAuthenticated, isLoading });
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
