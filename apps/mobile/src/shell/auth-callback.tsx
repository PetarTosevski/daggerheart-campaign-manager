import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

import { colors } from "../theme/colors";
import { space } from "../theme/spacing";
import { Button } from "../ui/button";
import { ErrorState } from "../ui/error-state";
import { Loading } from "../ui/loading";
import { SIGN_IN_HREF } from "./session-gate";

/** How long `/auth` waits for the sign-in button to finish exchanging Google's code before giving up. */
export const AUTH_CALLBACK_TIMEOUT_MS = 20_000;

/**
 * The `/auth` screen. Signed in, the root layout sends the visitor home; until then it says "Signing in…", and if the
 * exchange never finishes (the browser session was closed, the app was restarted, the code was refused) it stops
 * after `AUTH_CALLBACK_TIMEOUT_MS` with a readable error and a way back to sign-in.
 */
export function AuthCallback({ timeoutMs = AUTH_CALLBACK_TIMEOUT_MS }: { timeoutMs?: number }) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), timeoutMs);
    return () => clearTimeout(timer);
  }, [timeoutMs]);

  if (timedOut) {
    return (
      <View style={styles.screen}>
        <ErrorState message="Sign-in didn’t finish. Go back and try again." title="Sign-in stopped" />
        <Button onPress={() => router.replace(SIGN_IN_HREF)} variant="outline">
          Back to sign-in
        </Button>
      </View>
    );
  }
  return (
    <View style={[styles.screen, styles.center]}>
      <Loading label="Signing in…" />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.ink, flex: 1, gap: space[4], padding: space[6] },
  center: { alignItems: "center", justifyContent: "center" },
});
