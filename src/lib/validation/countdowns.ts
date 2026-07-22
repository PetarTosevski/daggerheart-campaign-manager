import { z } from "zod";

import {
  COUNTDOWN_CATEGORIES,
  COUNTDOWN_INTENTS,
} from "@/lib/domain/countdowns";

export const COUNTDOWN_REASON_MAX_LENGTH = 200;
export const COUNTDOWN_DETAILS_MAX_LENGTH = 1000;

export const countdownCategorySchema = z.enum(COUNTDOWN_CATEGORIES);
export const countdownIntentSchema = z.enum(COUNTDOWN_INTENTS);
export const countdownEventModeSchema = z.enum(["operation", "correction"]);

export const createCountdownSchema = z.object({
  campaignId: z.uuid("Select a valid campaign."),
  name: z
    .string()
    .trim()
    .min(1, "Enter a countdown name.")
    .max(100, "Countdown names cannot exceed 100 characters."),
  description: z
    .string()
    .trim()
    .max(
      COUNTDOWN_DETAILS_MAX_LENGTH,
      `Descriptions cannot exceed ${COUNTDOWN_DETAILS_MAX_LENGTH} characters.`,
    ),
  category: countdownCategorySchema,
  startingValue: z.coerce
    .number("Enter a starting value.")
    .int("Starting value must be an integer.")
    .positive("Starting value must be greater than zero."),
  consequence: z
    .string()
    .trim()
    .max(
      COUNTDOWN_DETAILS_MAX_LENGTH,
      `Consequences cannot exceed ${COUNTDOWN_DETAILS_MAX_LENGTH} characters.`,
    ),
  idempotencyKey: z.uuid("The request key is invalid. Refresh and try again."),
});

export const operateCountdownSchema = z.object({
  countdownId: z.uuid("Select a valid countdown."),
  intent: countdownIntentSchema,
  eventMode: countdownEventModeSchema,
  reason: z
    .string()
    .trim()
    .max(
      COUNTDOWN_REASON_MAX_LENGTH,
      `Reasons cannot exceed ${COUNTDOWN_REASON_MAX_LENGTH} characters.`,
    ),
  idempotencyKey: z.uuid("The request key is invalid. Refresh and try again."),
});
