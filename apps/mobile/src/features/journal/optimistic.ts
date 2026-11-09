import type { OptimisticLocalStore } from "convex/browser";
import { useMutation, type ReactMutation } from "convex/react";
import type { FunctionArgs, FunctionReference } from "convex/server";

import { api, type Id } from "../../convex";

/**
 * The Journal's optimistic updates (rule 12: a tap with visible latency shows at once). The patches themselves are
 * the website's, from src/lib/journal (dcm-gdzi.46); this file holds the hook that applies them and the one patch the
 * website keeps inline. The test harness's mutations are plain functions without `withOptimisticUpdate`.
 */
export function useOptimistic<M extends FunctionReference<"mutation">>(
  ref: M,
  update: (store: OptimisticLocalStore, args: FunctionArgs<M>) => void,
): ReactMutation<M> {
  const mutation = useMutation(ref);
  if (!("withOptimisticUpdate" in mutation)) return mutation;
  return mutation.withOptimisticUpdate(update);
}

/** 'Allow extra characters this session' on the cached `sessions.current`. */
export function patchExtras(store: OptimisticLocalStore, args: { campaignId: Id<"campaigns">; allow: boolean }) {
  const current = store.getQuery(api.sessions.current, { campaignId: args.campaignId });
  if (current) store.setQuery(api.sessions.current, { campaignId: args.campaignId }, { ...current, extraCharacters: args.allow });
}
