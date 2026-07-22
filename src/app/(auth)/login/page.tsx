"use client";

import { useActionState } from "react";

import { signInAction, type SignInState } from "./actions";

const initialState: SignInState = {};

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(
    signInAction,
    initialState,
  );

  return (
    <main className="flex flex-1 flex-col items-center justify-center p-8">
      <form
        action={formAction}
        className="flex w-full max-w-sm flex-col gap-4 rounded-lg border border-black/10 p-6 dark:border-white/15"
      >
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Witherwild Campaign Manager is private. Sign in to continue.
        </p>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Email
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            defaultValue={state.email ?? ""}
            className="rounded-md border border-black/15 px-3 py-2 text-base dark:border-white/20"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="rounded-md border border-black/15 px-3 py-2 text-base dark:border-white/20"
          />
        </label>

        <label className="flex items-center gap-2 text-sm font-medium">
          <input
            name="remember"
            type="checkbox"
            defaultChecked={state.remember ?? true}
            className="size-4 rounded border-black/25 dark:border-white/30"
          />
          Remember me on this device
        </label>

        {state.error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {state.error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="rounded-md bg-black px-4 py-2 text-base font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
        >
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
