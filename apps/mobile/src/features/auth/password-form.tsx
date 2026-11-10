import { useAuthActions } from "@convex-dev/auth/react";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors } from "../../theme/colors";
import { type as fonts } from "../../theme/fonts";

import { authErrorText } from "./auth-error";
import { SocialSignIn } from "./social-sign-in";

/** Seconds before "Resend code" works again. The server also allows 5 sends per hour per email. */
export const RESEND_COOLDOWN_SECONDS = 30;

type Step = "signIn" | "signUp" | "code" | "resetEmail" | "resetCode";
type Origin = { name: string; password: string; flow: "signIn" | "signUp" };

const WRONG_LOGIN = "Wrong email or password.";

const LABELS: Record<Step, { title: string; submit: string }> = {
  signIn: { title: "Sign in with email", submit: "Sign in" },
  signUp: { title: "Create an account", submit: "Create account" },
  code: { title: "Enter the code", submit: "Verify email" },
  resetEmail: { title: "Reset password", submit: "Send code" },
  resetCode: { title: "Choose a new password", submit: "Set password" },
};

const styles = StyleSheet.create({
  safe: { backgroundColor: colors.ink, flex: 1 },
  avoid: { flex: 1 },
  // Centred on a tall phone, scrolls on a short one or with the keyboard up; one readable column on a tablet.
  scroll: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 24, paddingVertical: 32 },
  column: { alignSelf: "center", gap: 14, maxWidth: 420, width: "100%" },
  brand: { ...fonts.displayBold, color: colors.brand, fontSize: 15, letterSpacing: 2, textAlign: "center" },
  title: { ...fonts.displayMedium, color: colors.parchment, fontSize: 24, marginBottom: 4, textAlign: "center" },
  label: { gap: 6 },
  field: { ...fonts.sansMedium, color: colors.label, fontSize: 14 },
  input: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderRadius: 8,
    borderWidth: 1,
    color: colors.parchment,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  hint: { color: colors.subtle, fontSize: 13 },
  primary: {
    alignItems: "center",
    backgroundColor: colors.brand,
    borderRadius: 8,
    justifyContent: "center",
    marginTop: 4,
    minHeight: 48,
  },
  primaryPending: { opacity: 0.6 },
  primaryText: { ...fonts.sansSemibold, color: colors.brandInk, fontSize: 16 },
  button: { alignItems: "center", justifyContent: "center", minHeight: 44 },
  buttonText: { ...fonts.sans, color: colors.brand, fontSize: 16 },
  error: { color: colors.danger, fontSize: 14 },
  notice: { color: colors.ok, fontSize: 14 },
  help: { color: colors.body, fontSize: 14 },
});

/**
 * Email + password sign-in, account creation with an emailed code, and password reset by code. `joinCode` is the code
 * of the join link that sent a signed-out visitor here: sign-up sends it, so invite-only mode lets the account in.
 */
export function PasswordForm({ joinCode = null }: { joinCode?: string | null } = {}) {
  const { signIn } = useAuthActions();
  /** The extra sign-up params: the display name and the join link's code (as the website's `signUpParams`). */
  const signUpParams = (displayName: string) => ({ name: displayName, ...(joinCode ? { joinCode } : {}) });
  const [step, setStep] = useState<Step>("signIn");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [origin, setOrigin] = useState<Origin | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  function go(to: Step) {
    setStep(to);
    setError(null);
    setNotice(null);
  }

  function toCodeStep(to: Step) {
    setCode("");
    setCooldown(RESEND_COOLDOWN_SECONDS);
    go(to);
  }

  function run(call: () => Promise<void>, fallback: string) {
    setPending(true);
    setError(null);
    setNotice(null);
    call()
      .catch((caught: unknown) => setError(authErrorText(caught, fallback)))
      .finally(() => setPending(false));
  }

  function done(result: { signingIn: boolean }) {
    if (!result.signingIn) setError("That didn't work. Check your details and try again.");
  }

  function onSubmit() {
    if (pending) return;
    if (step === "signIn" || step === "signUp") {
      const flow = step;
      const address = email.trim();
      const values: Origin = { name, password, flow };
      setEmail(address);
      run(
        () =>
          signIn("password", {
            flow,
            email: address,
            password: values.password,
            ...(flow === "signUp" ? signUpParams(values.name) : {}),
          }).then((result) => {
            if (result.signingIn) done(result);
            else {
              setOrigin(values);
              toCodeStep("code");
            }
          }),
        flow === "signUp" ? "Couldn't create the account. Try again." : WRONG_LOGIN,
      );
      return;
    }
    if (step === "code") {
      run(
        () => signIn("password", { flow: "email-verification", email, code: code.trim() }).then(done),
        "Couldn't check the code. Try again.",
      );
      return;
    }
    if (step === "resetEmail") {
      const address = email.trim();
      setEmail(address);
      run(
        () => signIn("password", { flow: "reset", email: address }).then(() => toCodeStep("resetCode")),
        "Couldn't send the code. Try again.",
      );
      return;
    }
    run(
      () =>
        signIn("password", {
          flow: "reset-verification",
          email,
          code: code.trim(),
          newPassword,
        }).then(done),
      "Couldn't reset the password. Try again.",
    );
  }

  function resend() {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    run(async () => {
      if (step === "resetCode") {
        await signIn("password", { flow: "reset", email });
      } else if (origin) {
        await signIn("password", {
          flow: origin.flow,
          email,
          password: origin.password,
          ...(origin.flow === "signUp" ? signUpParams(origin.name) : {}),
        });
      }
      setNotice("We sent a new code.");
    }, "Couldn't send a new code. Try again.");
  }

  const codeStep = step === "code" || step === "resetCode";
  const submitLabel = pending ? "Please wait…" : LABELS[step].submit;

  return (
    <SafeAreaView edges={["top", "bottom", "left", "right"]} style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.avoid}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          testID="sign-in-scroll"
        >
          <View style={styles.column}>
            <Text style={styles.brand}>DUALITY HEART</Text>
            <Text accessibilityRole="header" style={styles.title}>{LABELS[step].title}</Text>
            {step === "signUp" ? (
              <View style={styles.label}>
                <Text style={styles.field}>Name</Text>
                <TextInput
                  accessibilityLabel="Name"
                  autoComplete="name"
                  maxLength={80}
                  onChangeText={setName}
                  style={styles.input}
                  textContentType="name"
                  value={name}
                />
              </View>
            ) : null}
            {step === "signIn" || step === "signUp" || step === "resetEmail" ? (
              <View style={styles.label}>
                <Text style={styles.field}>Email</Text>
                <TextInput
                  accessibilityLabel="Email"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  keyboardType="email-address"
                  onChangeText={setEmail}
                  style={styles.input}
                  textContentType="emailAddress"
                  value={email}
                />
              </View>
            ) : null}
            {step === "signIn" || step === "signUp" ? (
              <View style={styles.label}>
                <Text style={styles.field}>Password</Text>
                <TextInput
                  accessibilityLabel="Password"
                  autoCapitalize="none"
                  autoComplete={step === "signUp" ? "new-password" : "password"}
                  onChangeText={setPassword}
                  secureTextEntry
                  style={styles.input}
                  textContentType={step === "signUp" ? "newPassword" : "password"}
                  value={password}
                />
                {step === "signUp" ? <Text style={styles.hint}>At least 8 characters.</Text> : null}
              </View>
            ) : null}
            {codeStep ? (
              <View style={styles.label}>
                <Text style={styles.help}>
                  {step === "code"
                    ? `Enter the 6-digit code we emailed to ${email}.`
                    : `If ${email} has an account, we emailed it a 6-digit code. Enter it with a new password.`}
                </Text>
                <Text style={styles.field}>6-digit code</Text>
                <TextInput
                  accessibilityLabel="6-digit code"
                  autoComplete="sms-otp"
                  keyboardType="number-pad"
                  maxLength={6}
                  onChangeText={setCode}
                  style={styles.input}
                  textContentType="oneTimeCode"
                  value={code}
                />
              </View>
            ) : null}
            {step === "resetCode" ? (
              <View style={styles.label}>
                <Text style={styles.field}>New password</Text>
                <TextInput
                  accessibilityLabel="New password"
                  autoCapitalize="none"
                  autoComplete="new-password"
                  onChangeText={setNewPassword}
                  secureTextEntry
                  style={styles.input}
                  textContentType="newPassword"
                  value={newPassword}
                />
                <Text style={styles.hint}>At least 8 characters.</Text>
              </View>
            ) : null}
            <Pressable
              accessibilityRole="button"
              disabled={pending}
              onPress={onSubmit}
              style={[styles.primary, pending ? styles.primaryPending : null]}
            >
              <Text style={styles.primaryText}>{submitLabel}</Text>
            </Pressable>
            {step === "signIn" ? <SocialSignIn /> : null}
            {error ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {error}
              </Text>
            ) : null}
            {notice ? (
              <Text accessibilityLiveRegion="polite" style={styles.notice}>
                {notice}
              </Text>
            ) : null}
            {codeStep ? (
              <>
                <Pressable
                  accessibilityRole="button"
                  disabled={pending || cooldown > 0}
                  onPress={resend}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>{cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => go(step === "code" ? (origin?.flow === "signIn" ? "signIn" : "signUp") : "resetEmail")}
                  style={styles.button}
                >
                  <Text style={styles.buttonText}>Use a different email</Text>
                </Pressable>
              </>
            ) : null}
            {step === "signIn" ? (
              <Pressable accessibilityRole="button" onPress={() => go("resetEmail")} style={styles.button}>
                <Text style={styles.buttonText}>Forgot password?</Text>
              </Pressable>
            ) : null}
            {step === "signIn" || step === "signUp" ? (
              <Pressable accessibilityRole="button" onPress={() => go(step === "signUp" ? "signIn" : "signUp")} style={styles.button}>
                <Text style={styles.buttonText}>{step === "signUp" ? "Have an account? Sign in" : "New here? Create an account"}</Text>
              </Pressable>
            ) : null}
            {step === "resetEmail" ? (
              <Pressable accessibilityRole="button" onPress={() => go("signIn")} style={styles.button}>
                <Text style={styles.buttonText}>Back to sign in</Text>
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
