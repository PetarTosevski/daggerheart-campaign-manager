import { useMutation } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { useState } from "react";
import { randomUUID } from "expo-crypto";

import { errorMessage } from "../../../../../src/lib/convex-errors";

type KeyedMutation = FunctionReference<"mutation", "public", { idempotencyKey: string }>;

/**
 * One tap, one key. A retry of the same call can reuse Convex's own retry;
 * a second tap always gets a new key, so it is a second intent.
 */
export function useIntent<M extends KeyedMutation>(mutation: M) {
  const run = useMutation(mutation);
  const [error, setError] = useState<string | null>(null);

  async function fire(args: Omit<FunctionArgs<M>, "idempotencyKey">): Promise<FunctionReturnType<M> | undefined> {
    setError(null);
    try {
      const withKey = { ...args, idempotencyKey: randomUUID() } as FunctionArgs<M>;
      return await (run as unknown as (input: FunctionArgs<M>) => Promise<FunctionReturnType<M>>)(withKey);
    } catch (caught) {
      setError(errorMessage(caught));
      return undefined;
    }
  }

  return { fire, error, clearError: () => setError(null) };
}
