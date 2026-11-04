/**
 * A campaign's time phase and light (R8, dcm-bxp.54), split out of `./combatVision` (dcm-uh6r) so the light queries
 * (`campaigns.timeOfDay`, the HUD's scene) do not load the vision engine, the sprite packs and the card runner.
 * `./combatVision` re-exports them.
 */
import { getPhaseName, type CampaignPhaseName } from "../../src/lib/domain/campaign-time/index";
import { lightOf, type LightLevel } from "../../src/lib/domain/combat-map/light";
import { frameHasMechanic } from "../../src/lib/frames/index";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { timeOfDayValidator } from "../tables/campaigns";

/** The campaign's light (R8, dcm-bxp.54): day, dim (badge) or night (lights only). */
export const lightLevelValidator = timeOfDayValidator;

/**
 * The campaign's time phase (R8). Campaign time is a Witherwild mechanic: other frames have none and get null. A
 * Witherwild campaign without a time row is at the initial time (week 1, DAY day 1).
 */
export async function campaignPhase(ctx: QueryCtx, campaign: Doc<"campaigns">): Promise<CampaignPhaseName | null> {
  if (!frameHasMechanic(campaign.frameId, "campaignTime")) return null;
  const row = await ctx.db
    .query("campaignTime")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
    .unique();
  if (row === null) return getPhaseName("DAY", 1);
  try {
    return getPhaseName(row.cycle, row.cycleDay);
  } catch {
    return null;
  }
}

/** A campaign's light (dcm-bxp.54): its time phase and that phase's light, or its time of day (no phase). */
export type CampaignLight = { phase: CampaignPhaseName | null; light: LightLevel };

/**
 * The light every map of the campaign follows (dcm-bxp.54, user 2026-10-30): in a frame with campaign time (the
 * Witherwild) the time phase decides (`lightOf`, dcm-p40); every other campaign has the GM's Day / Dim / Night
 * (`campaigns.timeOfDay`, unset = day).
 */
export async function campaignLight(ctx: QueryCtx, campaign: Doc<"campaigns">): Promise<CampaignLight> {
  if (frameHasMechanic(campaign.frameId, "campaignTime")) {
    const phase = await campaignPhase(ctx, campaign);
    return { phase, light: lightOf(phase ?? "") };
  }
  return { phase: null, light: campaign.timeOfDay ?? "day" };
}
