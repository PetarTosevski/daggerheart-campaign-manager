"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";

import { type CampaignPhaseName } from "@/lib/domain/campaign-time";
import { type LightLevel } from "@/lib/domain/combat-map/light";
import { errorMessage } from "@/lib/convex-errors";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

/**
 * The campaign's light (dcm-bxp.54): the Witherwild time phase and its light (`phase` set), or the GM's time of day
 * (`phase` null). `canSet`: the caller may change it (edit access, a frame without campaign time).
 */
export type CampaignLight = { phase: CampaignPhaseName | null; light: LightLevel; canSet: boolean };

/**
 * The campaign's light, the same value C7's server vision uses (`campaigns.timeOfDay`, `campaignLight`): `undefined`
 * while loading, else the phase (Witherwild) or null, the light and whether the caller may set it.
 */
export function useCampaignLight(campaignId: Id<"campaigns">): CampaignLight | null | undefined {
  const row = useQuery(api.campaigns.timeOfDay, { campaignId });
  if (row === undefined) return undefined;
  return { phase: row.phase as CampaignPhaseName | null, light: row.light, canSet: row.canSet };
}

/**
 * Sets the campaign's time of day (`campaigns.setTimeOfDay`, an intent: the one field), shown at once through an
 * optimistic update of `campaigns.timeOfDay`. Errors are kept as a message for an `aria-live` region.
 */
export function useSetTimeOfDay(campaignId: Id<"campaigns">) {
  const mutate = useMutation(api.campaigns.setTimeOfDay).withOptimisticUpdate((store, args) => {
    const current = store.getQuery(api.campaigns.timeOfDay, { campaignId: args.campaignId });
    if (current === undefined || !current.canSet) return;
    store.setQuery(api.campaigns.timeOfDay, { campaignId: args.campaignId }, { ...current, light: args.timeOfDay });
  });
  const [error, setError] = useState<string | null>(null);
  async function set(timeOfDay: LightLevel): Promise<void> {
    setError(null);
    try {
      await mutate({ campaignId, timeOfDay });
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  return { set, error };
}
