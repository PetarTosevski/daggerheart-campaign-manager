import { useMutation } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { useState } from "react";

import { errorMessage } from "../../../../../../src/lib/convex-errors";

type KeyedMutation = FunctionReference<"mutation", "public", { idempotencyKey: string }>;

function idempotencyKey(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID !== "function") {
    throw new Error("crypto.randomUUID is unavailable");
  }
  return crypto.randomUUID();
}

/** One idempotency key per tap, same as the website's `useIntent`. */
export function useIntent<M extends KeyedMutation>(mutation: M) {
  const run = useMutation(mutation);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function fire(
    args: Omit<FunctionArgs<M>, "idempotencyKey">,
  ): Promise<FunctionReturnType<M> | undefined> {
    setError(null);
    setPending(true);
    try {
      const withKey = { ...args, idempotencyKey: idempotencyKey() } as FunctionArgs<M>;
      return await (run as unknown as (a: FunctionArgs<M>) => Promise<FunctionReturnType<M>>)(withKey);
    } catch (caught) {
      setError(errorMessage(caught));
      return undefined;
    } finally {
      setPending(false);
    }
  }

  return { fire, error, pending, clearError: () => setError(null) };
}

/** Runs a keyed mutation once per intent string (retry-safe), for class feature `use`. */
export function useFeatureIntent() {
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(call: (idempotencyKey: string) => Promise<unknown>): Promise<boolean> {
    const next = key ?? globalThis.crypto.randomUUID();
    setKey(next);
    setBusy(true);
    setError(null);
    try {
      await call(next);
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      setKey(null);
      setBusy(false);
    }
  }

  return { run, busy, error };
}
