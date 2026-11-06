"use client";

import { useQuery } from "convex/react";

import type { FeatureKey } from "@/lib/admin/features";

import { api } from "../../convex/_generated/api";

/**
 * Whether `flags` (a `features.mine` answer) has `key` on. Anything that is not a loaded answer (loading, a test's
 * stub) counts as on: a missing switch means Everyone (AD9), so nothing flickers off for everyone while it loads.
 */
export function featureFlagOn(flags: unknown, key: FeatureKey): boolean {
  if (typeof flags !== "object" || flags === null) return true;
  const value = (flags as Partial<Record<FeatureKey, unknown>>)[key];
  return typeof value === "boolean" ? value : true;
}

/**
 * Whether a feature switch (config AD9 / AF1, Q25 b) is on for the signed-in user: the owner's Off / Only me /
 * Testers / Everyone choice, read from `features.mine`. Every caller shares the one `features.mine` subscription
 * (Convex de-duplicates the same query and args), so this is cheap to call wherever a feature shows. Loading = on.
 *
 * The server checks the same switch where there is server code (`featureOn` in `convex/lib/features.ts`); this hook
 * only decides what the client shows. Journal and Share links are inert (N2 a) and always answer true.
 */
export function useFeature(key: FeatureKey): boolean {
  return featureFlagOn(useQuery(api.features.mine, {}), key);
}
