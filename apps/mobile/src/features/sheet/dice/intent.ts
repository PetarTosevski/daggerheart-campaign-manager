import { useMutation } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { useState } from "react";
import { randomUUID } from "expo-crypto";

import { errorMessage } from "../../../../../../src/lib/convex-errors";

type KeyedMutation = FunctionReference<"mutation", "public", { idempotencyKey: string }>;

/** One tap, one idempotency key (matches the dashboard and website). */
export function useIntent<M extends KeyedMutation>(mutation: M) {
  const run = useMutation(mutation);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return { fire, pending, error, clearError: () => setError(null) };
}
