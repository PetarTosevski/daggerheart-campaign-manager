import { z } from "zod";

export const CAMPAIGN_NAME_MAX_LENGTH = 100;
export const CAMPAIGN_DESCRIPTION_MAX_LENGTH = 500;

export const createCampaignSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a campaign name.")
    .max(
      CAMPAIGN_NAME_MAX_LENGTH,
      `Campaign names cannot exceed ${CAMPAIGN_NAME_MAX_LENGTH} characters.`,
    ),
  description: z
    .string()
    .trim()
    .max(
      CAMPAIGN_DESCRIPTION_MAX_LENGTH,
      `Descriptions cannot exceed ${CAMPAIGN_DESCRIPTION_MAX_LENGTH} characters.`,
    ),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
