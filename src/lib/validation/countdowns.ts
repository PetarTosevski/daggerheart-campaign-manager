import { z } from "zod";

import {
  COUNTDOWN_CATEGORIES,
  COUNTDOWN_INTENTS,
  MAX_COUNTDOWN_START,
} from "../domain/countdowns";
import {
  COUNTDOWN_DICE_SIDES,
  COUNTDOWN_MODES,
  COUNTDOWN_REPEATS,
  COUNTDOWN_REST_MODES,
  COUNTDOWN_STEP_TEXT_MAX,
  MAX_COUNTDOWN_DICE,
  MAX_COUNTDOWN_STEPS,
  MAX_LONG_TERM_START,
} from "../domain/countdowns/advanced";

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

export const countdownModeSchema = z.enum(COUNTDOWN_MODES);
export const countdownRepeatSchema = z.enum(COUNTDOWN_REPEATS);
export const countdownRestModeSchema = z.enum(COUNTDOWN_REST_MODES);

/** A randomized start (CB p.163 "Countdown (1d6)"): 1-4 of one standard die, rolled on the server. */
export const countdownStartDiceSchema = z.object({
  count: z.number().int().min(1, "Roll at least one die.").max(MAX_COUNTDOWN_DICE, `Roll at most ${MAX_COUNTDOWN_DICE} dice.`),
  sides: z.literal(COUNTDOWN_DICE_SIDES, "Pick a d4, d6, d8, d10, d12 or d20."),
});

/** One box of a long-term track (CB p.164): the value it sits on, what happens, and whether news reaches the party. */
export const countdownStepSchema = z.object({
  value: z.number().int().min(0).max(MAX_LONG_TERM_START),
  text: z
    .string()
    .trim()
    .min(1, "Write the step or leave it out.")
    .max(COUNTDOWN_STEP_TEXT_MAX, `Steps cannot exceed ${COUNTDOWN_STEP_TEXT_MAX} characters.`),
  news: z.boolean().optional(),
});

/**
 * Countdown fields as the dashboard's "New countdown" dialog sends them to Convex. The advanced fields
 * (countdowns-advanced K0) are optional; without them this is today's countdown. Exactly one of `startingValue`
 * and `startDice`; a long-term countdown has a fixed start, no repeat and may carry `steps` and `restMode`;
 * steps sit within 0..start, one per value.
 */
export const countdownDetailsSchema = createCountdownSchema
  .pick({ name: true, description: true, category: true, consequence: true })
  .extend({
    startingValue: z
      .number("Enter a starting value.")
      .int("Starting value must be an integer.")
      .min(1, "Starting value must be greater than zero.")
      .max(MAX_COUNTDOWN_START, `Starting value cannot exceed ${MAX_COUNTDOWN_START}.`)
      .optional(),
    mode: countdownModeSchema.optional(),
    repeat: countdownRepeatSchema.optional(),
    startDice: countdownStartDiceSchema.optional(),
    armed: z.boolean().optional(),
    steps: z.array(countdownStepSchema).max(MAX_COUNTDOWN_STEPS, "Too many steps.").optional(),
    restMode: countdownRestModeSchema.optional(),
  })
  .superRefine((input, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if ((input.startingValue === undefined) === (input.startDice === undefined)) {
      issue("startingValue", "Pick a starting value or dice to roll.");
    }
    const longTerm = input.mode === "longTerm";
    if (longTerm && input.repeat !== undefined) issue("repeat", "A long-term countdown doesn't repeat.");
    if (longTerm && input.startDice !== undefined) issue("startDice", "A long-term countdown starts at a number.");
    if (!longTerm && input.steps !== undefined) issue("steps", "Only a long-term countdown has steps.");
    if (!longTerm && input.restMode !== undefined) issue("restMode", "Only a long-term countdown ticks on rests.");
    if (input.steps !== undefined && input.startingValue !== undefined) {
      const seen = new Set<number>();
      for (const step of input.steps) {
        if (step.value > input.startingValue) issue("steps", "A step must sit between 0 and the start.");
        if (seen.has(step.value)) issue("steps", "Only one step per value.");
        seen.add(step.value);
      }
    }
  });

export type CountdownDetailsInput = z.infer<typeof countdownDetailsSchema>;
