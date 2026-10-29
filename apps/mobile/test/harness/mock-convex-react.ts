import { getFunctionName } from "convex/server";
import { useEffect, useId } from "react";

import { activeClient, hasActiveClient } from "./session";

export { hasActiveClient };

function nameOf(ref: unknown): string {
  return getFunctionName(ref as never);
}

/** Subscribe unless `args` is `"skip"`. Returns the fixture value, or `undefined` when skipped. */
function useWatched(ref: unknown, args: unknown): unknown {
  const client = activeClient();
  const skip = args === "skip";
  const name = nameOf(ref);
  const id = useId();
  useEffect(() => {
    if (skip) return undefined;
    return () => client.unwatch(name, id);
  }, [client, skip, name, id]);
  if (skip) return undefined;
  client.watch(name, id);
  return client.queryResult(name, args);
}

export function useQuery(ref: unknown, args?: unknown): unknown {
  return useWatched(ref, args);
}

export function usePaginatedQuery(ref: unknown, args: unknown): unknown {
  const value = useWatched(ref, args);
  if (args === "skip" || value === undefined) {
    return {
      results: [],
      status: "LoadingFirstPage" as const,
      isLoading: true,
      loadMore: () => undefined,
    };
  }
  if (Array.isArray(value)) {
    return {
      results: value,
      status: "Exhausted" as const,
      isLoading: false,
      loadMore: () => undefined,
    };
  }
  if (typeof value === "object" && value !== null && "results" in value && "status" in value) {
    return value;
  }
  return {
    results: [],
    status: "Exhausted" as const,
    isLoading: false,
    loadMore: () => undefined,
  };
}

export function useMutation(ref: unknown): (args?: unknown) => unknown {
  const client = activeClient();
  const name = nameOf(ref);
  return (args?: unknown) => client.call(name, args, "mutation");
}

export function useAction(ref: unknown): (args?: unknown) => unknown {
  const client = activeClient();
  const name = nameOf(ref);
  return (args?: unknown) => client.call(name, args, "action");
}
