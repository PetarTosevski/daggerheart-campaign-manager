import { z } from "zod";

export const fearDirectionSchema = z.enum(["increase", "decrease"]);
export const fearEventTypeSchema = z.enum(["adjustment", "correction"]);

export const fearAdjustmentSchema = z.object({
  campaignId: z.uuid("A valid campaign is required."),
  direction: fearDirectionSchema,
  eventType: fearEventTypeSchema,
  idempotencyKey: z.uuid("A valid request identifier is required."),
});

export type FearAdjustmentInput = z.infer<typeof fearAdjustmentSchema>;
