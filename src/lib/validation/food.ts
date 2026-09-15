import { z } from "zod";

import { FOOD_TYPES } from "@/lib/domain/food";

export const FOOD_LABEL_MAX = 100;
export const FOOD_NOTE_MAX = 300;
export const FOOD_REASON_MAX = 300;

export const acquireFoodBatchSchema = z.object({
  campaignId: z.uuid("Select a valid campaign."),
  idempotencyKey: z.uuid("The request key is invalid. Refresh and try again."),
  label: z
    .string()
    .trim()
    .min(1, "Enter a food label.")
    .max(FOOD_LABEL_MAX, `Labels cannot exceed ${FOOD_LABEL_MAX} characters.`),
  foodType: z.enum(FOOD_TYPES),
  initialPortions: z.coerce
    .number("Enter the number of portions.")
    .int("Portions must be a whole number.")
    .positive("Portions must be greater than zero."),
  sourceNote: z
    .string()
    .trim()
    .max(FOOD_NOTE_MAX, `Notes cannot exceed ${FOOD_NOTE_MAX} characters.`),
});

export const FOOD_SELECTION_MAX = 500;

export const processWeeklyFoodSchema = z
  .object({
    campaignId: z.uuid("Select a valid campaign."),
    idempotencyKey: z.uuid("The request key is invalid. Refresh and try again."),
    targetWeek: z.coerce
      .number()
      .int()
      .min(1, "Target week must be at least 1."),
    overrideRequiredPortions: z
      .union([z.literal(""), z.coerce.number().int().min(0, "Required portions cannot be negative.")])
      .transform((v) => (v === "" ? null : v)),
    skipSpoilage: z.boolean(),
    // Explicit ordered batch selection overriding default FIFO.
    overrideBatchSelection: z.boolean(),
    selectedBatchIds: z
      .array(z.uuid("Selected batches must be valid ids."))
      .max(FOOD_SELECTION_MAX, `Cannot select more than ${FOOD_SELECTION_MAX} batches.`),
    reason: z
      .string()
      .trim()
      .max(FOOD_REASON_MAX, `Reasons cannot exceed ${FOOD_REASON_MAX} characters.`),
  })
  // A custom selection must list at least one batch.
  .refine(
    (data) => !data.overrideBatchSelection || data.selectedBatchIds.length > 0,
    { message: "Select at least one batch, or turn off the batch override.", path: ["selectedBatchIds"] },
  )
  // Selected ids may not repeat.
  .refine(
    (data) => new Set(data.selectedBatchIds).size === data.selectedBatchIds.length,
    { message: "A batch can only be selected once.", path: ["selectedBatchIds"] },
  )
  // Batches may not be submitted unless the batch override is enabled.
  .refine(
    (data) => data.overrideBatchSelection || data.selectedBatchIds.length === 0,
    { message: "Enable the batch override to select batches.", path: ["selectedBatchIds"] },
  )
  // Any override (portions, spoilage, or batch selection) requires a reason.
  .refine(
    (data) =>
      !(data.overrideRequiredPortions !== null || data.skipSpoilage || data.overrideBatchSelection) ||
      data.reason.length > 0,
    { message: "An override requires a reason.", path: ["reason"] },
  );

export const correctFoodBatchSchema = z.object({
  campaignId: z.uuid("Select a valid campaign."),
  idempotencyKey: z.uuid("The request key is invalid. Refresh and try again."),
  batchId: z.uuid("Select a valid batch."),
  newRemainingPortions: z.coerce
    .number("Enter the corrected portions.")
    .int("Portions must be a whole number.")
    .min(0, "Portions cannot be negative."),
  reason: z
    .string()
    .trim()
    .min(1, "A correction requires a reason.")
    .max(FOOD_REASON_MAX, `Reasons cannot exceed ${FOOD_REASON_MAX} characters.`),
});

export type AcquireFoodBatchInput = z.infer<typeof acquireFoodBatchSchema>;
export type ProcessWeeklyFoodInput = z.infer<typeof processWeeklyFoodSchema>;
export type CorrectFoodBatchInput = z.infer<typeof correctFoodBatchSchema>;
