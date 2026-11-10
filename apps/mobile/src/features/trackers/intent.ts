import { useMutation } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { useState } from "react";

import { errorMessage } from "../../../../../src/lib/convex-errors";

type KeyedMutation = FunctionReference<"mutation", "public", { idempotencyKey: string }>;

/**
 * One idempotency key per tap, same as the website's `useIntent`.
 * `installExpoCrypto` puts `randomUUID` on `globalThis.crypto` before a screen mounts.
 * Node's Web Crypto covers the test runtime.
 */
function idempotencyKey(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID !== "function") {
    throw new Error("crypto.randomUUID is unavailable");
  }
  return crypto.randomUUID();
}

/** Runs a keyed mutation once per tap. The message is `errorMessage`. */
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
