import { describe, expect, it } from "vitest";

import {
  COUNTDOWN_REASON_MAX_LENGTH,
  createCountdownSchema,
  operateCountdownSchema,
} from "@/lib/validation/countdowns";

const campaignId = "11111111-1111-4111-8111-111111111111";
const countdownId = "22222222-2222-4222-8222-222222222222";
const idempotencyKey = "33333333-3333-4333-8333-333333333333";

describe("countdown validation", () => {
  it("accepts a valid constrained countdown", () => {
    expect(
      createCountdownSchema.parse({
        campaignId,
        name: "  Encroaching blight  ",
        description: "A threat approaches.",
        category: "threat",
        startingValue: "6",
        consequence: "The refuge is overrun.",
        idempotencyKey,
      }),
    ).toMatchObject({
      campaignId,
      name: "Encroaching blight",
      category: "threat",
      startingValue: 6,
    });
  });

  it("rejects unsupported categories and invalid starting values", () => {
    const base = {
      campaignId,
      name: "Project",
      description: "",
      consequence: "",
      idempotencyKey,
    };

    expect(
      createCountdownSchema.safeParse({
        ...base,
        category: "custom",
        startingValue: 6,
      }).success,
    ).toBe(false);
    expect(
      createCountdownSchema.safeParse({
        ...base,
        category: "project",
        startingValue: 0,
      }).success,
    ).toBe(false);
  });

  it("validates operation intent, mode, reason, and request key", () => {
    expect(
      operateCountdownSchema.safeParse({
        countdownId,
        intent: "advance",
        eventMode: "correction",
        reason: "Fix the previous step.",
        idempotencyKey,
      }).success,
    ).toBe(true);

    expect(
      operateCountdownSchema.safeParse({
        countdownId,
        intent: "complete",
        eventMode: "operation",
        reason: "x".repeat(COUNTDOWN_REASON_MAX_LENGTH + 1),
        idempotencyKey: "invalid",
      }).success,
    ).toBe(false);
  });
});
