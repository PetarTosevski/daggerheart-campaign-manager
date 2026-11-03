import type { Id } from "../../../convex";

/** Combat slot props store `campaignId` as string; Convex expects `Id<"campaigns">`. */
export function asCampaignId(campaignId: string): Id<"campaigns"> {
  return campaignId as Id<"campaigns">;
}
