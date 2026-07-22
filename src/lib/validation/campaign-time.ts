import { z } from "zod";

export const CAMPAIGN_TIME_NOTE_MAX_LENGTH = 200;

const commonFields = {
  campaignId: z.uuid("Select a valid campaign."),
  idempotencyKey: z.uuid(
    "The request key is invalid. Refresh and try again.",
  ),
  note: z
    .string()
    .trim()
    .max(
      CAMPAIGN_TIME_NOTE_MAX_LENGTH,
      `Notes cannot exceed ${CAMPAIGN_TIME_NOTE_MAX_LENGTH} characters.`,
    ),
};

const advanceCampaignTimeSchema = z.object({
  ...commonFields,
  intent: z.literal("advance"),
  targetWeek: z.literal("").optional(),
  targetCycle: z.literal("").optional(),
  targetCycleDay: z.literal("").optional(),
  correctsEventId: z.literal("").optional(),
});

const correctCampaignTimeSchema = z.object({
  ...commonFields,
  intent: z.literal("correction"),
  targetWeek: z.coerce
    .number("Enter a campaign week.")
    .int("Campaign week must be an integer.")
    .min(1, "Campaign week must be at least 1."),
  targetCycle: z.enum(["DAY", "NIGHT"], {
    error: "Select Day or Night Cycle.",
  }),
  targetCycleDay: z.coerce
    .number("Enter a cycle day.")
    .int("Cycle day must be an integer.")
    .min(1, "Cycle day must be from 1 through 7.")
    .max(7, "Cycle day must be from 1 through 7."),
  correctsEventId: z
    .union([z.uuid("The corrected event is invalid."), z.literal("")])
    .transform((value) => value || null),
});

export const campaignTimeActionSchema = z.discriminatedUnion("intent", [
  advanceCampaignTimeSchema,
  correctCampaignTimeSchema,
]);
