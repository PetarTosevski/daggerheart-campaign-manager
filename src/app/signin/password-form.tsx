"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { BrandButton } from "@/components/brand/buttons";
import { safeNextPath } from "@/lib/safe-next";
import { cn } from "@/lib/utils";

const INPUT =
  "min-h-11 rounded-lg border border-line-2 bg-ink px-3 font-sans text-[15px] text-parchment placeholder:text-faint";

/** Email + password sign-in and account creation (Convex Auth `password` provider). */
export function PasswordForm() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const next = useSearchParams().get("next");
  const [mode, setMode] = useState<"signIn" | "signUp">("signIn");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signUp = mode === "signUp";

  return (
    <form
      aria-label={signUp ? "Create account" : "Sign in with email"}
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setPending(true);
        setError(null);
        signIn("password", {
          flow: mode,
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
          ...(signUp ? { name: String(form.get("name") ?? "") } : {}),
        })
          .then(({ signingIn }) => {
            if (signingIn) router.push(safeNextPath(next));
            else setError("That didn't work. Check your details and try again.");
          })
          .catch(() =>
            setError(
              signUp
                ? "Couldn't create the account. The email may not be invited yet, may already have an account, or the password is shorter than 8 characters."
                : "Wrong email or password.",
            ),
          )
          .finally(() => setPending(false));
      }}
    >
      {signUp ? (
        <label className="flex flex-col gap-1.5 text-[14px]">
          Name
          <input name="name" type="text" maxLength={80} autoComplete="name" className={INPUT} />
        </label>
      ) : null}
      <label className="flex flex-col gap-1.5 text-[14px]">
        Email
        <input name="email" type="email" required autoComplete="email" className={INPUT} />
      </label>
      <label className="flex flex-col gap-1.5 text-[14px]">
        Password
        <input
          name="password"
          type="password"
          required
          minLength={signUp ? 8 : undefined}
          autoComplete={signUp ? "new-password" : "current-password"}
          className={INPUT}
        />
      </label>
      <BrandButton type="submit" variant="solid" size="lg" disabled={pending}>
        {pending ? "Please wait…" : signUp ? "Create account" : "Sign in"}
      </BrandButton>
      {error ? (
        <p role="alert" className="m-0 text-[14px] text-danger">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        className={cn("cursor-pointer self-center text-[14px] text-muted-text underline-offset-4 hover:underline")}
        onClick={() => {
          setMode(signUp ? "signIn" : "signUp");
          setError(null);
        }}
      >
        {signUp ? "Have an account? Sign in" : "New here? Create an account"}
      </button>
    </form>
  );
}
