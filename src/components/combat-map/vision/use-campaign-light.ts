"use client";

import { useQuery } from "convex/react";

import { getPhaseName, type CampaignPhaseName } from "@/lib/domain/campaign-time";
import { lightOf, type LightLevel } from "@/lib/domain/combat-map/light";
import { frameHasMechanic } from "@/lib/frames";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export type CampaignLight = { phase: CampaignPhaseName; light: LightLevel };

/**
 * The light of the campaign's time phase (R8), the same rule C7's server uses: `undefined` while loading, null
 * for a frame without campaign time (vision as by day, no phase badge; C7 QUESTION 1), else the phase and its
 * light. `campaigns.get` is the subscription the campaign shell already holds, so this adds only the time row.
 */
export function useCampaignLight(campaignId: Id<"campaigns">): CampaignLight | null | undefined {
  const campaign = useQuery(api.campaigns.get, { campaignId });
  const hasTime = campaign ? frameHasMechanic(campaign.frameId, "campaignTime") : false;
  const time = useQuery(api.campaignTime.get, hasTime ? { campaignId } : "skip");
  if (campaign === undefined) return undefined;
  if (campaign === null || !hasTime) return null;
  if (time === undefined) return undefined;
  const phase = getPhaseName(time.cycle, time.cycleDay);
  return { phase, light: lightOf(phase) };
}
