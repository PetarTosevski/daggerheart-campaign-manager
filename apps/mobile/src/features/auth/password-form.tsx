import { useAuthActions } from "@convex-dev/auth/react";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { authErrorText } from "./auth-error";

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
  screen: { flex: 1, gap: 12, padding: 24 },
  label: { fontSize: 14, gap: 6 },
  input: {
    borderRadius: 8,
    borderWidth: 1,
    fontSize: 16,
    minHeight: 44,
    paddingHorizontal: 12,
  },
  hint: { fontSize: 13 },
  button: { alignItems: "center", justifyContent: "center", minHeight: 44 },
  error: { fontSize: 14 },
  notice: { fontSize: 14 },
  help: { fontSize: 14 },
});

/** Email + password sign-in, account creation with an emailed code, and password reset by code. */
export function PasswordForm() {
  const { signIn } = useAuthActions();
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
            ...(flow === "signUp" ? { name: values.name } : {}),
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
          ...(origin.flow === "signUp" ? { name: origin.name } : {}),
        });
      }
      setNotice("We sent a new code.");
    }, "Couldn't send a new code. Try again.");
  }

  const codeStep = step === "code" || step === "resetCode";
  const submitLabel = pending ? "Please wait…" : LABELS[step].submit;

  return (
    <View style={styles.screen}>
      <Text accessibilityRole="header">{LABELS[step].title}</Text>
      {step === "signUp" ? (
        <View style={styles.label}>
          <Text>Name</Text>
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
          <Text>Email</Text>
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
          <Text>Password</Text>
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
          <Text>6-digit code</Text>
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
          <Text>New password</Text>
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
      <Pressable accessibilityRole="button" disabled={pending} onPress={onSubmit} style={styles.button}>
        <Text>{submitLabel}</Text>
      </Pressable>
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
            <Text>{cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => go(step === "code" ? (origin?.flow === "signIn" ? "signIn" : "signUp") : "resetEmail")}
            style={styles.button}
          >
            <Text>Use a different email</Text>
          </Pressable>
        </>
      ) : null}
      {step === "signIn" ? (
        <Pressable accessibilityRole="button" onPress={() => go("resetEmail")} style={styles.button}>
          <Text>Forgot password?</Text>
        </Pressable>
      ) : null}
      {step === "signIn" || step === "signUp" ? (
        <Pressable accessibilityRole="button" onPress={() => go(step === "signUp" ? "signIn" : "signUp")} style={styles.button}>
          <Text>{step === "signUp" ? "Have an account? Sign in" : "New here? Create an account"}</Text>
        </Pressable>
      ) : null}
      {step === "resetEmail" ? (
        <Pressable accessibilityRole="button" onPress={() => go("signIn")} style={styles.button}>
          <Text>Back to sign in</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
