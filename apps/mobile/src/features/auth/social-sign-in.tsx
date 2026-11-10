import { useAuthActions } from "@convex-dev/auth/react";
import * as AppleAuthentication from "expo-apple-authentication";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { isAppleCancel, signInWithApple } from "../../auth/apple";
import { signInWithGoogle } from "../../auth/google";
import { socialSignInEnabled } from "../../auth/social-flag";
import { authErrorText } from "./auth-error";

const styles = StyleSheet.create({
  group: { gap: 12 },
  button: { alignItems: "center", justifyContent: "center", minHeight: 44 },
  apple: { height: 44, width: "100%" },
  error: { fontSize: 14 },
});

/** Google on either platform, and the native Apple button on iOS, only when the social flag is on. */
export function SocialSignIn() {
  const { signIn } = useAuthActions();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enabled = socialSignInEnabled();
  const showApple = enabled && Platform.OS === "ios";
  const showGoogle = enabled;
  if (!showApple && !showGoogle) return null;

  function run(call: () => Promise<void>, fallback: string, quiet?: (caught: unknown) => boolean) {
    if (pending) return;
    setPending(true);
    setError(null);
    call()
      .catch((caught: unknown) => {
        if (quiet?.(caught)) return;
        setError(authErrorText(caught, fallback));
      })
      .finally(() => setPending(false));
  }

  return (
    <View style={styles.group}>
      {showApple ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          cornerRadius={8}
          onPress={() => run(() => signInWithApple(signIn), "Couldn't sign in with Apple. Try again.", isAppleCancel)}
          style={styles.apple}
        />
      ) : null}
      {showGoogle ? (
        <Pressable
          accessibilityRole="button"
          disabled={pending}
          onPress={() => run(() => signInWithGoogle(signIn), "Couldn't sign in with Google. Try again.")}
          style={styles.button}
        >
          <Text>{pending ? "Please wait…" : "Sign in with Google"}</Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
