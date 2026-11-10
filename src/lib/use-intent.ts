"use client";

import { useMutation } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { useState } from "react";

import { errorMessage } from "./convex-errors";

type KeyedMutation = FunctionReference<"mutation", "public", { idempotencyKey: string }>;

/**
 * Runs a mutation once per GM intent (a click): each call gets a fresh
 * idempotency key, so the Convex client's own retries can never apply it twice.
 * Errors are kept as a message for an `aria-live` region.
 */
export function useIntent<M extends KeyedMutation>(mutation: M) {
  const run = useMutation(mutation);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /**
   * `key` reuses one idempotency key across clicks, for a form whose second click must not act twice (the
   * character wizard: a double click or a click while navigating returns the first character instead of a copy).
   */
  async function fire(args: Omit<FunctionArgs<M>, "idempotencyKey">, opts?: { key?: string }): Promise<FunctionReturnType<M> | undefined> {
    setError(null);
    setPending(true);
    try {
      const withKey = { ...args, idempotencyKey: opts?.key ?? crypto.randomUUID() } as FunctionArgs<M>;
      // OptionalRestArgs<M> cannot be built from a generic M; the shape is checked by FunctionArgs.
      return await (run as unknown as (a: FunctionArgs<M>) => Promise<FunctionReturnType<M>>)(withKey);
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setPending(false);
    }
  }

  return { fire, error, pending, clearError: () => setError(null) };
}
