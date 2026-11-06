"use client";

import { useMutation, useQuery } from "convex/react";
import type { OptimisticLocalStore } from "convex/browser";

import { refusalFor } from "@/lib/errors/refusals";

import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { hudToasts } from "../blocked";

type FoldArgs = { campaignId: Id<"campaigns">; characterId: Id<"characters">; folded: boolean };

/**
 * `setFold`'s optimistic update: the character joins or leaves the cached `preferences.folds` list at once, so the
 * fan folds on the click (rule 12). Nothing to update while the list hasn't loaded; the server's answer brings it.
 */
export function foldLocally(store: OptimisticLocalStore, { campaignId, characterId, folded }: FoldArgs): void {
  const current = store.getQuery(api.preferences.folds, { campaignId });
  if (current === undefined) return;
  const without = current.filter((id) => id !== characterId);
  store.setQuery(api.preferences.folds, { campaignId }, folded ? [...without, characterId] : without);
}

/**
 * "Hide cards" (plan config U6c, Q15 b): whether the viewer folded this character's hand, stored on the account
 * (`preferences.folds` / `preferences.setFold`, per campaign and character), so the choice follows them to every
 * device. Unfolded until the list loads. A refused write rolls the optimistic fold back and shows a HUD toast.
 */
export function useHandFold(campaignId: Id<"campaigns">, characterId: Id<"characters">): [boolean, (folded: boolean) => void] {
  const folds = useQuery(api.preferences.folds, { campaignId });
  const setFold = useMutation(api.preferences.setFold).withOptimisticUpdate(foldLocally);
  const folded = folds?.includes(characterId) ?? false;
  return [
    folded,
    (on) => {
      setFold({ campaignId, characterId, folded: on }).catch((error: unknown) => hudToasts.refusal(refusalFor(error)));
    },
  ];
}
