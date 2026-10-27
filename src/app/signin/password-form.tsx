"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { ConvexError } from "convex/values";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { authMessages } from "@/lib/errors/auth";
import { safeNextPath } from "@/lib/safe-next";

const INPUT =
  "min-h-11 rounded-lg border border-line-2 bg-ink px-3 font-sans text-[15px] text-parchment placeholder:text-faint";
const LINK = "min-h-11 cursor-pointer self-center text-[14px] text-muted-text underline-offset-4 hover:underline";

/** Seconds before "Resend code" works again (the server also allows 5 sends per hour per email). */
export const RESEND_COOLDOWN_SECONDS = 30;

type Step = "signIn" | "signUp" | "code" | "resetEmail" | "resetCode";
type Origin = { name: string; password: string; flow: "signIn" | "signUp" };

const WRONG_LOGIN = "Wrong email or password.";
const RATE_LIMIT_TEXT = "Too many tries for this email. Wait a few minutes, then try again.";

/** The text for a failed auth call; `fallback` covers the library's own opaque errors (for example a wrong password). */
export function authErrorText(error: unknown, fallback: string): string {
  const data: unknown = error instanceof ConvexError ? error.data : null;
  let code: unknown = typeof data === "object" && data !== null ? (data as { code?: unknown }).code : undefined;
  // The Next.js auth proxy (/api/auth) answers a failed sign-in with only `error.message`, so the browser gets a plain
  // Error. Its text carries the serialized payload (`ConvexError: {"code":"CODE_INVALID"}`): dev Convex gives it, and
  // src/lib/auth-errors.ts restores it where production redacts the message.
  if (code === undefined && error instanceof Error) code = /"code":"([A-Z_]+)"/.exec(error.message)?.[1];
  if (code === "RATE_LIMITED") return RATE_LIMIT_TEXT;
  if (code === "EMAIL_TAKEN" || code === "PASSWORD_TOO_SHORT" || code === "CODE_INVALID") return authMessages[code];
  return fallback;
}

const LABELS: Record<Step, { form: string; submit: string }> = {
  signIn: { form: "Sign in with email", submit: "Sign in" },
  signUp: { form: "Create account", submit: "Create account" },
  code: { form: "Enter the code", submit: "Verify email" },
  resetEmail: { form: "Reset password", submit: "Send code" },
  resetCode: { form: "Choose a new password", submit: "Set password" },
};

/** Email + password sign-in, account creation with an emailed code, and password reset by code (Convex Auth `password`). */
export function PasswordForm() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [step, setStep] = useState<Step>("signIn");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  // Kept in memory only: to name the address and to send a new code.
  const [email, setEmail] = useState("");
  const [origin, setOrigin] = useState<Origin | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>("input")?.focus();
  }, [step]);
  useEffect(() => {
    if (error) alertRef.current?.focus();
  }, [error]);
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
    setCooldown(RESEND_COOLDOWN_SECONDS);
    go(to);
  }

  /** One auth call with the shared pending and error handling. */
  function run(call: () => Promise<void>, fallback: string) {
    setPending(true);
    setError(null);
    setNotice(null);
    call()
      .catch((caught: unknown) => setError(authErrorText(caught, fallback)))
      .finally(() => setPending(false));
  }

  const done = ({ signingIn }: { signingIn: boolean }) => {
    if (signingIn) router.push(safeNextPath(next));
    else setError("That didn't work. Check your details and try again.");
  };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (key: string) => String(form.get(key) ?? "");
    if (step === "signIn" || step === "signUp") {
      const flow = step;
      const values: Origin = { name: text("name"), password: text("password"), flow };
      const address = text("email").trim();
      setEmail(address);
      run(
        () =>
          signIn("password", {
            flow,
            email: address,
            password: values.password,
            ...(flow === "signUp" ? { name: values.name } : {}),
          }).then(({ signingIn }) => {
            if (signingIn) done({ signingIn });
            else {
              // Sign-up, or sign-in of an account whose code was never entered: the code step.
              setOrigin(values);
              toCodeStep("code");
            }
          }),
        flow === "signUp" ? "Couldn't create the account. Try again." : WRONG_LOGIN,
      );
    } else if (step === "code") {
      run(
        () => signIn("password", { flow: "email-verification", email, code: text("code").trim() }).then(done),
        "Couldn't check the code. Try again.",
      );
    } else if (step === "resetEmail") {
      const address = text("email").trim();
      setEmail(address);
      // The same answer whether or not the address has an account.
      run(
        () => signIn("password", { flow: "reset", email: address }).then(() => toCodeStep("resetCode")),
        "Couldn't send the code. Try again.",
      );
    } else {
      run(
        () =>
          signIn("password", {
            flow: "reset-verification",
            email,
            code: text("code").trim(),
            newPassword: text("newPassword"),
          }).then(done),
        "Couldn't reset the password. Try again.",
      );
    }
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

  return (
    <form ref={formRef} aria-label={LABELS[step].form} className="flex flex-col gap-3" onSubmit={onSubmit}>
      {step === "signUp" ? (
        <label className="flex flex-col gap-1.5 text-[14px]">
          Name
          <input name="name" type="text" maxLength={80} autoComplete="name" className={INPUT} />
        </label>
      ) : null}
      {step === "signIn" || step === "signUp" || step === "resetEmail" ? (
        <label className="flex flex-col gap-1.5 text-[14px]">
          Email
          <input name="email" type="email" required autoComplete="email" defaultValue={email} className={INPUT} />
        </label>
      ) : null}
      {step === "signIn" || step === "signUp" ? (
        <div className="flex flex-col gap-1.5 text-[14px]">
          <label htmlFor="password">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            required
            minLength={step === "signUp" ? 8 : undefined}
            aria-describedby={step === "signUp" ? "password-hint" : undefined}
            autoComplete={step === "signUp" ? "new-password" : "current-password"}
            className={INPUT}
          />
          {step === "signUp" ? (
            <span id="password-hint" className="text-[13px] text-muted-text">
              At least 8 characters.
            </span>
          ) : null}
        </div>
      ) : null}
      {codeStep ? (
        <>
          <p className="m-0 text-[14px]" id="code-help">
            {step === "code"
              ? `Enter the 6-digit code we emailed to ${email}.`
              : `If ${email} has an account, we emailed it a 6-digit code. Enter it with a new password.`}
          </p>
          <label className="flex flex-col gap-1.5 text-[14px]">
            6-digit code
            <input
              name="code"
              type="text"
              required
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              autoComplete="one-time-code"
              aria-describedby="code-help"
              className={INPUT}
            />
          </label>
        </>
      ) : null}
      {step === "resetCode" ? (
        <div className="flex flex-col gap-1.5 text-[14px]">
          <label htmlFor="newPassword">New password</label>
          <input
            id="newPassword"
            name="newPassword"
            type="password"
            required
            minLength={8}
            aria-describedby="new-password-hint"
            autoComplete="new-password"
            className={INPUT}
          />
          <span id="new-password-hint" className="text-[13px] text-muted-text">
            At least 8 characters.
          </span>
        </div>
      ) : null}
      <BrandButton type="submit" variant="solid" size="lg" disabled={pending}>
        {pending ? "Please wait…" : LABELS[step].submit}
      </BrandButton>
      {error ? (
        <p ref={alertRef} role="alert" tabIndex={-1} className="m-0 text-[14px] text-danger">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="m-0 text-[14px] text-muted-text">
          {notice}
        </p>
      ) : null}
      {codeStep ? (
        <>
          <button type="button" className={LINK} disabled={pending || cooldown > 0} onClick={resend}>
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </button>
          <button
            type="button"
            className={LINK}
            onClick={() => go(step === "code" ? (origin?.flow === "signIn" ? "signIn" : "signUp") : "resetEmail")}
          >
            Use a different email
          </button>
        </>
      ) : null}
      {step === "signIn" ? (
        <button type="button" className={LINK} onClick={() => go("resetEmail")}>
          Forgot password?
        </button>
      ) : null}
      {step === "signIn" || step === "signUp" ? (
        <button type="button" className={LINK} onClick={() => go(step === "signUp" ? "signIn" : "signUp")}>
          {step === "signUp" ? "Have an account? Sign in" : "New here? Create an account"}
        </button>
      ) : null}
      {step === "resetEmail" ? (
        <button type="button" className={LINK} onClick={() => go("signIn")}>
          Back to sign in
        </button>
      ) : null}
    </form>
  );
}
