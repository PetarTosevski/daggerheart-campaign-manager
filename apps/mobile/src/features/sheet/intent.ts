import { useMutation } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { randomUUID } from "expo-crypto";
import { useRef, useState } from "react";

import { errorMessage } from "../../../../../src/lib/convex-errors";

type KeyedMutation = FunctionReference<"mutation", "public", { idempotencyKey: string }>;

/**
 * The sheet's one keyed-intent hook (dcm-gdzi.21, .26; the website's `src/lib/use-intent.ts` imports React and
 * convex/react, so the phone keeps its own). Each tap gets a fresh idempotency key, so the Convex client's own
 * retries never apply it twice. `pending` disables the control; the ref guard also drops a second tap that lands
 * before React re-renders. Errors are kept as `errorMessage` text for an alert.
 */
export function useIntent<M extends KeyedMutation>(mutation: M) {
  const run = useMutation(mutation);
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function fire(args: Omit<FunctionArgs<M>, "idempotencyKey">): Promise<FunctionReturnType<M> | undefined> {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setError(null);
    setPending(true);
    try {
      const withKey = { ...args, idempotencyKey: randomUUID() } as FunctionArgs<M>;
      return await (run as unknown as (input: FunctionArgs<M>) => Promise<FunctionReturnType<M>>)(withKey);
    } catch (caught) {
      setError(errorMessage(caught));
      return undefined;
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return { fire, pending, error, clearError: () => setError(null) };
}

/**
 * Runs a keyed call once per intent, as the website's features panel does: the key lives in a ref (read at once, not
 * after a re-render), a second tap while one is in flight is dropped, and a finished call, failed or not, starts a new
 * key for the next intent.
 */
export function useKeyedRun() {
  const key = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(call: (idempotencyKey: string) => Promise<unknown>): Promise<boolean> {
    if (key.current !== null) return false;
    key.current = randomUUID();
    setBusy(true);
    setError(null);
    try {
      await call(key.current);
      return true;
    } catch (caught) {
      setError(errorMessage(caught));
      return false;
    } finally {
      key.current = null;
      setBusy(false);
    }
  }

  return { run, busy, error };
}
