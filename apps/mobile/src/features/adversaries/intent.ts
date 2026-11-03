import { useMutation } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { useState } from "react";
import { randomUUID } from "expo-crypto";

import { errorMessage } from "../../../../../src/lib/convex-errors";

type KeyedMutation = FunctionReference<"mutation", "public", { idempotencyKey: string }>;
type AnyMutation = FunctionReference<"mutation", "public">;

/**
 * One tap, one key: every `fire` gets a new idempotency key, so a second tap
 * is a second intent. `pending` disables the button while the call runs.
 */
export function useIntent<M extends KeyedMutation>(mutation: M) {
  const run = useMutation(mutation);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function fire(args: Omit<FunctionArgs<M>, "idempotencyKey">): Promise<FunctionReturnType<M> | undefined> {
    setError(null);
    setPending(true);
    try {
      const withKey = { ...args, idempotencyKey: randomUUID() } as FunctionArgs<M>;
      return await (run as unknown as (input: FunctionArgs<M>) => Promise<FunctionReturnType<M>>)(withKey);
    } catch (caught) {
      setError(errorMessage(caught));
      return undefined;
    } finally {
      setPending(false);
    }
  }

  return { fire, error, pending, clearError: () => setError(null) };
}

/** A mutation without an idempotency key (rename, reorder, a budget change). */
export function useAct<M extends AnyMutation>(mutation: M) {
  const run = useMutation(mutation);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function act(args: FunctionArgs<M>): Promise<FunctionReturnType<M> | undefined> {
    setError(null);
    setPending(true);
    try {
      return await (run as unknown as (input: FunctionArgs<M>) => Promise<FunctionReturnType<M>>)(args);
    } catch (caught) {
      setError(errorMessage(caught));
      return undefined;
    } finally {
      setPending(false);
    }
  }

  return { act, error, pending, clearError: () => setError(null) };
}

export function newKey(): string {
  return randomUUID();
}
